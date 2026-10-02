/**
 * Architectures — the model families, and what each is actually good at.
 *
 * SRP: Data only. Merged by `../index.ts`.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  // ── Trees ──────────────────────────────────────────────────────────────
  {
    id: "decision-tree",
    term: "decision tree",
    domain: "ml-architectures",
    aliases: ["cart"],
    definition:
      "Recursive axis-aligned splits partitioning the feature space into boxes. **Interpretable and, alone, high variance.**",
    see: ["random-forest", "boosting", "inductive-bias"],
  },
  {
    id: "random-forest",
    term: "random forest",
    domain: "ml-architectures",
    definition:
      "Many trees on bootstrapped rows and random feature subsets, averaged. **Variance reduction through decorrelation.**",
    why: "Feature importance from a forest is biased toward high-cardinality features. Use permutation importance instead.",
    see: ["ensemble", "decision-tree", "feature-importance"],
  },
  {
    id: "boosting",
    term: "gradient boosting",
    aliases: ["xgboost", "lightgbm", "catboost", "gbm", "gbdt"],
    domain: "ml-architectures",
    definition:
      "Trees fitted in sequence, each on the previous ensemble's residuals. **The default winner on tabular data**, and that includes most financial features.",
    why: "Overconfident at the probability extremes — calibrate before using an output as a number rather than a rank.",
    see: ["ensemble", "decision-tree", "calibration"],
  },
  {
    id: "histogram-boosting",
    term: "histogram-based boosting",
    domain: "ml-architectures",
    definition:
      "Boosting that bins continuous features first, so split search is over a few hundred bins instead of every distinct value. **Orders of magnitude faster** at near-identical accuracy.",
    see: ["boosting"],
  },

  // ── Linear ─────────────────────────────────────────────────────────────
  {
    id: "linear-regression",
    term: "linear regression",
    aliases: ["ols", "least squares"],
    domain: "ml-architectures",
    definition:
      "Fit a straight line by minimising squared error. **The baseline every other model must beat**, and on low signal-to-noise data it frequently is not beaten.",
    see: ["ridge-lasso", "logistic-regression", "r-squared"],
  },
  {
    id: "ridge-lasso",
    term: "ridge / lasso / elastic net",
    domain: "ml-architectures",
    definition:
      "Linear regression with a penalty. **Ridge** (L2) shrinks correlated coefficients together; **lasso** (L1) drives some to exactly zero; **elastic net** does both.",
    see: ["regularization", "linear-regression", "multicollinearity"],
  },
  {
    id: "logistic-regression",
    term: "logistic regression",
    domain: "ml-architectures",
    definition:
      "Linear model for classification, squashed through a sigmoid into a probability. **Well-calibrated by construction**, which trees are not.",
    see: ["linear-regression", "calibration", "sigmoid"],
  },
  {
    id: "glm",
    term: "GLM",
    expansion: "Generalised Linear Model",
    domain: "ml-architectures",
    definition:
      "Linear model plus a link function and a non-Gaussian error distribution — Poisson for counts, logistic for binary, gamma for positive skewed.",
    see: ["logistic-regression", "linear-regression"],
  },
  {
    id: "svm",
    term: "SVM",
    expansion: "Support Vector Machine",
    domain: "ml-architectures",
    aliases: ["kernel trick", "svr"],
    definition:
      "Finds the widest separating margin, and via the **kernel trick** does so in a high-dimensional space without ever building it.",
    why: "Scales badly past tens of thousands of rows, which rules it out for most bar-level financial data.",
    see: ["kernel-method"],
  },
  {
    id: "kernel-method",
    term: "kernel method",
    aliases: ["gaussian process", "rbf", "kriging"],
    domain: "ml-architectures",
    definition:
      "Working with similarities between points rather than their coordinates. A **Gaussian process** does this and returns a calibrated uncertainty with every prediction.",
    see: ["svm", "uncertainty"],
  },

  // ── Neural ─────────────────────────────────────────────────────────────
  {
    id: "mlp",
    term: "MLP",
    expansion: "Multi-Layer Perceptron",
    aliases: ["feedforward", "dense network", "fully connected"],
    domain: "ml-architectures",
    definition:
      "Stacked linear layers with non-linearities between them. **Assumes nothing about structure**, which is exactly why it needs so much data.",
    see: ["activation-function", "inductive-bias", "universal-approximation"],
  },
  {
    id: "universal-approximation",
    term: "universal approximation",
    domain: "ml-architectures",
    definition:
      "A wide enough single hidden layer can approximate any continuous function. **A statement about existence, not about learnability** — it says nothing about whether training will find it.",
    see: ["mlp"],
  },
  {
    id: "activation-function",
    term: "activation function",
    aliases: ["relu", "gelu", "tanh", "sigmoid", "silu", "swish"],
    domain: "ml-architectures",
    definition:
      "The non-linearity between layers. Without one, any stack of linear layers collapses into a single linear layer. **ReLU** and **GELU** are the defaults.",
    see: ["mlp", "vanishing-gradient", "sigmoid"],
  },
  {
    id: "sigmoid",
    term: "sigmoid / softmax",
    domain: "ml-architectures",
    definition:
      "**Sigmoid** squashes one number into (0,1); **softmax** turns a vector into probabilities summing to 1.",
    why: "Both saturate: far from zero the gradient vanishes, which is why they are rare as hidden activations now.",
    see: ["activation-function", "logistic-regression", "temperature"],
  },
  {
    id: "temperature",
    term: "temperature",
    domain: "ml-architectures",
    definition:
      "A divisor on logits before a softmax. **Low sharpens toward the argmax, high flattens toward uniform.**",
    why: "Must be set from the data's own scale. A temperature that blurs each point across seven neighbours is not soft assignment in any useful sense.",
    see: ["sigmoid", "codebook"],
  },
  {
    id: "cnn",
    term: "CNN",
    expansion: "Convolutional Neural Network",
    domain: "ml-architectures",
    aliases: ["conv1d", "convolution", "tcn"],
    definition:
      "Shares a small filter across positions, so a pattern is detected wherever it occurs. **Assumes locality and translation invariance.**",
    why: "A 1-D CNN over a price series assumes a shape means the same thing at 09:00 and at 16:00 — often false, and testable.",
    see: ["inductive-bias", "dilated-convolution", "receptive-field"],
  },
  {
    id: "dilated-convolution",
    term: "dilated convolution",
    domain: "ml-architectures",
    definition:
      "Convolution with gaps between taps, so the receptive field grows exponentially with depth instead of linearly.",
    see: ["cnn", "receptive-field"],
  },
  {
    id: "receptive-field",
    term: "receptive field",
    domain: "ml-architectures",
    definition:
      "How far back in the input a given output position can see. **A hard ceiling on the context a convolutional model can use.**",
    see: ["cnn", "dilated-convolution", "attention"],
  },
  {
    id: "rnn",
    term: "RNN / LSTM / GRU",
    expansion: "Recurrent Neural Network",
    domain: "ml-architectures",
    definition:
      "Carries a hidden state along the sequence. **LSTM** and **GRU** add gates so gradients survive long spans.",
    why: "Sequential by construction, so it cannot be parallelised over time — the reason transformers displaced it.",
    see: ["vanishing-gradient", "transformer", "state-space-model"],
  },
  {
    id: "transformer",
    term: "transformer",
    domain: "ml-architectures",
    aliases: ["self-attention", "encoder decoder"],
    definition:
      "Every position attends to every other, so context is direct rather than carried. **Parallel over the sequence**, unlike a recurrence.",
    why: "Cost is quadratic in length, and it needs a positional encoding because attention alone is order-blind.",
    see: ["attention", "positional-encoding", "rnn"],
  },
  {
    id: "attention",
    term: "attention",
    symbol: "softmax(QKᵀ/√d)·V",
    domain: "ml-architectures",
    aliases: ["multi-head attention", "query key value"],
    definition:
      "A weighted average over positions, where the weights come from how well a **query** matches each **key**. **Multi-head** runs several in parallel.",
    see: ["transformer", "positional-encoding"],
  },
  {
    id: "positional-encoding",
    term: "positional encoding",
    aliases: ["rope", "rotary", "sinusoidal"],
    domain: "ml-architectures",
    definition:
      "Injecting order information, since attention is a set operation and would otherwise be blind to sequence.",
    see: ["transformer", "attention"],
  },
  {
    id: "state-space-model",
    term: "state space model",
    aliases: ["mamba", "s4", "ssm", "hyena"],
    definition:
      "A learned linear recurrence with a convolutional form, giving long context at linear rather than quadratic cost.",
    domain: "ml-architectures",
    why: "Solves the long-context problem. Worth using only when long context is actually the problem — measure the memory first.",
    see: ["transformer", "rnn", "long-memory"],
  },
  {
    id: "residual-connection",
    term: "residual connection",
    aliases: ["skip connection", "resnet"],
    domain: "ml-architectures",
    definition:
      "Adding a layer's input to its output, so gradients have a direct path and each block only has to learn a correction.",
    see: ["vanishing-gradient", "batch-norm"],
  },
  {
    id: "gnn",
    term: "GNN",
    expansion: "Graph Neural Network",
    domain: "ml-architectures",
    definition:
      "Passes messages along a graph's edges, so a node's representation absorbs its neighbourhood. **Assumes the graph is known and meaningful.**",
    see: ["inductive-bias", "attention"],
  },
  {
    id: "autoencoder",
    term: "autoencoder",
    aliases: ["ae", "denoising autoencoder"],
    domain: "ml-architectures",
    definition:
      "Compress to a bottleneck and reconstruct. **The bottleneck is the point** — it forces the model to keep only what matters.",
    see: ["vae", "latent-space", "representation-learning"],
  },
  {
    id: "vae",
    term: "VAE",
    expansion: "Variational Autoencoder",
    domain: "ml-architectures",
    definition:
      "An autoencoder whose latent is a distribution rather than a point, so the space is smooth and samplable.",
    why: "Reconstructions are blurry because it optimises an average — the well-known cost of the probabilistic framing.",
    see: ["autoencoder", "gan", "latent-space"],
  },
  {
    id: "gan",
    term: "GAN",
    expansion: "Generative Adversarial Network",
    domain: "ml-architectures",
    definition:
      "A generator and a discriminator trained against each other until the generator's output is indistinguishable from real data.",
    why: "Notoriously unstable, and prone to **mode collapse** — producing one convincing thing instead of the full variety.",
    see: ["vae", "diffusion-model", "synthetic-data"],
  },
  {
    id: "diffusion-model",
    term: "diffusion model",
    domain: "ml-architectures",
    definition:
      "Learn to reverse a gradual noising process, generating by denoising from pure noise. **More stable to train than a GAN**, and slower to sample.",
    see: ["gan", "vae"],
  },
  {
    id: "som",
    term: "SOM",
    expansion: "Self-Organising Map",
    domain: "ml-architectures",
    definition:
      "A clustering method whose codes sit on a grid, so **neighbouring codes mean neighbouring things** — topology-preserving where k-means is not.",
    see: ["clustering", "codebook", "dimensionality-reduction"],
  },
  {
    id: "mixture-of-experts",
    term: "mixture of experts",
    expansion: "MoE",
    domain: "ml-architectures",
    definition:
      "Several specialised sub-models plus a gate choosing which to use per input. **Capacity without proportional compute.**",
    see: ["ensemble", "regime-change"],
  },
  {
    id: "temporal-fusion-transformer",
    term: "Temporal Fusion Transformer",
    expansion: "TFT",
    domain: "ml-architectures",
    definition:
      "A forecasting architecture combining variable selection, a recurrent encoder and interpretable attention, with quantile outputs.",
    see: ["transformer", "quantile-loss", "attention"],
  },
  {
    id: "online-learning",
    term: "online learning",
    aliases: ["recursive least squares", "rls", "incremental"],
    domain: "ml-architectures",
    definition:
      "Updating on each new observation rather than retraining in batch. **RLS** does this exactly for a linear model.",
    why: "Naturally suited to non-stationarity, and it needs a forgetting factor or it eventually stops adapting.",
    see: ["drift-detection", "regime-change", "linear-regression"],
  },
];
