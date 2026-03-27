"""
CNN+Transformer multi-head predictor.

Architecture:
  Input (B, W, 5) → normalize → Linear(5, 128) → CnnBlock(128→128→256, 4x downsample)
  → SoftQuantizationLayer(K=32, d=256) → SinusoidalPE → Prepend [CLS]
  → TransformerEncoder(8L, 8H, d=256) → CLS ∥ mean-pool → trunk(512→256)
  → nn.ModuleDict heads

~6M parameters. Designed for raw OHLCV input with per-window normalization.
"""

import math
from collections.abc import Set as AbstractSet

import torch
import torch.nn as nn
import torch.nn.functional as F

# Default head configuration: {head_name: n_classes}
DEFAULT_HEAD_CONFIGS: dict[str, int] = {
    "barrier_class": 3,
    "vol_regime": 3,
    "return_bucket": 8,
}


class SinusoidalPositionalEncoding(nn.Module):
    """Fixed sinusoidal positional encoding (Vaswani et al. 2017)."""

    def __init__(self, d_model: int, max_len: int = 256):
        super().__init__()
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float32).unsqueeze(1)
        div_term = torch.exp(
            torch.arange(0, d_model, 2, dtype=torch.float32) * (-math.log(10000.0) / d_model)
        )
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        self.register_buffer("pe", pe.unsqueeze(0))  # (1, max_len, d_model)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (B, T, D) → (B, T, D) with positional encoding added."""
        return x + self.pe[:, : x.size(1)]


