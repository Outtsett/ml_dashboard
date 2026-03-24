import type { LearningPath } from "../types";

export const deepLearningPath: LearningPath = {
  id: "deep-learning",
  title: "Deep Learning",
  description:
    "Master deep neural networks for financial time series — from feedforward nets and backpropagation to LSTMs, attention mechanisms, and transformer architectures applied to forex forecasting.",
  icon: "Cpu",
  color: "violet",
  difficulty: "advanced",
  estimatedHours: 22,
  modules: [
    {
      id: "nn-fundamentals",
      title: "Neural Network Fundamentals",
      description:
        "Build a solid foundation in neural network architecture, training dynamics, and regularization techniques essential for robust financial models.",
      lessons: [
        {
          id: "dl-neural-nets",
          title: "Neural Networks & Backpropagation",
          description:
            "Understand how perceptrons combine into deep networks, how activation functions introduce non-linearity, and how backpropagation uses the chain rule to learn from forex price data.",
          estimatedMinutes: 45,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Learn the building blocks of neural networks — perceptrons, activation functions (ReLU, sigmoid, tanh), loss functions, and the backpropagation algorithm — then apply them to a forex direction-prediction task.",
              keyTakeaways: [
                "A perceptron computes y = σ(∑ wᵢxᵢ + b) where σ is a non-linear activation",
                "ReLU(x) = max(0, x) avoids vanishing gradients for deep nets",
                "Backpropagation applies the chain rule: ∂L/∂wᵢ = ∂L/∂ŷ · ∂ŷ/∂zₖ · ∂zₖ/∂wᵢ",
                "Cross-entropy loss is preferred for classification: L = −∑ yᵢ log(ŷᵢ)",
                "Weight initialization (Xavier, He) prevents signal collapse in deep layers",
              ],
            },
            {
              type: "theory",
              title: "From Perceptrons to Deep Networks",
              content:
                "A single perceptron computes z = ∑ᵢ wᵢxᵢ + b and passes it through an activation σ(z). Stacking layers creates a universal function approximator f: ℝⁿ → ℝᵐ.\n\n**Activation Functions:**\n- **Sigmoid:** σ(z) = 1/(1 + e⁻ᶻ) ∈ (0, 1) — saturates, causing vanishing gradients\n- **Tanh:** tanh(z) ∈ (−1, 1) — zero-centred but still saturates\n- **ReLU:** f(z) = max(0, z) — cheap, no saturation for z > 0\n\n**Backpropagation** propagates error gradients via the chain rule:\n  δˡ = (Wˡ⁺¹)ᵀ δˡ⁺¹ ⊙ σ′(zˡ)\nenabling gradient descent: W ← W − α · ∂L/∂W.\n\n**Loss Functions:** MSE for regression L = (1/N)∑(yᵢ−ŷᵢ)², binary cross-entropy for direction L = −[y log ŷ + (1−y) log(1−ŷ)].",
            },
            {
              type: "intuition",
              title: "Neural Nets as Feature Detectors",
              analogy:
                "Think of a neural network as a trading desk team. First-layer analysts spot simple patterns — 'price went up', 'volume spiked'. Middle layers combine these into insights — 'bullish engulfing with volume confirmation'. The final analyst synthesises a trading decision. Backpropagation is the daily review where P&L tells each analyst how to adjust.",
              content:
                "Each hidden layer learns increasingly abstract representations. Early layers detect candlestick components, deeper layers compose complex chart patterns. The network discovers features that would take a quant months to hand-engineer — by minimising a loss function through iterative gradient updates.",
              emoji: "🧠",
            },
            {
              type: "code",
              title: "Feedforward Net for Forex Direction Prediction",
              language: "python",
              code: `import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset

def prepare_features(df: pd.DataFrame, lookback: int = 20):
    df["returns"] = df["close"].pct_change()
    df["sma_ratio"] = df["close"] / df["close"].rolling(lookback).mean()
    df["volatility"] = df["returns"].rolling(lookback).std()
    df["target"] = (df["close"].shift(-1) > df["close"]).astype(float)
    df.dropna(inplace=True)
    X = torch.tensor(df[["returns", "sma_ratio", "volatility"]].values, dtype=torch.float32)
    y = torch.tensor(df["target"].values, dtype=torch.float32).unsqueeze(1)
    return X, y

class ForexDirectionNet(nn.Module):
    def __init__(self, n_features: int, hidden: int = 64):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_features, hidden),
            nn.ReLU(),                        # σ(z) = max(0, z)
            nn.Linear(hidden, hidden // 2),
            nn.Tanh(),
            nn.Linear(hidden // 2, 1),
            nn.Sigmoid(),                      # output ∈ (0,1) → P(up)
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)

model = ForexDirectionNet(n_features=3)
criterion = nn.BCELoss()  # L = −[y log ŷ + (1−y) log(1−ŷ)]
optimizer = optim.Adam(model.parameters(), lr=1e-3)

# X_train, y_train = prepare_features(df)
# loader = DataLoader(TensorDataset(X_train, y_train), batch_size=64)
# for epoch in range(50):
#     for xb, yb in loader:
#         loss = criterion(model(xb), yb)
#         optimizer.zero_grad()
#         loss.backward()   # ∂L/∂W via chain rule
#         optimizer.step()  # W ← W − α · ∂L/∂W`,
              explanation:
                "A 3-layer feedforward network takes technical features (returns, SMA ratio, volatility) and predicts P(up). ReLU → Tanh → Sigmoid activations demonstrate different non-linearities. The training loop shows the core backprop cycle: forward → loss → backward → update.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "dl-neural-nets-q1",
                  question: "Why is ReLU preferred over sigmoid in hidden layers of deep networks?",
                  options: [
                    { id: "dl-neural-nets-q1-a", text: "ReLU outputs are always positive, improving accuracy" },
                    { id: "dl-neural-nets-q1-b", text: "ReLU avoids vanishing gradients — its derivative is 1 for positive inputs" },
                    { id: "dl-neural-nets-q1-c", text: "ReLU is a smoother function than sigmoid" },
                    { id: "dl-neural-nets-q1-d", text: "ReLU outputs probabilities directly" },
                  ],
                  correctOptionId: "dl-neural-nets-q1-b",
                  explanation:
                    "Sigmoid saturates for large |z|, pushing gradients → 0. ReLU has constant gradient 1 for z > 0, allowing gradients to flow through many layers.",
                },
                {
                  id: "dl-neural-nets-q2",
                  question: "Which loss function is most appropriate for predicting EUR/USD direction (up/down)?",
                  options: [
                    { id: "dl-neural-nets-q2-a", text: "Mean Squared Error (MSE)" },
                    { id: "dl-neural-nets-q2-b", text: "Binary Cross-Entropy (BCE)" },
                    { id: "dl-neural-nets-q2-c", text: "Hinge Loss" },
                    { id: "dl-neural-nets-q2-d", text: "Kullback-Leibler Divergence" },
                  ],
                  correctOptionId: "dl-neural-nets-q2-b",
                  explanation:
                    "Direction prediction is binary classification. BCE L = −[y log ŷ + (1−y) log(1−ŷ)] directly measures how well predicted probabilities match binary outcomes.",
                },
              ],
            },
            {
              type: "practice",
              title: "Build & Train a Direction Classifier",
              description:
                "Using EUR/USD OHLCV data, build a feedforward net to predict next-bar direction. Experiment with hidden sizes (32, 64, 128), activations, and learning rates. Target: >52% out-of-sample accuracy on 1H bars.",
              catalogModelId: "feedforward-classifier",
            },
          ],
        },
        {
          id: "dl-regularization",
          title: "Regularization & Training Tricks",
          description:
            "Learn essential techniques to prevent overfitting — dropout, batch normalisation, learning rate scheduling, early stopping, and weight decay.",
          estimatedMinutes: 40,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Master regularization and training techniques that transform fragile neural networks into robust models suitable for noisy, non-stationary forex markets.",
              keyTakeaways: [
                "Dropout randomly zeros neurons with probability p: ĥ = m ⊙ h / (1−p)",
                "Batch Normalisation: x̂ = (x − μ_B) / √(σ²_B + ε)",
                "Cosine annealing LR: α_t = α_min + ½(α_max − α_min)(1 + cos(πt/T))",
                "Early stopping halts training when validation loss stagnates for `patience` epochs",
                "L2 weight decay adds λ‖θ‖² to the loss, shrinking parameters toward zero",
              ],
            },
            {
              type: "theory",
              title: "Regularization Techniques for Financial Models",
              content:
                "Financial time series have low signal-to-noise ratio. Without regularization, networks memorise noise.\n\n**Dropout**: Each neuron is independently zeroed with probability p during training. At inference, weights scale by (1−p). Forces redundant representations.\n\n**Batch Normalisation**: Normalises mini-batch activations x̂ᵢ = (xᵢ − μ_B) / √(σ²_B + ε), then scales yᵢ = γx̂ᵢ + β. Reduces internal covariate shift.\n\n**Weight Decay (L2)**: L_total = L_data + λ∑θᵢ² biases toward simpler solutions. Typical λ ∈ [1e-5, 1e-3].\n\n**LR Scheduling**: Step decay (α ← α·γ every N epochs), cosine annealing with warm restarts, or linear warmup.\n\n**Early Stopping**: Track validation loss; restore best weights after `patience` epochs without improvement.",
            },
            {
              type: "intuition",
              title: "Why Regularization Matters in Trading",
              analogy:
                "Without regularization, you're memorising every past trade — including random noise. Dropout is like randomly covering parts of your notes while studying, forcing you to learn core patterns. Early stopping is knowing when to stop studying before confusing yourself with edge cases.",
              content:
                "In forex, yesterday's volatility spike may never repeat. A model that memorises such events fails on new data. Regularization favours generalisation: dropout creates implicit ensembles, batch norm stabilises optimisation, weight decay penalises complexity. The goal: capture μ (signal) without fitting σ (noise).",
              emoji: "🛡️",
            },
            {
              type: "code",
              title: "PyTorch Training Loop with All Regularization Tricks",
              language: "python",
              code: `import torch
import torch.nn as nn
import torch.optim as optim
from torch.optim.lr_scheduler import CosineAnnealingWarmRestarts

class RegularizedForexNet(nn.Module):
    def __init__(self, n_features: int, hidden: int = 128, dropout_p: float = 0.3):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_features, hidden),
            nn.BatchNorm1d(hidden),       # x̂ = (x − μ_B) / √(σ²_B + ε)
            nn.ReLU(),
            nn.Dropout(p=dropout_p),      # zero p fraction of neurons
            nn.Linear(hidden, hidden // 2),
            nn.BatchNorm1d(hidden // 2),
            nn.ReLU(),
            nn.Dropout(p=dropout_p),
            nn.Linear(hidden // 2, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)

model = RegularizedForexNet(n_features=10)
optimizer = optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)
scheduler = CosineAnnealingWarmRestarts(optimizer, T_0=10, T_mult=2)
criterion = nn.BCELoss()
best_val_loss, patience, patience_ctr = float("inf"), 10, 0

for epoch in range(200):
    model.train()
    # for xb, yb in train_loader:
    #     loss = criterion(model(xb), yb)
    #     optimizer.zero_grad(); loss.backward()
    #     torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    #     optimizer.step()
    scheduler.step()
    # model.eval()
    # val_loss = criterion(model(X_val), y_val).item()
    # if val_loss < best_val_loss:
    #     best_val_loss = val_loss; patience_ctr = 0
    #     torch.save(model.state_dict(), "best.pt")
    # else:
    #     patience_ctr += 1
    #     if patience_ctr >= patience: break`,
              explanation:
                "Production-ready loop combining Dropout (p=0.3), BatchNorm, AdamW weight decay (λ=1e-4), cosine annealing LR, gradient clipping, and early stopping with patience=10.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "dl-regularization-q1",
                  question: "What happens to dropout during inference (model.eval())?",
                  options: [
                    { id: "dl-regularization-q1-a", text: "Dropout continues to randomly zero neurons" },
                    { id: "dl-regularization-q1-b", text: "Dropout is disabled and activations are scaled by (1−p)" },
                    { id: "dl-regularization-q1-c", text: "Dropout probability is halved" },
                    { id: "dl-regularization-q1-d", text: "Dropout layers are removed from the graph" },
                  ],
                  correctOptionId: "dl-regularization-q1-b",
                  explanation:
                    "During inference, dropout is disabled and outputs are scaled by (1−p). PyTorch's model.eval() handles this automatically.",
                },
                {
                  id: "dl-regularization-q2",
                  question: "Why is cosine annealing preferred over fixed learning rates for forex models?",
                  options: [
                    { id: "dl-regularization-q2-a", text: "It guarantees convergence to the global minimum" },
                    { id: "dl-regularization-q2-b", text: "It periodically increases the LR, helping escape local minima in noisy loss landscapes" },
                    { id: "dl-regularization-q2-c", text: "It eliminates the need for a validation set" },
                    { id: "dl-regularization-q2-d", text: "It reduces the total number of epochs required" },
                  ],
                  correctOptionId: "dl-regularization-q2-b",
                  explanation:
                    "Cosine annealing with warm restarts periodically raises the LR, helping escape sharp local minima — valuable for noisy financial data with many spurious minima.",
                },
              ],
            },
            {
              type: "practice",
              title: "Regularization Ablation Study",
              description:
                "Train the same forex model under 4 configs: (1) none, (2) dropout only, (3) batch norm only, (4) all tricks. Compare validation accuracy, loss curves, and train-val accuracy gap. The config with smallest gap and highest val accuracy wins.",
              catalogModelId: "regularization-ablation",
            },
          ],
        },
      ],
    },
    {
      id: "sequence-models",
      title: "Sequence Models",
      description:
        "Master architectures for sequential data — recurrent networks with hidden state and transformers with parallel self-attention.",
      lessons: [
        {
          id: "dl-rnn-lstm",
          title: "RNNs & LSTMs for Time Series",
          description:
            "Explore how recurrent architectures maintain temporal memory and why LSTM gating solves vanishing gradients for long forex sequences.",
          estimatedMinutes: 50,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Understand RNNs, LSTMs, and GRUs for multi-step forex forecasting, including vanishing gradients and how gating mechanisms address them.",
              keyTakeaways: [
                "RNN hidden state: hₜ = tanh(Wₕhₜ₋₁ + Wₓxₜ + b) creates temporal memory",
                "Vanishing gradients: ∂hₜ/∂h₁ = ∏ₖ Wₕ · diag(σ′(zₖ)) → 0 for long sequences",
                "LSTM gates (forget fₜ, input iₜ, output oₜ) control cell state cₜ information flow",
                "GRU uses two gates (reset rₜ, update zₜ) with comparable performance to LSTM",
                "Bidirectional processing captures both past and future context for feature extraction",
              ],
            },
            {
              type: "theory",
              title: "From Vanilla RNNs to Gated Architectures",
              content:
                "**Vanilla RNN** maintains hidden state hₜ ∈ ℝᵈ: hₜ = tanh(Wₕhₜ₋₁ + Wₓxₜ + b). Backpropagation through time (BPTT) requires gradients through T steps — repeated multiplication by Wₕ causes vanishing (‖Wₕ‖<1) or exploding (‖Wₕ‖>1) gradients.\n\n**LSTM** introduces cell state cₜ with three gates:\n- Forget: fₜ = σ(Wf·[hₜ₋₁, xₜ] + bf)\n- Input: iₜ = σ(Wi·[hₜ₋₁, xₜ] + bi), c̃ₜ = tanh(Wc·[hₜ₋₁, xₜ] + bc)\n- Cell: cₜ = fₜ ⊙ cₜ₋₁ + iₜ ⊙ c̃ₜ\n- Output: oₜ = σ(Wo·[hₜ₋₁, xₜ] + bo), hₜ = oₜ ⊙ tanh(cₜ)\n\nThe cell state acts as a gradient highway — gates near 1 let gradients flow unimpeded.\n\n**GRU** merges cell/hidden state with update gate zₜ and reset gate rₜ:\nhₜ = (1−zₜ) ⊙ hₜ₋₁ + zₜ ⊙ h̃ₜ, where h̃ₜ = tanh(W·[rₜ ⊙ hₜ₋₁, xₜ]).",
            },
            {
              type: "intuition",
              title: "LSTM Gates as a Trading Journal",
              analogy:
                "The LSTM cell state is your long-term trading journal. The forget gate discards outdated theses ('USD strength from last quarter is irrelevant'). The input gate records new observations ('NFP just surprised upside'). The output gate selects which entries matter for today's decision.",
              content:
                "In forex, some patterns persist for weeks (trends) while others are fleeting (news spikes). The forget gate maintains long-term regime info while the input gate captures new price action. This selective memory is why LSTMs outperform vanilla RNNs on financial time series.",
              emoji: "📝",
            },
            {
              type: "code",
              title: "LSTM for Multi-Step Forex Forecasting",
              language: "python",
              code: `import numpy as np
import pandas as pd
import torch
import torch.nn as nn

class ForexLSTM(nn.Module):
    def __init__(self, n_features: int = 5, hidden_size: int = 128,
                 num_layers: int = 2, forecast_horizon: int = 5, dropout: float = 0.2):
        super().__init__()
        self.lstm = nn.LSTM(input_size=n_features, hidden_size=hidden_size,
                            num_layers=num_layers, batch_first=True, dropout=dropout)
        self.fc = nn.Sequential(
            nn.Linear(hidden_size, 64), nn.ReLU(),
            nn.Linear(64, forecast_horizon),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        lstm_out, (h_n, c_n) = self.lstm(x)  # x: (batch, seq_len, features)
        return self.fc(lstm_out[:, -1, :])     # last step → (batch, horizon)

def create_sequences(df: pd.DataFrame, seq_len: int = 60, horizon: int = 5):
    features = ["open", "high", "low", "close", "volume"]
    data = df[features].values.astype(np.float32)
    X, y = [], []
    for i in range(seq_len, len(data) - horizon):
        window = data[i - seq_len : i]
        mu, sigma = window.mean(0), window.std(0) + 1e-8
        X.append((window - mu) / sigma)  # rolling z-score: x̂ = (x−μ)/σ
        future_ret = np.diff(data[i : i + horizon + 1, 3]) / data[i, 3]
        y.append(future_ret)
    return torch.tensor(np.array(X)), torch.tensor(np.array(y))

model = ForexLSTM(n_features=5, hidden_size=128, forecast_horizon=5)
# X, y = create_sequences(df, seq_len=60, horizon=5)
# pred = model(X[:32])  # → (32, 5) next 5 returns`,
              explanation:
                "A 2-layer stacked LSTM takes 60-bar OHLCV windows (rolling z-score normalised) and predicts the next 5 returns. create_sequences handles sliding-window transformation with proper normalisation to prevent look-ahead bias.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "dl-rnn-lstm-q1",
                  question: "Which LSTM gate decides what old information to discard from the cell state?",
                  options: [
                    { id: "dl-rnn-lstm-q1-a", text: "Input gate (iₜ)" },
                    { id: "dl-rnn-lstm-q1-b", text: "Output gate (oₜ)" },
                    { id: "dl-rnn-lstm-q1-c", text: "Forget gate (fₜ)" },
                    { id: "dl-rnn-lstm-q1-d", text: "Cell candidate (c̃ₜ)" },
                  ],
                  correctOptionId: "dl-rnn-lstm-q1-c",
                  explanation:
                    "The forget gate fₜ = σ(Wf·[hₜ₋₁,xₜ]+bf) outputs values ∈ (0,1) multiplied against the cell state. Near 0 discards, near 1 preserves.",
                },
                {
                  id: "dl-rnn-lstm-q2",
                  question: "Why must forex sequences use rolling normalisation rather than global statistics?",
                  options: [
                    { id: "dl-rnn-lstm-q2-a", text: "Rolling normalisation makes data stationary, preventing spurious level-dependent patterns" },
                    { id: "dl-rnn-lstm-q2-b", text: "Global statistics are too slow to compute" },
                    { id: "dl-rnn-lstm-q2-c", text: "Rolling normalisation guarantees positive inputs" },
                    { id: "dl-rnn-lstm-q2-d", text: "LSTM gates only work with normalised data" },
                  ],
                  correctOptionId: "dl-rnn-lstm-q2-a",
                  explanation:
                    "Forex prices are non-stationary — μ and σ² shift over time. Global stats leak future info. Rolling normalisation ensures each window is locally standardised.",
                },
              ],
            },
            {
              type: "practice",
              title: "LSTM vs GRU Forecasting Comparison",
              description:
                "Implement LSTM and GRU models with identical hyperparameters (seq_len=60, hidden=128, 2 layers) for EUR/USD 5-step return prediction. Compare MSE, directional accuracy, and training speed. Try a bidirectional variant — does it improve feature extraction?",
              catalogModelId: "lstm-gru-comparison",
            },
          ],
        },
        {
          id: "dl-transformers",
          title: "Transformers & Attention",
          description:
            "Discover how self-attention attends to all time steps simultaneously, eliminating the sequential bottleneck of RNNs for long forex sequences.",
          estimatedMinutes: 55,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              content:
                "Understand self-attention, positional encoding, and multi-head attention, then apply temporal fusion transformers to forex price prediction.",
              keyTakeaways: [
                "Self-attention: Attention(Q,K,V) = softmax(QKᵀ / √dₖ) V",
                "Positional encoding: PE(pos,2i) = sin(pos / 10000^(2i/d))",
                "Multi-head attention runs h parallel heads, each learning different temporal relationships",
                "Transformers process all T steps in parallel — O(1) sequential ops vs O(T) for RNNs",
                "Temporal Fusion Transformers combine static covariates, known future inputs, and past data",
              ],
            },
            {
              type: "theory",
              title: "Self-Attention & the Transformer Architecture",
              content:
                "**Self-Attention** lets each position attend to all others. For input X ∈ ℝᵀˣᵈ:\n1. Project: Q = XWQ, K = XWK, V = XWV\n2. Scores: A = softmax(QKᵀ / √dₖ) — scaling prevents softmax saturation\n3. Output: Z = AV\n\n**Multi-Head Attention**: MultiHead(Q,K,V) = Concat(head₁,...,headₕ)Wᴼ where headᵢ = Attention(QWᵢQ, KWᵢK, VWᵢV). Each head learns different patterns — momentum, seasonality, correlations.\n\n**Positional Encoding** injects order (attention is permutation-invariant):\nPE(pos,2i) = sin(pos/10000^(2i/d)), PE(pos,2i+1) = cos(pos/10000^(2i/d)).\n\n**Temporal Fusion Transformers** extend this with variable selection networks, static covariate encoders, gated residual networks, and interpretable multi-head attention over time.",
            },
            {
              type: "intuition",
              title: "Attention as a Smart Order Book Scanner",
              analogy:
                "An RNN reads 100 bars sequentially — by bar 100, bar 1's reversal is forgotten. Attention gives 100 eyes simultaneously: each bar directly sees every other bar. Multi-head attention is multiple analysts — one tracks momentum, another watches support/resistance, a third monitors volume.",
              content:
                "The key insight: O(1) path length between any two positions. A support level from 50 bars ago can directly influence the current bar's representation. The attention weights are interpretable — showing which bars the model considers most important for each prediction.",
              emoji: "👁️",
            },
            {
              type: "code",
              title: "Transformer Encoder for Price Prediction",
              language: "python",
              code: `import torch
import torch.nn as nn
import math

class PositionalEncoding(nn.Module):
    def __init__(self, d_model: int, max_len: int = 500):
        super().__init__()
        pe = torch.zeros(max_len, d_model)
        pos = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(pos * div)  # PE(pos,2i) = sin(pos/10000^(2i/d))
        pe[:, 1::2] = torch.cos(pos * div)
        self.register_buffer("pe", pe.unsqueeze(0))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.pe[:, : x.size(1)]

class ForexTransformer(nn.Module):
    def __init__(self, n_features: int = 5, d_model: int = 64, n_heads: int = 4,
                 n_layers: int = 2, dropout: float = 0.1, forecast_horizon: int = 1):
        super().__init__()
        self.input_proj = nn.Linear(n_features, d_model)
        self.pos_enc = PositionalEncoding(d_model)
        layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=n_heads, dim_feedforward=d_model * 4,
            dropout=dropout, batch_first=True,
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=n_layers)
        self.head = nn.Sequential(nn.LayerNorm(d_model), nn.Linear(d_model, forecast_horizon))
        self._mask = None

    def _causal_mask(self, seq_len: int, device: torch.device):
        if self._mask is None or self._mask.size(0) != seq_len:
            self._mask = torch.triu(torch.ones(seq_len, seq_len, device=device), 1).bool()
        return self._mask

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.pos_enc(self.input_proj(x))
        x = self.encoder(x, mask=self._causal_mask(x.size(1), x.device))
        return self.head(x[:, -1, :])  # last position → prediction

model = ForexTransformer(n_features=5, d_model=64, n_heads=4)
out = model(torch.randn(16, 60, 5))  # (batch=16, seq=60, feat=5) → (16, 1)
print(f"Output: {out.shape}")  # torch.Size([16, 1])`,
              explanation:
                "A transformer encoder with sinusoidal positional encoding, multi-head self-attention (softmax(QKᵀ/√dₖ)V), and a causal mask to prevent look-ahead. Takes 60-bar OHLCV sequences and predicts next return from the final position's representation.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "dl-transformers-q1",
                  question: "Why is the attention score scaled by 1/√dₖ?",
                  options: [
                    { id: "dl-transformers-q1-a", text: "To normalise output to unit variance" },
                    { id: "dl-transformers-q1-b", text: "To prevent large dot products that push softmax into vanishing-gradient regions" },
                    { id: "dl-transformers-q1-c", text: "To reduce computational cost" },
                    { id: "dl-transformers-q1-d", text: "To ensure attention weights sum to 1" },
                  ],
                  correctOptionId: "dl-transformers-q1-b",
                  explanation:
                    "With large dₖ, dot products grow (variance ≈ dₖ), pushing softmax toward one-hot where gradients vanish. Dividing by √dₖ keeps variance ≈ 1.",
                },
                {
                  id: "dl-transformers-q2",
                  question: "Why is a causal mask essential for time series transformers?",
                  options: [
                    { id: "dl-transformers-q2-a", text: "It reduces computational cost by half" },
                    { id: "dl-transformers-q2-b", text: "It prevents attending to future time steps, avoiding look-ahead bias" },
                    { id: "dl-transformers-q2-c", text: "It improves long-range dependency learning" },
                    { id: "dl-transformers-q2-d", text: "It is only needed during training" },
                  ],
                  correctOptionId: "dl-transformers-q2-b",
                  explanation:
                    "Without a causal mask, position t can see t+1,...,T — info unavailable in real-time trading. The mask sets future attention weights to −∞ before softmax.",
                },
                {
                  id: "dl-transformers-q3",
                  question: "What advantage does multi-head attention give for forex data?",
                  options: [
                    { id: "dl-transformers-q3-a", text: "Fewer parameters than single-head" },
                    { id: "dl-transformers-q3-b", text: "Eliminates the need for positional encoding" },
                    { id: "dl-transformers-q3-c", text: "Each head learns different temporal patterns — momentum, mean reversion, seasonality — in parallel" },
                    { id: "dl-transformers-q3-d", text: "Guarantees uniform attention distribution" },
                  ],
                  correctOptionId: "dl-transformers-q3-c",
                  explanation:
                    "Each head projects Q,K,V into a separate subspace, independently learning which temporal relationships matter — short-term momentum, weekly seasonality, cross-pair correlation, etc.",
                },
              ],
            },
            {
              type: "practice",
              title: "Transformer vs LSTM Showdown",
              description:
                "Build transformer and LSTM models with ~500K parameters each for EUR/USD 1H return prediction. Compare MSE, directional accuracy, and training speed. Visualise attention weights — which historical bars does the transformer attend to? Test sequence lengths 30, 60, 120.",
              catalogModelId: "transformer-vs-lstm",
            },
          ],
        },
      ],
    },
  ],
};
