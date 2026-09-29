# P1 audit — every training-related analysis notebook

72 notebooks audited 2026-09-29 by 7 read-only auditors (51 relevant to training); the 3 claimed edges were re-tested by adversarial skeptics; the synthesis below turns it into design inputs. Full per-notebook records: `evidence/p1_notebook_audits.json`, landed as `derived_multimodal_notebook_audit_notebooks`.

## Edge claims after the skeptics

| Notebook | Claim | Holds | Usable for the design |
|---|---|---|---|
| `ml_dashboard/Trading/forexmodel/notebooks/01_analysis.ipynb` | Strong, significant predictive skill for volatility (corr 0.695 vs HAR 0.555, 18/18 CIs clear of zero) but none for direction (AUC 0.51-0.53, 0/18 above breakeven at 0.8 pip); no trading PnL computed, so no trading edge. | partly | Only as a volatility-scaling input, not as an edge. A next-bar range forecast of about 0.75 correlation is available cheaply from an hour-of-day range profile plus trailing deseasonalised range (seasonal HAR). The GBR adds about 0.01 on top. That is suitable f |
| `ml_dashboard/Trading/forexmodel/notebooks/16_vector_store.ipynb` | kNN analogs over 35 multiscale EURUSD state columns beat HAR by +0.042 correlation on the next-hour standardised log range (CI [0.037, 0.047]) but trail GBR by 0.0135. The neighbours carry volatility and time of day, not | partly | This can be used only as a volatility/regime input, never as a direction signal. What can be carried over: (1) GBR on the 35 multiscale columns forecasts next-hour standardised range at corr 0.70 walk-forward (dev region only). That is useful for sizing stops  |
| `ml_dashboard/Trading/quant/lean/Casual Red Flamingo/research/magnitude_forecasting.ipynb` | HAR+clock predicts next-hour log realized variance of MNQ 5-minute RTH returns out of sample (R2 +0.52, corr 0.69, 27/27 folds positive); direction has no skill; this is a risk forecast, not a trading edge. | partly | Usable as a volatility input, not as a return signal. A trailing HAR (12/84/252-bar realized variance) plus a clock factor fitted on training rows only gives a causal next-hour variance forecast with honest out-of-sample R2 of about 0.24-0.52 across six MNQ qu |

## Every notebook