class CnnBlock(nn.Module):
    """3-layer 1D CNN for local pattern extraction.

    Conv1d(128,128,k=3) → Conv1d(128,128,k=5)+Pool(2) → Conv1d(128,256,k=5)+Pool(2)
    Downsamples time dimension 4x. Channels: 128 → 128 → 128 → 256.
    Effective receptive field ~22 bars.
    """

    def __init__(self, d_model: int = 128):
        super().__init__()
        self.layers = nn.Sequential(
            # Layer 1: k=3, single-bar and 2-bar candle patterns
            nn.Conv1d(d_model, d_model, kernel_size=3, padding=1),
            nn.BatchNorm1d(d_model),
            nn.GELU(),
            # Layer 2: k=5, 3-5 bar sequences + downsample
            nn.Conv1d(d_model, d_model, kernel_size=5, padding=2),
            nn.BatchNorm1d(d_model),
            nn.GELU(),
            nn.MaxPool1d(kernel_size=2),
            # Layer 3: k=5, deep extraction + expand channels + downsample
            nn.Conv1d(d_model, d_model * 2, kernel_size=5, padding=2),
            nn.BatchNorm1d(d_model * 2),
            nn.GELU(),
            nn.MaxPool1d(kernel_size=2),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (B, d_model, T) → (B, d_model*2, T//4)"""
        return self.layers(x)


class SoftQuantizationLayer(nn.Module):
    """Fully differentiable soft vector quantization via codebook attention.

    Per timestep:
      1. Project input x → query q via linear projection
      2. Compute softmax similarity between q and K codebook entries
      3. Output = weighted sum of codebook vectors (soft assignment)

    Learnable temperature τ (initialized to 1.0) scales the similarity logits,
    allowing the model to sharpen or soften cluster assignments during training.
    As τ → 0 the layer approaches hard VQ; as τ → ∞ it collapses to mean-pool.

    This is a continuous relaxation of the discrete VQ-VAE commitment step,
    allowing gradients to flow without straight-through estimation.
    """

    def __init__(self, d_model: int, n_codebook: int):
        super().__init__()
        # Codebook: K centroids in d_model-dim space
        self.codebook = nn.Parameter(torch.randn(n_codebook, d_model) * 0.02)
        # Linear projection to compute query from input
        self.proj = nn.Linear(d_model, d_model, bias=False)
        # Learnable inverse temperature (log scale for numerical stability)
        self.log_temperature = nn.Parameter(torch.zeros(1))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (B, T, D) → (B, T, D) soft-quantized output.

        Each token is replaced by a convex combination of codebook entries,
        weighted by softmax-normalized dot-product similarity.
        """
        # Project input to query space
        q = self.proj(x)  # (B, T, D)

        # Temperature-scaled similarity to each codebook entry
        # codebook: (K, D) → transposed for matmul: (D, K)
        temperature = self.log_temperature.exp()  # scalar > 0
        sim = torch.matmul(q, self.codebook.T) / (temperature + 1e-6)  # (B, T, K)

        # Soft assignment weights
        weights = F.softmax(sim, dim=-1)  # (B, T, K)

        # Weighted sum of codebook entries
        out = torch.matmul(weights, self.codebook)  # (B, T, D)

        return out


class CnnTransformerModel(nn.Module):
    """CNN+Transformer with dict-based multi-task classification heads.

    Parameters
    ----------
    window_size : int
        Input sequence length (number of bars per window).
    d_input : int
        Raw feature dimension (5 for OHLCV).
    d_model : int
        Model dimension for CNN projection, Transformer, and heads.
        CNN expands to d_model*2 before quantization; quantization projects back to d_model*2.
    n_heads : int
        Number of Transformer attention heads.
    n_layers : int
        Number of Transformer encoder layers.
    d_ff : int
        Feedforward dimension in Transformer.
    n_codebook : int
        Number of codebook entries in SoftQuantizationLayer.
    dropout : float
        Dropout rate.
    head_configs : dict[str, int] | None
        Maps head name → number of output classes.
        Defaults to {"barrier_class": 3, "vol_regime": 3, "return_bucket": 8}.
    """

    def __init__(
        self,
        window_size: int = 128,
        d_input: int = 5,
        d_model: int = 256,
        n_heads: int = 8,
        n_layers: int = 8,
        d_ff: int = 1024,
        n_codebook: int = 32,
        dropout: float = 0.1,
        head_configs: dict[str, int] | None = None,
    ):
        super().__init__()
        self.window_size = window_size
        self.d_model = d_model

        if head_configs is None:
            head_configs = dict(DEFAULT_HEAD_CONFIGS)

        # Input projection: (B, W, 5) → (B, W, 128) — half d_model for CNN input
        d_cnn_in = d_model // 2
        self.input_proj = nn.Linear(d_input, d_cnn_in)

        # CNN: (B, d_cnn_in, W) → (B, d_model, W//4)
        # CnnBlock doubles channels on layer 3: d_cnn_in → d_cnn_in*2 = d_model
        self.cnn = CnnBlock(d_model=d_cnn_in)

        # Sequence length after 4x CNN downsampling
        self.seq_len_after_cnn = window_size // 4

        # Soft quantization: (B, T, d_model) → (B, T, d_model)
        self.soft_quantization = SoftQuantizationLayer(d_model=d_model, n_codebook=n_codebook)

        # Positional encoding: max_len = seq_len_after_cnn + 1 (for CLS token)
        self.pos_enc = SinusoidalPositionalEncoding(
            d_model=d_model, max_len=self.seq_len_after_cnn + 1
        )

        # Learnable [CLS] token
        self.cls_token = nn.Parameter(torch.randn(1, 1, d_model) * 0.02)

        # Transformer encoder (Pre-LN for training stability)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_ff,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,  # Pre-LN
        )
        self.transformer = nn.TransformerEncoder(encoder_layer, num_layers=n_layers)

        # Aggregation trunk: concat(CLS, mean_pool) → (B, d_model*2) → (B, d_model)
        self.trunk = nn.Sequential(
            nn.Linear(d_model * 2, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
        )

        # Dict-based head registry (nn.ModuleDict so params register correctly)
        self.heads = nn.ModuleDict(
            {name: nn.Linear(d_model, n_out) for name, n_out in head_configs.items()}
        )

        self._init_weights()

    def _init_weights(self):
        """Xavier uniform for linear layers, Kaiming normal for conv, standard for BN."""
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)
            elif isinstance(m, nn.Conv1d):
                nn.init.kaiming_normal_(m.weight, nonlinearity="relu")
                if m.bias is not None:
                    nn.init.zeros_(m.bias)
            elif isinstance(m, nn.BatchNorm1d):
                nn.init.ones_(m.weight)
                nn.init.zeros_(m.bias)

    @staticmethod
    def normalize_batch(x: torch.Tensor) -> torch.Tensor:
        """Per-window normalization on GPU — vectorized over the batch.

        Price (O,H,L,C): (price - close[-1]) / close[-1]
        Volume:           (vol - mean) / (std + 1e-8)

        No future leakage — each window normalized against its own last close.
        """
        # x: (B, W, 5) — columns are [O, H, L, C, V]
        ref_close = x[:, -1, 3:4].unsqueeze(1)  # (B, 1, 1) — last close
        ref_close = ref_close.clamp(min=1e-8)

        price = (x[:, :, :4] - ref_close) / ref_close  # (B, W, 4)

        vol = x[:, :, 4:5]  # (B, W, 1)
        vol_mean = vol.mean(dim=1, keepdim=True)
        vol_std = vol.std(dim=1, keepdim=True)
        vol_norm = (vol - vol_mean) / (vol_std + 1e-8)

        return torch.cat([price, vol_norm], dim=-1)  # (B, W, 5)

    def forward(
        self,
        x: torch.Tensor,
        active_heads: AbstractSet[str] | None = None,
    ) -> dict[str, torch.Tensor | None]:
        """
        Parameters
        ----------
        x : torch.Tensor
            Shape (B, W, 5) — RAW OHLCV window (normalized here on GPU).
        active_heads : set[str] | None
            If None, compute all heads. If a set, only compute those heads;
            all others return None in the output dict.

        Returns
        -------
        dict[str, Tensor | None]
            Keys are head names. Values are logit tensors (B, n_classes) for
            active heads and None for inactive heads.
        """
        B = x.size(0)

        # Normalize on GPU — vectorized over batch
        x = self.normalize_batch(x)

        # Input projection: (B, W, 5) → (B, W, d_model//2)
        x = self.input_proj(x)

        # CNN expects (B, C, T) format
        x = x.transpose(1, 2)       # (B, d_model//2, W)
        x = self.cnn(x)             # (B, d_model, W//4)
        x = x.transpose(1, 2)       # (B, W//4, d_model)

        # Soft quantization: differentiable codebook projection
        x = self.soft_quantization(x)  # (B, W//4, d_model)

        # Prepend [CLS] token before positional encoding
        cls = self.cls_token.expand(B, -1, -1)  # (B, 1, d_model)
        x = torch.cat([cls, x], dim=1)          # (B, W//4 + 1, d_model)

        # Positional encoding
        x = self.pos_enc(x)

        # Transformer encoder
        x = self.transformer(x)  # (B, W//4 + 1, d_model)

        # Aggregation: CLS output ∥ mean pool of sequence tokens
        cls_out = x[:, 0]              # (B, d_model)
        pool_out = x[:, 1:].mean(dim=1)  # (B, d_model)
        combined = torch.cat([cls_out, pool_out], dim=1)  # (B, d_model*2)

        # Shared trunk
        trunk_out = self.trunk(combined)  # (B, d_model)

        # Apply heads — skip inactive heads
        result: dict[str, torch.Tensor | None] = {}
        for name, head in self.heads.items():
            if active_heads is None or name in active_heads:
                result[name] = head(trunk_out)
            # heads not in active_heads are omitted from result dict

        return result

    def param_count(self) -> int:
        """Total trainable parameters."""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)
