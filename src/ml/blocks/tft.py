"""Temporal Fusion Transformer building blocks (Lim et al. 2019).

Public API:
    GatedLinearUnit(input_size, output_size=None, dropout=0.0)
    GatedResidualNetwork(input_size, hidden_size, output_size=None,
                         dropout=0.0, context_size=None)
    VariableSelectionNetwork(num_inputs, input_dim, hidden_size,
                             dropout=0.0, context_size=None)
    InterpretableMultiHeadAttention(d_model, n_heads, dropout=0.0)
    TemporalFusionTransformer(n_features, window_size, d_model=64, n_heads=4,
                              lstm_layers=1, dropout=0.1, n_classes=2,
                              hidden_size=None)

Faithful re-implementation of the components from Bryan Lim, Sercan O. Arik,
Nicolas Loeff & Tomas Pfister, "Temporal Fusion Transformers for Interpretable
Multi-horizon Time Series Forecasting" (arXiv:1912.09363), ADAPTED for
single-shot CLASSIFICATION over a rolling feature window rather than the
paper's quantile multi-horizon forecasting decoder.

Mapping to the paper's Section 3:
- Eq. (2)/(3)   GLU + Add & Norm  -> ``GatedLinearUnit`` + the gated-skip pattern
                                      inlined in ``TemporalFusionTransformer``.
- Eq. (2)-(4)   Gated Residual Network -> ``GatedResidualNetwork`` (GRN), with the
                                      optional static context vector ``c`` folded
                                      into the first dense layer (Eq. 3).
- Eq. (6)-(8)   Variable Selection Network -> ``VariableSelectionNetwork`` (VSN);
                                      here every engineered scalar feature is one
                                      "variable" with ``input_dim == 1``.
- Section 4.4   Interpretable Multi-Head Attention -> ``InterpretableMultiHeadAttention``
                                      (shared value across heads, head-averaged
                                      output) -- the source of the
                                      ``temporal_attention`` interpretability map.

The forecasting decoder (future inputs, quantile outputs) is intentionally
dropped: this variant consumes a single window ``(B, W, F)`` of past features and
emits one classification logit set from the last temporal position.
"""

from __future__ import annotations

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F


