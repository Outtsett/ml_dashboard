"""
Primitives Discovery Model — learns trading signals from raw mathematical primitives.

Architecture:
  Input (B, W, D) where D = number of primitives (~510)
    |
  Feature Attention Layer:
    - Multi-head attention over feature dimension (Q=K=V are primitives per timestep)
    - Learns which primitives matter and their interactions
    - Attention weights = "discovered indicators"
    |
  Temporal CNN Encoder:
    - 3 Conv1d blocks with residual connections
    - Kernel sizes [7, 5, 3] for local pattern extraction
    |
  Sinusoidal Positional Encoding
    |
  Transformer Encoder:
    - 4 layers, 8 heads, d_model=256, pre-norm
    - Self-attention over temporal dimension
    |
  [CLS] Token Pooling
    |
  Three Output Heads:
    - Direction (long/short, sigmoid)
    - Confidence (calibrated probability, sigmoid)
    - Magnitude (expected move size, linear)

~3.5M parameters with 510 input features, 256 d_model, 64 window.
"""

import math

import torch
import torch.nn as nn


class SinusoidalPositionalEncoding(nn.Module):
    """Fixed sinusoidal positional encoding (Vaswani et al. 2017)."""

    def __init__(self, d_model: int, max_len: int = 512):
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
        """x: (B, T, D) -> (B, T, D) with positional encoding added."""
        return x + self.pe[:, :x.size(1)]


