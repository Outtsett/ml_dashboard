"""The multimodal network: one encoder per modality, attention fusion, one head per bracket.

    time, price, flow, cross, calendar, news   → per-modality MLP encoders   → tokens (H each)
    last `sequence_bars` 5-minute bars          → dilated temporal convolutions → token (H)
    [fusion token, modality tokens]              → 2-layer transformer encoder  → fusion token
    fusion token                                 → 4 logits: P(net win) for long/short x 2:1/3:1

Inputs are standardised with the fold's TRAINING rows only (mean/std, clipped to
±5); a missing value becomes 0 and a per-modality missing-share channel says
how much was missing. Modality dropout zeroes whole modality tokens during
training (never at inference), so the network cannot lean on one modality and
the ablation after training — each modality's token zeroed in turn on the test
quarter — measures what each modality contributes (AUC drop, per head).

Early-stopped on the fold's validation rows; per-head Platt calibration on the
same rows. Trains on the GPU when one is present.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import torch
from torch import nn

from multimodal.dataset import Dataset


@dataclass
class FusionParameters:
    epochs: int = 30
    hidden: int = 64
    dropout: float = 0.2
    sequence_bars: int = 48
    modality_dropout: float = 0.15
    batch_size: int = 512
    learning_rate: float = 1e-3
    weight_decay: float = 1e-4
    patience: int = 5
    seed: int = 7


class TabularEncoder(nn.Module):
    def __init__(self, width: int, hidden: int, dropout: float):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(width + 1, hidden * 2), nn.GELU(), nn.Dropout(dropout), nn.Linear(hidden * 2, hidden))

    def forward(self, x: torch.Tensor, missing_share: torch.Tensor) -> torch.Tensor:
        return self.net(torch.cat([x, missing_share], dim=1))


class SequenceEncoder(nn.Module):
    def __init__(self, channels: int, hidden: int, dropout: float):
        super().__init__()
        layers = []
        width = channels
        for dilation in (1, 2, 4, 8):
            layers += [nn.Conv1d(width, hidden, kernel_size=3, dilation=dilation, padding=dilation), nn.GELU(), nn.Dropout(dropout)]
            width = hidden
        self.net = nn.Sequential(*layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:   # x: (batch, bars, channels)
        h = self.net(x.transpose(1, 2))                  # (batch, hidden, bars)
        return h[:, :, -1] + h.mean(dim=2)               # the last bar's state plus the window's average


class FusionNetwork(nn.Module):
    def __init__(self, modality_widths: dict[str, int], sequence_channels: int, heads: int, p: FusionParameters):
        super().__init__()
        self.modalities = list(modality_widths)
        self.encoders = nn.ModuleDict({m: TabularEncoder(w, p.hidden, p.dropout) for m, w in modality_widths.items()})
        self.sequence = SequenceEncoder(sequence_channels, p.hidden, p.dropout) if sequence_channels else None
        tokens = len(self.modalities) + (1 if self.sequence is not None else 0)
        self.token_type = nn.Parameter(torch.randn(tokens + 1, p.hidden) * 0.02)
        self.fusion_token = nn.Parameter(torch.zeros(1, 1, p.hidden))
        layer = nn.TransformerEncoderLayer(p.hidden, nhead=4, dim_feedforward=p.hidden * 2, dropout=p.dropout, batch_first=True)
        self.fusion = nn.TransformerEncoder(layer, num_layers=2)
        self.head = nn.Sequential(nn.LayerNorm(p.hidden), nn.Linear(p.hidden, heads))
        self.modality_dropout = p.modality_dropout

    def token_names(self) -> list[str]:
        return self.modalities + (["sequence"] if self.sequence is not None else [])

    def forward(self, tabular: dict, missing: dict, sequence: torch.Tensor | None, drop: set[str] | None = None) -> torch.Tensor:
        tokens = [self.encoders[m](tabular[m], missing[m]) for m in self.modalities]
        if self.sequence is not None:
            tokens.append(self.sequence(sequence))
        stacked = torch.stack(tokens, dim=1)                                   # (batch, tokens, hidden)
        batch = stacked.shape[0]
        keep = torch.ones(batch, stacked.shape[1], 1, device=stacked.device)
        if self.training and self.modality_dropout > 0:
            keep = (torch.rand(batch, stacked.shape[1], 1, device=stacked.device) > self.modality_dropout).float()
        if drop:
            for k, name in enumerate(self.token_names()):
                if name in drop:
                    keep[:, k] = 0.0
        stacked = stacked * keep + self.token_type[1:].unsqueeze(0)
        sequence_in = torch.cat([self.fusion_token.expand(batch, 1, -1) + self.token_type[:1].unsqueeze(0), stacked], dim=1)
        fused = self.fusion(sequence_in)[:, 0]
        return self.head(fused)


def _standardise(x: np.ndarray, train_rows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    reference = x[train_rows]
    mean = np.nanmean(reference, axis=0)
    std = np.nanstd(reference, axis=0)
    std[~np.isfinite(std) | (std < 1e-9)] = 1.0
    mean[~np.isfinite(mean)] = 0.0
    z = np.clip((x - mean) / std, -5, 5)
    missing = np.isnan(z)
    z[missing] = 0.0
    return z.astype(np.float32), missing.mean(axis=1, keepdims=True).astype(np.float32)


def _sequences(data: Dataset, rows: np.ndarray, length: int, stats) -> np.ndarray:
    bars = data.sequence_bars
    index = data.sequence_index[rows]
    offsets = np.arange(-length + 1, 1)
    positions = np.clip(index[:, None] + offsets[None, :], 0, bars.shape[0] - 1)
    windows = bars[positions]                                   # (rows, length, channels)
    before_start = (index[:, None] + offsets[None, :]) < 0
    windows[before_start] = np.nan
    mean, std = stats
    z = np.clip((windows - mean) / std, -5, 5)
    z[np.isnan(z)] = 0.0
    return z.astype(np.float32)


def _platt(raw_logits: np.ndarray, y: np.ndarray) -> tuple[float, float]:
    from sklearn.linear_model import LogisticRegression

    if len(np.unique(y)) < 2:
        return 1.0, 0.0
    model = LogisticRegression(C=1.0).fit(raw_logits.reshape(-1, 1), y)
    return float(model.coef_[0, 0]), float(model.intercept_[0])


def fit_predict(data: Dataset, fold, heads, probabilities, p: FusionParameters, importances: list) -> dict:
    torch.manual_seed(p.seed + fold.index)
    np.random.seed(p.seed + fold.index)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    modalities = data.modalities()
    z, miss = {}, {}
    for m, columns in modalities.items():
        values = data.features[columns].to_numpy(np.float32).copy()
        z[m], miss[m] = _standardise(values, fold.train)
    use_sequence = data.sequence_bars is not None and p.sequence_bars > 1
    if use_sequence:
        reference = data.sequence_bars[np.unique(data.sequence_index[fold.train])]
        s_mean = np.nanmean(reference, axis=0)
        s_std = np.nanstd(reference, axis=0)
        s_std[~np.isfinite(s_std) | (s_std < 1e-9)] = 1.0
        s_mean[~np.isfinite(s_mean)] = 0.0
        stats = (s_mean, s_std)
    y = np.stack([data.heads[h].win.astype(np.float32) for h in heads], axis=1)
    mask = np.stack([data.heads[h].available for h in heads], axis=1).astype(np.float32)

    model = FusionNetwork({m: z[m].shape[1] for m in modalities}, len(data.sequence_columns) if use_sequence else 0, len(heads), p).to(device)
    optimiser = torch.optim.AdamW(model.parameters(), lr=p.learning_rate, weight_decay=p.weight_decay)
    loss_fn = nn.BCEWithLogitsLoss(reduction="none")

    def batch_tensors(rows):
        tab = {m: torch.from_numpy(z[m][rows]).to(device) for m in modalities}
        mis = {m: torch.from_numpy(miss[m][rows]).to(device) for m in modalities}
        seq = torch.from_numpy(_sequences(data, rows, p.sequence_bars, stats)).to(device) if use_sequence else None
        return tab, mis, seq

    def logits_for(rows, drop=None):
        model.eval()
        out = []
        with torch.no_grad():
            for start in range(0, rows.size, 4096):
                chunk = rows[start:start + 4096]
                tab, mis, seq = batch_tensors(chunk)
                out.append(model(tab, mis, seq, drop).float().cpu().numpy())
        return np.concatenate(out) if out else np.zeros((0, len(heads)))

    def validation_loss():
        logits = logits_for(fold.validation)
        target, weight = y[fold.validation], mask[fold.validation]
        loss = loss_fn(torch.from_numpy(logits), torch.from_numpy(target)).numpy() * weight
        return float(loss.sum() / max(weight.sum(), 1.0))

    best, best_state, waited, epochs_run = np.inf, None, 0, 0
    train_rows = fold.train.copy()
    for epoch in range(p.epochs):
        model.train()
        np.random.shuffle(train_rows)
        for start in range(0, train_rows.size, p.batch_size):
            rows = train_rows[start:start + p.batch_size]
            tab, mis, seq = batch_tensors(rows)
            logits = model(tab, mis, seq)
            target = torch.from_numpy(y[rows]).to(device)
            weight = torch.from_numpy(mask[rows]).to(device)
            loss = (loss_fn(logits, target) * weight).sum() / weight.sum().clamp(min=1.0)
            optimiser.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimiser.step()
        epochs_run = epoch + 1
        current = validation_loss()
        if current < best - 1e-5:
            best, waited = current, 0
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
        else:
            waited += 1
            if waited >= p.patience:
                break
    if best_state is not None:
        model.load_state_dict(best_state)

    valid_logits = logits_for(fold.validation)
    test_logits = logits_for(fold.test)
    calibration = {}
    for j, name in enumerate(heads):
        available = mask[fold.validation, j] > 0
        a, b = _platt(valid_logits[available, j], y[fold.validation, j][available])
        calibration[name] = (a, b)
        probabilities[name][fold.test] = 1.0 / (1.0 + np.exp(-(a * test_logits[:, j] + b)))

    # modality ablation on the test quarter: AUC with each token zeroed, per head
    from sklearn.metrics import roc_auc_score

    def head_auc(logits, j):
        available = mask[fold.test, j] > 0
        target = y[fold.test, j][available]
        if available.sum() < 50 or len(np.unique(target)) < 2:
            return np.nan
        return float(roc_auc_score(target, logits[available, j]))

    full = {name: head_auc(test_logits, j) for j, name in enumerate(heads)}
    for token in model.token_names():
        ablated = logits_for(fold.test, drop={token})
        for j, name in enumerate(heads):
            importances.append({"fold": fold.name, "head": name, "feature": f"{token}__token", "gain_share": np.nan,
                                "auc_full": full[name], "auc_without": head_auc(ablated, j),
                                "auc_drop": full[name] - head_auc(ablated, j)})
    return {"epochs_run": epochs_run, "validation_loss": best, "device": str(device)}
