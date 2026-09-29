import torch
import torch.nn as nn
from .BaseModel import BaseModel

class HybridNorm(nn.Module):
    """
    Adaptive Normalization combining LayerNorm and RMSNorm.
    Stabilizes gradients under regime shifts (LayerNorm mean-centering)
    and improves convergence speed (RMSNorm scale-invariance).
    """
    def __init__(self, d_model: int, eps: float = 1e-5):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(d_model))
        self.bias = nn.Parameter(torch.zeros(d_model))
        self.alpha = nn.Parameter(torch.tensor(0.5)) # Learned blend factor

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # LayerNorm component
        mean = x.mean(dim=-1, keepdim=True)
        var = x.var(dim=-1, unbiased=False, keepdim=True)
        ln_x = (x - mean) / torch.sqrt(var + self.eps)
        
        # RMSNorm component
        rms = torch.sqrt(torch.mean(x**2, dim=-1, keepdim=True) + self.eps)
        rmsn_x = x / rms
        
        # Blend
        blend = torch.sigmoid(self.alpha)
        hybrid = blend * ln_x + (1 - blend) * rmsn_x
        
        return self.weight * hybrid + self.bias


class LearnedTemporalEncoding(nn.Module):
    """
    Learned positional encoding that allows the model to learn time-dependent 
    volatility patterns rather than static sine/cosine waves.
    """
    def __init__(self, d_model: int, max_seq_len: int = 5000):
        super().__init__()
        self.pe = nn.Embedding(max_seq_len, d_model)
        
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        seq_len = x.size(1)
        positions = torch.arange(seq_len, device=x.device).unsqueeze(0).expand(x.size(0), -1)
        return x + self.pe(positions)


class RegimeAwareAttention(nn.Module):
    """
    TIPS (Transformer with Inductive Prior Synthesis) + Dynamic Windowing.
    Adjusts attention span based on volatility/trend regime.
    """
    def __init__(self, d_model: int, nhead: int, dropout: float = 0.1):
        super().__init__()
        self.mha = nn.MultiheadAttention(d_model, nhead, dropout=dropout, batch_first=True)
        # Gate to modulate attention based on the 3 regime signals
        self.regime_gate = nn.Sequential(
            nn.Linear(3, d_model),
            nn.SiLU(),
            nn.Linear(d_model, 1),
            nn.Sigmoid()
        )
        self.norm = HybridNorm(d_model)

    def forward(self, x: torch.Tensor, regime_signals: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        # Explicit Normalization Gates for Regime Signals
        regime_signals = torch.nan_to_num(regime_signals, nan=0.0)
        regime_signals = torch.clamp(regime_signals, 0.0, 1.0)
        
        # Generate dynamic window scalar based on current regime
        current_regime = regime_signals[:, -1, :] # [Batch, 3]
        gate = self.regime_gate(current_regime).unsqueeze(1) # [Batch, 1, d_model]
        
        # TIPS (Inductive Prior Synthesis) - Causal/Local distance decay mask
        seq_len = x.size(1)
        positions = torch.arange(seq_len, dtype=torch.float32, device=x.device)
        distance = torch.abs(positions.unsqueeze(0) - positions.unsqueeze(1))
        # Add a scaled negative distance as a bias to pre-softmax logits (encourages local attention)
        tips_mask = -distance * 0.1 # [SeqLen, SeqLen]
        
        # Bi-directional joint attention with TIPS prior
        attn_out, attn_weights = self.mha(x, x, x, attn_mask=tips_mask)
        
        # Dynamically scale attention output based on regime
        gated_attn = attn_out * gate
        
        # Add & Norm
        out = self.norm(x + gated_attn)
        return out, attn_weights


class ProbabilisticTransformer(BaseModel):
    """
    Overview:
    A Time-Series Transformer tailored for financial microstructure prediction.
    Incorporates TIPS, Regime-Aware Attention, Hybrid Normalization, and Learned Temporal Encodings.
    """
    def __init__(self, config: dict, input_dim: int = 8, d_model: int = 64, nhead: int = 4, num_layers: int = 2, dropout: float = 0.1):
        super(ProbabilisticTransformer, self).__init__(config)
        
        # input_dim is 8 (5 OHLCV + 3 Regime)
        self.input_projection = nn.Linear(input_dim, d_model)
        self.pos_encoder = LearnedTemporalEncoding(d_model)
        
        self.layers = nn.ModuleList([
            RegimeAwareAttention(d_model, nhead, dropout) for _ in range(num_layers)
        ])
        
        self.ffns = nn.ModuleList([
            nn.Sequential(
                nn.Linear(d_model, d_model * 4),
                nn.SiLU(),
                nn.Dropout(dropout),
                nn.Linear(d_model * 4, d_model),
                HybridNorm(d_model)
            ) for _ in range(num_layers)
        ])
        
        # Direct-Mapping Forecasting Heads
        self.mean_head = nn.Linear(d_model, 1)
        self.var_head = nn.Sequential(
            nn.Linear(d_model, 1),
            nn.Softplus()
        )

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        # x shape: [Batch, SeqLen, 8]
        # Splitting out the 3 regime signals: vol_ratio, trend_str, autocorr
        regime_signals = x[:, :, -3:]
        
        # Project input to d_model
        x_proj = self.input_projection(x)
        x_proj = self.pos_encoder(x_proj)
        
        for attn_layer, ffn in zip(self.layers, self.ffns):
            x_proj, _ = attn_layer(x_proj, regime_signals)
            x_proj = ffn(x_proj)
        
        # Direct-Mapping: Context is the final bar
        context = x_proj[:, -1, :]
        
        mu = self.mean_head(context)
        var = self.var_head(context) + 1e-6 
        
        return mu, var
