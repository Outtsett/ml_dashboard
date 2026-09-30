"""The two image models: a residual CNN and a vision transformer over candle columns.

Both read a (3, 128, 120) chart image (render.py) and give one logit per output class — a
(TA-Lib pattern, direction) pair — trained multi-label, because several patterns can fire on the
same bar (a doji is also a long-legged doji, a spinning top, a high wave ...).

CNN, parameter count printed by ``count_parameters``:
  (3,128,120) -> stem conv 3x3 32 -> down 64 (64,60) -> [res 64] -> down 128 (32,30)
  -> [res 128] -> down 256 (16,15) -> [res 256] -> global average + max pool (512) -> dropout -> K

ViT: one token per 16-row x 6-column patch (one candle wide) -> 8 x 20 = 160 tokens + [CLS],
  width 192, 6 pre-norm blocks, 6 heads, learned 2-D positions -> [CLS] -> K
"""

from __future__ import annotations

import torch
from torch import nn


class Residual(nn.Module):
    def __init__(self, channels: int) -> None:
        super().__init__()
        self.body = nn.Sequential(
            nn.Conv2d(channels, channels, 3, padding=1, bias=False), nn.BatchNorm2d(channels), nn.GELU(),
            nn.Conv2d(channels, channels, 3, padding=1, bias=False), nn.BatchNorm2d(channels),
        )
        self.act = nn.GELU()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.act(x + self.body(x))


def _down(cin: int, cout: int) -> nn.Module:
    return nn.Sequential(nn.Conv2d(cin, cout, 3, stride=2, padding=1, bias=False), nn.BatchNorm2d(cout), nn.GELU())


class CandleCNN(nn.Module):
    def __init__(self, classes: int, width: int = 32, dropout: float = 0.2) -> None:
        super().__init__()
        w = width
        self.features = nn.Sequential(
            nn.Conv2d(3, w, 3, padding=1, bias=False), nn.BatchNorm2d(w), nn.GELU(),
            _down(w, 2 * w), Residual(2 * w),
            _down(2 * w, 4 * w), Residual(4 * w),
            _down(4 * w, 8 * w), Residual(8 * w),
        )
        self.head = nn.Sequential(nn.Dropout(dropout), nn.Linear(16 * w, classes))

    def embed(self, x: torch.Tensor) -> torch.Tensor:
        f = self.features(x)
        return torch.cat([f.mean((2, 3)), f.amax((2, 3))], 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.head(self.embed(x))


class CandleViT(nn.Module):
    def __init__(self, classes: int, image_height: int = 128, image_width: int = 120, patch_height: int = 16,
                 patch_width: int = 6, dim: int = 192, depth: int = 6, heads: int = 6, dropout: float = 0.1) -> None:
        super().__init__()
        self.grid = (image_height // patch_height, image_width // patch_width)
        self.patch = nn.Conv2d(3, dim, (patch_height, patch_width), stride=(patch_height, patch_width))
        self.row_position = nn.Parameter(torch.zeros(1, dim, self.grid[0], 1))
        self.column_position = nn.Parameter(torch.zeros(1, dim, 1, self.grid[1]))
        self.cls = nn.Parameter(torch.zeros(1, 1, dim))
        layer = nn.TransformerEncoderLayer(dim, heads, dim * 4, dropout, activation="gelu", batch_first=True,
                                           norm_first=True)
        self.encoder = nn.TransformerEncoder(layer, depth, enable_nested_tensor=False)
        self.norm = nn.LayerNorm(dim)
        self.head = nn.Linear(dim, classes)
        for p in (self.row_position, self.column_position, self.cls):
            nn.init.trunc_normal_(p, std=0.02)

    def embed(self, x: torch.Tensor) -> torch.Tensor:
        tokens = self.patch(x) + self.row_position + self.column_position  # (B, dim, rows, columns)
        tokens = tokens.flatten(2).transpose(1, 2)
        tokens = torch.cat([self.cls.expand(len(tokens), -1, -1), tokens], 1)
        return self.norm(self.encoder(tokens)[:, 0])

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.head(self.embed(x))


ARCHITECTURES = {"cnn": CandleCNN, "vit": CandleViT}


def build(architecture: str, classes: int) -> nn.Module:
    return ARCHITECTURES[architecture](classes)


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)
