/**
 * Deep learning — the machinery underneath a neural network.
 *
 * SRP: Data only. Merged by `../index.ts`.
 *
 * Architectures live in `ml-architectures.ts` and the general training loop in
 * `ml-training.ts`. This file is the deep-learning-specific layer: tensors and
 * autograd, the things that go wrong at scale, the transformer internals, and
 * the vocabulary that arrived with large models.
 */

import type { Term } from "../types";

export const TERMS: Term[] = [
  // ── Tensors and autograd ───────────────────────────────────────────────
  {
    id: "tensor",
    term: "tensor",
    domain: "deep-learning",
    aliases: ["ndarray", "shape", "rank"],
    definition:
      "An n-dimensional array — the only data structure a network sees. **Its shape is the thing you spend most debugging time on**: `(batch, sequence, features)` is the usual layout for time series.",
    see: ["broadcasting", "batch-size", "einsum"],
  },
  {
    id: "broadcasting",
    term: "broadcasting",
    domain: "deep-learning",
    definition:
      "Automatically stretching a smaller tensor across a larger one so shapes line up without copying.",
    why: "Silently succeeds when you meant something else — a `(n,1)` against a `(1,n)` gives you an `(n,n)` matrix instead of an error. A classic source of a model that trains and means nothing.",
    see: ["tensor", "einsum"],
  },
  {
    id: "einsum",
    term: "einsum",
    symbol: "einsum('bij,bjk->bik', A, B)",
    domain: "deep-learning",
    definition:
      "Einstein summation — expressing a contraction by naming the axes. **Says what you meant**, where a chain of transposes and matmuls only says what happens.",
    see: ["tensor", "broadcasting"],
  },
  {
    id: "autograd",
    term: "autograd",
    aliases: ["automatic differentiation", "computational graph"],
    domain: "deep-learning",
    definition:
      "The framework recording every operation into a graph, then walking it backwards to produce gradients. **You write the forward pass; the backward pass is derived.**",
    see: ["backpropagation", "detach", "computational-graph"],
  },
  {
    id: "computational-graph",
    term: "computational graph",
    domain: "deep-learning",
    definition:
      "The DAG of operations connecting inputs to loss. **Dynamic** graphs are rebuilt each forward pass (PyTorch's default); **static** ones are compiled once and reused.",
    see: ["autograd", "torch-compile"],
  },
  {
    id: "detach",
    term: "detach / stop-gradient",
    domain: "deep-learning",
    definition:
      "Cutting a tensor out of the graph so no gradient flows back through it. **Essential for target networks and teacher models**, where the target must not be trained by its own loss.",
    see: ["autograd", "target-network", "distillation"],
  },
  {
    id: "parameter-vs-buffer",
    term: "parameter vs buffer",
    domain: "deep-learning",
    definition:
      "**Parameters** are learned and appear in the optimizer; **buffers** are state that moves with the model but is not trained — batch-norm running statistics, positional tables, masks.",
    why: "Both are saved in a checkpoint. Forgetting to register a buffer means it silently resets on load.",
    see: ["checkpoint", "batch-norm"],
  },
  {
    id: "initialization",
    term: "weight initialisation",
    aliases: ["xavier", "glorot", "he init", "kaiming"],
    domain: "deep-learning",
    definition:
      "The starting values of the weights, scaled so activations neither vanish nor explode through depth. **Xavier/Glorot** for symmetric activations, **He/Kaiming** for ReLU.",
    why: "For an embedding over something with known geometry, initialise from that geometry — do not make the model rediscover coordinates you could hand it.",
    see: ["vanishing-gradient", "embedding", "activation-function"],
  },
  {
    id: "eval-vs-train-mode",
    term: "train vs eval mode",
    domain: "deep-learning",
    definition:
      "A flag changing layer behaviour: dropout is active in training and off at inference; batch norm uses batch statistics in training and running averages at inference.",
    why: "Forgetting to switch to eval mode is a classic silent bug — the model still produces numbers, they are just noisy and slightly wrong.",
    see: ["dropout", "batch-norm", "inference"],
  },

  // ── Training at scale ──────────────────────────────────────────────────
  {
    id: "gradient-accumulation",
    term: "gradient accumulation",
    domain: "deep-learning",
    definition:
      "Summing gradients over several small batches before stepping, to get a large effective batch on limited memory.",
    why: "Remember to scale the loss or the learning rate, or the effective step size changes with the accumulation count.",
    see: ["batch-size", "gpu", "mixed-precision"],
  },
  {
    id: "gradient-checkpointing",
    term: "gradient checkpointing",
    aliases: ["activation checkpointing", "rematerialisation"],
    domain: "deep-learning",
    definition:
      "Discarding intermediate activations in the forward pass and recomputing them during the backward pass. **Trades roughly 30% more compute for a large memory saving.**",
    see: ["gradient-accumulation", "gpu"],
  },
  {
    id: "data-parallel",
    term: "data vs model parallelism",
    aliases: ["ddp", "fsdp", "zero", "tensor parallel", "pipeline parallel"],
    domain: "deep-learning",
    definition:
      "**Data parallel** replicates the model and splits the batch (DDP). **Model/tensor parallel** splits the model itself when it does not fit. **FSDP / ZeRO** shard parameters, gradients and optimizer state across devices.",
    why: "Optimizer state is usually the largest of the three — Adam keeps two extra copies of every parameter.",
    see: ["gpu", "optimizer", "gradient-accumulation"],
  },
  {
    id: "torch-compile",
    term: "graph compilation",
    aliases: ["torch.compile", "jit", "xla", "kernel fusion"],
    domain: "deep-learning",
    definition:
      "Tracing the model into a graph and compiling fused kernels, so a chain of small operations becomes one launch instead of many.",
    why: "Biggest wins on small ops that are launch-bound rather than compute-bound — which is most of a time-series model.",
    see: ["computational-graph", "gpu"],
  },
  {
    id: "quantization",
    term: "quantisation",
    aliases: ["int8", "int4", "ptq", "qat"],
    domain: "deep-learning",
    definition:
      "Storing weights and activations at lower precision. **Post-training** quantisation is applied after the fact; **quantisation-aware training** simulates it during training so the model adapts.",
    see: ["mixed-precision", "distillation", "pruning-weights"],
  },
  {
    id: "pruning-weights",
    term: "pruning (weights)",
    domain: "deep-learning",
    definition:
      "Removing weights or whole channels that contribute little. **Structured** pruning removes shapes hardware can skip; **unstructured** produces sparsity most hardware cannot exploit.",
    see: ["quantization", "distillation"],
  },
  {
    id: "distillation",
    term: "knowledge distillation",
    domain: "deep-learning",
    definition:
      "Training a small **student** to match a large **teacher**'s outputs rather than the hard labels. The teacher's full probability distribution carries more information than a one-hot target.",
    see: ["detach", "quantization", "temperature"],
  },
  {
    id: "lora",
    term: "LoRA / PEFT",
    expansion: "Low-Rank Adaptation / Parameter-Efficient Fine-Tuning",
    domain: "deep-learning",
    definition:
      "Freezing the base model and training a small low-rank update alongside it. **Trains a fraction of a percent of the parameters** and can be swapped in and out.",
    see: ["transfer-learning", "few-shot", "fine-tuning-drift"],
  },
  {
    id: "ema-weights",
    term: "EMA of weights / SWA",
    expansion: "Exponential Moving Average / Stochastic Weight Averaging",
    domain: "deep-learning",
    definition:
      "Keeping a running average of the weights across steps and evaluating that instead of the final iterate. **Almost free, and reliably generalises better** — it settles into a flatter minimum.",
    see: ["ewma-vol", "convergence", "flat-minimum"],
  },
  {
    id: "flat-minimum",
    term: "flat vs sharp minimum",
    domain: "deep-learning",
    definition:
      "How much the loss changes for a small move in parameter space. **Flat minima generalise better** — a sharp one is fitted to the training set's exact shape.",
    why: "Small batches and higher learning rates find flatter minima, which is one reason a large-batch run can score worse despite a lower training loss.",
    see: ["ema-weights", "batch-size", "overfitting"],
  },
  {
    id: "label-smoothing",
    term: "label smoothing",
    domain: "deep-learning",
    definition:
      "Replacing a hard 1.0 target with something like 0.9, spreading the rest across other classes. **Stops the model driving logits to infinity** and improves calibration.",
    see: ["calibration", "loss-function", "log-loss"],
  },
  {
    id: "focal-loss",
    term: "focal loss",
    symbol: "FL = −(1 − p)^γ · log p",
    domain: "deep-learning",
    definition:
      "Cross-entropy down-weighted on examples already classified confidently, so training focuses on hard ones. **γ** controls how aggressively.",
    why: "Built for extreme class imbalance, and a better answer than resampling because it does not distort the base rate.",
    see: ["class-imbalance", "loss-function", "sym-gamma"],
  },
  {
    id: "mixup",
    term: "mixup / cutmix",
    domain: "deep-learning",
    definition:
      "Training on convex combinations of two examples AND their labels, so the model learns to interpolate rather than memorise.",
    why: "Hard to justify on price series: a blend of two market states is not a market state.",
    see: ["data-augmentation", "regularization"],
  },
  {
    id: "catastrophic-forgetting",
    term: "catastrophic forgetting",
    domain: "deep-learning",
    definition:
      "A network losing an old capability while learning a new one, because the same weights encode both.",
    why: "The central obstacle to continually retraining on the newest regime. Replay and elastic-weight-consolidation are the usual mitigations.",
    see: ["continual-learning", "regime-change", "transfer-learning"],
  },
  {
    id: "continual-learning",
    term: "continual / lifelong learning",
    domain: "deep-learning",
    definition:
      "Learning from a stream of changing tasks without retraining from scratch and without forgetting.",
    see: ["catastrophic-forgetting", "online-learning", "drift-detection"],
  },
  {
    id: "fine-tuning-drift",
    term: "fine-tuning collapse",
    domain: "deep-learning",
    definition:
      "A pretrained model losing its general representation during fine-tuning on a small dataset, ending up worse than the frozen base.",
    why: "Mitigated with a lower learning rate, layer freezing, or LoRA — which cannot destroy the base weights because it never touches them.",
    see: ["lora", "transfer-learning", "catastrophic-forgetting"],
  },

  // ── Convolution and sequence internals ─────────────────────────────────
  {
    id: "kernel-stride-padding",
    term: "kernel, stride, padding",
    domain: "deep-learning",
    definition:
      "**Kernel** the filter's width; **stride** how far it moves each step; **padding** what is added at the edges so the output keeps a chosen length. Together they determine the output shape.",
    why: "For a causal time-series convolution, padding must be left-only — symmetric padding lets the filter see the future.",
    see: ["cnn", "causal-window", "dilated-convolution"],
  },
  {
    id: "pooling",
    term: "pooling",
    aliases: ["max pooling", "average pooling", "global pooling"],
    domain: "deep-learning",
    definition:
      "Downsampling a feature map by taking the max or mean of each region. **Buys translation tolerance and throws away position.**",
    see: ["cnn", "receptive-field"],
  },
  {
    id: "feature-map",
    term: "feature map / channel",
    domain: "deep-learning",
    definition:
      "The output of one filter across all positions. A layer's **channels** are its parallel filters, each learning a different pattern.",
    see: ["cnn", "tensor"],
  },
  {
    id: "causal-masking",
    term: "causal masking",
    domain: "deep-learning",
    definition:
      "Setting attention weights to −∞ for future positions so a token can only attend backwards. **The difference between a forecaster and a look-ahead bug.**",
    see: ["attention", "look-ahead-bias", "transformer"],
  },
  {
    id: "cross-attention",
    term: "self- vs cross-attention",
    domain: "deep-learning",
    definition:
      "**Self-attention** takes queries, keys and values from the same sequence; **cross-attention** takes queries from one and keys/values from another — how a decoder reads an encoder.",
    see: ["attention", "transformer", "encoder-decoder"],
  },
  {
    id: "mqa-gqa",
    term: "MQA / GQA",
    expansion: "Multi-Query / Grouped-Query Attention",
    domain: "deep-learning",
    definition:
      "Sharing key and value projections across attention heads to shrink the KV cache, at a small quality cost. **Grouped** is the middle ground.",
    see: ["attention", "kv-cache"],
  },
  {
    id: "kv-cache",
    term: "KV cache",
    domain: "deep-learning",
    definition:
      "Storing computed keys and values so each new token attends without recomputing the whole prefix. **Turns generation from quadratic into linear per step**, and becomes the memory bottleneck.",
    see: ["attention", "mqa-gqa", "context-window"],
  },
  {
    id: "flash-attention",
    term: "FlashAttention",
    domain: "deep-learning",
    definition:
      "An exact attention implementation that tiles the computation to avoid writing the full n×n matrix to memory. **Same output, far less memory traffic.**",
    see: ["attention", "torch-compile", "gpu"],
  },
  {
    id: "context-window",
    term: "context window",
    domain: "deep-learning",
    definition:
      "How many tokens or bars the model can attend over at once. **A hard limit on what it can condition on** — anything older is invisible unless summarised.",
    why: "Worth measuring before paying for it: if the data's memory is two bars, a long-context architecture solves a problem you do not have.",
    see: ["receptive-field", "attention", "long-memory"],
  },
  {
    id: "encoder-decoder",
    term: "encoder–decoder / seq2seq",
    domain: "deep-learning",
    definition:
      "One stack compresses the input to a representation, another generates the output from it. **Encoder-only** for classification, **decoder-only** for generation.",
    see: ["transformer", "cross-attention", "teacher-forcing"],
  },
  {
    id: "teacher-forcing",
    term: "teacher forcing & exposure bias",
    domain: "deep-learning",
    definition:
      "Training a sequence model on the TRUE previous token rather than its own prediction. Fast and stable, and it creates **exposure bias**: at inference the model sees its own mistakes, which it never trained on.",
    why: "Why multi-step forecasts degrade faster than one-step accuracy suggests.",
    see: ["encoder-decoder", "multi-step-forecast"],
  },
  {
    id: "multi-step-forecast",
    term: "recursive vs direct multi-step",
    domain: "deep-learning",
    definition:
      "**Recursive** feeds a forecast back in to predict further, compounding its own error. **Direct** trains a separate model per horizon — more models, no error compounding.",
    see: ["teacher-forcing", "label-horizon"],
  },
  {
    id: "tokenisation",
    term: "tokenisation",
    aliases: ["bpe", "subword", "vocabulary"],
    definition:
      "Splitting input into the discrete units the model actually consumes. **BPE** merges frequent pairs into subwords.",
    domain: "deep-learning",
    why: "For a price series the analogue is discretisation — and, as with subwords, the vocabulary is fitted and must be fitted on training data only.",
    see: ["codebook", "embedding", "quantisation-error"],
  },
  {
    id: "sampling-decoding",
    term: "decoding: greedy, beam, top-k, top-p",
    domain: "deep-learning",
    definition:
      "How a sequence is generated. **Greedy** takes the argmax; **beam** keeps several partial candidates; **top-k** and **top-p (nucleus)** sample from the most likely tokens only.",
    see: ["temperature", "sigmoid", "sym-argmax"],
  },
  {
    id: "perplexity",
    term: "perplexity",
    symbol: "PPL = exp(cross-entropy)",
    domain: "deep-learning",
    definition:
      "The exponential of average cross-entropy — roughly, how many equally-likely options the model is choosing among. **Lower is better; 1 is certainty.**",
    see: ["log-loss", "entropy", "f-cross-entropy"],
  },

  // ── Large models ───────────────────────────────────────────────────────
  {
    id: "scaling-laws",
    term: "scaling laws",
    domain: "deep-learning",
    definition:
      "Loss falling as a power law in parameters, data and compute. **Predictable enough to plan a training run before starting it.**",
    why: "The compute-optimal point trades parameters against tokens; most models were historically under-trained on too little data for their size.",
    see: ["emergent-ability", "gpu"],
  },
  {
    id: "emergent-ability",
    term: "emergent ability",
    domain: "deep-learning",
    definition:
      "A capability absent at small scale and present at large. **Contested** — some apparent emergence is an artifact of a discontinuous metric rather than the model.",
    see: ["scaling-laws"],
  },
  {
    id: "in-context-learning",
    term: "in-context learning",
    domain: "deep-learning",
    definition:
      "Performing a task from examples supplied in the prompt, with no weight update. **Inference-time adaptation.**",
    see: ["few-shot", "prompt-engineering"],
  },
  {
    id: "prompt-engineering",
    term: "prompt engineering",
    aliases: ["chain of thought", "system prompt"],
    domain: "deep-learning",
    definition:
      "Shaping the input so the model does what you want. **Chain-of-thought** asks for intermediate reasoning, which measurably helps on multi-step problems.",
    see: ["in-context-learning", "hallucination"],
  },
  {
    id: "rlhf",
    term: "RLHF / DPO",
    expansion: "Reinforcement Learning from Human Feedback / Direct Preference Optimisation",
    domain: "deep-learning",
    definition:
      "Aligning a model to preferences: **RLHF** trains a reward model from comparisons then optimises against it; **DPO** skips the reward model and optimises preferences directly.",
    see: ["reinforcement-learning", "reward-function", "reward-hacking"],
  },
  {
    id: "hallucination",
    term: "hallucination",
    domain: "deep-learning",
    definition:
      "Fluent output that is not grounded in anything true. **A generative model optimises plausibility, not accuracy**, and those come apart.",
    see: ["prompt-engineering", "calibration"],
  },
  {
    id: "embedding-similarity",
    term: "cosine similarity / vector search",
    symbol: "cos θ = (a·b)/(‖a‖‖b‖)",
    domain: "deep-learning",
    definition:
      "Angle between two embeddings as a similarity score, ignoring magnitude. **The retrieval primitive** behind nearest-neighbour and vector databases.",
    see: ["embedding", "sym-norm", "curse-of-dimensionality"],
  },

  // ── RL internals ───────────────────────────────────────────────────────
  {
    id: "experience-replay",
    term: "experience replay",
    domain: "deep-learning",
    definition:
      "Storing past transitions in a buffer and training on random samples from it, breaking the correlation between consecutive experiences.",
    why: "**Prioritised** replay samples surprising transitions more often, and introduces a bias that has to be corrected by importance weights.",
    see: ["q-learning", "target-network", "reinforcement-learning"],
  },
  {
    id: "target-network",
    term: "target network",
    domain: "deep-learning",
    definition:
      "A frozen copy of the value network used to compute the learning target, updated slowly. **Without it the target moves with every step** and training chases itself.",
    see: ["q-learning", "detach", "bellman-equation"],
  },
  {
    id: "advantage-function",
    term: "advantage / GAE",
    symbol: "A(s,a) = Q(s,a) − V(s)",
    domain: "deep-learning",
    definition:
      "How much better an action is than the state's average. **Generalised Advantage Estimation** trades bias against variance in estimating it.",
    see: ["actor-critic", "bellman-equation", "policy"],
  },
  {
    id: "entropy-bonus",
    term: "entropy bonus / KL penalty",
    domain: "deep-learning",
    definition:
      "Adding an entropy term to keep a policy from collapsing to one action too early, or a KL term to stop it moving too far from a reference in one update.",
    see: ["exploration-exploitation", "entropy", "rlhf"],
  },
];