| Notebook | Training? | Edge evidence | Look-ahead | Costs | OOS | Summary |
|---|---|---|---|---|---|---|
| `ml_dashboard/Trading/quant/lean/Casual Red Flamingo/research/magnitude_forecasting.ipynb` | yes | strong | low | n/a | yes | Predictive edge in volatility: HAR+clock explains +0.52 of out-of-sample log-variance (corr 0.69, all 27 rolling folds positive), replicated by me from the lake. Direction has none (R2 -0.02, sign accuracy 0.47). This is a predictive edge in risk, not a trading edge: it yields no signed return, and  |
| `ml_dashboard/Trading/forexmodel/notebooks/01_analysis.ipynb` | yes | moderate | low | no | yes | Strong, significant predictive skill for volatility (corr 0.695 vs HAR 0.555, 18/18 CIs clear of zero) but none for direction (AUC 0.51-0.53, 0/18 pairs above breakeven at 0.8 pip). No trading PnL is computed, so there is no trading edge. |
| `ml_dashboard/Trading/forexmodel/notebooks/16_vector_store.ipynb` | yes | moderate | low | n/a | yes | kNN analogs beat HAR by +0.042 correlation on the next-hour range (CI [0.037, 0.047]) but trail gradient boosting by 0.0135; the retrieved neighbours carry volatility and time-of-day, not direction. No trading edge measured. |
| `datalake/notebooks/mnq_candle_vectors.py` | yes | weak | low | yes | yes | Across five timeframes, 569 pattern sides/shape codes, two baselines, day-clustered t-tests and placebos, exactly one candidate survived discovery (1m bullish engulfing, +0.0145 average ranges = about 0.07 ticks-equivalent), failed 2024 validation (p=0.057), and never reached holdout; nothing surviv |
| `datalake/notebooks/mnq_indicator_study.py` | yes | weak | low | no | yes | The only statistically real signal is a mean-reversion lean on 1-minute bars: best single-indicator /IC/ 0.018 and a walk-forward logistic AUC 0.514 (null 95th pct 0.5045), accuracy 50.46% vs 50.27% base rate. In casebook trading terms it is worth +0.05 ticks gross per trade against a 5.60-tick roun |
| `ml_dashboard/Trading/forexmodel/notebooks/06_candle_direction.ipynb` | yes | weak | low | yes | yes | Real but tiny mean-reversion information (hit rates 0.505-0.566 gross), 20-50x too small to clear the spread: median breakeven spread 0.033 pips, best 0.284 pips; every configuration net-negative; logistic AUC 0.50-0.52. |
| `ml_dashboard/Trading/forexmodel/notebooks/08_candle_embeddings.ipynb` | yes | weak | low | no | yes | AUC 0.510-0.511 for every encoding, differences 0.001, well below any spread hurdle (06 shows AUC needed above 0.53-0.59 with costs). |
| `ml_dashboard/Trading/forexmodel/notebooks/09_candle_transitions.ipynb` | yes | weak | low | yes | yes | Replicating short-horizon mean reversion (hit 55.96% gross at 1m h=1) but breakeven spread 0.018 pips versus 0.6-1.0 retail, so net Sharpe -50.6. Information is under 1.5% of symbol entropy. |
| `ml_dashboard/Trading/forexmodel/notebooks/12_feature_scales.ipynb` | yes | weak | low | no | yes | Measured windows add +0.012 to +0.016 correlation at 15m/30m (CI excludes zero) and nothing at 1h; no direction or trading claim. |
| `ml_dashboard/Trading/forexmodel/notebooks/14_multiscale.ipynb` | yes | weak | low | no | yes | Multi-scale variance ladder adds +0.0256 correlation at a 15-minute horizon and +0.010 at 60 minutes (CIs exclude zero) but 0 at 240 minutes; trendiness (rho) next window is essentially unpredictable (corr 0.03-0.09). No return edge. |
| `ml_dashboard/Trading/forexmodel/notebooks/19_pair_signals.py` | yes | weak | low | no | no | Volatility is predictable (up to /rho/ 0.74 same-bar range persistence, 34% of tests survive) but that is a level/persistence effect, not a trading edge. For direction the largest in-sample Spearman is 0.077 and typical survivors are 0.02-0.07; my back-of-envelope (not in the notebook) is a sign-pos |
| `ml_dashboard/Trading/quant/analytics/notebooks/crossover_visualization.py` | no | weak | low | yes | no | A fixed EMA5/SMA100 5m rule earns Sharpe 1.595 (+74.9% equity, -17.5% max DD) on 2024-03..2025-12 after a 2.80 USD round-trip (0.70 pts/side), reproduced by me. It is not out-of-sample (parameters were picked on this window from a 966-combo grid), Deflated Sharpe is 0.379 and the bootstrap Sharpe CI |
| `ml_dashboard/Trading/quant/lean/Casual Red Flamingo/research/crossing_analysis.ipynb` | yes | weak | low | yes | no | EMA9/SMA21 crossings show a gross 2-bar signed return of +2.18 bp (t 2.28, n=249) and +1.62 bp net of a 0.554 bp cost, but it comes entirely from shorts (+5.23 bp vs -0.96 bp long) in one 59-session, single-contract window, the net interval covers zero at every horizon, and crossings cluster so the  |
| `ml_dashboard/notebooks/ta_strategy_600_ticks.py` | yes | weak | low | yes | yes | A small real directional edge exists in momentum/breakout entries, but it is 1 to 2 orders of magnitude below a tradable target and does not reach the 40% win / 2:1 requirement. Best honest numbers: NQ 2010-2019 pre-registered pooled excess +3.81 ticks/day (t 4.52) with net +1.9 ticks/day summed ove |
| `datalake/notebooks/candle_pattern_scorecard.py` | yes | none | low | yes | yes | No pattern trades profitably after costs on the 2025 holdout once the number of tests is corrected: 0 of 883 survive Benjamini-Yekutieli, and the 13 uncorrected cost-clearing cells (5 timeframe/side combinations with n<150 dominate) are below the ~44 false positives chance supplies. Up-rate when fir |
| `datalake/notebooks/findings_casebook.py` | yes | none | low | yes | yes | Priced in ticks after a 5.60-tick round trip, every pure price/pattern/indicator direction rule tested loses: best gross edge found is about +0.05 to +0.5 ticks per trade against 5.6 ticks of cost; win rates 47-50% with payoff ratio about 1:1, far from 40% at 2:1. The only forecasts that work are fo |
| `datalake/notebooks/frozen_candle_encoder.py` | yes | none | none | no | yes | No directional information in the frozen encoder or in any sibling feature block: AUCs 0.494-0.508 on ~40k 2025 rows, with the information-free shuffled control scoring as high (0.5057) as the encoder (0.4990). Directional edge of raw geometry is at best 0.0079 AUC. |
| `datalake/notebooks/tails.py` | yes | none | medium | n/a | n/a | No edge tested; a descriptive study of return distribution shape under different sampling clocks. The practical value is for label/sizing design (barriers in sigma units, sizing off fat tails). |
| `datalake/notebooks/volume_candle_anatomy.py` | yes | none | low | n/a | no | No predictive claim is made or tested. The strongest results are volume-range and volume-body-size linkages (/rho/ up to 0.83), i.e. volatility/activity structure; volume has essentially no linear relation to signed body (-0.0055). |
| `datalake/notebooks/what_to_encode.py` | yes | none | low | no | yes | Direction is not forecastable (AUC <= 0.5098, ~0.01 above coin flip, unexpressed in dollars). What is forecastable is the size of the next bar: R^2 0.0869 for next-bar range and 0.117 for close-to-next-open gap magnitude, driven by volume level and body-per-volume (a price-impact / execution-cost pr |
| `ml_dashboard/Trading/forexmodel/notebooks/02_discovery.ipynb` | no | none | low | no | no | No edge tested. The regime model produces short-lived states (mean 3.8 bars) and its emission means give trend-up/down classes only 7-8% of bars each; there is no forward-return evidence. |
| `ml_dashboard/Trading/forexmodel/notebooks/03_candle_geometry.ipynb` | yes | none | none | no | n/a | None: explicitly a measurement notebook, no return or forecast test. |
| `ml_dashboard/Trading/forexmodel/notebooks/04_candle_vocabulary.ipynb` | yes | none | low | no | no | None for prediction; the notebook itself concludes 'Measurement and representation only'. The bias of up to +/-0.14 is a same-bar statistic. |
| `ml_dashboard/Trading/forexmodel/notebooks/05_candle_ngrams.ipynb` | yes | none | low | no | yes | Null result: 0.56% of information at best. The 96 'confirmed' patterns are a liquidity artefact (S14 concentration at NY close), not predictive geometry. |
| `ml_dashboard/Trading/forexmodel/notebooks/07_candle_overlay.ipynb` | no | none | none | no | n/a | None; visual QA of a vocabulary. |
| `ml_dashboard/Trading/forexmodel/notebooks/10_triple_barrier.ipynb` | yes | none | none | no | n/a | No edge: a passive long entry hits a 2:1 target 33.4% (1m) versus 33.3% random-walk baseline; largest excess over shuffle is +1.06 points. For the 40% / 2:1 goal a strategy must add about 6.7 points of hit rate over this baseline (my derivation: expectancy at 40%/2:1 is +0.2R before costs; breakeven |
| `ml_dashboard/Trading/forexmodel/notebooks/11_trend_definitions.ipynb` | yes | none | low | yes | yes | No definition pays: 0 of 76 net-positive with a Sharpe CI excluding zero; best ema_cross_50_200 4h net +540 bp but Sharpe 0.33 with CI [-0.17, 0.82]. |
| `ml_dashboard/Trading/forexmodel/notebooks/15_black_scholes.ipynb` | yes | none | none | n/a | n/a | None: confirms independence (variance ratios near 1, Hurst 0.479) so direction is close to a random walk, and that volatility clusters strongly. |
| `ml_dashboard/Trading/quant/analytics/notebooks/regime_gated_crossover.py` | yes | none | medium | yes | no | Regime gating adds nothing: recorded gated Sharpe 1.595->1.668 has a per-bar improvement CI of [-6e-6, +1e-6] (.remember/today-2026-08-03.done.md), so the difference is noise. The base crossover (Sharpe ~1.55-1.6 walk-forward, 966-combo selection, DSR 0.379) is itself not a demonstrated edge, and no |
| `ml_dashboard/Trading/quant/analytics/notebooks/trend_state_calibration.py` | yes | none | low | yes | no | The TrendState flag carries no demonstrated edge on MNQ 2025. Agreement with the forward trend label is 0.566 [0.490, 0.642] (spec) and 0.496 [0.441, 0.550] (minute) against a null of 0.507, net points per episode are -4.7 and -0.4 after 1.40 pts cost, win rates 37.9% / 35.2% with payoff 1.36 / 1.79 |
| `ml_dashboard/Trading/quant/chart_cnn/pkg/report.py` | yes | none | medium | no | yes | AUC 0.498-0.506 on 15k-188k out-of-sample bars for both image and sequence models; top-quintile R of +0.04..+0.07 ATR is gross of cost, uses a test-derived threshold, overlaps heavily between adjacent samples (no CI reported) and is not distinguishable from naive-long drift plus noise. Image shape a |
| `ml_dashboard/Trading/quant/lean/Casual Red Flamingo/research/research.ipynb` | yes | none | high | yes | no | No edge. The +15.0% backtest is in-sample on a mis-clocked feed with 5 contracts and 1.0:1 payoff (profit factor 1.23, trade-level Sharpe 0.066); the later run loses 2.3% even in-sample. The lake-based study shows a cross adds no range beyond its hour and EMA/SMA legs have 30% win rate, 2.2:1 payoff |
| `ml_dashboard/Trading/quant/lean/Casual Red Flamingo/research/trend_detection.ipynb` | yes | none | low | yes | no | No trading edge: 1.5-sigma standardized ROC signals show +5 to +6 bp gross drift over 5-12 bars in-sample (n=560-582, overlapping) but that peak is within the sign-shuffled null of the maximum (p 0.17), and the variance ratios are indistinguishable from a random walk under the robust test. |
| `ml_dashboard/Trading/quant/model/notebooks/candle_vocab.py` | yes | none | low | n/a | yes | For direction: none. Candle-LM direction accuracy 0.513-0.517 vs 0.510 majority (n=3,537, not significant) and 0.488-0.493 vs 0.516 at non-overlapping stride. For volatility: shape-only codes add -0.003 to +0.0003 R2 over HAR-RV (0.4964); adding two range-magnitude channels lifts HAR+ to 0.528-0.540 |
| `ml_dashboard/Trading/quant/model/notebooks/direction_on_candles.py` | yes | none | none | n/a | n/a | No model and no edge. The only quantitative content is the base rate: the up-rate drifts from 0.4811 (H=1) to 0.5566 (H=1440) because MNQ rose 7,687 -> ~25,862 over the sample, so any direction accuracy near those values reflects drift, not skill. |
| `ml_dashboard/Trading/quant/model/notebooks/eda_mnq_1d.py` | no | none | low | no | n/a | No edge tested. Verified base facts on 30m: returns are stationary and leptokurtic (excess kurtosis 41.5), lag-1 autocorrelation is zero (-0.0011), squared-return autocorrelation +0.138, up-rate 0.5153. |
| `ml_dashboard/Trading/quant/model/notebooks/label_audit.py` | yes | none | none | no | n/a | No trading edge. What it proves: direction labels carry 0.52-0.56 of free accuracy at long horizons; a next-bar volatility target has a +0.42..+0.74 R2 persistence baseline; several label configs are degenerate at 1m. It defines the honest baselines the multimodal model must beat. |
| `ml_dashboard/Trading/quant/model/notebooks/path_geometry_study.py` | yes | none | low | n/a | yes | Path geometry does not predict future path geometry on MNQ 1m at H=60: best ridge R2 is -0.0016 and no DM interval is positive; two intervals sit entirely below zero (model worse than trivial). Gradient boosting loses to ridge on every fold. Untested: H=240/1440 and coarser timeframes. |
| `ml_dashboard/Trading/quant/model/notebooks/slope_analysis.py` | yes | none | low | yes | no | Gross Sharpe 0.35 vs buy-and-hold 0.40 over ~3 months (one regime), net Sharpe -0.77 after 1.4 pt per change. Segment-level payoff is 36.8% wins with 1.78:1 win/loss before costs, which looks like a trend profile but is not net-profitable and is one 3-month in-sample window. |
| `ml_dashboard/Trading/quant/model/notebooks/training_environment.py` | yes | none | low | no | yes | The stored multimodal runs have skill -0.021 to +0.011 vs the majority baseline on 3 and 2 epochs of training; the 1h +0.011 is noise-level on a single split with no interval. No PnL is computed. |
| `ml_dashboard/Trading/quantlab/notebooks/oos_results.py` | yes | none | low | yes | yes | No edge in a pure 1-minute candle-geometry transformer: negative R2 in 6 of 6 folds, directional accuracy 0.5066 against a cost break-even of 0.693, net -7.2e-5 log return per trade (about -1.4 points), and no conviction threshold rescues it. Only the magnitude of the prediction carries a trace of i |
| `ml_dashboard/notebooks/candlestick_pattern_exemplars.py` | no | none | low | n/a | n/a | No edge tested. It documents that TA-Lib candlestick signals are mostly context-inconsistent on MNQ daily bars, which argues against using raw CDL_* outputs as signals. |
| `ml_dashboard/notebooks/contract_specifications.py` | yes | none | none | yes | n/a | None; reference data. |
| `ml_dashboard/notebooks/data_lifecycle_audit.py` | yes | none | low | n/a | n/a | No edge content; it is a data-engineering integrity audit. |
| `ml_dashboard/notebooks/finbert_sentiment.py` | yes | none | low | n/a | n/a | No predictive test exists: the notebook shows feature distributions only, and there is only one week of overlap with price (2025-12-15..21, about 5 sessions), far too small to estimate any effect; live data collection began 2026-09-28 so the multimodal model's text modality cannot be trained or vali |
| `ml_dashboard/notebooks/hwma_stability.py` | no | none | none | n/a | n/a | None. A UI numerical-stability audit of a chart indicator. |
| `ml_dashboard/notebooks/label_catalog.py` | yes | none | low | yes | n/a | Labels only, no model skill measured. Base rates matter for the target: with a 2.0/1.5 ATR barrier the long-side upper-touch rate is 44.9% (24 bars, 5m), roughly the 40% win rate needed at 2:1 only if the geometry is right; a 2:1 barrier set would have to be regenerated and its base rate measured. |
| `ml_dashboard/notebooks/model_cycle_runs.py` | yes | none | low | yes | yes | No edge: every family tested on MNQ 5m in Dec 2025 has AUC <= 0.50, negative price-forecast skill, and net PnL is mostly negative versus a small buy-and-hold gain; the two positive recipes (lightgbm +765 USD over 185 trades at win 54.1% and payoff 0.96; mlptune +622 USD over 48 trades) are single-mo |
| `ml_dashboard/notebooks/process_census.py` | no | none | none | n/a | n/a | None. |
| `ml_dashboard/notebooks/regression_tab_performance.py` | no | none | none | n/a | n/a | None; no trading or predictive content. |
| `ml_dashboard/scripts/candle_range_analysis_executed.ipynb` | no | none | medium | no | no | No trading or predictive claim is made or tested. The only quantitative relationship is body size vs volume (r 0.56), a same-bar association, not a forecast. |
| `datalake/notebooks/candlestick_pattern_census.py` | yes | n/a | none | n/a | n/a | No edge claimed or tested here; it is a vocabulary/coverage census. Its only trading-relevant statement (883 tests, 0 survivors) is inherited from the scorecard. |
| `datalake/notebooks/data_format_inventory.py` | no | n/a | n/a | n/a | n/a | No modelling content. |
| `datalake/notebooks/lake_audit.py` | no | n/a | n/a | n/a | n/a | No modelling content. |
| `datalake/notebooks/lake_explorer.py` | yes | n/a | medium | n/a | n/a | No edge analysis; exploration only. |
| `datalake/notebooks/market_bars_columns.py` | no | n/a | n/a | n/a | n/a | Data-integrity evidence only. |
| `datalake/notebooks/mnq_talib_1m.py` | yes | n/a | low | n/a | n/a | No edge claim; it is a data/EDA notebook. Pattern-fire counts show most patterns fire too rarely or too often to be useful and a handful never fire. |
| `datalake/notebooks/single_candle_recognizer.py` | no | n/a | none | n/a | yes | No trading edge tested. It shows a tree/GBT can reproduce hand rules almost perfectly once trailing context is supplied, which means a downstream model that receives trailing range/body context does not need TA-Lib pattern flags at all. |
| `datalake/notebooks/timescaledb_load.py` | no | n/a | n/a | n/a | n/a | No modelling content; infrastructure monitoring. |
| `dotfiles/diagnostics/notebooks/machine_health.py` | no | n/a | n/a | n/a | n/a | None; unrelated to training. |
| `ml_dashboard/Trading/forexmodel/notebooks/13_indicator_matrix.ipynb` | yes | n/a | low | n/a | n/a | None: feature-engineering infrastructure, no relation to returns tested. |
| `ml_dashboard/Trading/forexmodel/notebooks/18_vector_browser.ipynb` | no | n/a | none | n/a | n/a | None; not an analysis. |
| `ml_dashboard/Trading/forexmodel/notebooks/eurusd.py` | no | n/a | none | n/a | n/a | None: a viewer with no statistical test. |
| `ml_dashboard/Trading/forexmodel/notebooks/eurusd_viz.py` | no | n/a | none | n/a | n/a | None; not an analysis of any edge. |
| `ml_dashboard/Trading/quant/analytics/notebooks/zigzag_view.py` | no | n/a | medium | n/a | n/a | No edge claim is made or tested; this is a chart of an indicator. External exp06 evidence says the ZigZag adds no tradeable edge once its confirmation lag is honoured. |
| `ml_dashboard/Trading/quant/chart_cnn/pkg/gallery.py` | no | n/a | none | n/a | n/a | None; a visual index of pattern examples. |
| `ml_dashboard/Trading/quant/chart_cnn/pkg/report_patterns.py` | yes | n/a | none | n/a | yes | No trading edge; it is a positive control confirming the CNN can see the same shapes that carry no direction information. |
| `ml_dashboard/Trading/quant/chart_cnn/synth/report_synth.py` | yes | n/a | none | n/a | yes | No trading or predictive edge is measured; the notebook shows the CNN reproduces TA-Lib pattern flags on real 2024-25 bars (mean AUC 0.989). Whether any pattern flag predicts returns is answered only by the direction notebooks (null, see report.py). |
| `ml_dashboard/Trading/quant/model/notebooks/label_overlay.py` | yes | n/a | low | n/a | n/a | No model or strategy is evaluated; it is a label-integrity audit. Its value is proving the 48 label columns align to bars and documenting the class-balance and baseline facts every model must be graded against. |
| `ml_dashboard/Trading/quant/model/notebooks/vector_space_explained.py` | no | n/a | low | n/a | n/a | No predictive claim; it explains the vector-space visualisation. The one useful fact is that the 19-dim continuous token space needs more than two axes (41.5% in PC1+PC2). |
| `ml_dashboard/Trading/quant/model/notebooks/volatility_to_price_range.py` | yes | n/a | none | n/a | no | No directional or PnL edge is claimed or tested. It is a sizing/scaling tool: it converts a volatility forecast into a stop/target distance in points and dollars per timeframe, with measured median, mean and 10-90% outcome bands. The underlying volatility forecastability (HAR-RV/GBT skill over HAR,  |
| `ml_dashboard/Trading/quantlab/notebooks/transformer_pipeline.py` | yes | n/a | none | n/a | n/a | No predictive or trading claim; it is a data-pipeline notebook whose sibling oos_results shows the resulting model has no edge. |

---

# Design inputs for a multimodal MNQ model (40% win, 2:1 payoff, AMP costs, H2-2025 holdout)

**Short answer:** the notebooks establish one strong, forecastable quantity, volatility and range. They establish no direction edge that comes anywhere near the gate. The best honest directional lift is about +5 points of target-hit rate over random entries. The gate needs about +9 to +10 points. My prior that any model clears the whole gate as written is **about 3% (range 1–5%)**. Two of the gate's own clauses cause most of that shortfall, and they are fixable (section 5).

I added two measurements of my own, because the design depends on them:
- **Unconditional 2:1 bracket base rates:** measured on `mnq_ohlcv_5m`, RTH, 2019-05 → 2025-12, 212,106 trades per specification. Script `C:/Users/tyler/AppData/Local/Temp/claude/E--source-repos-ml-dashboard/10d731be-cdcd-4d72-97d1-7fe7eebfb612/scratchpad/bracket_base.py`, output `bracket_base.parquet` beside it. It is scratch and not landed; the lake tables `derived_labels_bracket_base_rates` and `derived_gate_power` are still to be written.
- **Binomial power of the gate:** how often a true edge would pass it.

---

## 1. What the notebooks established

### Verified edges (after skeptic correction)

| Claim | Corrected number | Source |
|---|---|---|
| **Volatility / range is forecastable** (the only robust signal) | MNQ next-hour log realised variance, HAR+clock walk-forward R² **+0.24 to +0.52 across six quarters (median ≈ +0.39)**, not +0.52. No-fit persistence alone scores +0.05 to +0.40. | `Trading/quant/lean/Casual Red Flamingo/research/magnitude_forecasting.ipynb` (skeptic) |
| | MNQ 5m next-bar range R² 0.087; close-to-next-open gap magnitude R² 0.117, driven by volume level and body-per-volume | `datalake/notebooks/what_to_encode.py` |
| | HAR-RV 0.4964 → 0.5397 with candle-magnitude channels (+0.043); shape-only channels add 0 | `Trading/quant/model/notebooks/candle_vocab.py` |
| | FX GBR lift over a *seasonal* HAR is **+0.010**, not +0.155. An hour-of-day range profile alone gives 0.69. | `forexmodel/notebooks/01_analysis.ipynb` (skeptic) |
| Range scaling law | Range ∝ T^0.505 (R² 0.99995). Log-range is near-normal; raw range has kurtosis 7.7–31.9. Median MNQ range per bar: 1m 6.75, 5m 15.0, 15m 26.25, 1h 53.25 points. | `model/notebooks/volatility_to_price_range.py` |
| Momentum / breakout direction, pre-registered | NQ 2010-06 → 2019-05, never tuned on: pooled excess **+3.81 ticks/day (t 4.52)**, but net only +1.9 ticks/day across 3 books. `momentum_expansion_two_to_one`: win 43.5%, PF 1.10, so payoff = 1.10 × 0.565 / 0.435 = **1.43, not 2.0**. 0.55 trades/day. | `ml_dashboard/notebooks/ta_strategy_600_ticks.py`, `docs/ta-strategy-600-ticks.md` |
| Same family, MNQ, in-sample tuned | Round 4, RTH 15m, 3 books: +59.6 net ticks/day, per year 2019 +7.8 … 2022 +146.3 … 2025 +52.4. The same setting on NQ 2010–2019 gives +2.0. The top 10 days carry 67–76% of the excess. | same |
| Rule search at 2:1 | 0 of 3,024 rules reach 40% target-hit. Round-2 "confirmed" edges are about **+5 points of target-hit over a matched random entry**; PF 1.33 would need +9 to +12. | same |
| 1m mean reversion | Logistic on all TA-Lib indicators, AUC 0.514 (null 95th 0.5045). Worth +0.05 ticks gross against a 5.6-tick round trip. | `mnq_indicator_study.py`, `findings_casebook.py` |

### Failed (do not rebuild)

| Approach | Result | Source |
|---|---|---|
| Candlestick patterns | 0 of 883 survive Benjamini–Yekutieli. The one pre-registered survivor (1m bullish engulfing) failed 2024 validation (t 1.58, p 0.057) and trades at −$2.68/trade. | `candle_pattern_scorecard.py`, `mnq_candle_vectors.py` |
| Chart images | Direction AUC 0.498–0.506; the 1-D numeric control is equal or better at every timeframe. The CNN recognises patterns (AUC 0.989) but they carry no direction. | `chart_cnn/pkg/report.py`, `report_synth.py` |
| Frozen CNN embedding | Direction AUC 0.4977–0.5002 against a shuffled control at 0.4967–0.5057 | `frozen_candle_encoder.py` |
| Nearest neighbours, shape embeddings, candle LM | kNN median AUC 0.5012, 0/396 significant. Autoencoder AP 0.043 vs raw 0.498. LM next-symbol accuracy 1.4% vs 1.56% chance. | `mnq_candle_vectors.py`, `candle_vocab.py` |
| Path geometry (H=60) | Best R² −0.0016; no Diebold–Mariano interval is positive | `path_geometry_study.py` |
| Support / resistance levels | Every level family breaks *more* often than chance; continuation 0.519 vs 0.520 for random levels | `ta_strategy_600_ticks.py` |
| TrendState flag | Agreement 0.566 [0.49, 0.64] vs null 0.507; net −4.7 points per episode; PBO 0.67 | `trend_state_calibration.py` |
| Regime gating | Sharpe improvement CI [−6e-6, +1e-6] | `regime_gated_crossover.py` |
| HDP-HMM regimes | Mean run 3.8 bars | `forexmodel/02_discovery.ipynb` |
| EMA5/SMA100 crossover | Sharpe 1.595 in-sample, DSR 0.379, CI includes 0. Trade shape is 22% win / 4.2:1 payoff. | `crossover_visualization.py` |
| Model Cycle (all families) | AUC 0.486–0.498; price-forecast skill −0.0002 to −0.0042. Best run is LightGBM +$765, but that is 185 trades in one month at payoff 0.96. | `model_cycle_runs.py` |
| Existing multimodal prototype | Skill −0.021 to +0.011 against the majority class | `training_environment.py` / `scripts/train_multimodal_direction.py` |
| Model rounds (logistic / LightGBM) | Reality Check p 0.064–0.52 | ta_strategy rounds 1–2 |

### Recurring validity problems to avoid

- **Same-period selection.** Parameters were chosen on the window they were scored on: crossover grid of 966, ta_strategy frozen specs selected on 2022–2025, TrendState thresholds on 2025.
- **Fill at the signal bar's close.** The crossover and slope notebooks do this, and `candle_pattern_scorecard` includes the untradeable close-to-open jump.
- **Whole-series statistics inside labels or features:**
  - chart_cnn `tcap` (`pkg/build.py:9`)
  - `clocks.py` threshold (line 96)
  - `multiscale.py:302-306` normaliser, which ends at t+60
  - full-run z-scoring in the Lens study
- **Test-derived quantile gates** (`chart_cnn/pkg/train.py`, `pp >= quantile(pp, .8)`).
- **Weak baselines.** HAR without seasonality, 0.50 instead of the fold's majority class, R² against a rolling mean.
- **Pooled correlation across folds**, which rewards tracking the level.
- **Stale hard-coded prose numbers and broken paths:**
  - `candle_vocab.py:25` and `training_environment.py:18` point to `E:\source\repos\Trading`
  - `tails.py:37` points to `E:/lake/_meta/tails.duckdb`
  - `eurusd.py` label path
- **Results in standalone `.duckdb` files** outside the lake (`E:/lake-workspace/mnq_candle_vectors.duckdb`, `mnq_indicator_study.duckdb`, `findings_casebook.duckdb`).
- **Two cost figures in circulation.** `Trading/quant/model/src/config/cost_model.json` is $2.8011 = 5.6022 ticks. The current `src/config/cost_model.json:15-16` is $2.78 = 5.56 ticks = **1.39 points**. Use the second.

---

## 2. Reusable assets, ranked by expected value

1. **Bracket and exit engine plus harness:**
   - `src/ml/ta_strategy/bracket.py` (`simulate(open, high, low, close, signal, stop_ticks, session_last, roll_after, tick, reward_multiple, …)` at line 33; `stop_distance_ticks` at line 100)
   - `engine.py` (1-minute path exits), `data.py::load_minutes_rebuilt` (one contract per session), `evaluate.py` / `metrics.py` (per-day Newey-West alpha over the buy-and-hold beta, White Reality Check, deflated Sharpe), `frequency.py`, `confirm.py`
   - Tests `tests/test_ta_strategy.py` and `tests/test_ta_rules.py`, which include truncation-causality tests.
2. **Candidate generators for meta-labelling:** the frozen `momentum_expansion_two_to_one`, `opening_range_breakout_runner` and `level_breakout_momentum` specs (`src/config/ta_conditional_templates.json`, `ta_conditional_rounds.json`). Their labelled outcomes are in `derived_ta_conditional_strategies_600_ticks_{trades,daily,frequency_daily,confirmation_daily}`, and the matched-null trades are in the same tables.
3. **Label contract and gates:**
   - `src/server/infrastructure/lib/labels/` (`sqlLabelGenerators/`, `labelEnrichment.ts` for uniqueness and attribution weights and `clears_round_trip_cost`, `labelValidation.ts` for the truncation gate)
   - `src/ml/shared/labels.py` (ATR-scaled triple-barrier kernel), `docs/labels.md`, `tests/test_label_contract.py`
   - The existing `triple_barrier_MNQ_5m_e79baabef522` is 2.0/1.5 ATR and long only, so it is the wrong geometry. Regenerate.
4. **Volatility head and sizing layer:**
   - `Trading/quant/model/src/ml/cnn_transformer/volatility_scale.py` (`log_range_to_quantile_points`, `empirical_range_calibration`) and `volatility_labels.py` (zero-range masking, `ewma_log_range_forecast`)
   - HAR+clock from the magnitude notebook
   - Causal feature construction in `datalake/scripts/build_feature_ladder.py:134-198` (range memory, volume level, body per unit volume)
   - Volume rank/z features in `build_volume_candle_anatomy.py:125-135`
5. **Evaluation and record harness:** Model Cycle `src/ml/cycle/{engine,simulate,rolls,store,report}.py`, which gives eight run tables plus seven metric tables and `derived_model_cycle_runs_*`. Fix open audit items #13, #14, #15 and #17 first.
6. **Null and multiple-testing templates:**
   - `datalake/scripts/build_candle_pattern_scorecard.py` (Benjamini–Yekutieli)
   - `probe_frozen_candle_encoder.py` (shuffled block plus permutation null)
   - `Trading/quant/analytics/latent/robust.py` (Politis–White block length, BCa)
   - `analytics/trend/calibration.py` (shuffle-within-session-type null, PBO/DSR)
   - Pre-registration protocol in `datalake/scripts/build_mnq_next_candles.py` (discovery 2021–23 → validate 2024 → holdout; placebo day-shifts)
7. **Text modality interface:** `datalake/src/lake/sentiment.py` (nine `finbert_*` columns, known-time rule), `src/ml/shared/sentiment.py`, `tests/test_finbert_mandatory.py`, and the live hub `live/`.
8. **Reference data:** `src/config/contract_specifications.json`, `src/config/cost_model.json`, `src/ml/cycle/rolls.py`.
9. **Low value (keep only as ablations):**
   - trend scaled-t columns (`analytics/trend/trend_state.py`)
   - `mnq_talib_1m` (3 months only)
   - `chart_cnn/synth/runs/seed0/cnn_patterns.pt`
   - 64-d ratio-normalised windows (`datalake/scripts/candle_vectors.py`)

---

## 3. Data coverage per modality

Development period: 2019-05-05 → 2025-06-30. Holdout: 2025-07-01 → 2025-12-31.

| Modality | Development | Holdout | What blocks it | Backfill plan |
|---|---|---|---|---|
| **MNQ price** | Full. 1s from 2019-05-05 (201.3M rows); `bars` 1m from 2020-12-31 (true UTC); `ohlcv_full_1m` / `mnq_ohlcv_1m` from 2019-05-05 (Pacific-as-UTC). RTH 98.1–98.8% present; full session about 82%. | Full through 2025-12-30 15:59 PT. **2025-12-31 is missing.** | Two clocks; raw roll splices; about 18% of full-session minutes absent (untraded minutes have no bar); nothing for 2026-01 → 09-20 | 2025-12-31 and 2026-01 → 09 from Databento MNQ 1m/1s. This is paid, so it needs Tyler's word. It would give a *clean* forward holdout. |
| **Intraday cross-asset (equity index)** | ES / NQ / YM 1s from 2010-06; RTY 2017-07; MES / M2K / MYM 2019-05 | Full | NQ ≠ MNQ bar for bar (close equal 21–31%, return correlation 0.94) | None needed. NQ 2010–2019 serves pretraining and confirmation, but ta_strategy round 3 has already been scored on it once. |
| **Cross-asset (rates, metals, dollar)** | Daily from 2000 (ZN/ZB/ZF/ZT/GC/SI/HG/DXY, yfinance); FRED DGS2/5/10/30, DTWEXBGS daily; 1h only from 2024-04-26 | Daily and 1h | No intraday data before 2024-04; **CL, 6E, VIX, 6J/6B/NG absent** | Databento ZN / 6E / CL / VX 1m for 2019–2025 (paid). Free option: use the daily series lagged one session only. |
| **Order flow** | Effectively none: `vol_at_bid` etc. non-null on 19 one-minute rows (2026-03-27). Quantower quotes (15.8M rows) and book (4.5M) cover 2026-09-02 → 09-08 only. | None | Missing everywhere | (a) **Free and available now:** order-flow proxies from the MNQ 1s bars. Tick-rule or bulk-volume classification gives signed volume and imbalance per 1m/5m, 2019-05 → 2025-12. (b) Inspect the 18.65 GB of unpromoted vendor archives (`data_format_inventory`) for Databento trades/mbp. (c) Databento MNQ trades/mbp-1 (paid). |
| **News / FinBERT** | 0.35% of RTH days (6/1718); only 2025-12-15 → 12-22 (2,811 GDELT rows); `derived_news_features` duplicated about 3x for MNQ | About 5% of bars (December only) | No history; GDELT DOC API throttled | GDELT GKG 2.1 bulk: stream-filter the 15-minute zips on finance/macro themes. About 173–216 GB/yr raw; land the filtered parquet under `E:\lake\raw\vendor=gdelt_gkg\` with a manifest. Tone, themes and organisations from 2015-02; page titles from 2019-09. Needs Tyler's approval of the filtered-landing exception. FNSPID covers 2019–2023 (per-company). Alpha Vantage tops up 2022+. Deduplicate `derived_news_features` first. |
| **Calendar** | `market_calendar_v1` (ISM etc.) and `fomc_decisions_v1` from 2021-01 only; counts not measured | Covered | 2019-05 → 2020-12 missing | Scrape Fed `fomchistorical<YEAR>.htm` (statements 14:00 ET) and BLS schedule pages (CPI/NFP/PPI 08:30 ET), both free. ALFRED point-in-time values need a free FRED key, which Tyler must register (no FRED variable is set). |
| **Chart images** | Not stored; renderable from bars (`chart_cnn/synth/gpu_render.py`, `pkg/render.py`) | Renderable | No evidence of value | Do not build unless an ablation shows lift over the 1-D control. |

---

## 4. Design implications

### 4.1 Label: a bracket in volatility units, with the target inflated for cost

Unconditional base rates, MNQ 5m RTH:
- Entry at the next open, 06:35–11:55 PT; forced exit at the RTH close.
- Stop `s` = 1×ATR20 of completed 5m bars, target `T` = 2s + 3c, c = 1.39 points.
- If stop and target are hit in the same bar, it is scored as a loss.
- Roll days are skipped.

| Specification | Target-hit rate by year, 2019→2025 | Timeouts | Net payoff | Median stop |
|---|---|---|---|---|
| **1×ATR** | 0.262, .297, .290, .308, .303, .303, .298 | 1.4–5% | **1.96–2.03** | 9 → 32 pts |
| 2×ATR | 0.15–0.21 | 24–33% | 1.39–1.57 (fails 2:1) | |
| 3×ATR | | 51–58% | ≈ 1.2 | |
| Fixed 20 pts | 2019 **0.145** (38% timeouts), 2020–25 0.27–0.30 | | | |
| Fixed 40 pts | 2019 0.037 (75% timeouts) vs 2022 0.276 | | | |

- **Verdict: volatility units, stop ≈ 1× 5m ATR20 (≈ 90–130 ticks in 2020–2025), target 2s + 3c.**
  - It holds the base rate stable across a 7.7k → 25.9k price level.
  - It keeps timeouts from diluting the payoff.
  - It holds cost at 4–7% of R.
  - Wide stops break the 2:1 condition through timeouts; fixed ticks make the label non-stationary.
- **The unconditional rate equals the random walk.** At zero drift the target-hit rate is 1 / (3(1 + c/s)) = 0.314 at s = 23.25. Measured: long 0.322, short 0.307.
  - **The model must add about +9 to +10 points of target-hit rate** to reach 40%. The best honest lift seen anywhere is about +5.
- **The gate's arithmetic.** With a symmetric cost c, a 2s target nets (2s − c)/(s + c) < 2, so it can never pass. You need T = 2s + 3c, and under the +1 tick stress (c = 1.89) you need T = 2s + 5.67 to keep net payoff at or above 2. Build the stressed version into the label. It lowers the base rate by only about 0.007.
- **Time of day** (2×ATR spec): 06:35–07:30 PT has the highest target rate (0.241) and the least negative net (−0.66 points). This agrees with ta_strategy's profitable 06:00–09:00 PT cluster.
- **Build it with the label contract:** both sides as separate outcomes, `clears_round_trip_cost`, `sample_uniqueness_weight`, purge = `resolution_bars`, truncation gate. Land it in `derived_labels`.

### 4.2 Decision timeframe and structure

- **Decisions on 5m bars in RTH; exits on the 1-minute path** (`ta_strategy/engine.py`); flat by the RTH close.
- **"Trade every session day"** means a forced top-k per day ranking, not a probability threshold. The lift has to hold at the day's best-ranked candidates, which removes most of the selectivity that meta-labelling usually relies on.
- **Architecture that fits the evidence:**
  - A candidate generator: the momentum / ORB entries plus a time-of-day grid.
  - A meta-label head: P(target before stop).
  - A volatility head that sizes `s`: HAR+clock, then GBR, with a seasonal HAR baseline.
  - Modality encoders feed the meta-label head. Report ablations by modality.

### 4.3 Likely signal vs likely noise

| Likely to carry signal | Likely noise (evidence above) |
|---|---|
| **Volatility / range and time-of-day seasonality.** Strong, but it sizes and gates trades; it does not give direction. | Candle patterns and shape codes |
| **Momentum / breakout state.** Weak but real. | Chart images and the CNN embedding |
| **Intraday equity cross-asset** (ES / NQ / RTY lead-lag, basis). Untested; data is complete. | Path geometry |
| **Order-flow proxies from 1s bars.** Untested. | S/R levels |
| **Calendar event proximity.** Mainly volatility; direction untested. | Raw TA-Lib direction |
| | HMM regimes; nearest neighbours; candle LM |
| | News before backfill: untestable, not noise. It is unknown. |

### 4.4 Baselines the model must beat

All in the same entry slots:
1. The unconditional bracket rate above: random side, same times.
2. The ta_strategy matched-random-entry null (gate, hours, side).
3. The frozen three books as the primary with no filter.
4. Buy-and-hold per session day: report alpha after beta with Newey-West.
5. The per-fold training majority class.
6. For the volatility head: a seasonal HAR, i.e. an hour-of-day profile plus deseasonalised lags (skeptic 01_analysis).

Grade every candidate against these with a Reality Check or deflated Sharpe that counts every configuration tried.

### 4.5 Traps and where they are already handled

| Trap | Where it is handled / what to do |
|---|---|
| **Two clocks** | `bars` is true UTC; `ohlcv_*`, `mnq_*`, `candle_anatomy*` and `derived_labels` are Pacific wall clock stored as UTC (+7/+8 h). Convert before any join with news (UTC), calendar or `bars`. Session day = stamp + 9 h (`ta_strategy_600_ticks.py:563,575`); `lake.sentiment` relocalises. |
| **Roll splices** | `mnq_ohlcv_*` is raw spliced. Use `cycle/rolls.py` (additive) or `ta_strategy/data.py::load_minutes_rebuilt`. The 2019–2020 stitch had 4,833 intra-session contract flips before the rebuild. Skip or flag roll days; holding across a roll is uncharged (Model Cycle audit #15). |
| **Overlapping samples** | Uniqueness weights plus purge = `resolution_bars` (label contract); block bootstrap with Politis–White length (`latent/robust.py`); count per-day correlated trades as one day. |
| **Look-ahead** | Next-open fills (`cycle/simulate.py`); same-bar stop and target counted as a loss or flagged ambiguous; features built from completed bars only (`build_feature_ladder.py` `shift(1)` + `min_periods = window`); higher-timeframe features from the last *completed* bar; news known at `seen_ts` with GDELT +15 min; ZigZag pivots only as of their confirmation bar. |
| **Feature cache** | Key it on data snapshot + `max_bars` + code version (TEMP-04, fixed 2026-09-28). |
| **Holdout contamination** | H2-2025 has already been viewed through the ta_strategy frozen specs (their three books score +57 ticks/day there), the crossover, TrendState and the candle_vocab test slice. Freeze all choices before one holdout read, and report NQ 2010–2019 alongside it. |

---

## 5. Honest prior

**Probability of clearing the gate as written: about 3% (1–5%).**

Three independent obstacles multiply:

1. **Edge size.** It needs +9 to +10 points of target-hit rate. The best found anywhere, after roughly 4,000 tested configurations, is about +5, and pre-registered out-of-sample it is smaller (PF 1.07–1.10, payoff 1.43).
2. **"Positive in every development quarter"** (about 25 quarters) is nearly unattainable at one trade a day even with a *true* edge. Independent trades, binomial:

   | True win rate | 1 trade/day | 2 trades/day | 3 trades/day | 5 trades/day |
   |---|---|---|---|---|
   | 40% | 0.9% | 14.5% | 41% | 80% |
   | 42% | 6.8% | 48% | 80% | — |
   | 45% | 36% | 88% | — | — |

   Trades on the same day are correlated, so the real numbers are lower.
3. **Holdout noise.** On 126 holdout days, a true 42% model shows ≥ 40% only 67% of the time; a true 40% model, 49%.

**What would raise it most, in order:**

1. **Restate the gate as the statistics require.**
   - Win rate and payoff measured over the holdout *portfolio*, with a confidence bound rather than a point estimate.
   - "Every quarter" replaced by "positive in at least 80% of quarters and no quarter below −X", or evaluated on 3–5 low-correlation trades a day.
2. **Add information that has not yet been tested:**
   - order-flow proxies from the 1s bars (free, available now)
   - intraday ES/RTY/NQ cross-asset features (data complete)
   - the filtered GDELT GKG backfill and the FOMC/BLS calendar (Tyler must approve the filtered landing and register a free FRED key)
3. **Meta-label the momentum/ORB primaries** rather than learning direction from scratch, with the volatility head setting `s`.
4. **Buy a clean holdout** (Databento MNQ 2026-01 → 09, paid) because H2-2025 is contaminated for the known families.
5. **Pretrain on NQ 2010–2019 plus MNQ, and pre-register one holdout read.**