class GatedLinearUnit(nn.Module):
    """Gated Linear Unit (Dauphin et al. 2017), TFT Eq. (5) gate.

    Computes ``GLU(x) = Linear_a(drop(x)) * sigmoid(Linear_b(drop(x)))``. The
    elementwise sigmoid gate lets the network suppress (gate toward 0) any
    contribution that is unhelpful for the current sample, which is the
    mechanism the paper uses to make every sub-block skippable.

    forward contract:
        input:  (..., input_size)
        output: (..., output_size)  -- output_size defaults to input_size
    """

    def __init__(self, input_size: int, output_size: int | None = None, dropout: float = 0.0):
        super().__init__()
        if input_size <= 0:
            raise ValueError(f"input_size must be > 0, got {input_size}")
        output_size = input_size if output_size is None else output_size
        if output_size <= 0:
            raise ValueError(f"output_size must be > 0, got {output_size}")
        if not 0.0 <= dropout < 1.0:
            raise ValueError(f"dropout must be in [0, 1), got {dropout}")

        self.input_size = input_size
        self.output_size = output_size
        self.dropout = nn.Dropout(dropout)
        self.fc_value = nn.Linear(input_size, output_size)
        self.fc_gate = nn.Linear(input_size, output_size)
        self._init_weights()

    def _init_weights(self) -> None:
        for m in (self.fc_value, self.fc_gate):
            nn.init.xavier_uniform_(m.weight)
            if m.bias is not None:
                nn.init.zeros_(m.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # input:  (..., input_size)
        # output: (..., output_size)
        x = self.dropout(x)
        return self.fc_value(x) * torch.sigmoid(self.fc_gate(x))


class GatedResidualNetwork(nn.Module):
    """Gated Residual Network (TFT Eq. 2-4) -- the universal TFT processing unit.

    Pipeline (paper notation, ``a`` is the pre-activation hidden state):
        a   = ELU(W1 x + b1 + (W_ctx c if context is not None))   # Eq. (3)
        a   = W2 a + b2                                            # Eq. (4) dense
        out = LayerNorm(skip(x) + GLU(dropout(a)))                # Eq. (2)

    The optional static context ``c`` (``context_size``) is injected additively
    into the first dense layer WITHOUT its own bias, exactly as in Eq. (3). The
    residual ``skip(x)`` is the identity when input and output dims match,
    otherwise a learned linear projection so the add is shape-valid.

    forward contract:
        input:  x (..., input_size), context (..., context_size) | None
        output: (..., output_size)  -- output_size defaults to input_size
    """

    def __init__(
        self,
        input_size: int,
        hidden_size: int,
        output_size: int | None = None,
        dropout: float = 0.0,
        context_size: int | None = None,
    ):
        super().__init__()
        if input_size <= 0:
            raise ValueError(f"input_size must be > 0, got {input_size}")
        if hidden_size <= 0:
            raise ValueError(f"hidden_size must be > 0, got {hidden_size}")
        output_size = input_size if output_size is None else output_size
        if output_size <= 0:
            raise ValueError(f"output_size must be > 0, got {output_size}")
        if context_size is not None and context_size <= 0:
            raise ValueError(f"context_size must be > 0 or None, got {context_size}")
        if not 0.0 <= dropout < 1.0:
            raise ValueError(f"dropout must be in [0, 1), got {dropout}")

        self.input_size = input_size
        self.hidden_size = hidden_size
        self.output_size = output_size
        self.context_size = context_size

        self.fc1 = nn.Linear(input_size, hidden_size)
        # Context contributes additively to the Eq. (3) pre-activation, no bias.
        self.fc_context = (
            nn.Linear(context_size, hidden_size, bias=False) if context_size is not None else None
        )
        self.fc2 = nn.Linear(hidden_size, output_size)
        self.glu = GatedLinearUnit(output_size, output_size, dropout=dropout)
        self.layer_norm = nn.LayerNorm(output_size)
        self.skip = (
            nn.Identity() if input_size == output_size else nn.Linear(input_size, output_size)
        )
        self.dropout = nn.Dropout(dropout)
        self._init_weights()

    def _init_weights(self) -> None:
        for m in (self.fc1, self.fc2):
            nn.init.xavier_uniform_(m.weight)
            if m.bias is not None:
                nn.init.zeros_(m.bias)
        if self.fc_context is not None:
            nn.init.xavier_uniform_(self.fc_context.weight)
        if isinstance(self.skip, nn.Linear):
            nn.init.xavier_uniform_(self.skip.weight)
            if self.skip.bias is not None:
                nn.init.zeros_(self.skip.bias)

    def forward(self, x: torch.Tensor, context: torch.Tensor | None = None) -> torch.Tensor:
        # input:  x (..., input_size), context (..., context_size) | None
        # output: (..., output_size)
        if (context is None) != (self.fc_context is None):
            raise ValueError(
                "context must be provided iff the GRN was built with context_size; "
                f"got context={'set' if context is not None else 'None'}, "
                f"context_size={self.context_size}"
            )
        a = self.fc1(x)
        if self.fc_context is not None:
            a = a + self.fc_context(context)
        a = F.elu(a)
        a = self.fc2(a)
        return self.layer_norm(self.skip(x) + self.glu(self.dropout(a)))


class VariableSelectionNetwork(nn.Module):
    """Variable Selection Network (TFT Eq. 6-8) for per-timestep feature gating.

    Each of ``num_inputs`` variables is an ``input_dim``-wide vector (for
    engineered scalar features ``input_dim == 1``). Two GRN families:

    1. Per-variable transform GRNs (``input_dim -> hidden_size``), one per
       variable, producing the processed representation ``xi_tilde`` (Eq. 7).
    2. A selection GRN over the FLATTENED ``num_inputs * input_dim`` vector
       producing ``num_inputs`` logits, softmaxed into selection weights
       ``v`` (Eq. 6).

    The output is the weighted sum ``sum_v v[:, j] * grn_j(x[:, j, :])`` (Eq. 8).
    The selection weights ``v`` are the per-variable importances surfaced for
    interpretability.

    forward contract:
        input:  x (B, num_inputs, input_dim), context (B, context_size) | None
        output: (selected (B, hidden_size), weights (B, num_inputs))
    """

    def __init__(
        self,
        num_inputs: int,
        input_dim: int,
        hidden_size: int,
        dropout: float = 0.0,
        context_size: int | None = None,
    ):
        super().__init__()
        if num_inputs <= 0:
            raise ValueError(f"num_inputs must be > 0, got {num_inputs}")
        if input_dim <= 0:
            raise ValueError(f"input_dim must be > 0, got {input_dim}")
        if hidden_size <= 0:
            raise ValueError(f"hidden_size must be > 0, got {hidden_size}")
        if context_size is not None and context_size <= 0:
            raise ValueError(f"context_size must be > 0 or None, got {context_size}")
        if not 0.0 <= dropout < 1.0:
            raise ValueError(f"dropout must be in [0, 1), got {dropout}")

        self.num_inputs = num_inputs
        self.input_dim = input_dim
        self.hidden_size = hidden_size
        self.context_size = context_size

        # Selection GRN: flattened variables -> per-variable softmax logits.
        # Context (if any) enters this GRN only (Eq. 6).
        self.selection_grn = GatedResidualNetwork(
            input_size=num_inputs * input_dim,
            hidden_size=hidden_size,
            output_size=num_inputs,
            dropout=dropout,
            context_size=context_size,
        )
        # One transform GRN per variable (Eq. 7); no context here.
        self.variable_grns = nn.ModuleList(
            [
                GatedResidualNetwork(
                    input_size=input_dim,
                    hidden_size=hidden_size,
                    output_size=hidden_size,
                    dropout=dropout,
                    context_size=None,
                )
                for _ in range(num_inputs)
            ]
        )

    def forward(
        self, x: torch.Tensor, context: torch.Tensor | None = None
    ) -> tuple[torch.Tensor, torch.Tensor]:
        # input:  x (B, num_inputs, input_dim), context (B, context_size) | None
        # output: (selected (B, hidden_size), weights (B, num_inputs))
        if x.dim() != 3:
            raise ValueError(f"x must be (B, num_inputs, input_dim), got shape {tuple(x.shape)}")
        if x.size(1) != self.num_inputs or x.size(2) != self.input_dim:
            raise ValueError(
                f"x shape {tuple(x.shape)} != (B, {self.num_inputs}, {self.input_dim})"
            )

        flat = x.reshape(x.size(0), self.num_inputs * self.input_dim)  # (B, num*dim)
        logits = self.selection_grn(flat, context=context)  # (B, num_inputs)
        weights = torch.softmax(logits, dim=-1)  # (B, num_inputs)

        # Per-variable transforms -> stack (B, num_inputs, hidden_size).
        processed = torch.stack(
            [self.variable_grns[j](x[:, j, :]) for j in range(self.num_inputs)],
            dim=1,
        )
        # Weighted combination (Eq. 8): broadcast weights over hidden dim.
        selected = (weights.unsqueeze(-1) * processed).sum(dim=1)  # (B, hidden_size)
        return selected, weights


class InterpretableMultiHeadAttention(nn.Module):
    """Interpretable multi-head attention (TFT Section 4.4).

    Differs from vanilla Transformer MHA in two ways that make the attention
    weights directly interpretable:

    1. A SINGLE shared value projection ``V`` across all heads (instead of one
       per head). Because every head attends to the same values, the per-head
       attention matrices live in a common output basis and can be averaged.
    2. The head outputs are AVERAGED (not concatenated) before the final output
       linear, so the returned ``attn`` is a single ``(B, T, T)`` matrix that
       faithfully describes how outputs mix over time.

    Scaling is ``1/sqrt(d_head)`` with ``d_head = d_model / n_heads``. An optional
    additive ``mask`` (broadcastable to ``(B, T, T)`` or ``(T, T)``) is added to
    the pre-softmax scores; entries set to ``-inf`` are excluded.

    forward contract:
        input:  q,k,v each (B, T, d_model), mask (T, T) | (B, T, T) | None
        output: (out (B, T, d_model), attn (B, T, T) averaged over heads)
    """

    def __init__(self, d_model: int, n_heads: int, dropout: float = 0.0):
        super().__init__()
        if d_model <= 0:
            raise ValueError(f"d_model must be > 0, got {d_model}")
        if n_heads <= 0 or d_model % n_heads != 0:
            raise ValueError(f"d_model ({d_model}) must be divisible by n_heads ({n_heads})")
        if not 0.0 <= dropout < 1.0:
            raise ValueError(f"dropout must be in [0, 1), got {dropout}")

        self.d_model = d_model
        self.n_heads = n_heads
        self.d_head = d_model // n_heads

        # Per-head Q, K projections; SINGLE shared V projection (Section 4.4).
        self.q_proj = nn.Linear(d_model, d_model)
        self.k_proj = nn.Linear(d_model, d_model)
        self.v_proj = nn.Linear(d_model, self.d_head)  # shared across heads
        self.out_proj = nn.Linear(self.d_head, d_model)
        self.dropout = nn.Dropout(dropout)
        self._init_weights()

    def _init_weights(self) -> None:
        for m in (self.q_proj, self.k_proj, self.v_proj, self.out_proj):
            nn.init.xavier_uniform_(m.weight)
            if m.bias is not None:
                nn.init.zeros_(m.bias)

    def forward(
        self,
        q: torch.Tensor,
        k: torch.Tensor,
        v: torch.Tensor,
        mask: torch.Tensor | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        # input:  q,k,v (B, T, d_model); mask (T, T) | (B, T, T) | None
        # output: (out (B, T, d_model), attn (B, T, T))
        if q.dim() != 3 or k.dim() != 3 or v.dim() != 3:
            raise ValueError("q, k, v must each be 3-D (B, T, d_model)")
        B, T, _ = q.shape

        # Per-head Q, K: (B, H, T, d_head).
        qh = self.q_proj(q).view(B, T, self.n_heads, self.d_head).transpose(1, 2)
        kh = self.k_proj(k).view(B, T, self.n_heads, self.d_head).transpose(1, 2)
        # Shared V: (B, T, d_head) -> broadcast over heads.
        vs = self.v_proj(v)  # (B, T, d_head)

        scores = torch.matmul(qh, kh.transpose(-2, -1)) / (self.d_head**0.5)  # (B,H,T,T)
        if mask is not None:
            # Broadcast (T, T) or (B, T, T) up to (B, H, T, T).
            if mask.dim() == 2:
                mask = mask.unsqueeze(0).unsqueeze(0)
            elif mask.dim() == 3:
                mask = mask.unsqueeze(1)
            else:
                raise ValueError(f"mask must be 2-D or 3-D, got shape {tuple(mask.shape)}")
            scores = scores + mask

        attn = torch.softmax(scores, dim=-1)  # (B, H, T, T)
        attn = self.dropout(attn)
        # Shared values: (B, 1, T, d_head) broadcast over heads.
        head_out = torch.matmul(attn, vs.unsqueeze(1))  # (B, H, T, d_head)

        # Average over heads (Section 4.4) -> (B, T, d_head) then project up.
        out = head_out.mean(dim=1)  # (B, T, d_head)
        out = self.out_proj(out)  # (B, T, d_model)
        attn_mean = attn.mean(dim=1)  # (B, T, T)
        return out, attn_mean


class TemporalFusionTransformer(nn.Module):
    """Temporal Fusion Transformer for single-shot window classification.

    Adapts Lim et al. 2019 to consume one rolling window ``(B, W, F)`` of
    engineered features and emit a classification logit set from the final
    temporal position. Static-covariate encoders and the quantile/multi-horizon
    decoder are removed; everything else follows the paper.

    ASCII pipeline (W = window_size, F = n_features, H = hidden_size):

        x (B, W, F)
          |  reshape -> (B*W, F, 1)
          v
        (a) Variable Selection Network  ----------------------------------+
          |  selected (B, W, H), var weights (B, W, F)                    | cached:
          v                                                               | last_variable_weights
        (b) LSTM(H, H, lstm_layers)  local temporal encoder               |
          |  lstm_out (B, W, H)                                           |
          |  GLU + Add(vsn) + LayerNorm  (gated skip vs VSN output)       |
          v                                                               |
        (c) Static enrichment GRN (context=None), position-wise           |
          |  enriched (B, W, H)                                           |
          v                                                               |
        (d) InterpretableMultiHeadAttention(q=k=v=enriched, mask opt.)    |
          |  attn_out (B, W, H), temporal attn (B, W, W) ----------------+|
          |  GLU + Add(enriched) + LayerNorm                             cached:
          v                                                              last_attention
        (e) Position-wise feed-forward GRN
          |  GLU + Add + LayerNorm
          v
        (f) take last timestep (B, H) -> output Linear
          v
        logits: (B,) single logit if n_classes == 2 (BCEWithLogits-ready)
                (B, n_classes) raw logits if n_classes > 2 (CrossEntropy-ready)

    forward contract:
        input:  x (B, window_size, n_features)
        output: (B,) if n_classes == 2 else (B, n_classes)

    Interpretability tensors are cached every forward:
        self.last_variable_weights  (B, W, F)
        self.last_attention         (B, W, W)
    Use ``interpretability()`` for batch-aggregated numpy summaries.
    """

    def __init__(
        self,
        n_features: int,
        window_size: int,
        d_model: int = 64,
        n_heads: int = 4,
        lstm_layers: int = 1,
        dropout: float = 0.1,
        n_classes: int = 2,
        hidden_size: int | None = None,
    ):
        super().__init__()
        if n_features <= 0:
            raise ValueError(f"n_features must be > 0, got {n_features}")
        if window_size <= 0:
            raise ValueError(f"window_size must be > 0, got {window_size}")
        if d_model <= 0:
            raise ValueError(f"d_model must be > 0, got {d_model}")
        if lstm_layers <= 0:
            raise ValueError(f"lstm_layers must be > 0, got {lstm_layers}")
        if n_classes < 2:
            raise ValueError(f"n_classes must be >= 2, got {n_classes}")
        if not 0.0 <= dropout < 1.0:
            raise ValueError(f"dropout must be in [0, 1), got {dropout}")

        hidden_size = d_model if hidden_size is None else hidden_size
        if hidden_size <= 0:
            raise ValueError(f"hidden_size must be > 0, got {hidden_size}")
        if n_heads <= 0 or hidden_size % n_heads != 0:
            raise ValueError(
                f"hidden_size ({hidden_size}) must be divisible by n_heads ({n_heads})"
            )

        self.n_features = n_features
        self.window_size = window_size
        self.d_model = d_model
        self.n_heads = n_heads
        self.lstm_layers = lstm_layers
        self.hidden_size = hidden_size
        self.n_classes = n_classes
        # Single logit for the binary case (BCEWithLogits), else one per class.
        self.output_size = 1 if n_classes == 2 else n_classes

        # (a) Variable selection over the F scalar features (input_dim=1).
        self.vsn = VariableSelectionNetwork(
            num_inputs=n_features,
            input_dim=1,
            hidden_size=hidden_size,
            dropout=dropout,
            context_size=None,
        )

        # (b) Local temporal encoder.
        self.lstm = nn.LSTM(
            input_size=hidden_size,
            hidden_size=hidden_size,
            num_layers=lstm_layers,
            batch_first=True,
            dropout=dropout if lstm_layers > 1 else 0.0,
        )
        self.lstm_glu = GatedLinearUnit(hidden_size, hidden_size, dropout=dropout)
        self.lstm_norm = nn.LayerNorm(hidden_size)

        # (c) Static enrichment GRN (no static covariates -> context=None).
        self.enrichment_grn = GatedResidualNetwork(
            input_size=hidden_size,
            hidden_size=hidden_size,
            output_size=hidden_size,
            dropout=dropout,
            context_size=None,
        )

        # (d) Interpretable temporal self-attention.
        self.attention = InterpretableMultiHeadAttention(
            d_model=hidden_size, n_heads=n_heads, dropout=dropout
        )
        self.attn_glu = GatedLinearUnit(hidden_size, hidden_size, dropout=dropout)
        self.attn_norm = nn.LayerNorm(hidden_size)

        # (e) Position-wise feed-forward GRN.
        self.ffn_grn = GatedResidualNetwork(
            input_size=hidden_size,
            hidden_size=hidden_size,
            output_size=hidden_size,
            dropout=dropout,
            context_size=None,
        )
        self.ffn_glu = GatedLinearUnit(hidden_size, hidden_size, dropout=dropout)
        self.ffn_norm = nn.LayerNorm(hidden_size)

        # (f) Output projection from the last timestep.
        self.output_layer = nn.Linear(hidden_size, self.output_size)
        self._init_output()

        # Interpretability caches (populated on every forward).
        self.last_variable_weights: torch.Tensor | None = None
        self.last_attention: torch.Tensor | None = None

    def _init_output(self) -> None:
        nn.init.xavier_uniform_(self.output_layer.weight)
        if self.output_layer.bias is not None:
            nn.init.zeros_(self.output_layer.bias)
        # LSTM: Xavier on input-hidden, orthogonal on hidden-hidden, zero biases.
        for name, param in self.lstm.named_parameters():
            if "weight_ih" in name:
                nn.init.xavier_uniform_(param)
            elif "weight_hh" in name:
                nn.init.orthogonal_(param)
            elif "bias" in name:
                nn.init.zeros_(param)

    def forward(self, x: torch.Tensor, causal: bool = False) -> torch.Tensor:
        # input:  x (B, window_size, n_features)
        # output: (B,) if n_classes == 2 else (B, n_classes)
        if x.dim() != 3:
            raise ValueError(f"x must be (B, W, F), got shape {tuple(x.shape)}")
        B, W, F_in = x.shape
        if W != self.window_size or F_in != self.n_features:
            raise ValueError(
                f"x shape {tuple(x.shape)} != (B, {self.window_size}, {self.n_features})"
            )

        # (a) Variable selection per timestep. Flatten time into batch so the
        #     VSN treats each (sample, t) independently, then restore (B, W, .).
        x_flat = x.reshape(B * W, F_in, 1)  # (B*W, F, 1)
        selected, weights = self.vsn(x_flat)  # (B*W, H), (B*W, F)
        selected = selected.reshape(B, W, self.hidden_size)  # (B, W, H)
        self.last_variable_weights = weights.reshape(B, W, F_in)  # (B, W, F)

        # (b) LSTM local encoder + gated skip vs VSN output.
        lstm_out, _ = self.lstm(selected)  # (B, W, H)
        temporal = self.lstm_norm(selected + self.lstm_glu(lstm_out))  # (B, W, H)

        # (c) Static enrichment (position-wise GRN, no static context).
        enriched = self.enrichment_grn(temporal)  # (B, W, H)

        # (d) Interpretable self-attention over the W timesteps + gated skip.
        mask = None
        if causal:
            # Upper-triangular -inf additive mask (each step sees <= itself).
            mask = torch.full((W, W), float("-inf"), device=x.device, dtype=x.dtype)
            mask = torch.triu(mask, diagonal=1)
        attn_out, attn = self.attention(enriched, enriched, enriched, mask=mask)  # (B,W,H),(B,W,W)
        self.last_attention = attn  # (B, W, W)
        attended = self.attn_norm(enriched + self.attn_glu(attn_out))  # (B, W, H)

        # (e) Position-wise feed-forward + gated skip.
        ffn = self.ffn_grn(attended)  # (B, W, H)
        out_seq = self.ffn_norm(attended + self.ffn_glu(ffn))  # (B, W, H)

        # (f) Last-timestep representation -> output logits.
        last = out_seq[:, -1, :]  # (B, H)
        logits = self.output_layer(last)  # (B, output_size)
        if self.n_classes == 2:
            return logits.squeeze(-1)  # (B,)
        return logits  # (B, n_classes)

    def interpretability(self) -> dict[str, np.ndarray]:
        """Batch-aggregated interpretability summaries from the last forward.

        Returns detached CPU numpy arrays:
            "variable_selection"      (F,)   -- mean variable importance over
                                                batch AND time.
            "variable_selection_time" (W, F) -- mean variable importance over
                                                batch, kept per-timestep.
            "temporal_attention"      (W, W) -- mean interpretable attention map
                                                over batch.

        Raises ``RuntimeError`` if called before any forward pass.
        """
        if self.last_variable_weights is None or self.last_attention is None:
            raise RuntimeError("interpretability() requires a prior forward() call")
        vw = self.last_variable_weights.detach().cpu()  # (B, W, F)
        attn = self.last_attention.detach().cpu()  # (B, W, W)
        return {
            "variable_selection": vw.mean(dim=(0, 1)).numpy(),  # (F,)
            "variable_selection_time": vw.mean(dim=0).numpy(),  # (W, F)
            "temporal_attention": attn.mean(dim=0).numpy(),  # (W, W)
        }


if __name__ == "__main__":
    # Smoke test -- run with: uv run python src/ml/blocks/tft.py
    torch.manual_seed(0)

    # Binary variant: n_classes == 2 -> single logit per sample.
    model_bin = TemporalFusionTransformer(
        n_features=20, window_size=32, d_model=32, n_heads=4, lstm_layers=1, n_classes=2
    )
    x = torch.randn(8, 32, 20)
    logits_bin = model_bin(x)
    assert logits_bin.shape == (8,), f"binary logits shape {tuple(logits_bin.shape)} != (8,)"

    # 3-class variant -> (B, n_classes) raw logits.
    model_multi = TemporalFusionTransformer(
        n_features=20, window_size=32, d_model=32, n_heads=4, lstm_layers=1, n_classes=3
    )
    logits_multi = model_multi(x)
    assert logits_multi.shape == (8, 3), (
        f"3-class logits shape {tuple(logits_multi.shape)} != (8, 3)"
    )

    # Interpretability summaries (use the binary model's cached tensors).
    interp = model_bin.interpretability()
    assert interp["variable_selection"].shape == (20,), interp["variable_selection"].shape
    assert interp["variable_selection_time"].shape == (32, 20), interp[
        "variable_selection_time"
    ].shape
    assert interp["temporal_attention"].shape == (32, 32), interp["temporal_attention"].shape
    # Selection weights must form a valid distribution over variables per (B, t).
    sel_time_sum = interp["variable_selection_time"].sum(axis=1)
    assert np.allclose(sel_time_sum, 1.0, atol=1e-4), (
        f"variable selection rows must sum to 1, got {sel_time_sum[:3]}"
    )

    # Multi-layer LSTM + causal-mask path exercised for coverage.
    model_deep = TemporalFusionTransformer(
        n_features=20, window_size=32, d_model=32, n_heads=4, lstm_layers=2, n_classes=2
    )
    logits_causal = model_deep(x, causal=True)
    assert logits_causal.shape == (8,), tuple(logits_causal.shape)

    print("TFT_SMOKE_OK")
