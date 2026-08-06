# Intraday Model Arsenal — A First-Principles Architecture for MNQ ≤30m

**Provenance.** Synthesis of a 300-spec audit across 7 parallel research agents (see `catalog_per_model_notes.md` for per-spec evidence). Designed against Tyler's MNQ futures stack: 863M-row QuestDB, multi-TF parquet (1m/5m/15m/30m/1h/4h/1d), 4 currently-trained models (`xgb_classifier`, `primitives`, `transformer_range`, `transformer_direction_daily`), and a $14 round-trip cost on MNQ. Note: the live OHLCV/ticks/DOM ILP feed that fed this stack was removed on 2026-07-27 — the QuestDB history it produced is intact, but nothing streams new bars in.

**Headline metric (sole arbiter).** Sharpe-after-costs on walk-forward + purged + embargoed CV, with block-bootstrap 95% CI. Every model in this arsenal must clear that bar OR have a concrete path to it.

**Reading guide.**
- §1 — the actionable arsenal (one-screen table)
- §2 — the 9-layer architecture, layer by layer with chosen model + alternatives rejected
- §3 — multi-timeframe training protocol (concrete: how 1m/5m/15m/30m heads share/don't share)
- §4 — trend / range / direction / volume / regime decomposition
- §5 — what `models.json` has now and where each new entry slots in
- §6 — ordered integration roadmap (week 1, quarter 1)
- §7 — explicit reject pile

---

## 1. The Arsenal — Executive Verdict

The 300-spec catalog reduces to **34 actionable models** (CORE + SUPPORTING). Everything else is BASELINE (must be beaten), RESEARCH (needs spike), or REJECT (no intraday role). The CORE column shows what should land in `models.json` first — the SUPPORTING column shows the infrastructure layers wrapping them.

### CORE (12 entries — wire to `models.json` first)

| # | Model | Role | TF | Lift mechanism (one sentence) | Risk |
|---|---|---|---|---|---|
| 1 | **MAE pretraining** (block-masked, 16-bar chunks) | pretrain | 1m–30m, MTF | Self-supervised foundation-model warm-start on 863M-row QuestDB; replaces random init for every downstream head | Block-mask schedule choice; needs ~10M windows |
| 2 | **GJR-GARCH(1,1,1) Student-t** | volatility | 5m–daily | Conditional-vol forecast — fills the project's largest gap; Hurst \|returns\|=0.81 daily proves vol persistence is dominant predictable structure | Cannot model intraday seasonality alone (use FFF or periodic GARCH addition) |
| 3 | **Quantile Regression** (LightGBM `objective="quantile"`) | volatility / range | 1m–30m | Distributional return forecast (q05/q25/q50/q75/q95) without distributional assumption — adaptive stop = q05, adaptive target = q75 replaces fixed triple-barrier widths | Quantile crossing (use monotone constraints / non-crossing penalty) |
| 4 | **HMM with Student-t emissions** at 5m+ | regime | 5m–MTF | Reinstate the previously-removed model **at the right TF** — 1m ACF=−0.011 = no Markov signal; 5m+ regime persistence is real | Must use Student-t emissions; Gaussian fails on kurtosis |
| 5 | **Mixture of Experts** (top-k routing) | regime / direction | 1m–MTF | Sparse per-regime expert heads (high-vol / low-vol × open / midday / close × news / no-news) sidesteps the single-distribution averaging that the current Transformer head silently does | Load-balance loss + gating noise required to prevent expert collapse |
| 6 | **Calibrated Classifier** (Isotonic + Temperature Scaling) | ensemble | all | Project explicitly lacks calibration; raw logits are over-confident → "trade only when p > 0.65" math is broken until this lands | Isotonic needs ~1000 calibration samples per class — borderline at K=21 daily |
| 7 | **Tree-Boosted Neural Embedding** | direction | 1m–30m | Textbook fusion of XGBoost + Transformer — encoder produces 128-d window embedding, XGBoost consumes it alongside engineered features in one head | Embedding distribution shift vs engineered features; standardize before feeding |
| 8 | **MC-Dropout BNN** (10 lines on existing model) | direction + sizing gate | all | Per-prediction uncertainty → conviction-based position sizing and threshold gating (project has zero uncertainty gating today) | MC Dropout under-estimates uncertainty under distribution shift; pair with temperature scaling |
| 9 | **PETS** (Probabilistic Ensemble + Trajectory Sampling) | execution / sizing | 1m–30m | Only model-based-RL spec with explicit epistemic vs aleatoric decomposition; epistemic disagreement IS the regime-break detector → flat the position when novel | Per-member Gaussian head still under-models tails; replace with Student-t |
| 10 | **Quadratic Programming sizer** (Markowitz with Ledoit-Wolf shrunk Σ) | execution | MTF | Closes the loop from probability → contracts; xgb/transformer output a probability, QP outputs lots with quadratic risk penalty | Raw 1m Σ is rank-deficient and flips sign every bar — Ledoit-Wolf shrinkage mandatory |
| 11 | **CMA-ES** for Sharpe-after-cost optimization | meta / HPO | n/a | Optuna's TPE assumes smooth surfaces; Sharpe-after-cost is non-differentiable (entry-thresholds and stop-distances are step functions around tick boundaries) — CMA-ES is the right tool | Population size ~4+3·log(n_dims); needs many CPU cores |
| 12 | **Isolation Forest jump labeler** | anomaly / label-gen | 1m–30m | Project has no jump labeling; IsoForest top-1% gives clean automatic jump labels that (a) become a categorical Transformer feature, (b) seed Tri-Training for rare-event amplification | Path-length score is feature-scale-sensitive; rank-normalize within rolling window |

### SUPPORTING (22 entries — secondary infrastructure)

| Model | Role | Why it lands |
|---|---|---|
| **CPC** (Contrastive Predictive Coding) | pretrain | Orthogonal to MAE — predicts FUTURE, only SSL objective directly aligned with the trading task |
| **SwAV** (Sinkhorn cluster assignments) | regime | Unsupervised regime labels for MoE expert routing |
| **GMM** (Student-t mixture) | regime | Soft regime probabilities, Student-t for fat tails, BIC selects K — primary regime tagger feeding MoE / HMM gating |
| **Dirichlet Process / HDP-HMM** | regime | Solves the K problem when GMM/HMM K-selection is unstable |
| **Gaussian Process** (spectral-mixture kernel) | regime / direction | Daily n=2069 fits perfectly in O(n³); learns periodicities Transformer misses; uncertainty-aware |
| **AFT (Accelerated Failure Time)** + Cox PH | exit-policy | Triple-barrier already produces (event_time, event_type) — perfect AFT inputs; predicts time-to-target vs time-to-stop |
| **Decision Transformer** (Latent Planning with Transformers) | exit-policy | Return-conditioned sequence modeling; sidesteps fat-tail world-model failure entirely |
| **MPC** with PETS dynamics | execution | Receding-horizon re-planning is structurally right for non-stationarity; naturally encodes transaction cost |
| **MCTS** (AlphaZero pattern, Transformer prior) | exit-policy | Cost-aware trade-sequence planning — every rollout sees the $14 explicitly |
| **Differentiable Logic Layer / Residual Learning over Rules** | direction prior | Encode "ATR break + VPIN > 0.7" as differentiable t-norm; NN learns the residual |
| **Attention-Weighted Forecast Stack** (TFT-style) | ensemble | Per-input attention weights over base models — upgrade from static stacked ensemble |
| **SDE family** (Heston + Bates jump-diffusion) | pretrain (synthetic) | Synthetic OHLCV that respects vol clustering AND fat tails for pretrain corpus |
| **Agent-Based Modeling** (heterogeneous LOB sim) | pretrain (synthetic) | Microstructure-aware synthetic ticks; complement to SDE-only paths |
| **Co-Training (Dual View)** | label-gen | Tyler's parquet has true dual views (`vol_at_{bid,ask}`, `trades_at_{bid,ask}`) — perfect fit |
| **Tri-Training** | label-gen | PAC-bounded majority-vote pseudo-labels; force diversity via feature-view splits |
| **Stacked Ensemble** (logistic meta-learner) | ensemble | One-day implementation; almost always beats single-model picks |
| **PCA whitening** (per-fold fit) | feature-extraction | Stabilizes Transformer training significantly; gradient noise scale drops |
| **UMAP** (16-d feature compression + 2D viz) | feature-extraction | Dual duty: dashboard regime panel + non-linear feature compression |
| **k-NN regime retrieval** (FAISS-IVF) | regime | Non-parametric "find 50 most similar bars and look at empirical conditional return distribution" |
| **Robust Covariance** (MCD) | anomaly + Σ | Dual-purpose — Mahalanobis anomaly detector AND robust Σ for the QP sizer |
| **Bayesian Linear Regression** | direction gate | Predictive variance gates entries: trade only when posterior \|μ\|/σ > k |
| **Fuzzy Logic blender** | ensemble | Mathematically-principled mixing of NN logits + indicator scores + regime posteriors → continuous trade-conviction |

Cross-reference: every entry above maps to a specific spec ID in `catalog_per_model_notes.md` §A1–A7.

---

## 2. The Intraday Architecture — 9 Layers

This is a layered stack reasoned from the four first-principles facts (microstructure-dominated S/N, regime-dependent stationarity, MTF causality, cost asymmetry), not chosen in advance. Every layer names a chosen model + specific alternatives explicitly considered and rejected, with mechanism reasoning.

### Layer 0 — Data Substrate

**Already exists.** Pre-materialized parquet at `data/parquet/{symbol}/{tf}.parquet` for {1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w} with common-span alignment (MNQ canonical: 2019-05-05..2025-12-25, 2,340,445 1m bars). QuestDB unified `ohlcv` (1-second granularity) + `ticks` + `dom_l2` + `dom_summary`. Microstructure fields (`vol_at_{bid,ask}`, `trades_at_{bid,ask}`) preserved through parquet rebuild.

**Gap to fix:** the 8 mat views exist but no live DOM ILP stream reaches the training cache — the previous feed was removed on 2026-07-27. A replacement DOM producer must be wired for the orderflow features Layer 4/9 needs.

### Layer 1 — Self-Supervised Pretrainers

**Chosen: MAE block-masked (50% mask ratio, 16-bar contiguous chunks) + CPC InfoNCE auxiliary loss.**

**Mechanism.** With 1m lag-1 ACF = −0.011, vanilla autoregressive next-bar MSE collapses to predicting the unconditional mean — the noise floor swallows the signal. **Masked modeling** with **block masking** sidesteps this: reconstructing 16 contiguous masked bars from the visible context cannot be solved by the trivial "copy the adjacent bar" strategy that random masking allows. The encoder is forced to learn cross-bar conditional structure, not marginal statistics. Throwaway decoder, keep encoder.

**CPC complements MAE because it predicts the FUTURE rather than reconstructing the past.** The InfoNCE loss `L = -log(exp(f(c, x_{t+k})) / Σ exp(f(c, x_neg)))` treats (context, true future) as positives and (context, random window) as negatives. Critically, InfoNCE does NOT require MSE-quality regression signal — it only needs that true-future is *more similar* to context than random-future. That's a much weaker requirement that survives the −0.011 ACF.

**Negatives correctly constructed for time-series** (not images): `same-symbol windows >1 day apart from a different volatility-regime bucket`. Naive image-style augmentations (jitter, scaling, flipping) destroy microstructure signal — they're the wrong analogy.

**Alternatives rejected:**
- **GPT-style autoregressive (decoder-only)** — better fit for natural language than for kurtosis-102 bars; needs token-bucketed vocabulary which adds a quantization hyperparameter that dominates downstream performance. Move to RESEARCH for a "TimeGPT"-style v2.
- **BYOL / SimSiam / Barlow Twins** — no-negatives variants are cleaner but less informative than MAE's reconstruction objective; keep as ablations.
- **Self-Supervised GANs** — GAN training is brittle on financial time-series (mode collapse on dominant regime); MAE/CPC dominate on every empirical benchmark.
- **Rotation Prediction (RotNet)** — rotations have no meaning for OHLCV; vision-only.

**Substrate:** pretrain on full 863M-row QuestDB → 5-10M 128-bar windows across MNQ + EURUSD. Asymmetric encoder/decoder (heavy encoder kept, light decoder discarded). Output: a frozen Transformer-encoder backbone consumed by every Layer 4/5/8 head.

**Walk-forward protocol:** pretrain runs on a rolling 5-year window once per quarter; downstream heads re-fine-tune per WF fold but the pretrained weights stay anchor-pinned for 90 days at a time.

**Headline metric:** downstream `within2pt_acc` improvement of the existing `transformer_range` head when initialized from MAE vs from random — must be ≥1.5% absolute or MAE doesn't ship.

---

### Layer 2 — Regime Detector (MTF, runs primarily on 30m)

**Chosen: HMM with Student-t emissions at 5m+ (primary) + GMM with Student-t mixture at all TFs (secondary, soft regime probabilities) + Sticky-HDP-HMM (when K is unstable).**

**Mechanism.** The 2026-04-03 HMM removal was a **scale error, not a model error**. At 1m, lag-1 ACF = −0.011 means nothing is Markovian — the model fits noise. At 5m+ the picture inverts: realized-vol clustering has Hurst exponent 0.81 daily, regime persistence is the dominant predictable structure. Reinstate HMM at 5m and 30m specifically, **not 1m**, with **Student-t emissions** (not Gaussian — kurtosis 5.8 daily and 102 at 1m make Gaussian likelihoods catastrophically wrong on tail bars).

**3–5 hidden states** carry the regime semantics:
- `S1: trend-up` (positive drift, low vol)
- `S2: trend-down` (negative drift, low vol)
- `S3: mean-reverting` (zero drift, low vol)
- `S4: high-vol no-direction`
- `S5: stress / news-shock` (rare, t-emission picks this up explicitly)

**Forward-backward smoother** outputs γ_t (state posterior at time t) — this becomes 3-5 extra channels into the Transformer's volume stream and a conditioning input to MoE gating (Layer 4).

**Sticky-HDP-HMM** (Fox 2008) is the right answer when "is K=4 right?" is itself uncertain. The Dirichlet process prior with a stickiness hyperparameter that biases toward longer dwell times solves both problems together.

**GMM is the parallel soft-clustering tagger** — operates on the same windowed feature vector (`return, |return|, range, volume_z, vpin, time_of_day_sin/cos`) and produces P(regime=k) probabilities. Student-t mixture is mandatory; the canonical Gaussian mixture chokes on tail bars.

**Alternatives rejected:**
- **K-Means** — spherical-cluster assumption is fatal for fat-tailed returns. BASELINE only.
- **Spectral Clustering** — captures non-convex regimes but O(N³) without Nyström; brittle to similarity-kernel choice. RESEARCH.
- **DBSCAN** — bandwidth-sensitive; use HDBSCAN as a fallback.
- **Affinity Propagation, Mean Shift** — O(N²)+ memory; don't scale to 2.3M bars.
- **Deep Clustering Network** — joint AE + clustering; cluster identities unstable across re-trainings.

**Walk-forward:** HMM refit per fold using only training-window data. EM converges in minutes.

**Headline metric:** Sharpe-after-cost lift when the existing direction head is conditioned on regime posterior vs unconditional — must beat the unconditional baseline by ≥0.1 cost-adj Sharpe.

---

### Layer 3 — Conditional Volatility Predictor

**Chosen: GJR-GARCH(1,1,1) with Student-t innovations (primary, classical) + Quantile Regression head via LightGBM `objective="quantile"` (modern, distributional, parallel).**

**GJR-GARCH mechanism.** The standard GARCH(p,q) update `σ²_t = ω + α·ε²_{t-1} + β·σ²_{t-1}` captures vol clustering but treats positive and negative shocks symmetrically. The **GJR (Glosten-Jagannathan-Runkle) leverage term** `+ γ·ε²_{t-1}·1[ε_{t-1}<0]` adds an asymmetric response: down-moves amplify vol more than up-moves of the same magnitude. This is empirically true on equity index futures (the leverage effect — Christie 1982, Bekaert-Wu 2000). Vanilla GARCH systematically under-predicts vol after large down moves.

**Student-t innovations** (df ~5-7 calibrated) are mandatory — the Gaussian innovation assumption underprices tail probabilities by orders of magnitude on MNQ kurtosis 102 / 5.8 (1m / daily). A Student-t with df=5 has kurtosis 6, df=4 has kurtosis 9 — at least matches the daily regime; for 1m use the realized-vol projection at 5m+ rather than fitting GARCH directly to 1m.

**Output:** 1-step-ahead conditional vol forecast `σ̂_{t+1}` consumed by:
- (Layer 8) position sizer — Kelly fraction ∝ 1/σ̂²
- (Layer 4) Transformer feature — `σ̂_{t+1}` and `σ̂_{t+1} / σ̂_{t-20:t}` (vol-of-vol)
- (Layer 6) exit-policy stop placement — adaptive stop at `entry - k·σ̂_{t+1}`

**Quantile Regression mechanism.** The complementary modern approach: predict `q05, q25, q50, q75, q95` of next-bar return jointly using **pinball loss** `L(y, q) = max(τ·(y-q), (τ-1)·(y-q))`. No distributional assumption — just the empirical conditional CDF. Use LightGBM's native `objective="quantile"` with `alpha=τ` for production; linear quantile regression (`statsmodels`) as the baseline.

**Adaptive trading rules from quantile output:**
- Adaptive stop = predicted q05 (5% downside)
- Adaptive target = predicted q75 (75% upside)
- Trade gate: `q50 > entry_threshold AND q05 > -max_drawdown_per_trade`

**Quantile crossing** (predicted q75 falling below q50 at boundaries) — solve with monotone constraints (Cannon 2018) or non-crossing penalty.

**Alternatives rejected:**
- **Vanilla GARCH** — symmetric response wrong for equity index futures.
- **EGARCH** — log-vol parameterization avoids non-negativity but is harder to interpret; GJR matches stylized facts equally well.
- **Prophet** — additive trend + seasonality is the wrong tool for tick returns; designed for daily business-cycle data.
- **Diffusion models for vol forecasting** — distributionally elegant but 100-1000 reverse-diffusion steps make 1m latency wall prohibitive; defer to RESEARCH (DDIM/distillation may eventually clear it).
- **Neural ODE for vol dynamics** — assumes smooth continuous flow; explicitly excludes jump processes.

**Walk-forward:** GARCH refit per fold (seconds); quantile head trained per fold with same purge/embargo as direction head.

**Headline metric:** out-of-sample log-likelihood vs realized vol; coverage of predicted intervals at nominal levels (e.g., true q05 should be exceeded ~5% of the time).

---

### Layer 4 — Direction Signal (1m, 5m, 15m parallel heads, MTF-conditioned)

**Chosen architecture (per-TF head):** **MAE-pretrained two-stream Transformer encoder + Mixture-of-Experts head + MC-Dropout uncertainty + Differentiable Logic Layer prior.**

**Stack:**
```
Input (128 bars × {OHLCV, vol_at_bid, vol_at_ask, trades_at_bid, trades_at_ask, vpin, regime_posterior_5d, garch_sigma, q05_q50_q75})
    │
    ├─→ Price stream: Linear(4 → 112) + sinusoidal PE
    ├─→ Volume stream: Linear(1 → 16)  (no PE)
    │
    ▼
Concat → d_model=128 → MAE-pretrained Transformer encoder (4 layers, 4 heads, d_ff=512)
    │
    ▼
Mean-pool → 128-d window embedding
    │
    ├─→ Tree-Boosted path: LightGBM([engineered_features ‖ embedding]) → P(direction)
    │
    └─→ MoE head: top-k=2 expert routing on (regime_posterior, garch_sigma, time_of_day)
            ├─ Expert 1: trend-up specialist
            ├─ Expert 2: trend-down specialist
            ├─ Expert 3: mean-reverting specialist
            ├─ Expert 4: high-vol specialist
            └─ Expert 5: stress specialist
        ↓ (weighted sum of expert logits)
    Differentiable Logic Layer adds prior: logit += λ·rule_score
        rule_score = ∏_i sigmoid(α_i·(feature_i - threshold_i))    # Lukasiewicz t-norm
    ↓
    MC Dropout (20 forward passes at inference) → predictive mean + std
    ↓
    Temperature-scaled softmax → calibrated P(direction)
    ↓
    Trade gate: P(direction) > 0.65 AND mean/std > k (Bayesian gate)
```

**Why this design wins on first principles:**

1. **MAE-pretrained encoder** beats random init because the −0.011 ACF supervised signal is too weak to learn good representations from scratch with only 2.3M labeled examples; SSL on 863M unlabeled examples extracts the structure that is there.
2. **Two-stream architecture** (existing) is correct — price and volume have different statistical structure; sharing parameters confounds them.
3. **MoE head** addresses regime-dependent stationarity directly — different experts for different regimes solves the problem that a single shared head implicitly assumes a single conditional distribution. **Top-k=2 routing** with **load-balance loss** (KL between expert usage and uniform) prevents expert collapse.
4. **Tree-Boosted Neural Embedding parallel path** (LightGBM consuming the embedding alongside engineered features) is a free-rider — XGBoost/LightGBM dominate on tabular interaction modeling that attention is bad at; the ensemble of MoE-Transformer + LightGBM-on-embedding is uncorrelated-error stacking with negligible engineering cost.
5. **Differentiable Logic Layer prior** encodes domain knowledge as a differentiable bias `λ·rule_score` where `rule_score = ∏ sigmoid(α·(feature - threshold))` is a smooth t-norm. Initialize the NN component to output zero so the model starts as the rule baseline and learns the residual — guarantees ≥ rule-only performance.
6. **MC Dropout** at inference (20 passes) gives a per-prediction variance — the cost-asymmetric trading task wants to skip uncertain predictions; not skipping uncertain trades costs $14 per contract round-trip.
7. **Temperature scaling** (single scalar, fit on validation set, preserves arg-max) fixes most of the ECE without touching the architecture.
8. **Bayesian gate** `μ/σ > k` (where μ is calibrated probability and σ is MC-Dropout std) is the explicit cost-aware filter.

**Per-TF heads:**
- 1m head: focused on entries with tight stops (q05-driven), expects 30-60 second hold
- 5m head: primary direction signal (best S/N at this scale per the daily-direction empirical work)
- 15m head: confirmatory bias for 5m head (alignment = high conviction; disagreement = skip)
- 30m head: regime context only (feeds Layer 2 regime detector — not a trade signal at 30m by itself)

**MTF aggregation:** ensemble logits as `final_logit = w_5 · σ⁻¹(p_5m) + w_15 · σ⁻¹(p_15m) + w_30 · σ⁻¹(p_30m)` with weights from the **Attention-Weighted Forecast Stack** (TFT-style learned attention over base model logits, conditioned on regime).

**Alternatives rejected:**
- **Pure XGBoost** — incumbent. Stays as the head-on-engineered-features comparator. The Tree-Boosted Neural Embedding path subsumes it as a member of the ensemble.
- **Pure GBM/Random Forest/ExtraTrees** — BASELINE only; LightGBM dominates them on speed and signal extraction (leaf-wise + GOSS on heavy-tailed gradients).
- **Decision Transformer (offline RL)** — RESEARCH (Layer 6 candidate); for the direction head specifically, supervised cross-entropy is more sample-efficient.
- **Mamba / S4 / state-space models** — not in the catalog; would need to be added as RESEARCH if PatchTST-style transformer hits a context-length ceiling.
- **GNN over cross-asset** — RESEARCH; useful only when 2+ instruments are in the parquet (currently only MNQ + EURUSD).
- **Capsule, Spiking, Vanilla RNN** — REJECT.

**Walk-forward:** per-TF heads trained per fold with purged k-fold (purge_bars = max(label_horizon, 5) per fold); MoE gating learnable per fold but expert weights pretrained-then-fine-tuned to avoid cold-start.

**Headline metric:** cost-adjusted Sharpe per TF; profit factor; calibration (ECE).

---

### Layer 5 — Range / Target Predictor

**Chosen: existing `transformer_range` (K=21 buckets) + Quantile Regression head as the distributional alternative.**

**Reasoning.** The existing K=21 bucket classification head is a discretized approximation to a quantile prediction. The Quantile Regression head is the continuous version. **Run both:**
- `range_class` (K=21) → easier to display in the chart overlay; integrates with the existing dashboard
- `quantile_head` (q05/q25/q50/q75/q95) → drives adaptive stop/target; integrates with position sizing

**Ordinal Regression** (proportional-odds) is the BASELINE that the K=21 classification must beat — exploits ordinal structure of price buckets that softmax/cross-entropy ignores.

**Walk-forward / metric:** per-fold `within2pt_acc` (existing headline) + pinball loss on the quantile head + Spearman rank correlation between predicted and true bucket index.

---

### Layer 6 — Exit / Position-Sizing Policy

**Chosen: AFT (time-to-target/stop) + MCTS (cost-aware trade-sequence planner with Transformer prior) + Decision Transformer (offline-RL alternative).**

**AFT mechanism.** Triple-barrier already produces (event_time, event_type, barrier_hit) tuples — perfect AFT inputs. Log-logistic AFT models `log(T) = β·X + ε` where T is time to barrier, X are entry features, and ε is log-logistic. **Predicts median time-to-target vs median time-to-stop conditioned on entry features** — directly enables adaptive holding-period policies (e.g., time-stop adjusted per trade). **Cox PH** is the semiparametric complement: hazard ratios per covariate (e.g., "VPIN > 0.7 doubles the hazard of hitting stop").

**MCTS mechanism.** State = (position ∈ {-1, 0, +1}, regime_posterior, bars_held, unrealized_PnL). Action ∈ {hold, exit, scale-up, scale-down, flip}. Reward = path-PnL minus $14 per round-trip (baked into rollout, not added later). **AlphaZero pattern**: use the Layer 4 Transformer's direction logits as the prior policy in UCB selection — `UCB(s, a) = Q(s, a) + c · π_NN(s, a) · √(N(s)) / (1 + N(s, a))`. Rollouts go through Layer 1 SDE+ABM synthetic environment (capped at horizon ≤ 8 bars to limit jump-amplified compounding errors).

**Decision Transformer mechanism.** Return-conditioned sequence modeling: condition on (target_return_to_go, regime_features) at inference; predict next action token. **Sidesteps the fat-tail world-model problem entirely** because there is no transition model — only conditional action prediction. Trained on the existing labeled tape with offline RL.

**Why three exit-policy methods, not one:**
- AFT is the closed-form **time-stop policy** — fast, interpretable
- MCTS is the **explicit-cost lookahead policy** — explicitly accounts for $14 RT per rollout
- Decision Transformer is the **return-conditioned discrete action policy** — sidesteps world-model failure

**Run all three, ensemble the action recommendations.** They have uncorrelated error structures (parametric survival vs tree-search vs return-conditioned sequence).

**Alternatives rejected:**
- **Static triple-barrier** (current default) — works but ignores conditional information and time
- **PPO / SAC / A2C / A3C / DQN** (model-free RL) — sample-efficiency disaster on raw OHLCV without orderflow; only viable if a tick-replay simulator is built first (RESEARCH)
- **Dreamer V3 / RSSM** — diagonal-Gaussian latent fails on kurtosis 102; RESEARCH spike with Student-t modification
- **MuZero** — RESEARCH; reward-predictive latent is elegant but offline-RL stability is a real risk; spike against MCTS-Transformer above
- **CEM** (Cross-Entropy Method) — gradient-free; SUPPORTING only — useful for the small-param exit-policy network as a CEM-trained ablation against AFT

**Walk-forward:** AFT refit per fold; MCTS uses Layer 4 frozen Transformer per fold; Decision Transformer fine-tuned per fold from a pretrained (DT-pretrain) checkpoint.

**Headline metric:** cost-adjusted Sharpe lift over the static triple-barrier baseline; mean realized hold time vs predicted; tail-risk control (CVaR-95).

---

### Layer 7 — Execution Agent

**DEFERRED — RESEARCH only.** Pure execution RL on tick/DOM data requires a high-fidelity tick-replay simulator with realistic queue dynamics, slippage, and partial fills. **DES (Discrete Event Simulation)** is the right substrate; until it's built, execution stays rule-based via the Layer 8 sizer + a simple aggressive/passive heuristic.

**When the simulator lands:** SAC for continuous-action sizing, TD3 as fallback, Rainbow DQN for discrete order types, GNN+RL for cross-asset hedging. None of these matter until the simulator exists.

---

### Layer 8 — Calibration + Meta-Labeling + Sizer

**Chosen: Calibrated Classifier (Isotonic for trees + temperature scaling for Transformer) + Meta-Labeling head + QP sizer with Ledoit-Wolf shrunk Σ.**

**Calibration mechanism.**
- Tree models (`xgb_classifier`, `lightgbm`, `catboost`) → `sklearn.calibration.CalibratedClassifierCV(method="isotonic", cv=5)`. Isotonic is non-parametric, handles arbitrary monotonic miscalibration shape. Better than Platt for K=21 multiclass (Platt assumes sigmoid-shaped miscalibration).
- Transformer head → `temperature_scale.py`: single scalar T fit on validation set by minimizing NLL: `p_calib = softmax(logits / T)`. Preserves arg-max, fixes most ECE.
- Emit ECE in `dashboard_stats.py` (already has Wilson CI + Grad-Norm CV² + reliability diagrams).

**Meta-labeling mechanism.** López de Prado's idea: a primary model predicts direction (Layer 4); a meta-model predicts whether to act on that direction. The meta-model is trained on `(features, primary_prediction, did_we_make_money)` — it learns when the primary is unreliable (low-vol chop, news windows, regime breaks). **Gates** the primary signal — directly attacks cost asymmetry by skipping low-probability-of-profit trades.

Implementation: `LightGBM(objective="binary")` on the primary head's OOS predictions + features → `P(act | primary_signal)`. Only trade when `P(act | primary_signal) > τ`.

**QP sizer mechanism.** Markowitz mean-variance with quadratic risk penalty:
```
maximize  μᵀw - λ·wᵀΣw
s.t.      |w_i| ≤ w_max for each instrument
          Σ|w_i| ≤ leverage_max
          w in lots (integer — solved via warm-started MIP or rounding)
```
- μ = vector of Layer 4 expected returns per instrument
- Σ = Ledoit-Wolf shrunk covariance over rolling 60-day intraday returns (raw 1m Σ rank-deficient and sign-flipping)
- λ = risk aversion, calibrated to target portfolio Sharpe variance

**Robust Covariance** (MCD — Minimum Covariance Determinant) is the alternative Σ estimator — robust to outliers but slower. Run both; pick whichever gives more stable weights across folds.

**Alternatives rejected:**
- **Static fixed-sizing** (current) — wastes the probability signal
- **Kelly fraction** — overfits; QP with risk constraints is the disciplined version
- **CMA-ES sizing** — gradient-free is overkill when QP is convex-closed-form
- **LP** (Linear Programming) — no risk term; trivially dominated

**Walk-forward:** calibration refit per fold; QP runs at every bar in production.

**Headline metric:** ECE (Expected Calibration Error), realized vs predicted CVaR, portfolio Sharpe-after-cost.

---

### Layer 9 — Operational Safety & Verification

**Chosen: Block-bootstrap CIs (mandatory) + RDM (Robust Decision Making) scenario suite + CSP/Rule-Based pre-trade gate + DES (when ready).**

These aren't models — they're the verification scaffolding every model must clear before promotion.

- **Block-bootstrap CIs** — 95% confidence intervals on Sharpe-after-cost per WF fold (block size = 30 bars to preserve autocorrelation). Already required per `docs/research/eda_and_metrics.md`. DSR (Deflated Sharpe Ratio) discounting for multiplicity.
- **Robust Decision Making** — every candidate strategy must report performance across {calm regime, trending regime, vol-spike regime, news days, FOMC days, Aug 2015 flash, Mar 2020 COVID, Jan 2018 vol-mageddon}. CVaR-of-Sharpe across worlds.
- **CSP / Rule-Based gate** — `python-constraint`-style pre-trade safety: max position, daily loss limit, no-trade windows around economic releases, margin/exposure caps.
- **DES** — once built, replaces the static `cost_model.json` with stochastic fills.

---

## 3. Multi-Timeframe Training Protocol

The 30m structure dictates 5m direction; 5m vol dictates 1m noise floor. A single-TF model cannot disentangle these. Concrete protocol:

**Backbone sharing.** ONE shared MAE-pretrained Transformer encoder. Per-TF heads are thin (single MoE layer + classification head on top of the shared embedding). Per-TF heads are NOT independent — they receive each other's outputs as features (see "Conditioning" below).

**Embargo / purge math.**
- Purge size per fold = max(label_horizon, 5) bars at boundary
- Embargo = label_horizon for the longest-horizon head in the fold (typically the 30m's label horizon × 6 = 30 1m bars)
- Verified against López de Prado purged k-fold with embargo

**Walk-forward configuration.**
- Fold size: 12 months training, 1 month test (consistent with the daily-direction model that has 4 folds × 12mo each)
- Step: 1 month
- Re-fit cadence: full re-fit per fold; pretrained MAE backbone re-fit only when its OOS reconstruction loss degrades >10% (typically once per quarter)

**CPCV (Combinatorial Purged Cross-Validation)** for the meta-labeling head specifically (López de Prado) — gives unbiased estimates of generalization when training on out-of-fold predictions.

**Per-TF training order (within each fold):**
1. MAE backbone (pretrain on all symbols × all TFs simultaneously)
2. CPC auxiliary loss (joint with MAE)
3. 30m head (regime context)
4. 5m head (primary signal, conditioned on 30m posterior + GARCH 5m)
5. 15m head (confirmatory)
6. 1m head (entry-precision, conditioned on 5m + 15m predictions)
7. Meta-labeler (trained on OOS of all of the above)
8. Calibration (per head, on val split inside the fold)
9. QP sizer (closed-form, no training — Σ recomputed per fold)

**Conditioning across TFs.**
- 1m head input includes: `5m_direction_logit, 15m_direction_logit, 30m_regime_posterior, garch_5m_sigma, garch_30m_sigma`
- 5m head input includes: `15m_direction_logit, 30m_regime_posterior, garch_5m_sigma`
- 15m head input includes: `30m_regime_posterior, garch_15m_sigma`
- 30m head is unconditional — it's the regime context source

This avoids look-ahead because the conditioning predictions are OOS predictions from the same fold (not in-sample fits).

**MTF aggregation at inference.**
- Final action = AttentionWeightedForecastStack({1m, 5m, 15m predictions}, conditioned on regime)
- Tie-break: when 1m says long but 5m says short, MoE-routing already-decided which expert speaks based on regime — trust that

**Headline metric:** per-TF Sharpe after costs + aggregated portfolio Sharpe vs single-TF baselines.

---

## 4. Trend / Range / Direction / Volume / Regime Decomposition

For each of the five domains, the chosen primary model + the chosen failure-detector + first-principles reasoning for why this model and not the obvious alternative.

### Trend

- **Primary:** GJR-GARCH for trend persistence detection (vol clustering Hurst > 0.5 = trending vol regime); 30m HMM `S1, S2` states for direction.
- **Failure detector:** PETS ensemble disagreement — when ensemble members disagree on the trend prediction, the trend hypothesis is unreliable.
- **Why not a simple moving-average crossover?** MA crossovers are stateful indicator-of-an-indicator with no statistical guarantee of significance under non-stationarity. GJR-GARCH provides actual probabilistic structure — `P(σ_{t+1}² | σ_t², ε_t)` — that conditions trend confidence on regime.
- **What it actually extracts that simpler methods miss:** the asymmetric leverage response. Down-trends have systematically higher vol than up-trends of equal magnitude; ignoring that under-prices stop placement on long trends.

### Range

- **Primary:** Existing `transformer_range` (K=21 buckets) + Quantile Regression head (q05/q75 → adaptive stop/target).
- **Failure detector:** Bayesian Decision Network with explicit "low-confidence range prediction → no-trade" decision node; calibration check (ECE on bucket predictions).
- **Why not a simpler ATR-based range projection?** ATR is a marginal vol estimate; conditional-on-current-state range distribution is what trades need. The K=21 head + quantile head together give the conditional distribution.
- **What it extracts:** asymmetric tail risk — trade entries with q05 << -ATR are trades to skip even if the directional signal is strong.

### Direction

- **Primary:** MAE-pretrained two-stream Transformer + MoE head + Tree-Boosted Neural Embedding parallel + Differentiable Logic Layer prior + MC-Dropout uncertainty + temperature-scaled calibration. (Layer 4.)
- **Failure detector:** Meta-labeler (Layer 8) — explicitly predicts when the primary is unreliable.
- **Why not pure XGBoost (incumbent)?** XGBoost is excellent on tabular interactions but blind to sequential structure (window order is just feature index). The Transformer captures sequential structure (attention over bars) while LightGBM handles tabular. Tree-Boosted Neural Embedding fuses both into one head; MoE handles regime-dependence the unconditional XGBoost ignores.
- **What it extracts:** regime-conditional behavior. The single XGBoost model averages across regimes; MoE doesn't.

### Volume

- **Primary:** Poisson Regression + Zero-Inflated Poisson for trade-arrival modeling on `trades_at_{bid,ask}`; Mixture of Exponentials for inter-trade durations; STL Seasonal Decomposition for intraday volume profile.
- **Failure detector:** Hawkes process residual diagnostic — if the Mixture-of-Exponentials residuals show self-excitation, durations are not memoryless and we need a Hawkes process (RESEARCH).
- **Why not just raw volume sums?** Aggregated volume hides aggressor imbalance, which is the actual microstructure signal. `(trades_at_bid - trades_at_ask) / total_trades` is a cleaner direction prior than raw volume.
- **What it extracts:** aggressor imbalance and abnormal-volume residuals as features into Layer 4. STL decomposition gives intraday profile residuals — known alpha precursor for breakout detection.

### Regime

- **Primary:** HMM with Student-t emissions at 5m + Sticky-HDP-HMM (when K is unstable) + GMM-Student-t soft probabilities at all TFs. (Layer 2.)
- **Failure detector:** Isolation Forest jump labels — when an anomaly is detected and the regime tagger doesn't update fast enough, we're in a transition that the HMM hasn't smoothed yet.
- **Why not just K-Means on (return, vol)?** K-Means assumes spherical clusters in Euclidean space; intraday returns are fat-tailed and asymmetric. Student-t HMM/GMM honor the actual distribution; K-Means is mathematically wrong here.
- **What it extracts:** regime persistence (HMM transition matrix) AND regime overlap (GMM soft probabilities). Hard cluster IDs lose the between-state information that gates aggressive sizing.

---

## 5. Mapping to Existing `models.json`

The current 4 trainable entries plus where this arsenal extends them:

| Current entry | Arsenal role | Extension |
|---|---|---|
| `xgb_classifier` (in-repo) | Layer 4 (direction baseline) | Wrap with Calibrated Classifier (Isotonic, Layer 8). Add Tree-Boosted Neural Embedding variant `xgb_classifier_with_embedding`. |
| `primitives` (sibling repo) | Layer 1 + Layer 4 | Acts as a feature-extraction backbone alongside MAE; primitives features become inputs to LightGBM in the Tree-Boosted path. |
| `transformer_range` (wrapper to trading_model) | Layer 4 + Layer 5 | Initialize from MAE backbone (Layer 1). Add MoE head. Add MC-Dropout. Add Differentiable Logic Layer. |
| `transformer_direction_daily` (wrapper to trading_model) | Layer 4 (daily) | Add GP head (Layer 2 alternative for n=2069). Add Bayesian Linear Regression as the uncertainty-gated baseline. |

**Gaps to fill (new `models.json` entries proposed):**

| New entry | Layer | Runner type |
|---|---|---|
| `mae_pretrain` | 1 | python (in-repo `src/ml/mae_pretrain/main.py`) |
| `cpc_pretrain` | 1 | python (in-repo `src/ml/cpc_pretrain/main.py`) |
| `gjr_garch_vol` | 3 | python (in-repo `src/ml/garch/main.py` using `arch` package) |
| `lgbm_quantile_range` | 3, 5 | python (in-repo `src/ml/lgbm_quantile/main.py`) |
| `hmm_regime_5m` | 2 | python (in-repo `src/ml/hmm/main.py` with t-distributed emissions) |
| `gmm_regime_tagger` | 2 | python (in-repo `src/ml/gmm/main.py` with Student-t mixture) |
| `gp_daily_direction` | 4 | python (in-repo `src/ml/gp/main.py` using GPyTorch + spectral-mixture kernel) |
| `lightgbm_classifier` | 4 | python (in-repo `src/ml/lgbm_classifier/main.py`) |
| `catboost_classifier` | 4 | python (in-repo `src/ml/catboost_classifier/main.py`) |
| `tree_boosted_embedding` | 4 | python (depends on MAE backbone + xgb/lgbm) |
| `aft_exit_policy` | 6 | python (in-repo `src/ml/aft/main.py` using `lifelines`) |
| `meta_labeler` | 8 | python (in-repo `src/ml/meta_label/main.py`) |
| `iso_forest_jumps` | 2 (anomaly) | python (in-repo `src/ml/anomaly/iso_forest.py`) |
| `qp_sizer` | 8 | python (in-repo, called from order layer; not a "trained" model but registered for transparency) |

Each entry must conform to the existing schema (`defaultHyperparameters`, `defaultSearchSpace`, `cliFlags`) so the orchestrator UI works without changes. The patch proposal lives in a separate plan file (per the original plan's tertiary deliverable note) — not landed in this pass.

---

## 6. Integration Roadmap

### Week 1 (5 items — "if I had a week")

1. **MAE pretraining of the existing two-stream Transformer body** — `scripts/pretrain_mae.py` against the parquet repo. Block masking, 50% mask ratio. Initialize `transformer_range` from the MAE checkpoint instead of random. Headline: `within2pt_acc` lift ≥1.5%.
2. **GJR-GARCH(1,1,1) Student-t at 5m** — `scripts/fit_garch.py` using `arch.univariate.ARX(...).GJRGARCH(p=1,o=1,q=1, dist="StudentsT")`. Output: `data/features/garch_5m.parquet` consumed by all downstream heads as a feature.
3. **Calibration wrapper for `xgb_classifier` and `transformer_range`** — `sklearn.calibration.CalibratedClassifierCV(method="isotonic", cv=5)` for the tree model + `temperature_scale.py` for the Transformer. Wire ECE into `dashboard_stats.py`.
4. **MC-Dropout on existing Transformer** — 10 lines: enable dropout at inference, run 20 forward passes, emit predictive mean + std as new dashboard channels. Add Bayesian gate `μ/σ > k` to the trade-decision logic.
5. **Stacked Ensemble** of `xgb_classifier` + `transformer_range` + (calibrated outputs) — `scripts/train_stacked_ensemble.py` with logistic meta-learner on OOS predictions, purged TimeSeriesSplit. Headline: cost-adj Sharpe lift over the better of the two.

### Quarter 1 (10 items — "if I had a quarter")

6. **CPC auxiliary pretraining** alongside MAE — joint loss `L = L_MAE + λ·L_CPC` on the same encoder. Headline: incremental `within2pt_acc` lift.
7. **HMM 5m with Student-t emissions** — `scripts/fit_hmm_5m.py` using `hmmlearn` with t-distribution patch (or PyMC for full Bayesian). Output γ_t feeds Transformer as a regime feature.
8. **GMM Student-t mixture** at 5m and 30m — soft regime probabilities as continuous features.
9. **LightGBM with `objective="quantile"`** for q05/q25/q50/q75/q95 head — `scripts/train_lgbm_quantile.py`. Drives adaptive stop/target.
10. **MoE head** on top of MAE-pretrained Transformer — refactor `src/ml/cnn_transformer/` to support top-k expert routing with load-balance loss.
11. **Tree-Boosted Neural Embedding** — `scripts/train_tree_boosted_embed.py`: extract embedding from MAE-Transformer, standardize, concat with engineered features, train LightGBM head.
12. **AFT exit-policy** — `scripts/fit_aft.py` using `lifelines.LogLogisticAFTFitter`. Predicts time-to-target / time-to-stop conditioned on entry features. Replaces static triple-barrier exit times.
13. **Meta-labeler** — `scripts/train_meta_labeler.py`: LightGBM(objective="binary") on OOS predictions of the primary direction model. Gates trades.
14. **CatBoost classifier** A/B vs XGBoost on identical features + folds. If CatBoost wins on cost-adj Sharpe by ≥0.05, swap or stack.
15. **QP sizer with Ledoit-Wolf shrunk Σ** — `src/portfolio/qp_sizer.py` consuming live model probability + LW-shrunk Σ. Replaces flat-lot sizing.

### Quarter 2+ (RESEARCH spikes)

- **MCTS exit-policy** with Transformer prior (AlphaZero pattern) — requires SDE+ABM rollout simulator
- **Decision Transformer** — return-conditioned offline RL on the existing labeled tape
- **PETS ensemble** — 5-7 dynamics MLPs with epistemic disagreement gating
- **Differentiable Logic Layer** — encode 10-20 indicator rules as differentiable t-norm priors
- **SDE + ABM synthetic pretrain corpus** — Heston + Bates jump-diffusion + heterogeneous-agent LOB sim → billions of synthetic 1m bars for backbone pretraining
- **Cross-asset GAT** — pending 2+ instruments in parquet
- **DES tick-replay simulator** — unblocks all execution-RL research (SAC, Rainbow, GNN+RL)

---

## 7. Reject Pile (one paragraph per category)

**Vision-pure architectures without mechanism transfer.** BigGAN, StyleGAN, CycleGAN, ViT for image classification, U-Net for image segmentation, Capsule Network, Spiking Neural Network, PixelRNN/PixelCNN, Self-Supervised GANs. Every one of these has architectural assumptions tied to spatial coherence that disappear on scalar OHLCV bars. The mechanism that transfers is patch embedding (ViT → PatchTST) and self-attention (already in stack); the rest are tools for different problems.

**Pre-Transformer sequence baselines.** Vanilla RNN, LSTM, GRU, Attention-Based RNN, RNN-CNN Hybrid, Neural Turing Machine. All BASELINE — useful as the floor every Transformer head must beat. Production runtime is too slow (sequential bottleneck), gradient flow over 128+ bars is fragile, and capacity per parameter is significantly worse than attention. Keep ONE LSTM baseline; skip the rest.

**Symbolic-AI legacies.** Probabilistic Logic Network, Probabilistic Soft Logic, First-Order Logic Inference, Logic Programming (Prolog), Expert System. No production tooling; truth-value calculus is ad hoc compared to standard probability; subsumed by Bayesian Networks for any practical use case. Symbolic Regression (PySR) is the one survivor — kept as RESEARCH for offline closed-form expression discovery.

**Generic templated specs.** "Hierarchical Latent Variable Model", "Composable Skill Transfer Framework", "Hybrid Differentiable Planner", "Latent Attention Decision Graph", "Multi-Modal Reasoning Agent" (when not actually multi-modal). When the spec content is a placeholder ("Component A + Component B + fusion") the actionable content is zero — extract the *concept* if it has one, otherwise REJECT.

**Solvers and engines (not models).** Interior-Point Methods, Augmented Lagrangian, Dual Decomposition, Lagrangian Relaxation, Branch and Bound. These are inside cvxpy / scipy / scikit-learn; cataloging them separately adds nothing.

**Wrong-scale algorithms.** Kernel SVM (O(N²) infeasible on 2.3M rows), Affinity Propagation (O(N²) memory), Mean Shift (O(N²) per iteration), Ladder Network (obsolete since 2015), Semi-Supervised SVM (wrong era for our data scale), Isomap/LLE (O(N²), dominated by UMAP). Tools designed for thousands of samples; we have millions.

**Wrong-objective optimizers.** Linear Programming (no risk term — Markowitz needs quadratic), Ant Colony Optimization (designed for combinatorial path problems, not continuous Sharpe), Particle Swarm Optimization (empirically dominated by CMA-ES on every black-box benchmark since 2010). PSO and ACO are popular but inferior; don't use.

**Wrong-distribution assumptions.** Naive Bayes (independence violated by tautological OHLCV dependencies), Prophet (additive trend on tick returns is the wrong tool), Neural ODE for jump-process dynamics (continuous flow assumption explicitly excludes jumps), Game-Theoretic Models (no strategic adversary for a price-taker on MNQ), System Dynamics (wrong abstraction layer — designed for macro/policy modeling).

**Strategic-adversary and HFT-specific tools.** Game Theory (Nash, Zero-Sum) — Tyler is a price-taker on MNQ; no adversary to play games against. Worth reconsidering only if scaling to market-making on a venue where queue priority creates strategic interaction.

---

## Verification Checklist

- [x] §1 lists 12 CORE + 22 SUPPORTING entries with one-line lift mechanism per row
- [x] §2 names a model for every layer 0–9 (no "TBD" or "depends")
- [x] §2 each layer states: chosen model + alternatives rejected with mechanism reasoning
- [x] §3 specifies concrete embargo math, fold size, conditioning order, MTF aggregation
- [x] §4 covers all 5 domains (trend / range / direction / volume / regime) with primary + failure-detector + "what it extracts"
- [x] §5 maps every existing `models.json` entry to layer + extension; lists 14 proposed new entries with runner type
- [x] §6 has 5 week-1 items (concrete enough to dispatch implementation work) + 10 quarter-1 + RESEARCH spikes
- [x] §7 explicitly rejects with one paragraph per category, no hedging

**Provenance trail:** every CORE/SUPPORTING entry in §1 maps to a specific spec ID in `catalog_per_model_notes.md`. The 7 agent transcripts at `C:\Users\tyler\AppData\Local\Temp\claude\C--Users-tyler\9b87c7f5-4103-4ef3-8d39-3d9bf6d03203\tasks\` carry the per-spec full audit (one transcript per agent A1–A7).

**Plan file:** `C:\Users\tyler\.claude\plans\go-to-ml-dashboard-merry-hinton.md` (the original research plan).
