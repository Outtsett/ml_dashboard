"""Draw candlestick windows as images, on the GPU, in batches.

A window is the last ``W`` bars ending at the bar being labelled (TA-Lib decides every one of its
61 patterns from the last 15 bars, measured: ``tests/test_candle_vision.py``). Each window is scaled
to its own lowest low .. highest high, so the image carries shape and never price level.

Three channels, each ``height`` x ``W * candle_width`` pixels, row 0 at the top:
  0  silhouette: the wick (one column at the candle's centre) and the body (four columns)
  1  rising body (close >= open, TA-Lib's "white" candle)
  2  falling body
Rows are anti-aliased: a pixel holds the fraction of it the span covers, so a body edge that falls
inside a pixel is still resolved. A span thinner than one pixel (a doji body, a flat wick) is drawn
one pixel tall around its centre.
"""

from __future__ import annotations

import numpy as np
import torch

HEIGHT = 128
CANDLE_WIDTH = 6
WINDOW_BARS = 20


def normalise(ohlc: np.ndarray) -> np.ndarray:
    """(N, W, 4) prices -> the same windows scaled to 0 = lowest low, 1 = highest high (float32).
    Done in float64 so a 20,000-point price loses nothing before the cast."""
    ohlc = np.asarray(ohlc, dtype=np.float64)
    lo = ohlc[:, :, 2].min(1, keepdims=True)[..., None]
    hi = ohlc[:, :, 1].max(1, keepdims=True)[..., None]
    return ((ohlc - lo) / np.maximum(hi - lo, 1e-12)).astype(np.float32)


def rasterize(unit_ohlc: torch.Tensor, height: int = HEIGHT) -> torch.Tensor:
    """(B, W, 4) windows already scaled to [0, 1] -> (B, 3, height, W * 6) images in [0, 1]."""
    batch, bars, _ = unit_ohlc.shape
    o, h, l, c = (unit_ohlc[..., k] * height for k in range(4))
    rows = torch.arange(height, device=unit_ohlc.device, dtype=unit_ohlc.dtype)

    def cover(bottom: torch.Tensor, top: torch.Tensor) -> torch.Tensor:
        middle = ((bottom + top) / 2).unsqueeze(-1)
        half = ((top - bottom) / 2).clamp_min(0.5).unsqueeze(-1)
        return (torch.minimum(middle + half, rows + 1) - torch.maximum(middle - half, rows)).clamp_(0, 1)

    wick = cover(l, h)
    body = cover(torch.minimum(o, c), torch.maximum(o, c))
    rising = (c >= o).to(unit_ohlc.dtype).unsqueeze(-1)
    blank = torch.zeros_like(wick)
    centre = torch.maximum(wick, body)
    up, down = body * rising, body * (1 - rising)
    silhouette = torch.stack([blank, body, centre, body, body, blank], 2)
    rising_bodies = torch.stack([blank, up, up, up, up, blank], 2)
    falling_bodies = torch.stack([blank, down, down, down, down, blank], 2)
    image = torch.stack([silhouette, rising_bodies, falling_bodies], 1)  # (B, 3, W, 6, H)
    return image.reshape(batch, 3, bars * CANDLE_WIDTH, height).transpose(2, 3).flip(2)


def to_png(image: torch.Tensor, path, zoom: int = 3) -> None:
    """One (3, H, W) image -> a PNG a person can read: black candles on white, rising bodies hollow
    orange, falling bodies filled blue (Okabe-Ito), scaled up ``zoom`` times."""
    from PIL import Image

    sil, up, down = (image[k].float().cpu().numpy() for k in range(3))
    rgb = np.ones(sil.shape + (3,), dtype=np.float32)
    ink = np.array([0.0, 0.0, 0.0]); orange = np.array([0.902, 0.624, 0.0]); blue = np.array([0.0, 0.447, 0.698])
    rgb = rgb * (1 - sil[..., None]) + ink * sil[..., None]
    rgb = rgb * (1 - up[..., None]) + orange * up[..., None]
    rgb = rgb * (1 - down[..., None]) + blue * down[..., None]
    picture = Image.fromarray((rgb * 255).clip(0, 255).astype(np.uint8))
    picture.resize((picture.width * zoom, picture.height * zoom), Image.NEAREST).save(path, format="PNG")