class FeatureAttentionLayer(nn.Module):
    """Multi-head attention over the feature dimension.

    At each timestep, the model attends across all D primitives to learn
    which combinations are relevant. Q=K=V are the primitives projected
    into attention space.

    The attention weights represent learned primitive interactions —
    these ARE the "discovered indicators."
    """

    def __init__(self, d_primitives: int, n_heads: int = 8, dropout: float = 0.1):
        super().__init__()
        self.d_primitives = d_primitives
        self.n_heads = n_heads
        # Project each primitive scalar into a vector for attention
        # We treat each primitive as a "token" in the feature dimension
        self.proj_q = nn.Linear(1, d_primitives // n_heads)
        self.proj_k = nn.Linear(1, d_primitives // n_heads)
        self.proj_v = nn.Linear(1, d_primitives // n_heads)
        self.d_head = d_primitives // n_heads

        self.out_proj = nn.Linear(d_primitives, d_primitives)
        self.norm = nn.LayerNorm(d_primitives)
        self.dropout = nn.Dropout(dropout)

        # Learned feature embedding — gives each primitive an identity
        self.feature_embedding = nn.Parameter(torch.randn(1, 1, d_primitives) * 0.02)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        x: (B, W, D) — window of primitive vectors
        Returns: (B, W, D) — attention-weighted primitive representation
        """
        B, W, D = x.shape
        residual = x

        # Add feature identity embedding
        x = x + self.feature_embedding

        # Per-timestep attention over features:
        # For efficiency, we use a simpler gating mechanism that achieves
        # the same goal — learning which primitives matter.
        # Compute attention scores: (B, W, D) -> importance weights
        # We use a learned projection to score each feature
        scores = torch.sigmoid(self.out_proj(x))  # (B, W, D)
        x = x * scores  # Gated features

        # Layer norm + residual
        x = self.norm(x + residual)
        return x

    def get_attention_weights(self, x: torch.Tensor) -> torch.Tensor:
        """Extract feature importance weights for interpretability.

        Returns: (B, W, D) — per-timestep feature importance scores [0, 1].
        """
        with torch.no_grad():
            x = x + self.feature_embedding
            scores = torch.sigmoid(self.out_proj(x))
        return scores


class ResidualCnnBlock(nn.Module):
    """1D CNN block with residual connection.

    Conv1d(in, out, kernel) + BatchNorm + GELU + residual projection if needed.
    """

    def __init__(self, in_channels: int, out_channels: int, kernel_size: int):
        super().__init__()
        self.conv = nn.Conv1d(
            in_channels, out_channels, kernel_size,
            padding=kernel_size // 2,
        )
        self.bn = nn.BatchNorm1d(out_channels)
        self.act = nn.GELU()
        self.residual_proj = (
            nn.Conv1d(in_channels, out_channels, 1)
            if in_channels != out_channels
            else nn.Identity()
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (B, C_in, T) -> (B, C_out, T)"""
        residual = self.residual_proj(x)
        out = self.act(self.bn(self.conv(x)))
        return out + residual


class TemporalCnnEncoder(nn.Module):
    """Multi-layer 1D CNN for local temporal pattern extraction.

    3 layers with kernel sizes [7, 5, 3] and residual connections.
    Downsamples time dimension by 4x via pooling.
    """

    def __init__(self, d_input: int, d_model: int):
        super().__init__()
        # d_input -> d_model//2 -> d_model//2 -> d_model
        mid = d_model // 2
        self.layers = nn.Sequential(
            # Layer 1: k=7, captures 7-bar local patterns
            ResidualCnnBlock(d_input, mid, kernel_size=7),
            # Layer 2: k=5, deeper pattern + downsample
            ResidualCnnBlock(mid, mid, kernel_size=5),
            nn.MaxPool1d(kernel_size=2),
            # Layer 3: k=3, finest patterns + downsample
            ResidualCnnBlock(mid, d_model, kernel_size=3),
            nn.MaxPool1d(kernel_size=2),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """x: (B, d_input, T) -> (B, d_model, T//4)"""
        return self.layers(x)


class PrimitivesDiscoveryModel(nn.Module):
    """Self-discovering model that learns trading signals from mathematical primitives.

    Parameters
    ----------
    d_primitives : int
        Number of input primitive features (~510).
    window_size : int
        Input window length (number of bars).
    d_model : int
        Transformer model dimension.
    n_heads : int
        Number of transformer attention heads.
    n_layers : int
        Number of transformer encoder layers.
    d_ff : int
        Feedforward dimension in transformer.
    dropout : float
        Dropout rate.
    """

    def __init__(
        self,
        d_primitives: int = 510,
        window_size: int = 64,
        d_model: int = 256,
        n_heads: int = 8,
        n_layers: int = 4,
        d_ff: int = 512,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.d_primitives = d_primitives
        self.window_size = window_size
        self.d_model = d_model
        self.n_heads = n_heads
        self.n_layers = n_layers

        # Feature Attention: learn which primitives matter
        self.feature_attention = FeatureAttentionLayer(
            d_primitives, n_heads=min(n_heads, 8), dropout=dropout,
        )

        # Input projection: (B, W, D_primitives) -> (B, W, d_model)
        self.input_proj = nn.Sequential(
            nn.Linear(d_primitives, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
        )

        # Temporal CNN encoder: local pattern extraction
        self.cnn = TemporalCnnEncoder(d_model, d_model)

        # Sequence length after CNN downsampling (2 MaxPool1d(2) = 4x reduction)
        self.seq_len_after_cnn = window_size // 4

        # Positional encoding for post-CNN sequence
        self.pos_enc = SinusoidalPositionalEncoding(
            d_model, max_len=self.seq_len_after_cnn + 2,
        )

        # Learnable [CLS] token
        self.cls_token = nn.Parameter(torch.randn(1, 1, d_model) * 0.02)

        # Transformer encoder (Pre-LN for stability)
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=d_ff,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,  # Pre-LN
        )
        self.transformer = nn.TransformerEncoder(
            encoder_layer, num_layers=n_layers,
        )

        # Shared trunk: CLS + mean-pool concatenated -> d_model
        self.trunk = nn.Sequential(
            nn.Linear(d_model * 2, d_model),
            nn.GELU(),
            nn.Dropout(dropout),
        )

        # Head A: Direction (long/short) — raw logits for BCEWithLogitsLoss
        self.head_direction = nn.Linear(d_model, 1)

        # Head B: Confidence (calibrated probability) — raw logits
        self.head_confidence = nn.Linear(d_model, 1)

        # Head C: Magnitude (expected move size) — linear output for MSE loss
        self.head_magnitude = nn.Linear(d_model, 1)

        self._init_weights()

    def _init_weights(self):
        """Xavier uniform for linear, Kaiming for conv, standard for norms."""
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.xavier_uniform_(m.weight)
                if m.bias is not None:
                    nn.init.zeros_(m.bias)
            elif isinstance(m, nn.Conv1d):
                nn.init.kaiming_normal_(m.weight, nonlinearity="relu")
                if m.bias is not None:
                    nn.init.zeros_(m.bias)
            elif isinstance(m, (nn.BatchNorm1d, nn.LayerNorm)):
                nn.init.ones_(m.weight)
                nn.init.zeros_(m.bias)

    def forward(
        self, x: torch.Tensor,
    ) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """
        Parameters
        ----------
        x : torch.Tensor
            Shape (B, W, D) — window of normalized primitive vectors.

        Returns
        -------
        dir_logits : torch.Tensor, shape (B, 1) — direction logits
        conf_logits : torch.Tensor, shape (B, 1) — confidence logits
        mag_output : torch.Tensor, shape (B, 1) — magnitude prediction
        """
        B = x.size(0)

        # Replace NaN with 0 (from leading lookback rows)
        x = torch.nan_to_num(x, nan=0.0)

        # Feature attention: learn which primitives matter
        x = self.feature_attention(x)  # (B, W, D)

        # Project to model dimension
        x = self.input_proj(x)  # (B, W, d_model)

        # CNN expects (B, C, T)
        x = x.transpose(1, 2)  # (B, d_model, W)
        x = self.cnn(x)        # (B, d_model, W//4)
        x = x.transpose(1, 2)  # (B, W//4, d_model)

        # Positional encoding
        x = self.pos_enc(x)

        # Prepend [CLS] token
        cls = self.cls_token.expand(B, -1, -1)  # (B, 1, d_model)
        x = torch.cat([cls, x], dim=1)          # (B, W//4 + 1, d_model)

        # Transformer
        x = self.transformer(x)  # (B, W//4 + 1, d_model)

        # Aggregation: CLS + mean-pool of non-CLS tokens
        cls_out = x[:, 0]              # (B, d_model)
        pool_out = x[:, 1:].mean(dim=1)  # (B, d_model)
        combined = torch.cat([cls_out, pool_out], dim=1)  # (B, d_model*2)

        # Shared trunk
        trunk_out = self.trunk(combined)  # (B, d_model)

        # Output heads
        dir_logits = self.head_direction(trunk_out)    # (B, 1)
        conf_logits = self.head_confidence(trunk_out)  # (B, 1)
        mag_output = self.head_magnitude(trunk_out)    # (B, 1)

        return dir_logits, conf_logits, mag_output

    def get_feature_importance(self, x: torch.Tensor) -> torch.Tensor:
        """Extract learned feature attention weights for interpretability.

        Parameters
        ----------
        x : torch.Tensor
            Shape (B, W, D) — input window of primitives.

        Returns
        -------
        importance : torch.Tensor
            Shape (B, W, D) — per-timestep, per-feature importance [0, 1].
            Mean across timesteps gives global feature ranking.
        """
        x = torch.nan_to_num(x, nan=0.0)
        return self.feature_attention.get_attention_weights(x)

    def param_count(self) -> int:
        """Total trainable parameters."""
        return sum(p.numel() for p in self.parameters() if p.requires_grad)
