# Model Lens + Notebooks integration — build plan (2026-09-15)

Goal: turn the dashboard into the local analytics surface. Two new surfaces:

1. **Model Lens** (`/lens`) — a trained model's out-of-sample record made inspectable:
   V1 prediction + interval on price · V2 simulated trades + equity · V3 rolling stability and decay ·
   V4 prediction vs reality · V5 direction confusion + precision/recall/win rate · V6 attribution by
   family (SHAP for tree models) · V7 bull/bear/sideways regimes · V8 cumulative PnL vs buy-and-hold ·
   V9 predicted vs actual return distributions · V10 step-by-step backtest playback.
2. **Notebooks** (`/marimo`) — every marimo notebook on the machine, served by pinned-port `marimo run`
   processes (one per interpreter + working directory), proxied same-origin through :5000.

Plus the candlestick-rendering audit fixes and the template bug that writes row indices as timestamps.

## Contract

`src/shared/lens/types.ts` is the single contract. Read it before writing any lens code. Parquet column
names, the `LensSeries` columnar shape, `LensEvaluation`, `LensBarWindow`, and the family mapping are all
defined there and must not be redefined elsewhere.

## Research facts the build rests on (verified 2026-09-15)

- `xgb_baseline_post` (MNQ 1m): `oos_predictions.parquet` = (ts epoch s, prob_up, label, realized_return_bp),
  2,565 rows 2019-05-21 19:39 → 2019-05-27 10:39 UTC; horizon 5 rows; evaluator threshold 0.55;
  `realized_return_bp = ln(close[i+5]/close[i])*1e4` in the kept-row order (src/ml/xgb_classifier/main.py:397-404).
  diagnostics.json reference: 264 trades (34 long / 230 short), cum −$549.70, profit factor 0.6097,
  win rate 0.4129, hit_rate_50 0.5423, AUC 0.529.
- `xgb_baseline_post_w2c` is byte-identical to `xgb_baseline_post` (sha256 of parquet, model, SHAP).
- `shap_summary.npz` `contribs[i]` belongs to val row `sample_indices[i]` — a random permutation (seed 42),
  NOT positional. Re-align before use.
- The parquet has no OHLC and no feature values; they come from re-running the model's own loader
  (`src/ml/shared/features.load_features_with_cache`) and dropping rows exactly as main.py:285-317 does.
  The current `mnq_ohlcv_1m` view is missing 536/2,565 of the OOS timestamps — do not use it for this.
- `MNQ_1m_cnn_transformer/oos_predictions.npz`: 468,929 rows 2024-09-01 → 2025-12-30 with timestamps
  (string), open/high/low/close, probs, labels; diagnostics marks it deprecated ("Swing baseline —
  misleading 91.8% accuracy from autocorrelated labels"); forward_n = 20.
- `rf_w2_smoke` and the TFT run wrote `timestamp = 0..N-1` (template bug `_walk_forward.py.j2:36`) → refused.
- `ghmm_smoke` is a regime model (prediction = state), not a direction classifier → refused.
- Cost: `src/config/cost_model.json` MNQ — round trip 1.40 points, $2.00/point, tick 0.25.
- lake: `from lake.serving import connect` works from this repo's `.venv`.

## File ownership (one owner per file)

| Owner | Files |
|---|---|
| lens-builder (Python) | `src/ml/lens/**`, `tests/ml/test_lens.py`, `data/models/*/lens/**` (generated) |
| lens-compute (TS) | `src/shared/lens/*.ts` except `types.ts`, `tests/shared/lens/**` |
| lens-server (Node) | `src/server/lens/**`, `tests/server/lens*.test.ts`, the two lens lines in `src/server/infrastructure/core/routes.ts` |
| lens-charts (UI) | `src/client/src/lens/charts/**`, `src/client/src/lens/playback/**` |
| lens-panels (UI) | `src/client/src/lens/panels/**` |
| notebooks | `src/server/marimo/**`, `src/config/notebooks.json`, `src/client/src/marimo/**`, `src/server/main.ts`, `tests/server/marimo*.test.ts`, `package.json` (http-proxy-middleware only) |
| templates | `src/templates/architectures/**`, `tests/test_template_timestamps.py` |
| main session | `src/shared/lens/types.ts`, `src/client/src/lens/LensPage.tsx`, `src/client/src/lens/api.ts`, `App.tsx`, `LeftSidebar.tsx`, `navigation.ts`, `RightSidebar.tsx`, candle fixes, docs |

## Verification gates

- Python: `uv run pytest tests/ml/test_lens.py`; builder re-scores `model.ubj` on the recomputed features and
  matches stored `prob_up` (max abs diff ≤ 1e-5); recomputed close reproduces `realized_return_bp`
  (max abs diff ≤ 1e-3 bp).
- Shared compute: vitest parity at default params against manifest.reference — exactly 264 trades, 34/230,
  cum −549.70 ± 0.01, profit factor 0.6097 ± 1e-4, hit rate 0.5423 ± 1e-4.
- Server: vitest route tests + live `curl` of every endpoint through :5000.
- UI: `tsc --noEmit` 0, color contract test, live render in the browser with 0 console errors.
- Notebooks: each group server healthy through the proxy; a notebook page loads in an iframe on :5000.
- Whole repo at the end: `node scripts/verify.mjs --full` no new errors; vitest no new failures vs the
  554-passed / 14-pre-existing-suite-failure baseline; pytest ≥ 210 passed.
