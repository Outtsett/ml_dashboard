# Catalog Per-Model Notes — 300-Spec Audit for Intraday MNQ Trading

**Provenance.** Per-spec evidence base from 7 parallel research agents (A1–A7) auditing the 300 algo-model markdown specs at `E:\documents\algo_models\`. Each agent received the same first-principles framing for intraday MNQ futures (microstructure-dominated S/N, regime-dependent stationarity, multi-timeframe causality, cost asymmetry) and applied a uniform 5-tier verdict scheme.

**High-level synthesis** lives in `intraday_model_arsenal.md`. This file is the supporting data — every CORE / SUPPORTING entry in the arsenal can be traced back to a specific spec ID here.

**Verdict legend.**
- **CORE** — wired into `models.json` now; clear measurable lift over the existing 4 trained models
- **SUPPORTING** — secondary role (label gen, pretrainer, ensemble member, regime gate, feature extractor)
- **RESEARCH** — promising mechanism, needs spike before integration
- **BASELINE** — useful only as a benchmark to beat
- **REJECT** — no plausible intraday role

**Catalog quality note.** Several specs (Optimization, Statistical, Probabilistic & Symbolic, Hybrid placeholders) are templated boilerplate where every file contains identical structure with only the model name swapped. Verdicts in those buckets are weighted by domain knowledge of each algorithm's empirical behavior on intraday financial data, not the spec content alone.

**Bucket counts.** A1=40 + A2=20 + A3=50 + A4=47 + A5=49 + A6=40 + A7=54 = **300 specs**.

---

## Table of Contents

- [A1 — Model-Free RL + Meta-RL (40)](#a1)
- [A2 — Model-Based RL (20)](#a2)
- [A3 — NN Architectures + Generative (50)](#a3)
- [A4 — SSL + Semi-Sup + Hybrid (47)](#a4)
- [A5 — ML Supervised + Statistical (49)](#a5)
- [A6 — Probabilistic + Simulation (40)](#a6)
- [A7 — Optimization + Unsupervised + Semi-Supervised (54)](#a7)

---

## <a name="a1"></a>A1 — Model-Free RL + Meta-RL (40 specs)

**Bucket synthesis.** Top picks: CEM, SAC, Rainbow DQN, PEARL, PPO (baseline). **Zero CORE verdicts.** RL on raw OHLCV without orderflow is a sample-efficiency disaster; the tools that survive are either (a) gradient-free optimizing the actual metric (CEM), (b) off-policy replay-based (SAC, Rainbow), or (c) infrastructure wrapping existing supervised heads (Reptile init, Task-Aware regime conditioning). Cross-bucket flags: Task-Aware Meta-RL provides the conditioning architecture for any HMM-emitted regime ID (A6); Hierarchical Latent Variable Model overlaps with VAE/normalizing flows (A3); PEARL/RL² compete with Decision Transformer (A2).

| ID | Name | Verdict | Role | TF | Integration sketch |
|---|---|---|---|---|---|
| feudal-rl | Feudal Reinforcement Learning | RESEARCH | regime | MTF | Manager-worker maps to MTF (30m manager, 1m worker); spike: does goal-vector geometry recover VPIN/regime states |
| hi-map | HI-MAP | REJECT | n/a | n/a | No expert-trader corpus to imitate |
| h-dqn | Hierarchical DQN | RESEARCH | exit-policy | 1m, 5m | Meta picks subgoal {target/stop offset}, controller manages tick-by-tick; Q-learning over (pnl, vol-state, time-in-trade) |
| multi-level-policy-learning | Multi-Level Policy Learning | REJECT | n/a | MTF | Strictly weaker than 2-level h-DQN under sample-efficiency constraint |
| option-critic | Option-Critic Architecture | RESEARCH | exit-policy | 1m, 5m | End-to-end option discovery; spike with Harb termination regularizer to prevent option collapse |
| composable-skill-transfer | Composable Skill Transfer | REJECT | n/a | n/a | Premise (existing skill library) doesn't hold |
| hierarchical-latent-variable-model | Hierarchical Latent Variable Model | RESEARCH | regime | MTF, daily | Hierarchical VAE on (window, action, P&L) tuples; cross-bucket overlap with A3 generative |
| skill-chaining | Skill Chaining | REJECT | n/a | n/a | Backward chaining presumes structural reachability that doesn't exist on price paths |
| successor-features | Successor Features for Transfer | RESEARCH | ensemble | MTF | Decouples dynamics from reward; objective-multiplexer for Sharpe/DD/PF heads |
| l2l-gradient-descent | Learning to Learn with Gradient Descent | REJECT | n/a | n/a | Adam dominates learned optimizers on small-batch finance |
| meta-policy-gradient | Meta Policy Gradient | REJECT | n/a | n/a | 2nd-order gradients on noisy 1m P&L = catastrophic variance |
| maml | Model-Agnostic Meta-Learning (MAML) | RESEARCH | regime | MTF, daily | Init-point that fine-tunes in <50 trades to new regime; FOMAML to dodge 2nd-order pain |
| pearl | PEARL | RESEARCH | regime | MTF | Probabilistic task embedding from context window — Bayesian regime tracking; off-policy efficiency is killer feature |
| rl2 | RL² (Reinforcement Learning Squared) | RESEARCH | regime | MTF | RNN hidden state as fast-adaptation memory; check if it reinvents VPIN poorly |
| reptile | Reptile Meta-RL | SUPPORTING | pretrain | MTF, daily | Cheap MAML alternative; warm-start init for walk-forward folds |
| task-aware-meta-rl | Task-Aware Meta-RL | SUPPORTING | regime | MTF | Explicit regime-ID conditioning; provides architecture for A6's HMM regime tags |
| hypernetworks-rl | HyperNetworks for RL | RESEARCH | ensemble | MTF | Hypernet generates head weights from regime z; alternative to MoE |
| meta-controller-subgoal-discovery | Meta-Controller with Subgoal Discovery | RESEARCH | feature-extraction | MTF | Auto-discover S/R levels via state-space graph Laplacian; cross-bucket with primitives_discovery |
| modular-meta-rl | Modular Meta-RL Agent | REJECT | n/a | n/a | MoE in A3 dominates discrete module routing |
| multitask-rl-shared-latent | Multitask RL with Shared Latent | SUPPORTING | pretrain | MTF | Cross-instrument transfer (MNQ + EURUSD + ES + NQ); useful for Tyler's existing dual-instrument setup |
| actor-critic | Actor-Critic | BASELINE | benchmark | n/a | Foundational; PPO/SAC dominate |
| a2c | Advantage Actor-Critic (A2C) | BASELINE | benchmark | n/a | PPO is strict superset |
| a3c | Asynchronous Advantage Actor-Critic | BASELINE | benchmark | n/a | Stale-gradient instability; superseded by PPO+vectorized envs |
| q-prop | Q-Prop | REJECT | n/a | n/a | SAC dominates with simpler architecture |
| sac | Soft Actor-Critic (SAC) | RESEARCH | execution | 1m | Continuous-action position sizing; off-policy replay; spike vs Kelly-fraction sizing |
| ddpg | Deep Deterministic Policy Gradient | BASELINE | benchmark | n/a | TD3 strict improvement |
| naf | Normalized Advantage Function | REJECT | n/a | n/a | Quadratic-Q assumption wrong for slippage-sensitive sizing |
| td3 | Twin Delayed DDPG (TD3) | SUPPORTING | execution | 1m | Deterministic alternative to SAC when entropy bonus hurts in trends |
| noisy-dqn | Noisy DQN | REJECT | n/a | n/a | Exploration improvements moot when training is offline |
| rainbow-dqn | Rainbow DQN | RESEARCH | exit-policy | 1m, 5m | C51 distributional Q natively models reward distributions = Sharpe optimization; discrete exit/management actions |
| cem | Cross-Entropy Method (CEM) | SUPPORTING | exit-policy | 1m, 5m, 15m | Gradient-free optimization of cost-adj Sharpe directly; ~128-param exit-policy network; lowest engineering risk RL |
| ppo | Proximal Policy Optimization (PPO) | SUPPORTING | execution | 1m, 5m | Mandatory baseline — every fancier RL must beat PPO; stable-baselines3 to minimize implementation risk |
| reinforce | REINFORCE | BASELINE | benchmark | n/a | Pure MC variance destroys signal on noisy intraday rewards |
| trpo | Trust Region Policy Optimization | BASELINE | benchmark | n/a | PPO replaced TRPO with negligible quality loss |
| vpg | Vanilla Policy Gradient | BASELINE | benchmark | n/a | High variance, no trust region |
| dqn | Deep Q-Network (DQN) | BASELINE | benchmark | n/a | Q-overestimation; superseded by Rainbow |
| double-dqn | Double DQN | BASELINE | benchmark | n/a | Subset of Rainbow |
| dueling-dqn | Dueling DQN | BASELINE | benchmark | n/a | Subset of Rainbow |
| q-learning | Q-Learning | BASELINE | benchmark | n/a | Tabular; useful only for tiny discretized state |
| sarsa | SARSA | BASELINE | benchmark | n/a | On-policy variant; never used in production |

---

## <a name="a2"></a>A2 — Model-Based RL (20 specs)

**Bucket synthesis.** Top picks: PETS (CORE), MPC (CORE), Latent Planning Transformers / Decision Transformer (CORE). The fat-tail killer eliminates roughly half this bucket — every spec built on a diagonal-Gaussian latent (RSSM, Dreamer's stochastic head, Variational World Model, Neural ODE) cannot represent the conditional return distribution Tyler trades. MNQ 1m kurtosis ~102 is two orders beyond what reparameterized Gaussian latent absorbs without KL term shutting down the surprise channel. Imagined trajectories will be too smooth, in-imagination policy under-prices tail risk, live execution blows up on first FOMC.

| ID | Name | Verdict | Role | TF | Integration sketch |
|---|---|---|---|---|---|
| adaptive-local-models-alm | Adaptive Local Models (ALM) | RESEARCH | regime | 5m, 15m, 30m | Locally-weighted regression per regime bucket (VPIN+TOD); sanity baseline for regime-conditional XGBoost |
| dreamer-v1-v3 | Dreamer (V1-V3) | RESEARCH | exit-policy | 5m–MTF | Offline Dreamer-V3 on QuestDB replay; symlog reward = log(1+cost-adj-return); shape with VPIN/jump penalties |
| hybrid-mfree-mbased | Hybrid Model-Free & Model-Based Agent | SUPPORTING | exit-policy | 5m, 15m, 30m | MBPO short-rollout buffer augmentation; rollout length ≤ 2 bars to limit jump-process drift |
| i2a | Imagination-Augmented Agents (I2A) | SUPPORTING | feature-extraction | 5m, 15m, MTF | LSTM aggregator learns to DOWN-WEIGHT bad imagined rollouts — defense against world-model jump failures |
| world-models-ha-schmidhuber | World Models (Ha & Schmidhuber) | RESEARCH | pretrain | 1m–MTF | MDN-RNN mixture density head IS the right primitive for fat-tailed next-bar; spike with 5-15 components |
| deepmdp | DeepMDP | SUPPORTING | regime | 5m, 15m, 30m | Bisimulation-style 32-d latent z_t as regime feature; useful as encoder, dangerous as planning substrate |
| rssm | Latent Dynamics Model (RSSM) | SUPPORTING | regime | 5m–MTF | Replace diagonal-Gaussian stochastic head with Student-t before serious use; deterministic h_t as regime context |
| state-space-abstraction | State-Space Abstraction Model | REJECT | n/a | n/a | Continuous-state bisimulation intractable; subsumed by DeepMDP |
| temporal-predictive-coding | Temporal Predictive Coding Agent | SUPPORTING | pretrain | 1m–MTF | CPC-style self-supervised pretrain; drop-in for two-stream Transformer encoder |
| variational-world-model | Variational World Model | SUPPORTING | regime | 5m, 15m, 30m | Scenario generator for backtest stress tests, NOT in-loop policy training; needs flow-based latent prior |
| latent-imagination-policy | Latent Imagination Policy Network | RESEARCH | exit-policy | 15m, 30m | Backprop-through-imagination for exit; horizon ≤ 8 bars; gradient clipping at world-model output essential |
| dyna-q | Dyna-Q | BASELINE | benchmark | 5m, 15m, 30m | 1990-style RL baseline; numerical floor for deep methods |
| mpc | Model Predictive Control (MPC) | CORE | execution | 1m, 5m | Receding-horizon planning over CEM in latent space; advisory signal first, then live executor |
| muzero | MuZero | RESEARCH | exit-policy | 5m, 15m, 30m | Reward-predictive latent (no obs reconstruction) sidesteps fat-tail problem; MuZero-Unplugged offline variant |
| planet | PlaNet (Planning Network) | SUPPORTING | exit-policy | 5m, 15m, 30m | RSSM + CEM; subsumed by MPC entry; canonical reference architecture |
| simple | SimPLe (Simulated Policy Learning) | REJECT | n/a | n/a | Pixel-coherence backbone meaningless on OHLCV; substrate is wrong |
| pets | Probabilistic Ensembles + Trajectory Sampling (PETS) | CORE | execution | 1m–30m | Epistemic disagreement IS the regime-break detector; aleatoric variance feeds cost-aware sizer; replace per-member Gaussian with Student-t |
| action-conditioned-dynamics-transformer | Action-Conditioned Dynamics Transformer | SUPPORTING | pretrain | 5m–MTF | Extend existing two-stream Transformer with action token; serves as dynamics backbone for MPC/PETS |
| latent-planning-transformers | Latent Planning with Transformers (Decision Transformer) | CORE | exit-policy | 5m–MTF | Return-conditioned sequence modeling sidesteps fat-tail world-model failure entirely; cleanest model-based-flavored path |
| neural-ode-dynamics | Neural ODE-based Dynamics Learner | REJECT | n/a | n/a | Continuous-flow assumption explicitly excludes jump processes; Lévy-jump generalization is a different model |

---

## <a name="a3"></a>A3 — NN Architectures + Generative (50 specs)

**Bucket synthesis.** Top picks: MoE (CORE — regime), Self-Attention/Transformer (CORE — validates current), ViT patch embedding (SUPPORTING — PatchTST in disguise), Normalizing Flow (SUPPORTING — anomaly), MADE/MAE (SUPPORTING — pretrain), Conditional GAN + WGAN-GP (SUPPORTING — only adversarial synth path with plausible win), Diffusion/Score-Based (RESEARCH — distributional vol forecasting). Vision-pure architectures REJECT unless mechanism transfers (self-attention → time-series transformer YES; ViT patches → patch-based bar embedding YES; image segmentation U-Net NO).

| ID | Name | Verdict | Role | TF | Integration sketch |
|---|---|---|---|---|---|
| adversarial-autoencoder | Adversarial Autoencoder (AAE) | RESEARCH | anomaly | 1m, 5m, 15m | GAN-regularized latent for non-Gaussian regime priors; only after VAE exhausted |
| biggan | BigGAN | REJECT | n/a | n/a | Vision-only ImageNet synthesis; no transfer |
| cgan | Conditional GAN (cGAN) | SUPPORTING | label-gen | 1m–30m | Per-regime synth augmentation conditioned on (VPIN, TOD, vol regime); KS-test gated |
| cyclegan | CycleGAN | REJECT | n/a | n/a | Unpaired image translation; cycle-consistency unjustified for vol regimes |
| gan | Generative Adversarial Network (GAN) | BASELINE | label-gen | 1m–30m | Reference floor; subsumed by WGAN-GP and cGAN |
| stylegan | StyleGAN | REJECT | n/a | n/a | Vision-only; AdaIN style mixing has no causal-time analog |
| wgan | Wasserstein GAN (WGAN-GP) | SUPPORTING | label-gen | 1m–30m | Stable adversarial backbone for synth pipeline; pair with cGAN conditioning |
| pixelrnn-pixelcnn | Autoregressive Model (PixelRNN, PixelCNN) | REJECT | n/a | n/a | Pixel ordering meaningless for OHLCV; concept covered by causal Transformer |
| gpt-transformer-generator | Transformer-Based Generator (GPT) | RESEARCH | pretrain | MTF | "TimeGPT"-style backbone; needs quantile-bucketed token vocab |
| diffusion-model | Diffusion Model (DDPM) | RESEARCH | volatility | 5m, 15m, 30m | Distributional return forecasting; needs DDIM/distillation for live latency |
| perceptual-loss-generator | Perceptual Loss Generator | REJECT | n/a | n/a | VGG perceptual loss is image-specific |
| score-based-model | Score-Based Generative Model | RESEARCH | volatility | 5m, 15m, 30m | Equivalent to DDPM under VP-SDE; treat as same research line |
| unet-generator-diffusion | U-Net Generator (in diffusion) | SUPPORTING | feature-extraction | 1m–30m | 1D U-Net backbone for diffusion vol-forecast head; not standalone |
| ebm | Energy-Based Model | RESEARCH | anomaly | 1m–30m | Unnormalised density E(x) for outlier scoring; JEM variant doubles as classifier+density |
| bayesian-generator | Bayesian Generator | REJECT | n/a | n/a | Re-skin of VAE/Bayesian-NN; no distinct mechanism |
| dbm-generator | Deep Boltzmann Machine Generator | REJECT | n/a | n/a | Gibbs sampling too slow; dominated by EBMs and diffusion |
| made | Masked Autoencoder for Distribution Learning (MADE) | SUPPORTING | pretrain | 1m–MTF | Self-supervised masked-bar reconstruction; cheaper than GPT decoder pretraining |
| neural-ode-generator | Neural ODE Generator | RESEARCH | volatility | 5m–daily | Continuous-time latent for irregular bars (dollar/volume bars); FFJORD-style |
| normalizing-flow | Normalizing Flow | SUPPORTING | anomaly | 1m–30m | Exact log-likelihood per window via single forward pass; circuit-breaker signal |
| vae-generative-model | Variational Autoencoder (VAE — Generative entry) | SUPPORTING | feature-extraction | 1m–30m | Beta-VAE on MNQ windows; latent mean as feature, KL-weighted recon error as anomaly |
| self-attention | Self-Attention Mechanism | CORE | feature-extraction | 1m–MTF | IS the existing transformer body; validates architectural direction |
| slot-attention | Slot Attention Network | RESEARCH | regime | 5m, 15m, 30m | K=4 latent regime slots; cluster slot embeddings → MoE gating input |
| transformer-encoder-decoder | Transformer (Encoder-Decoder) | CORE | direction | 1m–MTF | Validates current transformer_range; encoder-only stays for direction/range, decoder for multi-step seq2seq |
| vit | Vision Transformer (ViT) | SUPPORTING | feature-extraction | 1m–30m | Patch embedding mechanism transfers — IS PatchTST in disguise; refactor Linear bar embedding into patch-embedding stem |
| cnn | Convolutional Neural Network (CNN) | SUPPORTING | feature-extraction | 1m–30m | 1D causal CNN as cheap front-end stem before attention |
| densenet | DenseNet | BASELINE | benchmark | 1m–30m | Marginal over plain CNN; memory blowup on long sequences |
| resnet | Residual Neural Network (ResNet) | SUPPORTING | feature-extraction | 1m–30m | Standard residual connections — already inside every CORE backbone |
| unet-architecture | U-Net (segmentation) | REJECT | n/a | n/a | Image segmentation paradigm; diffusion-U-Net is its only valid form |
| fnn | Feedforward Neural Network (FNN) | BASELINE | benchmark | 1m–daily | Required baseline — if Transformer doesn't beat tuned MLP-on-flattened-window, kill it |
| mlp | Multilayer Perceptron (MLP — Feedforward) | BASELINE | benchmark | 1m–daily | Duplicate of FNN; consolidate |
| autoencoder-generative | Autoencoder (AE — Generative entry) | SUPPORTING | feature-extraction | 1m–30m | Latent + reconstruction-error as XGBoost features; ship VAE instead unless speed-bound |
| neural-ode | Neural Ordinary Differential Equation | RESEARCH | volatility | 5m–daily | Continuous-time hidden state for irregular-bar regimes (volume/dollar bars) |
| vae-architecture | Variational Autoencoder (VAE — Architectures entry) | SUPPORTING | feature-extraction | 1m–30m | Duplicate of VAE-Generative; consolidate |
| gat | Graph Attention Network (GAT) | RESEARCH | regime | 15m–daily | Cross-asset correlation graph w/ attention-weighted message passing; needs 2+ instruments |
| gcn | Graph Convolutional Network (GCN) | BASELINE | regime | 15m–daily | Uniform-weight aggregation baseline against GAT |
| gnn | Graph Neural Network (GNN) | REJECT | n/a | n/a | Generic umbrella; covered by GAT + GCN |
| hypernetwork | Hypernetwork | RESEARCH | regime | 1m–30m | Generates direction-head weights from regime context; MoE generally stronger primitive |
| moe | Mixture of Experts (MoE) | CORE | regime | 1m–MTF | Sparse top-k expert routing per regime (high-vol/low-vol × open/midday/close × news) — directly maps to regime-dependent stationarity |
| ntm | Neural Turing Machine | REJECT | n/a | n/a | External memory overkill; transformer attention already provides differentiable memory |
| attention-rnn | Attention-Based RNN | BASELINE | benchmark | 5m–daily | Bridge architecture between LSTM and Transformer |
| gru | Gated Recurrent Unit (GRU) | BASELINE | benchmark | 5m–daily | Same vanishing-gradient issues as LSTM at long horizons |
| lstm | Long Short-Term Memory (LSTM) | BASELINE | benchmark | 5m–daily | Canonical sequence baseline — must be beaten by Transformer |
| rnn | Recurrent Neural Network (RNN) | REJECT | n/a | n/a | Vanilla RNN dominated by LSTM/GRU |
| capsule-network | Capsule Network | REJECT | n/a | n/a | Dynamic routing slow, not GPU-friendly, irrelevant to time-series |
| dual-pathway-network | Dual-Pathway Network | SUPPORTING | feature-extraction | 1m–30m | IS the existing two-stream Transformer (price + volume); validates choice |
| siamese-network | Siamese Network | RESEARCH | regime | 5m–daily | Triplet contrastive on (anchor, same-regime, diff-regime); regime-discriminative embedding |
| snn | Spiking Neural Network (SNN) | REJECT | n/a | n/a | No GPU-native training, no advantage on financial bars |
| mlp-supervised | Multi-Layer Perceptron (MLP — Supervised) | BASELINE | benchmark | 1m–daily | Triplicate of FNN/MLP-Feedforward; consolidate |
| autoencoder-unsupervised | Autoencoder (Unsupervised) | SUPPORTING | feature-extraction | 1m–30m | Duplicate of AE-Generative; consolidate |
| deep-clustering-network | Deep Clustering Network (DCN) | RESEARCH | regime | 5m–daily | Joint AE + clustering producing explicit regime labels for MoE expert assignment |

---

## <a name="a4"></a>A4 — SSL + Semi-Sup + Hybrid (47 specs)

**Bucket synthesis.** Top 5–7 picks (deployment order): MAE block-masked pretrain (CORE — single highest-ROI), Stacked Ensemble (CORE — one-day implementation), Tree-Boosted Neural Embedding (CORE — textbook XGBoost+Transformer fusion), Bayesian-Neural Hybrid via MC Dropout (CORE — 10 lines for uncertainty), Differentiable Logic Layer / Residual Learning over Rules (CORE — encode "ATR break + VPIN > 0.7" as differentiable t-norm), CPC (CORE — predicts FUTURE, only SSL aligned with trading), SwAV (SUPPORTING — unsupervised regime discovery via Sinkhorn). Critical guidance: **time-series positives** are temporal proximity `(window_t, window_{t+ε})` or disjoint subsequences, NOT image-style augmentations.

| ID | Name | Verdict | Role | TF | Integration sketch |
|---|---|---|---|---|---|
| masked-autoencoder-mae | Masked Autoencoder (MAE) | CORE | pretrain | 1m–MTF | Block masking 16-bar chunks at 50% — highest-ROI change in bucket; pretrains existing two-stream Transformer encoder |
| masked-language-modeling-bert | Masked Language Modeling (BERT-style) | CORE | pretrain | 1m–30m | Discrete-token MLM with quantized OHLCV tokens (1024 buckets via VQ); use when categorical bottleneck is wanted |
| masked-graph-modeling | Masked Graph Modeling | RESEARCH | feature-extraction | MTF, daily | Cross-asset correlation graph; only valuable after MAE proven on single-asset |
| simclr-moco-contrastive | Contrastive Learning (SimCLR / MoCo) | CORE | pretrain | 1m–MTF | TS2Vec-style hierarchical positives — temporal-adjacent windows, NOT augmentations |
| byol | BYOL (Bootstrap Your Own Latent) | SUPPORTING | pretrain | 1m–30m | No-negatives variant; default contrastive choice when negative-pair definition is unreliable |
| barlow-twins | Barlow Twins | SUPPORTING | pretrain | 1m–30m | Cross-correlation loss decorrelates features; needs LARGE batch (2048+) — VRAM-bound on 5060 Ti |
| cross-view-prediction | Cross-View Prediction | SUPPORTING | pretrain | MTF | Predict 30m latent from 1m latent — direct MTF causality enforcement |
| moco-v3 | Momentum Contrast (MoCo v3) | SUPPORTING | pretrain | 1m–30m | VRAM-efficient contrastive (queue_size=8192 vs SimCLR's 4096 batch); chosen for hardware constraints |
| dino-patch-contrastive | Patch-level Contrastive Learning (DINO) | RESEARCH | pretrain | 1m–30m | Local-vs-global TIME crops (16-bar local + 128-bar global); attention-map interpretability is unique value |
| self-augmented-contrastive | Self-Augmented Contrastive Encoder | REJECT | n/a | n/a | Generic SimCLR variant with no time-series specifics |
| simsiam | SimSiam | SUPPORTING | pretrain | 1m–30m | Cheapest no-negatives method; choose when memory-bound, BYOL when slightly more capacity OK |
| swav | SwAV (Swapped Assignments) | SUPPORTING | regime | 5m–MTF | THE method for unsupervised regime discovery — Sinkhorn cluster assignments K=8-32 |
| self-supervised-gans | Self-Supervised GANs | REJECT | n/a | n/a | GANs don't work well on financial time-series — established consensus |
| denoising-autoencoder | Denoising Autoencoder | BASELINE | pretrain | 1m–30m | Mandatory baseline before claiming MAE wins (≥1.5% within2pt_acc lift required) |
| self-distillation-no-labels | Self-Distillation Without Labels | REJECT | n/a | n/a | Generic restatement of BYOL family; redundant |
| cpc-context-prediction | Contrastive Predictive Coding (CPC) | CORE | pretrain | 1m–MTF | InfoNCE on (context, future) — only SSL objective directly aligned with trading task; orthogonal to MAE |
| predictive-coding-models | Predictive Coding Models | SUPPORTING | pretrain | 1m–30m | CPC is the actionable instance; subsumed |
| rotnet-rotation-prediction | Rotation Prediction (RotNet) | REJECT | n/a | n/a | Rotations have NO meaning for OHLCV — vision-only pretext task |
| spr-self-predictive-representations | Self-Predictive Representations (SPR) | SUPPORTING | pretrain | 1m–30m | BYOL + CPC unified objective; predict future with stop-gradient |
| transformer-based-self-supervision | Transformer-based Self-Supervision | CORE | pretrain | 1m–MTF | Umbrella spec — actual implementations live in MAE/CPC/MoCo runners |
| consistency-regularization | Consistency Regularization (Mean Teacher) | SUPPORTING | label-gen | 1m–30m | For rare-event heads (jumps, regime breaks); EMA decay 0.999+ |
| fixmatch | FixMatch | SUPPORTING | label-gen | 1m–30m | Pseudo-label gating by confidence (τ=0.95); avoids autocorrelation-induced false positives |
| mixmatch | MixMatch | RESEARCH | label-gen | 1m–30m | MixUp on time-series produces non-causal Frankenstein windows; needs vol-aware mixing |
| virtual-adversarial-training-vat | Virtual Adversarial Training (VAT) | SUPPORTING | label-gen | 1m–30m | Augments without explicit policy; constrain perturbation to OHLC simplex |
| hybrid-generative-discriminative-ssl | Hybrid Generative-Discriminative SSL | RESEARCH | pretrain | 1m–30m | VAE encoder + classifier; niche use for synthetic jump-day generation |
| ladder-network | Ladder Network | REJECT | n/a | n/a | 2015-era denoising-AE + classifier; superseded by Mean Teacher / FixMatch |
| semi-supervised-gan-sgan | Semi-Supervised GAN (SGAN) | REJECT | n/a | n/a | GAN instability + class imbalance compounds; FixMatch beats SGAN |
| rnn-cnn-hybrid | RNN-CNN Hybrid | BASELINE | direction | 1m–30m | Pre-Transformer baseline; mandatory comparator for spec docs |
| stacked-ensemble-model | Stacked Ensemble Model | CORE | ensemble | 1m–MTF | Logistic meta-model on OOS predictions of XGBoost + Transformer + (CPC-pretrained) + regime-classifier; one-day implementation |
| hybrid-differentiable-planner | Hybrid Differentiable Planner | RESEARCH | exit-policy | 1m–30m | Generic placeholder spec; concept salvageable, implementation from scratch |
| tree-boosted-neural-embedding | Tree-Boosted Neural Embedding | CORE | direction | 1m–MTF | Transformer.encode() → standardize → concat with engineered features → XGBoost — second-highest-ROI hybrid |
| autoencoder-gan-fusion | Autoencoder-GAN Fusion | REJECT | n/a | n/a | Same GAN-on-OHLCV failure modes as SS-GAN |
| bayesian-neural-hybrid | Bayesian-Neural Hybrid Model | CORE | direction | 1m–daily | MC Dropout on existing CnnTransformerModel — 10 lines for predictive uncertainty; gate trades on conviction × (1 - normalized_entropy) |
| gnn-reinforcement-learner | GNN + Reinforcement Learner | RESEARCH | execution | 1m, 5m | Cross-asset hedging agent; requires multi-instrument infrastructure |
| graph-augmented-lstm | Graph-Augmented LSTM | REJECT | n/a | n/a | Template-tier spec, no actionable mechanism |
| latent-attention-decision-graph | Latent Attention Decision Graph | REJECT | n/a | n/a | Template-tier placeholder; no concrete architecture |
| transformer-gnn-hybrid | Transformer-GNN Hybrid | RESEARCH | feature-extraction | MTF | Per-asset Transformer + cross-asset GNN aggregation; needs cross-asset pipeline |
| attention-weighted-forecast-stack | Attention-Weighted Forecast Stack (TFT) | CORE | ensemble | 1m–MTF | Learned per-input attention weights over base models; upgrade from static stacked ensemble |
| hierarchical-task-oriented-agent | Hierarchical Task-Oriented Agent | RESEARCH | exit-policy | MTF | Decomposes "trade MNQ" into high-level regime selection + low-level execution; months of work |
| multi-modal-reasoning-agent | Multi-Modal Reasoning Agent | RESEARCH | direction | MTF | Native fusion of price + orderflow + news; requires DOM ingestion + news pipeline first |
| spatiotemporal-fusion-network | Spatiotemporal Fusion Network | SUPPORTING | feature-extraction | MTF | ST-GCN / DCRNN architecture; coordinates with cross-asset infrastructure |
| differentiable-logic-layer | Differentiable Logic Layer | CORE | direction | 1m–30m | t-norm soft-AND of (ATR-break, VPIN > 0.7, RSI-divergence) as differentiable bias added to neural logit |
| meta-learned-symbolic-router | Meta-Learned Symbolic Router | RESEARCH | regime | MTF | Meta-learned routing to regime-specific rule experts; spike after Differentiable Logic Layer proven |
| neuro-symbolic-model | Neuro-Symbolic Model | SUPPORTING | direction | 1m–30m | Umbrella for the family; concrete implementations in Differentiable Logic Layer |
| probabilistic-program-deepnet | Probabilistic Program + DeepNet | RESEARCH | direction | 1m–daily | Pyro + PyTorch hybrid; MC Dropout BNN gives 80% of value at 10% of effort |
| residual-learning-over-rules | Residual Learning over Rules | CORE | direction | 1m–30m | logit = rule_predictor(features) + neural_residual(x) initialized to zero; guarantees ≥ rule baseline |
| rule-augmented-neural-net | Rule-Augmented Neural Net | SUPPORTING | direction | 1m–30m | Most flexible of three rule-based hybrids; subsumed by Differentiable Logic Layer + Residual Learning |

---

## <a name="a5"></a>A5 — ML Supervised + Statistical (49 specs)

**Bucket synthesis.** Top picks: GJR-GARCH with Student-t innovations (CORE — fills project's largest gap), boosting trifecta XGBoost/LightGBM/CatBoost head-to-head (LightGBM wins on speed + leaf-wise + GOSS for fat-tailed; CatBoost wins where true categorical orderflow features exist via ordered boosting; XGBoost is conservative incumbent — stack the three with logistic meta-learner for uncorrelated error structures), Calibrated Classifier (CORE — Isotonic for trees + temperature scaling for Transformer fills documented gap), Quantile Regression (CORE — pinball loss → adaptive stop/target), AFT (CORE — uses existing triple-barrier event_time pairs), Bayesian Linear Regression (SUPPORTING — predictive variance for uncertainty gating), k-NN with FAISS (SUPPORTING — non-parametric regime retrieval). Notable rejections: Prophet, kernel SVM, Naive Bayes.

| ID | Name | Verdict | Role | TF | Integration sketch |
|---|---|---|---|---|---|
| bayesian-hierarchical-model | Bayesian Hierarchical Model | RESEARCH | regime | MTF | Most useful for cross-asset MNQ+EURUSD pooling, not single-symbol intraday |
| bayesian-linear-regression-stat | Bayesian Linear Regression (Statistical) | SUPPORTING | direction | 1m–MTF | Closed-form NIG posterior; emit pred_mean, pred_std, gate_pass per bar |
| prophet-forecasting | Prophet Forecasting Model | REJECT | n/a | n/a | Additive trend wrong tool for tick returns |
| gamma-regression | Gamma Regression | SUPPORTING | volatility | 5m, 15m, 30m | Realized vol GLM with log link; Inverse Gaussian or Gamma-GARCH better for vol-of-vol |
| glm | Generalized Linear Model (GLM) | BASELINE | benchmark | 1m–30m | Umbrella for the family; useful as unified wrapper |
| logistic-regression-stat | Logistic Regression (Statistical) | BASELINE | direction | 1m–daily | Mandatory floor — every direction model must beat L2-regularized logistic |
| multinomial-logistic-regression-stat | Multinomial Logistic Regression | BASELINE | direction | 1m–30m | Direct baseline for K=21-bucket range_class head |
| ordinal-regression-stat | Ordinal Regression (Statistical) | SUPPORTING | direction | 1m–30m | Better baseline than multinomial — exploits ordinal bucket structure |
| poisson-regression | Poisson Regression | SUPPORTING | feature-extraction | 1m, 5m | Trade-count + bid/ask aggressor counts via existing trades_at_{bid,ask}; emit lambda_bid, lambda_ask, aggressor_z |
| probit-regression-stat | Probit Regression | BASELINE | direction | 1m–30m | Numerically equivalent to logistic at this scale; skip in favor of logistic |
| tweedie-regression | Tweedie Regression | RESEARCH | direction | 1m, 5m | Point-mass-at-zero + continuous-tails of intraday signed PnL; needs power p cross-validation |
| zero-inflated-poisson | Zero-Inflated Poisson | RESEARCH | feature-extraction | 1m | Separates "no participation" from "low participation" regime; cheap kill-switch flag |
| mixture-of-exponentials | Mixture of Exponentials | RESEARCH | regime | 1m, 5m | 2-3 latent activity regimes from inter-trade durations; Hawkes-style approximation |
| linear-regression-stat | Linear Regression (Statistical) | BASELINE | benchmark | 1m–daily | OLS baseline every regression head must beat |
| multivariate-regression | Multivariate Regression | BASELINE | benchmark | MTF | Joint MTF prediction via SUR; comparator for dual-TF Transformer |
| plsr | Partial Least Squares Regression (PLSR) | SUPPORTING | feature-extraction | 1m–30m | Supervised dim-reduction over 510 primitives; component scores → XGBoost |
| quantile-regression-stat | Quantile Regression (Statistical) | CORE | volatility | 1m–30m | Distributional return forecast (q05/q25/q50/q75/q95) via pinball loss; adaptive stop = q05, target = q75 |
| robust-regression | Robust Regression | BASELINE | benchmark | 1m–30m | Huber/M-estimator; better baseline than vanilla OLS on intraday |
| aft | Accelerated Failure Time (AFT) | CORE | exit-policy | 1m, 5m | Triple-barrier (event_time, event_type) pairs as AFT inputs; log-logistic AFT robust to fat tails |
| cox-ph | Cox Proportional Hazards | SUPPORTING | exit-policy | 1m, 5m | Hazard-ratio interpretation (e.g., "vol-z=+2 doubles stop hazard"); per-bar hazard for trailing-stop |
| kaplan-meier | Kaplan-Meier Estimator | BASELINE | exit-policy | 1m, 5m | Non-parametric trade-duration baseline; informs time_stop_bars hyperparameter |
| arima | ARIMA | BASELINE | direction | daily | Mandatory daily-direction baseline; lag-1 ACF -0.097 daily is what ARIMA can grab |
| garch | GARCH | CORE | volatility | 5m–daily | GJR-GARCH(1,1,1) with Student-t innovations; fills project-wide vol-forecasting gap |
| sarima | SARIMA | SUPPORTING | feature-extraction | 5m, 15m, 30m | Intraday seasonality (e.g., 78-bar period for 30m × 6.5h equity day); volume-residual feature |
| seasonal-decomposition | Seasonal Decomposition (STL) | SUPPORTING | feature-extraction | 1m–30m | STL residuals as "abnormal volume/range" features — known alpha precursors |
| catboost | CatBoost | CORE | direction | 1m–daily | Native categorical features via ordered target stats; ordered boosting eliminates target-encoding leakage |
| gbm | Gradient Boosting Machine (vanilla) | BASELINE | benchmark | 1m–30m | sklearn GBM single-threaded, 50-100x slower than XGBoost; HistGradientBoosting as substitute |
| lightgbm | LightGBM | CORE | direction | 1m–daily | Leaf-wise growth + GOSS aligned with fat-tailed return distributions; ~10x faster than XGBoost |
| xgboost | XGBoost | CORE | direction | 1m–daily | Incumbent; level-wise growth conservative; add LightGBM and CatBoost runners with shared Optuna pruner |
| calibrated-classifier | Calibrated Classifier | CORE | ensemble | 1m–daily | Isotonic for tree models + temperature scaling for Transformer; fills documented project gap |
| random-forest | Random Forest | BASELINE | benchmark | 1m–daily | Decorrelated baseline via bagging; permutation importance more reliable than xgb gain |
| stacking | Stacked Generalization Model | SUPPORTING | ensemble | MTF | XGBoost + LightGBM + CatBoost + Transformer with logistic meta-learner; uncorrelated error structures |
| knn | K-Nearest Neighbors (k-NN) | SUPPORTING | regime | 1m–30m | FAISS-IVF for ms-lookups; "find 50 most similar bars" empirical conditional return distribution |
| bayesian-ridge | Bayesian Ridge Regression | SUPPORTING | direction | 1m–daily | Closed-form via sklearn.BayesianRidge; automatic shrinkage |
| elasticnet | ElasticNet Regression | SUPPORTING | feature-extraction | 1m–30m | L1+L2 mix for stable feature selection on 510 primitives under correlation |
| lars | LARS (Least Angle Regression) | BASELINE | feature-extraction | 1m–30m | Computes Lasso path in one pass; diagnostic only |
| lasso | Lasso Regression | SUPPORTING | feature-extraction | 1m–30m | Sparse selection; dominated by ElasticNet under multicollinearity |
| linear-regression-sup | Linear Regression (Supervised) | BASELINE | benchmark | 1m–daily | Same as Statistical entry; one shared OLS implementation |
| logistic-regression-sup | Logistic Regression (Supervised) | BASELINE | direction | 1m–daily | Duplicate of Statistical entry; combine into baselines/logreg.py |
| ordinal-regression-sup | Ordinal Regression (Supervised) | SUPPORTING | direction | 1m–30m | Same as Statistical entry — proportional-odds on K=21 buckets |
| probit-regression-sup | Probit Regression (Supervised) | BASELINE | direction | 1m–30m | Skip in favor of logistic |
| quantile-regression-sup | Quantile Regression (Supervised) | CORE | volatility | 1m–daily | Production: LightGBM objective="quantile"; baseline: linear QR; pair with conformal prediction |
| ridge | Ridge Regression | BASELINE | benchmark | 1m–daily | L2-regularized OLS baseline |
| sgd | Stochastic Gradient Descent (SGD) | SUPPORTING | direction | 1m, 5m, MTF | Online/streaming logistic via partial_fit on trailing buffer; concept-drift adaptation |
| svm | Support Vector Machine (SVM) | REJECT | n/a | n/a | Kernel SVM O(N²-N³) infeasible at 2.3M rows; LinearSVC dominated by SGDClassifier |
| naive-bayes | Naive Bayes | REJECT | n/a | n/a | Independence assumption violated by tautological OHLCV dependencies |
| cart | Classification And Regression Trees (CART) | BASELINE | benchmark | 1m–30m | Single decision tree as floor for ensembles |
| decision-tree-classifier | Decision Tree Classifier | BASELINE | benchmark | 1m–30m | Duplicate of CART; combine |
| extra-trees-regressor | Extra Trees Regressor | SUPPORTING | benchmark | 1m–30m | Fully random thresholds = extra decorrelation; lower bias on noisy features |

---

## <a name="a6"></a>A6 — Probabilistic + Simulation (40 specs)

**Bucket synthesis.** This bucket is the trading-system's nervous system, not its eyes. Top picks: HMM at 5m+ with t-distributed emissions (CORE — reinstate; 2026-04-03 removal was scale error not model error), Dirichlet Process / HDP-HMM (CORE — solves K problem), Gaussian Process (CORE — small-data killer for daily n=2069 with O(n³)), MCTS with Transformer prior (CORE — cost-aware planning), SDE family Heston+Bates (CORE — synthetic pretrain corpus), Fuzzy Logic (CORE — soft NN+indicator+regime ensemble), Bayesian Decision Networks (CORE — explainable policy layer). Mandatory operational layers: Monte Carlo block-bootstrap CIs, RDM, Scenario Analysis, DES, CSP/Rule-Based safety gate.

| ID | Name | Verdict | Role | TF | Integration sketch |
|---|---|---|---|---|---|
| dirichlet-process | Dirichlet Process | CORE | regime | 5m–MTF | Sticky-DP-HMM solves K problem; per-bar component posteriors → Transformer feature + ensemble gating |
| gmm-mixture-model | Mixture Model (GMM, DPM) | CORE | regime | 1m–MTF | Soft cluster posteriors over (return, |return|, range, volume_z); Hungarian alignment across folds |
| bayesian-network | Bayesian Network (BN) | SUPPORTING | regime | 5m–MTF | pgmpy-based P(direction \| regime, vol_bucket, tod) as calibration prior blended with Transformer |
| neuro-symbolic | Neuro-Symbolic Reasoning Model | RESEARCH | ensemble | MTF | Differentiable rule encoding (DeepProbLog/Scallop); enforce hard constraints inside loss |
| pgm | Probabilistic Graphical Model (PGM) | SUPPORTING | regime | MTF | Umbrella; subsumed by BN |
| bayesian-linear-regression | Bayesian Linear Regression | BASELINE | direction | 1m–daily | Calibrated uncertainty for sizing; Kelly fraction ∝ 1/σ² |
| gaussian-process | Gaussian Process (GP) | CORE | regime | 15m–daily | Daily n=2069 fits perfectly in O(n³); GPyTorch + spectral-mixture kernel; small-data fallback when WF folds shrink |
| hmm | Hidden Markov Model (HMM) | CORE | regime | 5m–MTF | Reinstate at 5m+ with t-distributed emissions; pipe smoothed γ_t as 3-5 channels into Transformer's volume stream |
| markov-chain | Markov Chain | SUPPORTING | exit-policy | 1m, 5m | Empirical transition matrix over discretized price-action states; microstructure baseline |
| mdp | Markov Decision Process (MDP) | CORE | exit-policy | 1m–15m | Replaces static triple-barrier with policy that learns when to bail early; Bellman target for Q-head |
| pln | Probabilistic Logic Network (PLN) | REJECT | n/a | n/a | OpenCog-grade infrastructure; subsumed by Bayesian Networks |
| probabilistic-programming | Probabilistic Programming (Stan, PyMC3) | CORE | regime | 15m–daily | Hierarchical Bayesian with NUTS sampler; ARM hierarchy for cross-instrument transfer |
| psl | Probabilistic Soft Logic (PSL) | REJECT | n/a | n/a | Designed for entity resolution / NLP; no clear bar-trading mapping |
| csp | Constraint Satisfaction Problem (CSP) | SUPPORTING | execution | n/a | Pre-trade gate: max position, daily loss, no-trade windows around news, margin/exposure |
| expert-system | Expert System | REJECT | n/a | n/a | Rules go stale immediately; covered by Rule-Based System |
| fol-inference | First-Order Logic (FOL) Inference | REJECT | n/a | n/a | No quantitative benefit on noisy continuous data |
| fuzzy-logic-model | Fuzzy Logic Model | CORE | ensemble | 1m–MTF | 10-30 IF-THEN rules over (vol-percentile, RSI, distance-to-VWAP, regime-posterior, NN-confidence) → trade-conviction score |
| logic-programming | Logic Programming (Prolog) | REJECT | n/a | n/a | Same issues as FOL/Expert System |
| rule-based-system | Rule-Based System | SUPPORTING | execution | 1m–MTF | Operational guardrails (no-trade windows, max-bars-held, daily-loss-limit, news-blackout); mandatory pre-deploy |
| symbolic-regression | Symbolic Regression | RESEARCH | feature-extraction | 15m–daily | PySR offline analysis; promote surviving expressions into primitives engine |
| agent-based-modeling | Agent-Based Modeling | CORE | pretrain | 1m, 5m | Heterogeneous-agent LOB simulator (informed/momentum/MM/noise); synthetic 1m bars respecting microstructure stylized facts |
| multi-agent-simulation | Multi-Agent Simulation | SUPPORTING | pretrain | 1m, 5m | Subsumed by ABM |
| evolutionary-decision-models | Evolutionary Decision Models | SUPPORTING | ensemble | MTF | Genetic Programming / NEAT for trade-policy programs; complements Optuna |
| fuzzy-decision-models | Fuzzy Decision Models | SUPPORTING | exit-policy | 1m–30m | Decision-flavored variant of Fuzzy Logic Model; folded |
| game-theory | Game Theoretic Models (Nash, Zero-Sum) | REJECT | n/a | n/a | Tyler is price-taker on MNQ — no strategic interaction warranting Nash framing |
| mcmc | Markov Chain Monte Carlo (MCMC) | SUPPORTING | regime | n/a | Inference engine for PyMC/Stan; subsumed |
| monte-carlo-simulation | Monte Carlo Simulation | CORE | benchmark | MTF | Block-bootstrap CIs on Sharpe-after-cost (mandatory per docs/research/eda_and_metrics.md) |
| mcda | Multi-Criteria Decision Analysis (MCDA) | SUPPORTING | ensemble | n/a | TOPSIS/AHP weighting of (Sharpe, max-DD, profit-factor, turnover-cost) for HPO winner selection |
| rdm | Robust Decision Making (RDM) | CORE | ensemble | MTF | Worst-case scenario tolerance — directly attacks regime non-stationarity; PBO killer |
| scenario-analysis | Scenario Analysis | SUPPORTING | benchmark | MTF | Fixed list of stress windows (Aug 2015 flash, Mar 2020 COVID, Jan 2018 vol-mageddon) |
| des | Discrete Event Simulation (DES) | SUPPORTING | execution | 1m, 5m | Realistic fill simulator with queue priority; replaces static $14 RT cost_model.json |
| event-driven-simulation | Event-Driven Simulation | SUPPORTING | execution | 1m, 5m | Same paradigm as DES; folded |
| sde | Stochastic Differential Equations (SDE) | CORE | pretrain | 1m–30m | Heston (vol clustering) + Bates jumps (kurtosis 102 tails); MLE on real returns; billions of synthetic OHLCV |
| system-dynamics-modeling | System Dynamics Modeling | REJECT | n/a | n/a | Designed for macro/policy, not minute-bar trading |
| bayesian-decision-networks | Bayesian Decision Networks | CORE | exit-policy | 1m–15m | Explainable trade policy via pgmpy InfluenceDiagram; EU-maximizing action atop NN |
| decision-trees | Decision Trees | BASELINE | direction | 1m–daily | Depth-3 sklearn tree as sanity baseline beneath xgb |
| dynamic-decision-networks | Dynamic Decision Networks | SUPPORTING | exit-policy | 1m–15m | Time-extended BDN; folded into BDN entry |
| influence-diagrams | Influence Diagrams | SUPPORTING | exit-policy | 1m–15m | Synonym for BDN; same artifact |
| mcts | Monte Carlo Tree Search (MCTS) | CORE | exit-policy | 1m–15m | UCB tree policy with Transformer rollout; reward = path-PnL minus $14/RT baked in; AlphaZero pattern |
| utility-theory | Utility Theory Models | SUPPORTING | exit-policy | n/a | CARA/CRRA position-sizing layer; CVaR-utility against fat tails |

---

## <a name="a7"></a>A7 — Optimization + Unsupervised + Semi-Supervised (54 specs)

**Bucket synthesis.** Top picks: QP (CORE — closes the open loop on sizing; Markowitz with Ledoit-Wolf shrunk Σ), CMA-ES (CORE — non-differentiable Sharpe-after-cost optimization, dominates GA/DE on non-separable surfaces), DE (CORE — cliff-y discrete-trade-rule surfaces), Isolation Forest (CORE — jump labels), GMM with Student-t (SUPPORTING — soft regime probabilities; primary regime tagger), PCA whitening + UMAP (CORE — Transformer training stability + dual-purpose viz/feature compression), Co-Training (CORE — Tyler's parquet has true dual views), Tri-Training (CORE — PAC-bounded majority vote). RL+MPC is a 3-6 month research project — defer until QP sizing + clustering regime tags + IsoForest jump labels are all in production.

| ID | Name | Verdict | Role | TF | Integration sketch |
|---|---|---|---|---|---|
| ilp | Integer Linear Programming (ILP) | SUPPORTING | execution | n/a | Combinatorial trade-batching; warm-start mandatory at MNQ tick speed |
| interior-point | Interior-Point Methods | REJECT | n/a | n/a | Solver internals inside scipy/cvxpy |
| lp | Linear Programming (LP) | REJECT | n/a | n/a | No risk term; trivially dominated by QP for finance |
| mip | Mixed-Integer Programming (MIP) | SUPPORTING | execution | n/a | Discrete contract sizing, regime-conditional position caps; warm-start + heuristic fallback |
| qp | Quadratic Programming (QP) | CORE | execution | MTF | Markowitz with Ledoit-Wolf shrunk Σ; closes loop from probability → contracts |
| convex-opt | Convex Optimization | SUPPORTING | n/a | n/a | Umbrella; use cvxpy as DSL when objective is provably convex |
| nonconvex-opt | Non-Convex Optimization | SUPPORTING | n/a | n/a | Umbrella covering GA/DE/CMA-ES/SA |
| aug-lagrangian | Augmented Lagrangian Method | REJECT | n/a | n/a | Solver internals |
| dual-decomposition | Dual Decomposition | REJECT | n/a | n/a | Distributed-solving design; not relevant at single-trader scale |
| lagrangian-relaxation | Lagrangian Relaxation | REJECT | n/a | n/a | Bound-tightening for hard MIPs; not needed |
| differential-evolution | Differential Evolution (DE) | CORE | execution | n/a | Cliff-y discrete-trade-rule optimization (top_pct, flat_threshold_pts, stop_distance, target_distance) |
| evolution-strategies | Evolution Strategies (CMA-ES) | CORE | execution | n/a | Adaptive search-distribution covariance; dominant on non-separable ridge-shaped Sharpe surfaces |
| ga | Genetic Algorithm (GA) | SUPPORTING | execution | n/a | Combinatorial feature-subset selection (binary chromosome over 510 primitives) |
| gradient-descent | Gradient Descent | SUPPORTING | n/a | n/a | Already in PyTorch stack |
| sgd-opt | Stochastic Gradient Descent (SGD — opt) | BASELINE | n/a | n/a | torch.optim.SGD; ablate vs AdamW for transformer |
| aco | Ant Colony Optimization (ACO) | REJECT | n/a | n/a | Designed for combinatorial path problems; wrong family for finance |
| bayes-opt | Bayesian Optimization | SUPPORTING | n/a | n/a | Already covered by Optuna TPE |
| branch-and-bound | Branch and Bound | SUPPORTING | execution | n/a | Engine inside MIP/ILP solvers |
| greedy | Greedy Algorithms | BASELINE | feature-extraction | MTF | Greedy forward feature selection; baseline for GA-based subset |
| pso | Particle Swarm Optimization (PSO) | REJECT | n/a | n/a | Empirically dominated by CMA-ES on every black-box benchmark since 2010 |
| simulated-annealing | Simulated Annealing | SUPPORTING | execution | n/a | Cheap warm-start refinement after CMA-ES finds basin |
| dp | Dynamic Programming (DP) | SUPPORTING | exit-policy | 1m, 5m | Optimal-stop solver via value-iteration on per-regime discretized MDP; lookup table at inference |
| rl-mpc | Reinforcement Learning with MPC | RESEARCH | exit-policy | 1m, 5m, MTF | 3-6 month project; extend dqn_trading repo; consume transformer prob as state |
| submodular-opt | Submodular Optimization | SUPPORTING | feature-extraction | MTF | (1-1/e)-approximation for diversifying feature/sensor selection |
| semi-clustering | Semi-Supervised Clustering | SUPPORTING | regime | 5m, 15m, 30m | Constrained K-Means / COP-K-Means with Tyler's hand-labeled regime exemplars |
| graph-ssl | Graph-Based Semi-Supervised Learning | RESEARCH | regime | MTF | Bars as graph nodes with kNN edges; label propagation along edges |
| label-propagation | Label Propagation | SUPPORTING | label-gen | MTF | Propagate "jump" / "regime-break" labels through graph neighbors |
| label-spreading | Label Spreading | SUPPORTING | label-gen | MTF | Normalized-Laplacian variant of LP; more robust to noise |
| manifold-reg | Manifold Regularization | RESEARCH | pretrain | MTF | Graph-Laplacian penalty on supervised loss; encourages similar predictions for graph-neighbors |
| co-training | Co-Training (Dual View) | CORE | label-gen | MTF | Tyler's parquet has true dual views (vol_at_{bid,ask}, trades_at_{bid,ask}) — most natural semi-sup integration |
| multi-view | Multi-View Learning | SUPPORTING | feature-extraction | MTF | CCA / multi-view AE; shared latent across OHLCV ↔ orderflow ↔ multi-TF |
| entropy-min | Entropy Minimization | SUPPORTING | pretrain | 1m–30m | H(p_unlabeled) penalty pushes Transformer toward confident predictions |
| s3vm | Semi-Supervised SVM (S3VM) | REJECT | n/a | n/a | Wrong era for Tyler's data scale (2.3M rows) |
| pseudo-labeling | Pseudo-Labeling | CORE | label-gen | MTF | IsoForest top-1% seed → xgb predict on unlabeled → keep p>0.95 → retrain |
| self-training | Self-Training Classifier | SUPPORTING | label-gen | MTF | scikit-learn SelfTrainingClassifier wrapper around xgb |
| tri-training | Tri-Training | CORE | label-gen | MTF | Three xgb on different feature views (price-only / volume-only / orderflow-only); PAC-bounded majority vote |
| isolation-forest | Isolation Forest | CORE | anomaly | 1m–30m | Per-bar anomaly score + binary is_jump flag; consumed by Transformer + seeds Tri-Training |
| lof | Local Outlier Factor (LOF) | SUPPORTING | anomaly | 1m, 5m | Density-based local-regime anomaly; rolling-window on last 30 days |
| one-class-svm | One-Class SVM | BASELINE | anomaly | n/a | Dominated by IsoForest in nearly every empirical comparison |
| robust-cov | Robust Covariance Estimation | SUPPORTING | anomaly | MTF | MCD via sklearn.covariance.MinCovDet; dual-purpose anomaly + Σ for QP sizer |
| affinity-propagation | Affinity Propagation | REJECT | regime | n/a | O(N²) memory and time; caps at ~10k bars |
| dbscan | DBSCAN | SUPPORTING | regime | 5m, 15m, 30m | HDBSCAN variant for robustness to eps choice; identifies noise bars as anomalies |
| gmm | Gaussian Mixture Model (GMM) | SUPPORTING | regime | 5m, 15m, 30m | Soft regime probabilities; BIC selects K∈[2,8]; Student-t mixture for fat tails |
| hierarchical-clustering | Hierarchical Clustering | SUPPORTING | feature-extraction | MTF | Cluster FEATURES not bars (de Prado's HRP); dedupe primitives |
| kmeans | K-Means Clustering | BASELINE | regime | 5m, 15m, 30m | Spherical assumption violated by fat tails; baseline that GMM/HDBSCAN must beat |
| meanshift | Mean Shift Clustering | REJECT | regime | n/a | O(N²) per iteration; strictly worse than HDBSCAN |
| spectral-clustering | Spectral Clustering | RESEARCH | regime | 5m, 15m, 30m | Captures non-convex regime manifolds; needs Nyström approximation |
| ica | Independent Component Analysis (ICA) | RESEARCH | feature-extraction | MTF | Decompose into INDEPENDENT components; non-Gaussian sources fits intraday |
| nmf | Non-Negative Matrix Factorization (NMF) | SUPPORTING | feature-extraction | MTF | Volume profile decomposition into trader-cohort components |
| pca | Principal Component Analysis (PCA) | CORE | feature-extraction | MTF | Whitening for Transformer training stability; gradient noise scale drops materially |
| manifold-isomap-lle | Manifold Learning (Isomap, LLE) | REJECT | feature-extraction | n/a | Dominated by UMAP for both quality and scale |
| umap | UMAP | CORE | feature-extraction | MTF | Dual-purpose: 2D dashboard regime panel + 16-d non-linear feature compression |
| tsne | t-SNE | BASELINE | feature-extraction | n/a | One-off EDA snapshots only; cannot transform new points |
| som | Self-Organizing Maps (SOM) | RESEARCH | regime | MTF | Topological 2D map of bar-feature space; UMAP wins for viz |

---

## Verification

- 7 agents × full-spec reads = 300 specs covered (40 + 20 + 50 + 47 + 49 + 40 + 54)
- Every CORE/SUPPORTING entry traces to a specific spec ID and bucket
- Every entry has: id, name, verdict, role, timeframe-fit, integration sketch (one line)
- Cross-bucket flags raised explicitly: Task-Aware Meta-RL ↔ HMM (A1↔A6), Hierarchical Latent Variable Model ↔ VAE (A1↔A3), PEARL/RL² ↔ Decision Transformer (A1↔A2), Co-Training ↔ existing dual-view parquet (A7↔data layer)
- Catalog quality flagged: Optimization, Statistical, Probabilistic & Symbolic, several Hybrid specs are templated boilerplate; verdicts in those buckets are weighted by domain knowledge

The actionable synthesis with the 9-layer architecture, MTF protocol, T/R/D/V/R decomposition, models.json mapping, and integration roadmap lives in `intraday_model_arsenal.md`.
