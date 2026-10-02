import type { LearningPath } from "@/training/lib/types";

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
          estimatedMinutes: 90,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              title: "Master Neural Network Foundations",
              description:
                "Learn the mathematical foundations of neural networks — from single perceptrons to deep architectures — including the universal approximation theorem, forward propagation mechanics, full backpropagation derivation, activation function analysis, and principled weight initialization strategies.",
              keyTakeaways: [
                "A perceptron computes y = σ(∑ᵢ wᵢxᵢ + b) where σ is a non-linear activation mapping linear combinations to useful ranges",
                "Universal Approximation Theorem: A 2-layer network with sufficient hidden units can approximate any continuous function on compact subsets of ℝⁿ",
                "Forward pass: z⁽ˡ⁾ = W⁽ˡ⁾a⁽ˡ⁻¹⁾ + b⁽ˡ⁾, a⁽ˡ⁾ = σ(z⁽ˡ⁾) with matrix operations enabling efficient GPU computation",
                "Backpropagation chain rule: ∂L/∂W⁽ˡ⁾ = ∂L/∂a⁽ᴸ⁾ · ∂a⁽ᴸ⁾/∂z⁽ᴸ⁾ · ... · ∂z⁽ˡ⁾/∂W⁽ˡ⁾ propagates gradients layer-by-layer",
                "ReLU(x) = max(0, x) has gradient 1 for x>0, avoiding vanishing gradients; GELU(x) = x·Φ(x) provides smooth approximation",
                "Xavier init: Var(W) = 2/(nᵢₙ + n_out); He init: Var(W) = 2/nᵢₙ preserves signal variance through layers",
                "Cross-entropy loss L = −∑ yᵢ log(ŷᵢ) directly optimizes log-likelihood for classification",
                "Gradient flow degrades exponentially with depth unless activations and initialization preserve variance",
              ],
            },
            {
              type: "theory",
              title: "Perceptron & Universal Approximation",
              content:
                "The **perceptron** is the atomic unit of neural networks. Given input vector x ∈ ℝⁿ, weights w ∈ ℝⁿ, and bias b ∈ ℝ, it computes:\n\n  z = wᵀx + b = ∑ᵢ₌₁ⁿ wᵢxᵢ + b\n  y = σ(z)\n\nwhere σ is an activation function. Without σ, stacking layers yields only linear transformations: f(x) = W₃(W₂(W₁x)) = (W₃W₂W₁)x = Wx, collapsing to a single linear layer. Non-linear σ enables function composition creating complex decision boundaries.\n\n**Universal Approximation Theorem (Cybenko 1989, Hornik 1991):** Let σ be a non-constant, bounded, continuous activation (e.g., sigmoid). Then for any continuous function f: [0,1]ⁿ → ℝ and ε > 0, there exists a 2-layer network:\n\n  F(x) = ∑ᵢ₌₁ᴴ vᵢσ(wᵢᵀx + bᵢ)\n\nsuch that |F(x) − f(x)| < ε for all x. **Proof sketch:** Each hidden unit σ(wᵀx + b) partitions input space via a shifted hyperplane. With enough units H, we tile the domain [0,1]ⁿ with arbitrarily fine resolution, approximating any function as a piecewise constant (or linear) combination.\n\n**Practical implication:** Width (H) enables approximation, but depth (L layers) enables *efficient* approximation. Deep nets can represent functions requiring exponentially many units in a shallow net. Example: parity function on n bits requires 2ⁿ hidden units in 2 layers, but O(n) units across log(n) layers.\n\nFor forex: A deep network learns hierarchy — first layer detects candlestick primitives (doji, hammer), second layer composes multi-bar patterns (engulfing, head-and-shoulders), third layer integrates with volume/volatility context, final layer produces directional probability.",
            },
            {
              type: "theory",
              title: "Forward Propagation: Matrix Form & Numerical Example",
              content:
                "Consider a 3-layer network (input → 3 → 2 → 1) predicting forex direction from features x = [return, sma_ratio] ∈ ℝ².\n\n**Layer 1:** z⁽¹⁾ = W⁽¹⁾x + b⁽¹⁾, a⁽¹⁾ = ReLU(z⁽¹⁾)\nW⁽¹⁾ ∈ ℝ³ˣ² = [[0.5, −0.3], [0.2, 0.8], [−0.4, 0.1]], b⁽¹⁾ = [0.1, −0.2, 0.05]\nInput: x = [0.02, 1.05] (2% return, price 5% above SMA)\nz⁽¹⁾ = [0.5·0.02 − 0.3·1.05 + 0.1, 0.2·0.02 + 0.8·1.05 − 0.2, −0.4·0.02 + 0.1·1.05 + 0.05]\n    = [−0.205, 0.644, 0.147]\na⁽¹⁾ = max(0, z⁽¹⁾) = [0, 0.644, 0.147]\n\n**Layer 2:** z⁽²⁾ = W⁽²⁾a⁽¹⁾ + b⁽²⁾, a⁽²⁾ = tanh(z⁽²⁾)\nW⁽²⁾ ∈ ℝ²ˣ³ = [[0.6, 0.4, −0.2], [−0.3, 0.7, 0.5]], b⁽²⁾ = [0.15, −0.1]\nz⁽²⁾ = [[0.6·0 + 0.4·0.644 − 0.2·0.147 + 0.15], [−0.3·0 + 0.7·0.644 + 0.5·0.147 − 0.1]]\n    = [0.358, 0.424]\na⁽²⁾ = tanh(z⁽²⁾) = [0.343, 0.401]\n\n**Layer 3 (output):** z⁽³⁾ = W⁽³⁾a⁽²⁾ + b⁽³⁾, ŷ = σ(z⁽³⁾)\nW⁽³⁾ = [1.2, −0.8], b⁽³⁾ = 0.05\nz⁽³⁾ = 1.2·0.343 − 0.8·0.401 + 0.05 = 0.411 − 0.321 + 0.05 = 0.140\nŷ = sigmoid(0.140) = 1/(1 + e⁻⁰·¹⁴) ≈ 0.535\n\n**Interpretation:** 53.5% probability price goes up next bar. If true label y=1 (price did rise), loss L = −[1·log(0.535) + 0·log(0.465)] = 0.625. Backprop will adjust weights to increase ŷ toward 1.",
            },
            {
              type: "theory",
              title: "Backpropagation: Full Derivation",
              content:
                "**Backpropagation** computes ∂L/∂W⁽ˡ⁾ and ∂L/∂b⁽ˡ⁾ for all layers via the **chain rule**. Define δ⁽ˡ⁾ = ∂L/∂z⁽ˡ⁾ as the error signal at layer l.\n\n**Output layer (L):** For binary cross-entropy L = −[y log(ŷ) + (1−y) log(1−ŷ)] with ŷ = σ(z⁽ᴸ⁾):\n  ∂L/∂ŷ = −y/ŷ + (1−y)/(1−ŷ)\n  ∂ŷ/∂z⁽ᴸ⁾ = σ(z⁽ᴸ⁾)(1 − σ(z⁽ᴸ⁾)) = ŷ(1−ŷ)\n  δ⁽ᴸ⁾ = ∂L/∂z⁽ᴸ⁾ = (∂L/∂ŷ)(∂ŷ/∂z⁽ᴸ⁾) = [−y/ŷ + (1−y)/(1−ŷ)] · ŷ(1−ŷ) = ŷ − y\n\n**Hidden layer (l):** Recursively compute δ⁽ˡ⁾ from δ⁽ˡ⁺¹⁾:\n  ∂L/∂z⁽ˡ⁾ = (∂L/∂z⁽ˡ⁺¹⁾)(∂z⁽ˡ⁺¹⁾/∂a⁽ˡ⁾)(∂a⁽ˡ⁾/∂z⁽ˡ⁾)\n  z⁽ˡ⁺¹⁾ = W⁽ˡ⁺¹⁾a⁽ˡ⁾ + b⁽ˡ⁺¹⁾  ⟹  ∂z⁽ˡ⁺¹⁾/∂a⁽ˡ⁾ = W⁽ˡ⁺¹⁾\n  a⁽ˡ⁾ = σ(z⁽ˡ⁾)  ⟹  ∂a⁽ˡ⁾/∂z⁽ˡ⁾ = σ′(z⁽ˡ⁾)\n  δ⁽ˡ⁾ = (W⁽ˡ⁺¹⁾)ᵀδ⁽ˡ⁺¹⁾ ⊙ σ′(z⁽ˡ⁾)\n\nwhere ⊙ is element-wise multiplication.\n\n**Weight gradients:**\n  ∂L/∂W⁽ˡ⁾ = (∂L/∂z⁽ˡ⁾)(∂z⁽ˡ⁾/∂W⁽ˡ⁾)\n  z⁽ˡ⁾ = W⁽ˡ⁾a⁽ˡ⁻¹⁾ + b⁽ˡ⁾  ⟹  ∂z⁽ˡ⁾/∂W⁽ˡ⁾ = a⁽ˡ⁻¹⁾\n  ∂L/∂W⁽ˡ⁾ = δ⁽ˡ⁾(a⁽ˡ⁻¹⁾)ᵀ\n  ∂L/∂b⁽ˡ⁾ = δ⁽ˡ⁾\n\n**Algorithm:**\n1. Forward: compute a⁽ˡ⁾ for l=1..L, store z⁽ˡ⁾ and a⁽ˡ⁾\n2. Output error: δ⁽ᴸ⁾ = ŷ − y (for BCE + sigmoid)\n3. Backward: for l=L−1 down to 1, compute δ⁽ˡ⁾ = (W⁽ˡ⁺¹⁾)ᵀδ⁽ˡ⁺¹⁾ ⊙ σ′(z⁽ˡ⁾)\n4. Gradients: ∂L/∂W⁽ˡ⁾ = δ⁽ˡ⁾(a⁽ˡ⁻¹⁾)ᵀ, ∂L/∂b⁽ˡ⁾ = δ⁽ˡ⁾\n5. Update: W⁽ˡ⁾ ← W⁽ˡ⁾ − α·∂L/∂W⁽ˡ⁾\n\n**Numerical example (continuing from forward pass):**\nGiven y=1, ŷ=0.535, δ⁽³⁾ = 0.535 − 1 = −0.465\nδ⁽²⁾ = [1.2, −0.8]ᵀ · (−0.465) ⊙ sech²(z⁽²⁾) = [−0.558, 0.372] ⊙ [0.882, 0.839] = [−0.492, 0.312]\n∂L/∂W⁽³⁾ = δ⁽³⁾·[a⁽²⁾]ᵀ = −0.465·[0.343, 0.401] = [−0.159, −0.186]\nW⁽³⁾_new = [1.2, −0.8] − 0.01·[−0.159, −0.186] = [1.202, −0.798] (weights shift to increase ŷ)",
            },
            {
              type: "theory",
              title: "Activation Functions & Weight Initialization",
              content:
                "**Activation Derivatives:**\n- Sigmoid: σ′(z) = σ(z)(1−σ(z)) ∈ [0, 0.25]. For |z| > 3, σ′ ≈ 0 → vanishing gradients in deep nets.\n- Tanh: tanh′(z) = 1 − tanh²(z) = sech²(z) ∈ (0,1]. Zero-centered outputs (mean 0) accelerate convergence vs sigmoid.\n- ReLU: ReLU′(z) = 𝟙{z>0}. Gradient is 1 (not <1), preventing vanishing. Dead ReLU problem: if z<0 always, neuron never updates.\n- Leaky ReLU: f(z) = max(αz, z) with α=0.01. Allows small gradient for z<0, preventing death.\n- GELU: f(z) = z·Φ(z) where Φ is Gaussian CDF. Smooth, used in transformers. Approximation: 0.5z(1 + tanh[√(2/π)(z + 0.044715z³)]).\n\n**Variance Preservation & Initialization:** Consider z⁽ˡ⁾ = W⁽ˡ⁾a⁽ˡ⁻¹⁾. Assume a⁽ˡ⁻¹⁾ᵢ are i.i.d. with mean 0, variance σ²_a, and Wᵢⱼ are i.i.d. with mean 0, variance σ²_w. Then:\n\n  Var(z⁽ˡ⁾ⱼ) = Var(∑ᵢ W⁽ˡ⁾ⱼᵢa⁽ˡ⁻¹⁾ᵢ) = ∑ᵢ Var(W⁽ˡ⁾ⱼᵢ)Var(a⁽ˡ⁻¹⁾ᵢ) = nᵢₙ·σ²_w·σ²_a\n\nFor signal to neither explode nor vanish: Var(z⁽ˡ⁾) ≈ Var(a⁽ˡ⁻¹⁾), require nᵢₙ·σ²_w = 1.\n\n**Xavier (Glorot) initialization (sigmoid/tanh):** Sample W ~ Uniform[−√(6/(nᵢₙ+n_out)), √(6/(nᵢₙ+n_out))], giving Var(W) = 2/(nᵢₙ+n_out). Averages forward/backward variance constraints.\n\n**He initialization (ReLU):** ReLU zeros half the activations, so effective variance is halved. Compensate with W ~ 𝒩(0, 2/nᵢₙ). This preserves variance through ReLU layers.\n\n**Proof:** Let a = ReLU(z) where z ~ 𝒩(0, σ²). Then E[a] = σ√(1/2π), Var(a) = σ²(1 − 1/(2π)) ≈ 0.5σ². So if Var(z) = nᵢₙ·Var(W), then Var(a) ≈ 0.5nᵢₙ·Var(W). For Var(a) ≈ Var(input), need Var(W) = 2/nᵢₙ.",
            },
            {
              type: "intuition",
              title: "Neural Nets as Hierarchical Feature Detectors",
              content:
                "Think of a neural network as a quant team at a trading desk. **Layer 1 analysts** spot atomic patterns: 'long green candle', 'volume spike', 'RSI crossed 30'. **Layer 2 analysts** combine these: 'bullish engulfing with volume confirmation', 'double bottom at support'. **Layer 3 synthesizers** form strategy: 'reversal signal in oversold regime with structural support — probability of upward move: 68%'. Backpropagation is the daily P&L review where each analyst receives feedback: 'Your volume calls were spot-on (+$50k), but your candlestick reads were late (−$20k) — adjust weights'.",
              emoji: "🧠",
            },
            {
              type: "intuition",
              title: "Why Backprop Works: The Credit Assignment Problem",
              content:
                "In a 10-layer network predicting forex direction, if the final prediction is wrong, which of the 10,000 weights caused the error? **Backpropagation solves this.** The chain rule computes exactly how much each weight contributed to the final loss. It's like tracing a losing trade: the final exit was bad (−$500), but was it due to (1) entry signal (layer 1), (2) position sizing (layer 5), or (3) stop-loss logic (layer 9)? Backprop assigns blame proportionally: ∂L/∂W⁽¹⁾ might be small (entry was fine), ∂L/∂W⁽⁹⁾ large (stop was too tight). Each weight then adjusts by its contribution, not blindly.",
              emoji: "🔗",
            },
            {
              type: "code",
              title: "Manual Backpropagation Implementation",
              language: "python",
              code: `import numpy as np

# Sigmoid activation and derivative
def sigmoid(z):
    return 1 / (1 + np.exp(-np.clip(z, -500, 500)))

def sigmoid_deriv(z):
    s = sigmoid(z)
    return s * (1 - s)

# Manual 2-layer network: input(2) → hidden(3) → output(1)
np.random.seed(42)
W1 = np.random.randn(3, 2) * 0.5  # He init: std = sqrt(2/n_in)
b1 = np.zeros((3, 1))
W2 = np.random.randn(1, 3) * 0.5
b2 = np.zeros((1, 1))

# Forward pass: x=[return, sma_ratio], y=1 (price went up)
x = np.array([[0.02], [1.05]])  # 2% return, 5% above SMA
y = 1.0

z1 = W1 @ x + b1           # (3,2)@(2,1) + (3,1) = (3,1)
a1 = np.maximum(0, z1)     # ReLU
z2 = W2 @ a1 + b2          # (1,3)@(3,1) + (1,1) = (1,1)
a2 = sigmoid(z2)           # ŷ ∈ (0,1)

print(f"Forward pass: ŷ = {a2[0,0]:.4f}, target y = {y}")
print(f"z1 = {z1.ravel()}")
print(f"a1 = {a1.ravel()}")
print(f"z2 = {z2[0,0]:.4f}, a2 = {a2[0,0]:.4f}")

# Binary cross-entropy loss: L = -[y log(ŷ) + (1-y) log(1-ŷ)]
loss = -y * np.log(a2 + 1e-8) - (1 - y) * np.log(1 - a2 + 1e-8)
print(f"Loss L = {loss[0,0]:.4f}")

# Backward pass: compute gradients
# Output layer: δ2 = ŷ - y (for BCE + sigmoid)
delta2 = a2 - y  # (1,1)
dW2 = delta2 @ a1.T  # (1,1)@(1,3) = (1,3)
db2 = delta2

# Hidden layer: δ1 = (W2ᵀ δ2) ⊙ ReLU'(z1)
delta1 = (W2.T @ delta2) * (z1 > 0).astype(float)  # (3,1) ⊙ (3,1)
dW1 = delta1 @ x.T  # (3,1)@(1,2) = (3,2)
db1 = delta1

print(f"\\nBackward pass:")
print(f"δ2 (output error) = {delta2[0,0]:.4f}")
print(f"dW2 = {dW2.ravel()}")
print(f"δ1 (hidden error) = {delta1.ravel()}")
print(f"dW1 =\\n{dW1}")

# Gradient descent update
lr = 0.01
W2 -= lr * dW2
b2 -= lr * db2
W1 -= lr * dW1
b1 -= lr * db1

# Forward pass after update
z1_new = W1 @ x + b1
a1_new = np.maximum(0, z1_new)
z2_new = W2 @ a1_new + b2
a2_new = sigmoid(z2_new)
loss_new = -y * np.log(a2_new + 1e-8) - (1 - y) * np.log(1 - a2_new + 1e-8)

print(f"\\nAfter 1 gradient step (lr={lr}):")
print(f"ŷ_new = {a2_new[0,0]:.4f}, Loss_new = {loss_new[0,0]:.4f}")
print(f"Δŷ = {a2_new[0,0] - a2[0,0]:+.4f}, ΔLoss = {loss_new[0,0] - loss[0,0]:+.4f}")`,
              explanation:
                "Manual implementation of forward and backward pass through a 2-layer network. Prints intermediate z, a, δ values. Shows loss decreases after one gradient step, confirming correct derivative computation.",
            },
            {
              type: "code",
              title: "PyTorch Feedforward Net for Forex Direction",
              language: "python",
              code: `import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np
import pandas as pd
from torch.utils.data import DataLoader, TensorDataset

# Set random seed for reproducibility
torch.manual_seed(42)

def prepare_forex_features(df: pd.DataFrame, lookback: int = 20):
    """Extract features: returns, SMA ratio, volatility, RSI"""
    df = df.copy()
    df["returns"] = df["close"].pct_change()
    df["sma_ratio"] = df["close"] / df["close"].rolling(lookback).mean()
    df["volatility"] = df["returns"].rolling(lookback).std()
    
    # Simple RSI
    delta = df["close"].diff()
    gain = delta.where(delta > 0, 0).rolling(14).mean()
    loss = -delta.where(delta < 0, 0).rolling(14).mean()
    rs = gain / (loss + 1e-8)
    df["rsi"] = 100 - 100 / (1 + rs)
    
    # Target: 1 if next bar closes higher
    df["target"] = (df["close"].shift(-1) > df["close"]).astype(float)
    df.dropna(inplace=True)
    
    feature_cols = ["returns", "sma_ratio", "volatility", "rsi"]
    X = torch.tensor(df[feature_cols].values, dtype=torch.float32)
    y = torch.tensor(df["target"].values, dtype=torch.float32).unsqueeze(1)
    return X, y

class ForexDirectionNet(nn.Module):
    def __init__(self, n_features: int, hidden_sizes=[64, 32]):
        super().__init__()
        layers = []
        in_features = n_features
        for h in hidden_sizes:
            layers.extend([
                nn.Linear(in_features, h),
                nn.ReLU(),
            ])
            in_features = h
        layers.extend([
            nn.Linear(in_features, 1),
            nn.Sigmoid(),  # P(price_up) ∈ (0,1)
        ])
        self.net = nn.Sequential(*layers)
        
        # He initialization for ReLU layers
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.kaiming_normal_(m.weight, mode='fan_in', nonlinearity='relu')
                nn.init.zeros_(m.bias)
    
    def forward(self, x):
        return self.net(x)

# Simulate EUR/USD data (replace with real data)
np.random.seed(42)
n = 1000
dates = pd.date_range('2023-01-01', periods=n, freq='1H')
price = 1.10 + np.cumsum(np.random.randn(n) * 0.001)
df = pd.DataFrame({'close': price}, index=dates)

X, y = prepare_forex_features(df)
print(f"Features shape: {X.shape}, Targets shape: {y.shape}")

# Train/val split
split = int(0.8 * len(X))
X_train, y_train = X[:split], y[:split]
X_val, y_val = X[split:], y[split:]

# Model, loss, optimizer
model = ForexDirectionNet(n_features=4, hidden_sizes=[64, 32])
criterion = nn.BCELoss()
optimizer = optim.Adam(model.parameters(), lr=1e-3)

# Training loop
train_loader = DataLoader(TensorDataset(X_train, y_train), batch_size=32, shuffle=True)
for epoch in range(20):
    model.train()
    train_loss = 0.0
    for xb, yb in train_loader:
        ŷ = model(xb)
        loss = criterion(ŷ, yb)
        optimizer.zero_grad()
        loss.backward()  # Backprop: compute ∂L/∂W for all W
        optimizer.step()  # W ← W - lr·∂L/∂W
        train_loss += loss.item() * len(xb)
    
    model.eval()
    with torch.no_grad():
        val_pred = model(X_val)
        val_loss = criterion(val_pred, y_val).item()
        val_acc = ((val_pred > 0.5).float() == y_val).float().mean().item()
    
    if epoch % 5 == 0:
        print(f"Epoch {epoch:2d} | Train Loss: {train_loss/len(X_train):.4f} | Val Loss: {val_loss:.4f} | Val Acc: {val_acc:.3f}")

print(f"\\nFinal validation accuracy: {val_acc:.3%}")`,
              explanation:
                "Production PyTorch implementation: feature engineering (returns, SMA ratio, volatility, RSI), He initialization, Adam optimizer, train/val split, BCE loss. The network learns to predict next-bar direction from technical features.",
            },
            {
              type: "code",
              title: "Activation Function Comparison",
              language: "python",
              code: `import torch
import torch.nn as nn
import matplotlib.pyplot as plt
import numpy as np

# Define activations
def gelu(x):
    """GELU approximation: 0.5x(1 + tanh[√(2/π)(x + 0.044715x³)])"""
    return 0.5 * x * (1 + torch.tanh(np.sqrt(2 / np.pi) * (x + 0.044715 * x**3)))

z = torch.linspace(-5, 5, 200, requires_grad=True)

activations = {
    'Sigmoid': torch.sigmoid(z),
    'Tanh': torch.tanh(z),
    'ReLU': torch.relu(z),
    'LeakyReLU': nn.functional.leaky_relu(z, 0.01),
    'GELU': gelu(z),
}

# Compute gradients
grads = {}
for name, a in activations.items():
    loss = a.sum()
    loss.backward(retain_graph=True)
    grads[name] = z.grad.clone()
    z.grad.zero_()

# Print saturation behavior
print("Activation saturation analysis:")
print(f"{'Activation':<12} | σ(-5)   σ(0)   σ(5)   | σ'(-5)  σ'(0)  σ'(5)")
print("-" * 60)
for name, a in activations.items():
    vals = [a[0].item(), a[100].item(), a[-1].item()]
    grad_vals = [grads[name][0].item(), grads[name][100].item(), grads[name][-1].item()]
    print(f"{name:<12} | {vals[0]:6.3f} {vals[1]:6.3f} {vals[2]:6.3f} | {grad_vals[0]:6.3f} {grad_vals[1]:6.3f} {grad_vals[2]:6.3f}")

print("\\nKey insights:")
print("- Sigmoid/Tanh saturate (σ' → 0) for |z| > 3, causing vanishing gradients")
print("- ReLU has constant gradient 1 for z > 0, avoiding vanishing gradients")
print("- GELU is smooth (differentiable everywhere), used in BERT/GPT models")
print("- LeakyReLU prevents 'dead neurons' by allowing small negative gradient")`,
              explanation:
                "Quantitative comparison of activation functions. Shows sigmoid/tanh saturation (gradient → 0 for large |z|), ReLU constant gradient, GELU smoothness. Explains why ReLU/GELU dominate modern deep learning.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "dl-neural-nets-q1",
                  question: "Why does the Universal Approximation Theorem not guarantee that neural networks will learn in practice?",
                  options: [
                    { id: "dl-neural-nets-q1-a", text: "It only applies to 2-layer networks, not deeper architectures" },
                    { id: "dl-neural-nets-q1-b", text: "It guarantees existence of weights approximating any function, but not that gradient descent will find them" },
                    { id: "dl-neural-nets-q1-c", text: "It requires infinite hidden units, which is computationally impossible" },
                    { id: "dl-neural-nets-q1-d", text: "It only works for continuous activations like sigmoid, not ReLU" },
                  ],
                  correctOptionId: "dl-neural-nets-q1-b",
                  explanation:
                    "The theorem is an existence proof: optimal weights exist in principle. But gradient descent may get stuck in local minima, require too many iterations, or need more hidden units than practical. Approximation ≠ learnability.",
                },
                {
                  id: "dl-neural-nets-q2",
                  question: "In backpropagation, why does the gradient δ⁽ˡ⁾ = (W⁽ˡ⁺¹⁾)ᵀδ⁽ˡ⁺¹⁾ ⊙ σ′(z⁽ˡ⁾) vanish for deep sigmoid networks?",
                  options: [
                    { id: "dl-neural-nets-q2-a", text: "The term (W⁽ˡ⁺¹⁾)ᵀ grows exponentially with depth" },
                    { id: "dl-neural-nets-q2-b", text: "The element-wise product ⊙ σ′(z⁽ˡ⁾) multiplies by values < 0.25 each layer, exponentially shrinking the gradient" },
                    { id: "dl-neural-nets-q2-c", text: "The chain rule compounds additive noise at each layer" },
                    { id: "dl-neural-nets-q2-d", text: "Sigmoid outputs are always positive, preventing negative gradients" },
                  ],
                  correctOptionId: "dl-neural-nets-q2-b",
                  explanation:
                    "For sigmoid, σ′(z) ≤ 0.25. After L layers, gradient scales by ~(0.25)ᴸ → 0. For L=10, factor is ~10⁻⁶. ReLU avoids this because ReLU′(z) = 1 for z > 0.",
                },
                {
                  id: "dl-neural-nets-q3",
                  question: "A 3-layer ReLU network is initialized with W ~ 𝒩(0, 0.01). After forward pass, activations a⁽³⁾ ≈ 0. What's wrong?",
                  options: [
                    { id: "dl-neural-nets-q3-a", text: "Learning rate is too high, causing exploding gradients" },
                    { id: "dl-neural-nets-q3-b", text: "Variance 0.01 is too small; signal shrinks each layer. Should use He init Var(W) = 2/nᵢₙ" },
                    { id: "dl-neural-nets-q3-c", text: "ReLU requires batch normalization to prevent vanishing activations" },
                    { id: "dl-neural-nets-q3-d", text: "The network needs a bias term to shift activations away from zero" },
                  ],
                  correctOptionId: "dl-neural-nets-q3-b",
                  explanation:
                    "With Var(W) = 0.01, after L layers variance scales by (nᵢₙ·0.01)ᴸ. For nᵢₙ=100, this is 0. He init Var(W)=2/nᵢₙ preserves variance through ReLU layers.",
                },
                {
                  id: "dl-neural-nets-q4",
                  question: "For forex direction prediction (binary classification), why is binary cross-entropy preferred over MSE?",
                  options: [
                    { id: "dl-neural-nets-q4-a", text: "MSE is only defined for regression, not classification" },
                    { id: "dl-neural-nets-q4-b", text: "BCE gradient is ŷ−y (proportional to error), while MSE gradient with sigmoid saturates when confident & wrong" },
                    { id: "dl-neural-nets-q4-c", text: "BCE is faster to compute than MSE" },
                    { id: "dl-neural-nets-q4-d", text: "MSE does not support probabilistic outputs" },
                  ],
                  correctOptionId: "dl-neural-nets-q4-b",
                  explanation:
                    "For MSE L=(ŷ−y)² with sigmoid output, ∂L/∂z = (ŷ−y)·ŷ(1−ŷ). When ŷ≈0 or ŷ≈1, gradient → 0 even if wrong. BCE gives ∂L/∂z = ŷ−y always, avoiding saturation.",
                },
                {
                  id: "dl-neural-nets-q5",
                  question: "Given a 5-layer network where all ReLU activations in layer 3 are zero, what will happen during backprop?",
                  options: [
                    { id: "dl-neural-nets-q5-a", text: "Gradients will flow normally; ReLU′(0) = 0.5 provides partial gradient" },
                    { id: "dl-neural-nets-q5-b", text: "Gradient will be blocked: ReLU′(z) = 0 for z ≤ 0, so δ⁽³⁾ = 0, preventing updates to layers 1-2" },
                    { id: "dl-neural-nets-q5-c", text: "Only layer 3 weights won't update; layers 1-2 will update normally" },
                    { id: "dl-neural-nets-q5-d", text: "Backpropagation will skip layer 3 and connect layers 2 and 4 directly" },
                  ],
                  correctOptionId: "dl-neural-nets-q5-b",
                  explanation:
                    "If a⁽³⁾ = 0 everywhere, then z⁽³⁾ ≤ 0, so ReLU′(z⁽³⁾) = 0. Thus δ⁽³⁾ = (W⁽⁴⁾)ᵀδ⁽⁴⁾ ⊙ 0 = 0. Gradient cannot flow to earlier layers — 'dead ReLU' problem.",
                },
                {
                  id: "dl-neural-nets-q6",
                  question: "Why do deeper networks often outperform wider networks with the same total parameter count?",
                  options: [
                    { id: "dl-neural-nets-q6-a", text: "Deeper networks train faster due to shorter gradient paths" },
                    { id: "dl-neural-nets-q6-b", text: "Depth enables hierarchical feature composition; representing complex functions requires exponentially fewer parameters than width alone" },
                    { id: "dl-neural-nets-q6-c", text: "Deeper networks have more activation functions, increasing non-linearity" },
                    { id: "dl-neural-nets-q6-d", text: "Wider networks suffer from more overfitting than deeper networks" },
                  ],
                  correctOptionId: "dl-neural-nets-q6-b",
                  explanation:
                    "Deep nets compose features hierarchically: layer l builds on layer l−1. Many functions (e.g., parity, decision trees) require O(2ⁿ) width in 2 layers but only O(n) parameters across O(log n) layers. Depth = compositional efficiency.",
                },
                {
                  id: "dl-neural-nets-q7",
                  question: "In a forex forecasting network, after 100 epochs, training accuracy is 95% but validation accuracy is 52%. What's the likely issue?",
                  options: [
                    { id: "dl-neural-nets-q7-a", text: "Learning rate is too low; the model hasn't converged yet" },
                    { id: "dl-neural-nets-q7-b", text: "Severe overfitting: model memorized training noise. Need regularization (dropout, weight decay) or simpler architecture" },
                    { id: "dl-neural-nets-q7-c", text: "Validation set is too small to give reliable accuracy estimates" },
                    { id: "dl-neural-nets-q7-d", text: "The network needs more hidden layers to capture forex dynamics" },
                  ],
                  correctOptionId: "dl-neural-nets-q7-b",
                  explanation:
                    "95% train vs 52% val (barely better than random for binary classification) indicates overfitting. The model learned training-specific patterns (noise) that don't generalize. Solutions: dropout, L2 regularization, early stopping, more data, simpler model.",
                },
              ],
            },
            {
              type: "practice",
              title: "Implement Backprop from Scratch",
              description:
                "Code a 3-layer feedforward network (2 hidden layers) in pure NumPy with manual forward and backward pass. Compare your gradients against PyTorch autograd using torch.autograd.gradcheck. Verify ‖∇_manual − ∇_torch‖ < 10⁻⁶ for all weight matrices.",
              tasks: [
                "Implement forward(x, W, b) returning all activations and pre-activations z⁽ˡ⁾, a⁽ˡ⁾",
                "Implement backward(y, ŷ, z, a, W) returning ∂L/∂W⁽ˡ⁾ and ∂L/∂b⁽ˡ⁾ for all layers",
                "Use finite differences to verify gradients: (L(W+ε) − L(W−ε))/(2ε) ≈ ∂L/∂W",
                "Compare with PyTorch: model = nn.Sequential(...); loss.backward(); check W.grad matches your ∂L/∂W",
              ],
            },
            {
              type: "practice",
              title: "Activation Function Ablation Study",
              description:
                "Train 5 identical forex direction classifiers (same architecture, data, optimizer) differing only in activation: (1) sigmoid, (2) tanh, (3) ReLU, (4) Leaky ReLU (α=0.01), (5) GELU. Report final validation accuracy, training time, and gradient norm statistics. Identify which activations suffer from vanishing/exploding gradients.",
              tasks: [
                "Prepare EUR/USD 1H data with features: returns, SMA ratio, ATR, RSI, MACD",
                "Build a 5-layer network (input → 128 → 64 → 32 → 16 → 1) for each activation",
                "Track gradient norms per layer: torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=float('inf'), norm_type=2) returns total norm",
                "Plot gradient norms over training. Sigmoid/tanh should show vanishing (norms → 0), ReLU should be stable",
                "Report which activation achieves highest validation accuracy and trains fastest",
              ],
            },
          ],
        },
        {
          id: "dl-regularization",
          title: "Regularization & Generalization",
          description:
            "Learn essential techniques to prevent overfitting — dropout, batch normalisation, learning rate scheduling, early stopping, and weight decay — with full mathematical foundations and bias-variance decomposition.",
          estimatedMinutes: 85,
          difficulty: "advanced",
          sections: [
            {
              type: "objective",
              title: "Master Regularization Techniques",
              description:
                "Understand the bias-variance tradeoff, derive regularization methods from first principles, and implement production-ready training loops with dropout, batch normalization, weight decay, learning rate schedules, and early stopping.",
              keyTakeaways: [
                "Bias-variance decomposition: E[(y − ŷ)²] = Bias²(ŷ) + Var(ŷ) + σ²_noise. Regularization trades bias for reduced variance.",
                "Dropout zeroes neurons with probability p during training: ĥ = m ⊙ h / (1−p) where m ~ Bernoulli(1−p). Acts as approximate Bayesian model averaging.",
                "Batch normalization: x̂ = (x − μ_B) / √(σ²_B + ε), then y = γx̂ + β reduces internal covariate shift and smooths loss landscape",
                "L2 weight decay L_total = L_data + (λ/2)‖θ‖² shrinks weights toward zero, equivalent to Gaussian prior p(θ) ~ 𝒩(0, 1/λ)",
                "L1 regularization L_total = L_data + λ‖θ‖₁ promotes sparsity via soft thresholding, useful for feature selection",
                "Cosine annealing: α_t = α_min + ½(α_max − α_min)(1 + cos(πt/T)) with warm restarts helps escape local minima",
                "Early stopping implicitly regularizes by halting before overfitting — equivalent to constrained optimization with iterations as budget",
                "Data augmentation for time series: jittering, window slicing, mixup increase effective training set size",
              ],
            },
            {
              type: "theory",
              title: "Bias-Variance Decomposition",
              content:
                "Consider a model ŷ(x; θ) trained on dataset 𝒟 to predict target y = f(x) + ε where ε ~ 𝒩(0, σ²) is irreducible noise. The **expected prediction error** over datasets 𝒟 and test points x is:\n\n  E_𝒟,x,ε[(y − ŷ)²] = E_𝒟,x[(f(x) − E_𝒟[ŷ])²] + E_𝒟,x[Var_𝒟(ŷ)] + σ²\n                    = Bias²(ŷ) + Var(ŷ) + Irreducible Error\n\n**Derivation:** Let ȳ = E_𝒟[ŷ(x)]. Then:\n  E[(y − ŷ)²] = E[(y − ȳ + ȳ − ŷ)²]\n              = E[(y − ȳ)²] + E[(ȳ − ŷ)²] + 2E[(y − ȳ)(ȳ − ŷ)]\n\nNote E[(y − ȳ)(ȳ − ŷ)] = E_y[(y − ȳ)]·E_𝒟[(ȳ − ŷ)] = 0 (cross term vanishes). Since y = f(x) + ε:\n  E[(y − ȳ)²] = E[(f − ȳ + ε)²] = (f − ȳ)² + σ²  (since E[ε] = 0)\n  E[(ȳ − ŷ)²] = Var(ŷ)\n\n**Interpretation:**\n- **Bias²**: Systematic error from model assumptions. Underfitting → high bias.\n- **Variance**: Sensitivity to training set fluctuations. Overfitting → high variance.\n- **Irreducible Error**: Noise inherent to the problem.\n\n**Regularization reduces variance** at the cost of increased bias. Example: A complex model (10-layer net) has low bias (can represent true function) but high variance (sensitive to noise). Adding dropout/L2 constraints the hypothesis class, increasing bias but reducing variance — often lowering total error.\n\n**Forex example:** Without regularization, a neural net memorizes every 2018 volatility spike, achieving perfect training accuracy but failing on 2023 data (high variance). With L2 penalty, the net learns smooth price dynamics generalizing across regimes (low variance, slight bias).",
            },
            {
              type: "theory",
              title: "Dropout: Theory & Derivation",
              content:
                "**Dropout (Srivastava et al. 2014)** randomly drops units with probability p during training. For hidden layer h ∈ ℝⁿ:\n\nTraining: Sample mask m ~ Bernoulli(1−p)ⁿ, compute ĥ = (m ⊙ h) / (1−p)\nInference: Use ĥ = h (no dropout, no scaling)\n\nThe scaling factor 1/(1−p) ensures E[ĥ] = E[h] regardless of dropout.\n\n**Proof of expectation preservation:**\n  E[ĥᵢ] = E[(mᵢhᵢ)/(1−p)] = E[mᵢ]·hᵢ/(1−p) = (1−p)·hᵢ/(1−p) = hᵢ\n\n**Interpretation as Model Averaging:** Training with dropout samples 2ⁿ different thinned networks (each subset of active neurons is a subnetwork). The final network at inference approximates averaging predictions from all 2ⁿ models — a form of **ensemble learning**. Since each subnetwork sees different feature combinations, the ensemble is robust to individual feature failures.\n\n**Connection to Bayesian Deep Learning:** Dropout approximates a variational Bayesian approach where weights have multiplicative Gaussian noise. Specifically, dropout with p=0.5 corresponds to placing a spike-and-slab prior on activations.\n\n**Geometric L2 Interpretation:** Dropout acts like L2 regularization on the activations. For linear layers y = Wx + b, dropout on x is equivalent to training on a corrupted version x̃, which induces a penalty proportional to ‖W‖²_F (Frobenius norm).\n\n**Practical guidelines:**\n- Hidden layers: p ∈ [0.2, 0.5]. Higher p → stronger regularization.\n- Input layers: p ∈ [0.1, 0.2] (mild corruption).\n- Output layers: no dropout (breaks calibration).\n- For forex: p=0.3 is a good default for noisy financial data.",
            },
            {
              type: "theory",
              title: "Batch Normalization: Forward & Backward Pass",
              content:
                "**Batch Normalization (Ioffe & Szegedy 2015)** normalizes activations to zero mean and unit variance per mini-batch, then applies learned affine transformation.\n\n**Forward pass (training):** For mini-batch B = {x₁, …, x_m}:\n1. Compute batch statistics:\n   μ_B = (1/m)∑ᵢ xᵢ\n   σ²_B = (1/m)∑ᵢ (xᵢ − μ_B)²\n2. Normalize: x̂ᵢ = (xᵢ − μ_B) / √(σ²_B + ε)  where ε ≈ 10⁻⁵ prevents division by zero\n3. Scale & shift: yᵢ = γx̂ᵢ + β  where γ, β are learnable parameters\n\n**Inference:** Use running averages μ_running, σ²_running (exponential moving average during training):\n   x̂ = (x − μ_running) / √(σ²_running + ε)\n   y = γx̂ + β\n\n**Backward pass gradients:**\n  ∂L/∂γ = ∑ᵢ (∂L/∂yᵢ)·x̂ᵢ\n  ∂L/∂β = ∑ᵢ (∂L/∂yᵢ)\n  ∂L/∂x̂ᵢ = (∂L/∂yᵢ)·γ\n  ∂L/∂σ²_B = ∑ᵢ (∂L/∂x̂ᵢ)·(xᵢ − μ_B)·(−½)(σ²_B + ε)⁻³/²\n  ∂L/∂μ_B = ∑ᵢ (∂L/∂x̂ᵢ)·(−1/√(σ²_B + ε)) + (∂L/∂σ²_B)·(−2/m)∑ⱼ(xⱼ − μ_B)\n  ∂L/∂xᵢ = (∂L/∂x̂ᵢ)/√(σ²_B + ε) + (∂L/∂σ²_B)·(2/m)(xᵢ − μ_B) + (∂L/∂μ_B)/m\n\n**Why it works:**\n1. **Reduces internal covariate shift:** Distribution of layer inputs stays stable as earlier layers update.\n2. **Smooths loss landscape:** Normalization makes loss less sensitive to parameter scale, enabling higher learning rates.\n3. **Implicit regularization:** Batch statistics add noise (like dropout), reducing overfitting.\n\n**Layer Norm vs Batch Norm:** For sequences (RNNs, Transformers), **Layer Norm** normalizes across features (not batch), avoiding dependence on batch size and temporal structure.",
            },
            {
              type: "theory",
              title: "Weight Decay & L1/L2 Regularization",
              content:
                "**L2 Regularization (Ridge):** Add penalty λ/2·∑θᵢ² to loss:\n  L_total(θ) = L_data(θ) + (λ/2)‖θ‖²\n  ∇L_total = ∇L_data + λθ\nGradient descent: θ ← θ − α(∇L_data + λθ) = (1 − αλ)θ − α∇L_data\n\n**Weight decay interpretation:** Each update shrinks weights by factor (1 − αλ) before applying gradient. For αλ ≪ 1, weights decay exponentially toward zero unless gradient compensates.\n\n**Bayesian view:** L2 is equivalent to MAP estimation with Gaussian prior p(θ) = 𝒩(0, 1/λ). Minimizing −log p(θ|𝒟) = −log p(𝒟|θ) − log p(θ) gives L_data + (λ/2)‖θ‖².\n\n**Geometric interpretation:** L2 penalty constrains optimization to ‖θ‖² ≤ C. The feasible region is a hypersphere; solutions tend to have all weights small but non-zero.\n\n**L1 Regularization (Lasso):** Penalty λ‖θ‖₁ = λ∑|θᵢ|\n  L_total(θ) = L_data(θ) + λ‖θ‖₁\nSubgradient (since |·| is non-differentiable at 0):\n  ∂L_total/∂θᵢ = ∂L_data/∂θᵢ + λ·sign(θᵢ)\n\n**Soft thresholding:** For simple quadratic loss L = ½(y − θ)², the L1-regularized solution is:\n  θ* = sign(y)·max(|y| − λ, 0)\nThis **zeros out** weights with |∇L_data| < λ, promoting **sparsity**. Useful for feature selection in high-dimensional forex data (e.g., selecting relevant indicators from 100+ candidates).\n\n**Geometric interpretation:** L1 penalty constrains to ‖θ‖₁ ≤ C, a diamond-shaped region. The sharp corners intersect coordinate axes, driving many θᵢ exactly to zero.\n\n**ElasticNet:** Combines L1 + L2: λ₁‖θ‖₁ + λ₂‖θ‖². Balances sparsity (L1) with stability (L2).",
            },
            {
              type: "intuition",
              title: "Regularization as Noise Injection",
              content:
                "Think of an overfitting model as a student memorizing the exact wording of practice problems instead of learning principles. **Dropout** is like randomly hiding parts of the notes — the student must learn robust patterns, not specific phrasings. **Batch norm** is like standardizing test scores across classes — prevents one loud class (large activations) from dominating. **Weight decay** is like penalizing overly complex answers — Occam's razor prefers simple explanations. **Early stopping** is knowing when to stop studying — beyond a point, you're memorizing typos in the textbook, not learning. For forex: without regularization, the model memorizes '2018 volatility spike at 14:37 GMT on Jan 12' instead of learning 'volatility spikes often precede reversals'.",
              emoji: "🛡️",
            },
            {
              type: "intuition",
              title: "Bias-Variance as Dart Throwing",
              content:
                "Imagine throwing darts at a bullseye (true function f). **High bias, low variance:** All darts cluster together but miss the bullseye (systematic error, underfitting — like using a linear model for non-linear data). **Low bias, high variance:** Darts scatter widely around the bullseye (overfitting — model changes drastically with different training sets). **Ideal:** Low bias AND low variance — darts cluster tightly on the bullseye. Regularization reduces variance (tightens dart spread) by constraining where darts can land (e.g., weight decay forces small weights), accepting slight bias (darts shift slightly off-center) for better overall accuracy.",
              emoji: "🎯",
            },
            {
              type: "code",
              title: "Dropout from Scratch",
              language: "python",
              code: `import torch
import torch.nn as nn

class ManualDropout(nn.Module):
    def __init__(self, p=0.5):
        super().__init__()
        self.p = p  # dropout probability
    
    def forward(self, x):
        if not self.training:
            return x  # No dropout during inference
        
        # Sample Bernoulli mask: 1 with prob (1-p), 0 with prob p
        mask = torch.bernoulli(torch.full_like(x, 1 - self.p))
        # Scale by 1/(1-p) to preserve expectation
        return (x * mask) / (1 - self.p)

# Test expectation preservation
torch.manual_seed(42)
x = torch.randn(10000, 128)  # Large batch
dropout = ManualDropout(p=0.3)
dropout.train()

# Apply dropout 1000 times, check mean
x_dropped_sum = torch.zeros_like(x[0])
for _ in range(1000):
    x_dropped_sum += dropout(x).mean(dim=0)
x_dropped_avg = x_dropped_sum / 1000

print(f"Original mean: {x.mean():.4f}, std: {x.std():.4f}")
print(f"Dropout mean (averaged over 1000 runs): {x_dropped_avg.mean():.4f}")
print(f"Mean preservation error: {(x.mean(dim=0) - x_dropped_avg).abs().mean():.6f}")

# Compare to PyTorch implementation
dropout_torch = nn.Dropout(p=0.3)
dropout_torch.train()
x_torch = dropout_torch(x)
print(f"\\nPyTorch Dropout mean: {x_torch.mean():.4f}, std: {x_torch.std():.4f}")

# Test inference mode
dropout.eval()
x_inference = dropout(x)
print(f"\\nInference mode (no dropout): mean diff = {(x - x_inference).abs().max():.10f}")`,
              explanation:
                "Manual dropout implementation showing Bernoulli sampling, scaling by 1/(1−p), and train/eval mode switching. Verifies expectation preservation: E[dropout(x)] ≈ x over many forward passes.",
            },
            {
              type: "code",
              title: "Batch Normalization from Scratch",
              language: "python",
              code: `import torch
import torch.nn as nn

class ManualBatchNorm1d(nn.Module):
    def __init__(self, num_features, eps=1e-5, momentum=0.1):
        super().__init__()
        self.eps = eps
        self.momentum = momentum
        
        # Learnable parameters
        self.gamma = nn.Parameter(torch.ones(num_features))   # scale
        self.beta = nn.Parameter(torch.zeros(num_features))   # shift
        
        # Running statistics (not learned, updated during training)
        self.register_buffer('running_mean', torch.zeros(num_features))
        self.register_buffer('running_var', torch.ones(num_features))
    
    def forward(self, x):
        # x: (batch_size, num_features)
        if self.training:
            # Compute batch statistics
            batch_mean = x.mean(dim=0)
            batch_var = x.var(dim=0, unbiased=False)  # biased estimator (divide by N, not N-1)
            
            # Normalize
            x_hat = (x - batch_mean) / torch.sqrt(batch_var + self.eps)
            
            # Update running statistics with exponential moving average
            self.running_mean = (1 - self.momentum) * self.running_mean + self.momentum * batch_mean
            self.running_var = (1 - self.momentum) * self.running_var + self.momentum * batch_var
        else:
            # Inference: use running statistics
            x_hat = (x - self.running_mean) / torch.sqrt(self.running_var + self.eps)
        
        # Scale and shift
        y = self.gamma * x_hat + self.beta
        return y

# Test
torch.manual_seed(42)
batch_size, num_features = 32, 10
x = torch.randn(batch_size, num_features) * 5 + 10  # mean≈10, std≈5

manual_bn = ManualBatchNorm1d(num_features)
torch_bn = nn.BatchNorm1d(num_features)

# Training mode
manual_bn.train()
torch_bn.train()
y_manual = manual_bn(x)
y_torch = torch_bn(x)

print("Training mode:")
print(f"Manual BN output: mean={y_manual.mean():.4f}, std={y_manual.std():.4f}")
print(f"PyTorch BN output: mean={y_torch.mean():.4f}, std={y_torch.std():.4f}")
print(f"Normalized features should have ~0 mean, ~1 std (before γ, β)")

# Check normalization worked
x_normalized = (x - x.mean(dim=0)) / torch.sqrt(x.var(dim=0, unbiased=False) + 1e-5)
print(f"Direct normalization: mean={x_normalized.mean():.4f}, std={x_normalized.std():.4f}")

# Inference mode (after training on a few batches)
manual_bn.eval()
for _ in range(10):  # Simulate training on 10 batches to populate running stats
    manual_bn.train()
    manual_bn(torch.randn(batch_size, num_features) * 5 + 10)

manual_bn.eval()
x_test = torch.randn(5, num_features) * 5 + 10
y_test = manual_bn(x_test)
print(f"\\nInference mode output: mean={y_test.mean():.4f}, std={y_test.std():.4f}")
print(f"Running mean: {manual_bn.running_mean[:3]}")
print(f"Running var: {manual_bn.running_var[:3]}")`,
              explanation:
                "Full BatchNorm implementation with batch statistics, running averages, learnable γ/β, and train/eval mode switching. Shows normalized activations have ~0 mean, ~1 std during training.",
            },
            {
              type: "code",
              title: "Production Training Loop with All Regularization",
              language: "python",
              code: `import torch
import torch.nn as nn
import torch.optim as optim
from torch.optim.lr_scheduler import CosineAnnealingWarmRestarts
from torch.utils.data import DataLoader, TensorDataset
import numpy as np

class RegularizedForexNet(nn.Module):
    def __init__(self, n_features, hidden_sizes=[128, 64, 32], dropout_p=0.3):
        super().__init__()
        layers = []
        in_dim = n_features
        for h in hidden_sizes:
            layers.extend([
                nn.Linear(in_dim, h),
                nn.BatchNorm1d(h),
                nn.ReLU(),
                nn.Dropout(p=dropout_p),
            ])
            in_dim = h
        layers.extend([nn.Linear(in_dim, 1), nn.Sigmoid()])
        self.net = nn.Sequential(*layers)
    
    def forward(self, x):
        return self.net(x)

# Simulate data
torch.manual_seed(42)
n_samples, n_features = 5000, 10
X = torch.randn(n_samples, n_features)
y = (X[:, 0] + 0.5 * X[:, 1] - 0.3 * X[:, 2] > 0).float().unsqueeze(1)

# Train/val split
split = int(0.8 * n_samples)
X_train, y_train = X[:split], y[:split]
X_val, y_val = X[split:], y[split:]

train_loader = DataLoader(TensorDataset(X_train, y_train), batch_size=64, shuffle=True)

# Model with L2 weight decay
model = RegularizedForexNet(n_features, dropout_p=0.3)
criterion = nn.BCELoss()
optimizer = optim.AdamW(model.parameters(), lr=1e-3, weight_decay=1e-4)  # L2 via weight_decay
scheduler = CosineAnnealingWarmRestarts(optimizer, T_0=10, T_mult=2)

# Early stopping
best_val_loss = float('inf')
patience = 10
patience_counter = 0
best_state = None

print("Epoch | Train Loss | Val Loss | Val Acc | LR")
print("-" * 50)

for epoch in range(100):
    # Training
    model.train()
    train_loss = 0.0
    for xb, yb in train_loader:
        ŷ = model(xb)
        loss = criterion(ŷ, yb)
        
        optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)  # Gradient clipping
        optimizer.step()
        
        train_loss += loss.item() * len(xb)
    
    train_loss /= len(X_train)
    
    # Validation
    model.eval()
    with torch.no_grad():
        val_pred = model(X_val)
        val_loss = criterion(val_pred, y_val).item()
        val_acc = ((val_pred > 0.5).float() == y_val).float().mean().item()
    
    # Learning rate schedule
    scheduler.step()
    current_lr = optimizer.param_groups[0]['lr']
    
    # Early stopping
    if val_loss < best_val_loss:
        best_val_loss = val_loss
        patience_counter = 0
        best_state = model.state_dict().copy()
    else:
        patience_counter += 1
        if patience_counter >= patience:
            print(f"Early stopping at epoch {epoch}")
            break
    
    if epoch % 5 == 0:
        print(f"{epoch:5d} | {train_loss:10.4f} | {val_loss:8.4f} | {val_acc:7.3f} | {current_lr:.6f}")

# Restore best model
if best_state is not None:
    model.load_state_dict(best_state)
    
print(f"\\nBest validation loss: {best_val_loss:.4f}")
print(f"Final validation accuracy: {val_acc:.3%}")

# Analyze regularization effect
print(f"\\nWeight statistics:")
for name, param in model.named_parameters():
    if 'weight' in name:
        print(f"{name}: mean={param.data.abs().mean():.4f}, max={param.data.abs().max():.4f}")`,
              explanation:
                "Complete training pipeline: Dropout + BatchNorm + AdamW (L2 weight decay) + cosine annealing LR + gradient clipping + early stopping. Tracks train/val loss, implements patience-based stopping, saves best weights.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "dl-regularization-q1",
                  question: "In the bias-variance decomposition, what is the effect of increasing L2 regularization λ?",
                  options: [
                    { id: "dl-regularization-q1-a", text: "Decreases both bias and variance" },
                    { id: "dl-regularization-q1-b", text: "Increases bias, decreases variance — trading flexibility for stability" },
                    { id: "dl-regularization-q1-c", text: "Decreases bias, increases variance" },
                    { id: "dl-regularization-q1-d", text: "Only affects irreducible error, not bias or variance" },
                  ],
                  correctOptionId: "dl-regularization-q1-b",
                  explanation:
                    "L2 regularization constrains the hypothesis class (smaller weights → simpler models), increasing bias but reducing sensitivity to training data (lower variance). Total error may decrease if variance reduction exceeds bias increase.",
                },
                {
                  id: "dl-regularization-q2",
                  question: "Why must dropout scale activations by 1/(1−p) during training?",
                  options: [
                    { id: "dl-regularization-q2-a", text: "To prevent gradient vanishing in deep networks" },
                    { id: "dl-regularization-q2-b", text: "To preserve the expected value E[ĥ] = E[h], ensuring consistent scale between train and inference" },
                    { id: "dl-regularization-q2-c", text: "To increase the effective dropout probability for better regularization" },
                    { id: "dl-regularization-q2-d", text: "Scaling is only needed during inference, not training" },
                  ],
                  correctOptionId: "dl-regularization-q2-b",
                  explanation:
                    "Without scaling, E[m⊙h] = (1−p)E[h] ≠ E[h]. Dividing by (1−p) makes E[(m⊙h)/(1−p)] = E[h], so inference (no dropout) and training (with dropout) produce same expected activations.",
                },
                {
                  id: "dl-regularization-q3",
                  question: "During inference, batch normalization uses running averages instead of batch statistics. Why?",
                  options: [
                    { id: "dl-regularization-q3-a", text: "Batch statistics are too slow to compute during inference" },
                    { id: "dl-regularization-q3-b", text: "Inference may process single samples (batch_size=1) or test batches with different distributions; running averages provide stable normalization" },
                    { id: "dl-regularization-q3-c", text: "Running averages have higher variance, improving model robustness" },
                    { id: "dl-regularization-q3-d", text: "Batch normalization is disabled entirely during inference" },
                  ],
                  correctOptionId: "dl-regularization-q3-b",
                  explanation:
                    "At inference, batch size may be 1 (undefined batch statistics) or test distribution may differ from training. Running averages (exponential moving average of training batch stats) provide stable, population-level normalization.",
                },
                {
                  id: "dl-regularization-q4",
                  question: "What is the key difference between L1 and L2 regularization in terms of solution geometry?",
                  options: [
                    { id: "dl-regularization-q4-a", text: "L1 has no geometric interpretation; it's purely algorithmic" },
                    { id: "dl-regularization-q4-b", text: "L1 (diamond) constraint has sharp corners that encourage sparse solutions; L2 (sphere) encourages small but non-zero weights" },
                    { id: "dl-regularization-q4-c", text: "L2 produces sparser solutions than L1" },
                    { id: "dl-regularization-q4-d", text: "Both have identical geometric interpretations" },
                  ],
                  correctOptionId: "dl-regularization-q4-b",
                  explanation:
                    "L1 constraint ‖θ‖₁ ≤ C is a diamond in 2D (rhombus), with corners on axes. Loss contours often intersect corners → some θᵢ = 0 (sparsity). L2 constraint ‖θ‖² ≤ C is a circle; intersection yields small but non-zero weights.",
                },
                {
                  id: "dl-regularization-q5",
                  question: "Why does cosine annealing with warm restarts help escape local minima in non-convex forex loss landscapes?",
                  options: [
                    { id: "dl-regularization-q5-a", text: "It guarantees finding the global minimum" },
                    { id: "dl-regularization-q5-b", text: "Periodically increasing LR allows the optimizer to jump out of sharp local minima, exploring new regions" },
                    { id: "dl-regularization-q5-c", text: "It reduces training time by using higher learning rates throughout" },
                    { id: "dl-regularization-q5-d", text: "Warm restarts improve gradient estimation accuracy" },
                  ],
                  correctOptionId: "dl-regularization-q5-b",
                  explanation:
                    "Cosine annealing periodically raises LR from α_min to α_max. High LR enables large steps, escaping narrow local minima. Then LR decays, allowing fine-tuning. This cycle repeats, exploring multiple basins — valuable for noisy, multimodal forex loss surfaces.",
                },
                {
                  id: "dl-regularization-q6",
                  question: "A forex model achieves 0.02 training loss but 0.45 validation loss. Which regularization technique is MOST likely to help?",
                  options: [
                    { id: "dl-regularization-q6-a", text: "Increase learning rate to converge faster" },
                    { id: "dl-regularization-q6-b", text: "Add dropout (p=0.3-0.5) and L2 weight decay to reduce overfitting" },
                    { id: "dl-regularization-q6-c", text: "Remove batch normalization to increase model capacity" },
                    { id: "dl-regularization-q6-d", text: "Train for more epochs to reduce validation loss" },
                  ],
                  correctOptionId: "dl-regularization-q6-b",
                  explanation:
                    "Huge train-val gap (0.02 vs 0.45) indicates severe overfitting. Dropout and L2 directly reduce variance by constraining the model. Increasing LR or training longer would worsen overfitting. Removing BatchNorm might hurt, but won't address overfitting.",
                },
                {
                  id: "dl-regularization-q7",
                  question: "Early stopping is often described as 'implicit regularization'. Why?",
                  options: [
                    { id: "dl-regularization-q7-a", text: "It adds an explicit penalty term to the loss function" },
                    { id: "dl-regularization-q7-b", text: "Halting training early constrains the effective parameter search, equivalent to limiting optimization budget — a form of capacity control" },
                    { id: "dl-regularization-q7-c", text: "It changes the model architecture to be simpler" },
                    { id: "dl-regularization-q7-d", text: "Early stopping is not a regularization technique at all" },
                  ],
                  correctOptionId: "dl-regularization-q7-b",
                  explanation:
                    "Early stopping doesn't modify the loss, but constrains how far optimization proceeds. Stopping at iteration T is like constraining ‖θ − θ₀‖ ≤ f(T). Prevents overfitting by not exploring full parameter space — regularization via optimization constraint.",
                },
              ],
            },
            {
              type: "practice",
              title: "Bias-Variance Decomposition Experiment",
              description:
                "Empirically estimate bias, variance, and total error for forex direction prediction under different regularization strengths. Train 50 models with different random seeds for each λ ∈ {0, 10⁻⁵, 10⁻⁴, 10⁻³, 10⁻²}, compute E[ŷ], Var[ŷ], and MSE. Plot bias² and variance vs λ — observe the tradeoff.",
              tasks: [
                "Generate synthetic forex data: y = sign(0.3·x₁ − 0.5·x₂ + ε) with ε ~ 𝒩(0, 0.1)",
                "For each λ, train 50 models (different weight init) on same training set",
                "On fixed test set, compute ŷᵢ for each model, then ȳ = mean(ŷᵢ), Var(ŷ) = var(ŷᵢ)",
                "Bias² = E[(f(x) − ȳ)²], Variance = E[Var(ŷ)], Total = Bias² + Variance",
                "Plot curves: x-axis = log(λ), y-axis = {Bias², Variance, Total Error}. Identify optimal λ.",
              ],
            },
            {
              type: "practice",
              title: "Regularization Ablation on Live Forex Data",
              description:
                "Train EUR/USD direction classifiers under 8 configurations: (1) none, (2) dropout only, (3) BatchNorm only, (4) L2 only, (5) dropout+BN, (6) dropout+L2, (7) BN+L2, (8) all. Use same architecture (4-layer, 128→64→32→16), same data split, same optimizer (Adam, lr=1e-3). Report validation accuracy, train-val gap, and training time. Identify best config.",
              tasks: [
                "Download EUR/USD 1H OHLCV data (2020-2023), compute features: returns, SMA ratio, ATR, RSI, MACD",
                "Split: 70% train, 15% val, 15% test (chronological — no shuffling for time series)",
                "Train 8 models with different regularization, track val accuracy every 5 epochs",
                "Plot learning curves (train loss, val loss vs epoch) for all 8 configs on same plot",
                "Compute train-val accuracy gap: |acc_train − acc_val|. Best config minimizes gap while maximizing val acc.",
                "Test final models on held-out 2024 data. Does best-val config also achieve best test accuracy?",
              ],
            },
          ],
        },
        {
          id: "dl-cnn-features",
          title: "CNNs for Feature Extraction",
          description:
            "Master 1D convolutional neural networks for extracting hierarchical patterns from raw OHLCV data — from convolution mathematics and receptive field calculations to dilated convolutions, residual connections, and Conv-LSTM hybrids.",
          estimatedMinutes: 95,
          difficulty: "advanced",
          prerequisites: ["dl-neural-nets"],
          sections: [
            {
              type: "objective",
              title: "Master Convolutional Feature Extraction",
              description:
                "Learn the mathematical foundations of 1D convolutions on time series, derive receptive field formulas, understand parameter sharing and translation equivariance, implement pooling operations, and build Conv1D architectures that discover novel chart patterns.",
              keyTakeaways: [
                "Conv1D operation: (W * x)ₜ = ∑ᵢ₌₀ᵏ⁻¹ Wᵢ·xₜ₊ᵢ slides kernel w ∈ ℝᵏ over sequence, computing k-step weighted sums",
                "Receptive field for L layers with kernel k: RF = 1 + L(k−1). Dilated conv with dilation d: RF = 1 + L(k−1)d",
                "Parameter sharing: same kernel applied at all positions → translation equivariance f(shift(x)) = shift(f(x))",
                "Max pooling: pool(x) = max{xₜ, …, xₜ₊ₚ₋₁} provides local translational invariance and downsampling",
                "Multi-scale features: stacking conv layers learns hierarchy — layer 1: edges/candles, layer 2: multi-bar patterns, layer 3: regime structure",
                "Dilated convolutions grow receptive field exponentially: d = [1,2,4,8] covers 15 bars with only 4×3-kernel layers",
                "Residual connections: x_out = F(x) + x via skip connections enable gradient flow in deep nets",
                "Conv-LSTM hybrid: CNN extracts spatial patterns, LSTM models temporal dependencies",
              ],
            },
            {
              type: "theory",
              title: "1D Convolution: Derivation & Mechanics",
              content:
                "A **1D convolution** applies a learnable kernel W ∈ ℝᶜᵒᵘᵗ ˣ ᶜⁱⁿ ˣ ᵏ to input X ∈ ℝᵀ ˣ ᶜⁱⁿ (T time steps, C_in channels):\n\n  Yₜ,ⱼ = σ(∑ᵢ₌₀ᵏ⁻¹ ∑ᶜ₌₁ᶜⁱⁿ W_{j,c,i} · X_{t+i,c} + bⱼ)\n\nfor output channel j ∈ {1, …, C_out}. This slides kernel across time, computing weighted sums at each position.\n\n**Example:** X = OHLCV (T=60, C_in=5), kernel k=3, C_out=32 filters.\nEach filter learns a 3-bar pattern across all 5 channels. Filter 1 might detect 'close > open AND volume spike' (bullish engulfing), filter 2 detects 'high ≈ low' (doji), etc.\n\n**Parameter count:** C_out · C_in · k + C_out bias terms. For (5 → 32, k=3): 32·5·3 + 32 = 512 params.\nCompare to fully-connected: T·C_in → 32 neurons = 60·5·32 = 9600 params. **Convolution is 18× more efficient** via parameter sharing.\n\n**Translation equivariance:** If pattern appears at bar 10 or bar 50, same filter activates. Formally: W * shift(x, δ) = shift(W * x, δ). This is crucial for financial data where patterns occur at arbitrary times.\n\n**Convolution vs Cross-Correlation:** True convolution flips the kernel: (W * x)ₜ = ∑ᵢ Wᵢ·xₜ₋ᵢ. Cross-correlation (what CNNs actually use): ∑ᵢ Wᵢ·xₜ₊ᵢ. Since kernels are learned, flipping doesn't matter — networks learn the same features either way.\n\n**Padding:** 'valid' produces output length T−k+1 (no padding). 'same' pads input to preserve length T. Causal padding adds k−1 zeros on the left, ensuring yₜ depends only on x₁, …, xₜ (not future), crucial for time series forecasting.",
            },
            {
              type: "theory",
              title: "Receptive Field Calculation",
              content:
                "The **receptive field** (RF) is the span of input time steps influencing a single output activation.\n\n**Single layer:** RF = k (kernel size). A k=5 filter sees 5 consecutive bars.\n\n**L layers (same kernel size k):** Each layer adds (k−1) to RF.\n  RF(L) = k + (L−1)(k−1) = 1 + L(k−1)\n\n**Derivation:** Layer 1 output yₜ depends on x_{t:t+k}. Layer 2 output zₜ depends on y_{t:t+k}, which collectively depend on x_{t:t+2k−1}. Continuing:\n  RF = k + (k−1) + (k−1) + … (L times) = 1 + L(k−1)\n\n**Example:** L=5 layers, k=3 → RF = 1 + 5·2 = 11 bars.\n\n**Pooling effect:** Max pooling with stride s multiplies the RF growth. After pool(stride=2), each position in the next layer sees 2× the input span.\n\n**Dilated convolutions:** Dilation d spaces kernel elements d steps apart.\n  Effective kernel size: k_eff = k + (k−1)(d−1)\n  RF for L layers with dilation d: RF = 1 + ∑ₗ (k−1)·dₗ\n\n**Example (WaveNet-style exponential dilation):** k=3, d=[1,2,4,8]\n  Layer 1: RF = 3\n  Layer 2: RF = 3 + 2·(3−1) = 7\n  Layer 3: RF = 7 + 4·2 = 15\n  Layer 4: RF = 15 + 8·2 = 31\nCovers 31 bars with only 4 layers and 4·(3·C_in·C_out) parameters — exponentially more efficient than stacking standard convolutions.\n\n**Forex application:** To detect head-and-shoulders (15+ bars), either use k=15 (225 params per filter) or stack dilated convs (4× fewer params, better generalization).",
            },
            {
              type: "theory",
              title: "Pooling & Parameter Sharing",
              content:
                "**Max Pooling:** pool(x) = max{xₜ, …, xₜ₊ₚ₋₁}\n  - **Purpose:** (1) Downsample — reduce sequence length, (2) Local translation invariance, (3) Expand receptive field.\n  - **Example:** Pattern detected at bar 10 or 12 → same pooled output. Network cares *that* pattern exists, not exact position.\n  - **Forex use:** Detect 'strong bullish signal in this 4-bar window' without caring if it's bar 1 or bar 3.\n\n**Average Pooling:** pool(x) = (1/p)∑ᵢ xₜ₊ᵢ\n  - Smoother than max pooling. Used when feature magnitude matters (e.g., average volatility in window).\n\n**Global Average Pooling:** Collapse entire sequence to single value per channel: GAP(X) = (1/T)∑ₜ Xₜ,ᶜ for each channel c.\n  - **Replaces flattening:** Instead of flattening (T, C) → T·C vector (huge), GAP produces C-dimensional vector.\n  - **Regularization:** No learnable params, prevents overfitting.\n  - **Example:** After Conv layers extract 128-channel features from variable-length sequences, GAP produces fixed 128-dim vector for classification.\n\n**Parameter Sharing Analysis:** Fully-connected layer: T_in → T_out requires T_in·T_out weights. Conv layer: C_in → C_out with kernel k requires only C_in·C_out·k weights, independent of sequence length T.\n  - **Generalization benefit:** Same kernel applies to bars 1-10 and bars 50-60. Model trained on 100-bar sequences generalizes to 500-bar sequences with no retraining.\n  - **Forex advantage:** Train on hourly data (60-bar windows), deploy on 15-minute data (240-bar windows) with same weights.",
            },
            {
              type: "theory",
              title: "Residual Connections & Skip Connections",
              content:
                "**Residual connection (He et al., ResNet 2015):** Instead of learning F: x → y, learn residual F: x → y−x, then add identity:\n  y = F(x) + x\n\n**Gradient flow advantage:** During backprop:\n  ∂L/∂x = ∂L/∂y · (∂F/∂x + I)\nThe identity term I ensures gradient always flows, even if ∂F/∂x → 0. Prevents vanishing gradients in deep nets.\n\n**Numerical example:** 10-layer network without skip connections. If each layer has gradient scaling 0.8:\n  ∂L/∂x_input = 0.8¹⁰ · ∂L/∂y_output ≈ 0.107 · ∂L/∂y (90% gradient loss)\nWith residual connections: gradient has additive path through identity shortcuts → no exponential decay.\n\n**Implementation:**\n```python\nclass ResidualBlock(nn.Module):\n    def __init__(self, channels, kernel_size=3):\n        super().__init__()\n        self.conv1 = nn.Conv1d(channels, channels, kernel_size, padding=kernel_size//2)\n        self.conv2 = nn.Conv1d(channels, channels, kernel_size, padding=kernel_size//2)\n        self.bn1 = nn.BatchNorm1d(channels)\n        self.bn2 = nn.BatchNorm1d(channels)\n    \n    def forward(self, x):\n        residual = x\n        out = F.relu(self.bn1(self.conv1(x)))\n        out = self.bn2(self.conv2(out))\n        out += residual  # Skip connection\n        out = F.relu(out)\n        return out\n```\n\n**When to use:** Any network >10 layers. For forex, deep temporal nets benefit from ResBlocks to learn long-range dependencies without gradient degradation.",
            },
            {
              type: "intuition",
              title: "CNN as a Sliding Pattern Detector",
              content:
                "Imagine a technical analyst with a **template** showing a specific 5-bar pattern (e.g., inverted hammer). She slides this template along the price chart, at each position computing 'how similar is this 5-bar window to my template?' by dot product. High similarity → strong activation. A **Conv1D filter is exactly this**: a learned template that slides across price bars, activating when the pattern matches. With 32 filters, you have 32 analysts each looking for their specific pattern. **Pooling** is the senior analyst summarizing: 'Across bars 10-14, the strongest signal was 0.85 — somewhere in there, a pattern fired.' **Stacking layers**: junior analysts detect candles (layer 1), mid-level analysts combine into multi-bar formations (layer 2), senior analysts synthesize regime (layer 3) — hierarchical feature extraction mirroring human technical analysis.",
              emoji: "🔍",
            },
            {
              type: "intuition",
              title: "Why Parameter Sharing Matters for Generalization",
              content:
                "Without parameter sharing (fully-connected), the network learns 'bar 15's close affects output this way, bar 16's close affects it differently' — memorizing position-specific patterns. **Convolution shares weights across time**: the same pattern detector is applied to every position. If the network learns 'rising close + volume spike → bullish' from bars 20-22, it automatically applies this knowledge to bars 50-52, 100-102, etc. This is why CNNs trained on limited forex data (10k bars) generalize to years of unseen data — they learn pattern templates, not position-specific rules. It's like learning 'hammer candlestick indicates reversal' as a general rule, not '17th candle = hammer → reversal'.",
              emoji: "🧩",
            },
            {
              type: "code",
              title: "Receptive Field Calculation & Visualization",
              language: "python",
              code: `import torch
import torch.nn as nn

def compute_receptive_field(layers_config):
    """
    Compute receptive field for a sequence of Conv1d + Pooling layers.
    layers_config: list of (type, kernel_size, stride, dilation)
    """
    rf = 1
    jump = 1  # spacing between adjacent RF positions
    
    for layer_type, k, s, d in layers_config:
        if layer_type == 'conv':
            # Effective kernel size with dilation
            k_eff = k + (k - 1) * (d - 1)
            rf = rf + (k_eff - 1) * jump
        elif layer_type == 'pool':
            jump = jump * s  # stride multiplies jump
    
    return rf

# Example 1: Standard conv stack
config1 = [
    ('conv', 3, 1, 1),  # k=3, stride=1, dilation=1
    ('conv', 3, 1, 1),
    ('pool', 2, 2, 1),  # pool kernel=2, stride=2
    ('conv', 3, 1, 1),
    ('conv', 3, 1, 1),
]
print(f"Standard stack RF: {compute_receptive_field(config1)} bars")

# Example 2: Dilated conv (WaveNet style)
config2 = [
    ('conv', 3, 1, 1),
    ('conv', 3, 1, 2),  # dilation=2
    ('conv', 3, 1, 4),  # dilation=4
    ('conv', 3, 1, 8),  # dilation=8
]
print(f"Dilated conv RF: {compute_receptive_field(config2)} bars")

# Example 3: With max pooling
config3 = [
    ('conv', 5, 1, 1),
    ('pool', 2, 2, 1),
    ('conv', 5, 1, 1),
    ('pool', 2, 2, 1),
    ('conv', 5, 1, 1),
]
print(f"Conv + pooling RF: {compute_receptive_field(config3)} bars")

# Manual verification for simple case: 3 conv layers, k=3
# RF = 1 + L(k-1) = 1 + 3*2 = 7
simple_config = [('conv', 3, 1, 1)] * 3
print(f"\\n3-layer k=3 RF: {compute_receptive_field(simple_config)} bars (expect 7)")

# Visualize receptive field
def visualize_rf(input_len=30, rf_size=7):
    """Show which input positions influence center output"""
    center_out = input_len // 2
    rf_start = center_out - rf_size // 2
    rf_end = rf_start + rf_size
    
    print(f"\\nInput sequence (length {input_len}):")
    print("".join([f"{i%10}" for i in range(input_len)]))
    print("".join(["." if i < rf_start or i >= rf_end else "█" for i in range(input_len)]))
    print(f"RF for output at position {center_out}: bars {rf_start}-{rf_end-1}")

visualize_rf(30, 7)`,
              explanation:
                "Computes receptive field for arbitrary conv/pool stacks, accounting for dilation and stride. Shows that dilated convs achieve larger RF with fewer layers. Visualizes which input bars influence a central output position.",
            },
            {
              type: "code",
              title: "Multi-Scale Conv1D with Dilated Convolutions",
              language: "python",
              code: `import torch
import torch.nn as nn
import torch.nn.functional as F

class DilatedConvBlock(nn.Module):
    def __init__(self, in_channels, out_channels, kernel_size=3, dilation=1):
        super().__init__()
        padding = (kernel_size - 1) * dilation // 2  # maintain length
        self.conv = nn.Conv1d(in_channels, out_channels, kernel_size, 
                              padding=padding, dilation=dilation)
        self.bn = nn.BatchNorm1d(out_channels)
    
    def forward(self, x):
        return F.relu(self.bn(self.conv(x)))

class MultiScaleForexCNN(nn.Module):
    def __init__(self, n_features=5, hidden_dim=64):
        super().__init__()
        
        # Multi-scale parallel branches
        # Branch 1: short-term patterns (3-bar)
        self.branch1 = nn.Sequential(
            DilatedConvBlock(n_features, hidden_dim, kernel_size=3, dilation=1),
            DilatedConvBlock(hidden_dim, hidden_dim, kernel_size=3, dilation=1),
        )
        
        # Branch 2: medium-term patterns (7-bar via dilation)
        self.branch2 = nn.Sequential(
            DilatedConvBlock(n_features, hidden_dim, kernel_size=3, dilation=2),
            DilatedConvBlock(hidden_dim, hidden_dim, kernel_size=3, dilation=2),
        )
        
        # Branch 3: long-term patterns (15-bar via dilation)
        self.branch3 = nn.Sequential(
            DilatedConvBlock(n_features, hidden_dim, kernel_size=3, dilation=4),
            DilatedConvBlock(hidden_dim, hidden_dim, kernel_size=3, dilation=4),
        )
        
        # Combine branches
        self.fusion = nn.Sequential(
            nn.Conv1d(3 * hidden_dim, hidden_dim, kernel_size=1),  # 1x1 conv to fuse
            nn.BatchNorm1d(hidden_dim),
            nn.ReLU(),
            nn.AdaptiveAvgPool1d(1),  # Global pooling
        )
        
        # Classifier
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(0.3),
            nn.Linear(hidden_dim, 32),
            nn.ReLU(),
            nn.Linear(32, 1),
            nn.Sigmoid(),
        )
    
    def forward(self, x):
        # x: (batch, seq_len, features) -> (batch, features, seq_len)
        x = x.transpose(1, 2)
        
        # Parallel processing at 3 scales
        feat1 = self.branch1(x)  # short-term
        feat2 = self.branch2(x)  # medium-term
        feat3 = self.branch3(x)  # long-term
        
        # Concatenate multi-scale features
        combined = torch.cat([feat1, feat2, feat3], dim=1)
        
        # Fuse and classify
        fused = self.fusion(combined)
        return self.classifier(fused)

# Test model
model = MultiScaleForexCNN(n_features=5, hidden_dim=64)
x_test = torch.randn(4, 60, 5)  # (batch, seq_len, features)
out = model(x_test)
print(f"Input shape: {x_test.shape}")
print(f"Output shape: {out.shape}")
print(f"Output (probabilities): {out.squeeze().detach().numpy()}")

# Count parameters
total_params = sum(p.numel() for p in model.parameters())
print(f"\\nTotal parameters: {total_params:,}")`,
              explanation:
                "Multi-scale architecture with 3 parallel dilated conv branches capturing short/medium/long-term patterns simultaneously. Concatenates features and fuses with 1×1 conv. More efficient than large kernels while capturing wide temporal context.",
            },
            {
              type: "code",
              title: "Residual CNN for Deep Temporal Feature Learning",
              language: "python",
              code: `import torch
import torch.nn as nn
import torch.nn.functional as F

class ResidualConvBlock(nn.Module):
    def __init__(self, channels, kernel_size=3):
        super().__init__()
        padding = kernel_size // 2
        self.conv1 = nn.Conv1d(channels, channels, kernel_size, padding=padding)
        self.bn1 = nn.BatchNorm1d(channels)
        self.conv2 = nn.Conv1d(channels, channels, kernel_size, padding=padding)
        self.bn2 = nn.BatchNorm1d(channels)
    
    def forward(self, x):
        residual = x
        out = F.relu(self.bn1(self.conv1(x)))
        out = self.bn2(self.conv2(out))
        out = out + residual  # Skip connection
        out = F.relu(out)
        return out

class DeepResidualForexNet(nn.Module):
    def __init__(self, n_features=5, hidden_dim=128, n_blocks=6):
        super().__init__()
        
        # Initial conv to project to hidden_dim
        self.input_proj = nn.Sequential(
            nn.Conv1d(n_features, hidden_dim, kernel_size=7, padding=3),
            nn.BatchNorm1d(hidden_dim),
            nn.ReLU(),
        )
        
        # Stack of residual blocks
        self.res_blocks = nn.ModuleList([
            ResidualConvBlock(hidden_dim, kernel_size=3) for _ in range(n_blocks)
        ])
        
        # Output head
        self.output = nn.Sequential(
            nn.AdaptiveAvgPool1d(1),
            nn.Flatten(),
            nn.Linear(hidden_dim, 64),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )
    
    def forward(self, x):
        # x: (batch, seq_len, features)
        x = x.transpose(1, 2)  # -> (batch, features, seq_len)
        
        x = self.input_proj(x)
        
        for block in self.res_blocks:
            x = block(x)
        
        return self.output(x)

# Compare gradient flow: with vs without residual connections
def compare_gradients():
    torch.manual_seed(42)
    
    # Model with residual connections
    model_res = DeepResidualForexNet(n_features=5, hidden_dim=64, n_blocks=6)
    
    # Simple deep conv (no residuals)
    class DeepConvNoRes(nn.Module):
        def __init__(self):
            super().__init__()
            layers = [nn.Conv1d(5, 64, 7, padding=3), nn.ReLU()]
            for _ in range(6):
                layers.extend([
                    nn.Conv1d(64, 64, 3, padding=1),
                    nn.BatchNorm1d(64),
                    nn.ReLU(),
                ])
            layers.extend([nn.AdaptiveAvgPool1d(1), nn.Flatten(), nn.Linear(64, 1), nn.Sigmoid()])
            self.net = nn.Sequential(*layers)
        def forward(self, x):
            return self.net(x.transpose(1, 2))
    
    model_no_res = DeepConvNoRes()
    
    # Forward + backward pass
    x = torch.randn(16, 60, 5, requires_grad=True)
    y = torch.ones(16, 1)
    
    for name, model in [("ResNet", model_res), ("No Residual", model_no_res)]:
        out = model(x)
        loss = F.binary_cross_entropy(out, y)
        loss.backward()
        
        # Check gradient magnitude at input
        grad_norm = x.grad.norm().item() if x.grad is not None else 0
        print(f"{name:15} | Loss: {loss.item():.4f} | Input grad norm: {grad_norm:.6f}")
        x.grad = None  # Reset for next model

model = DeepResidualForexNet(n_features=5, hidden_dim=128, n_blocks=8)
print(f"\\nDeep ResNet parameters: {sum(p.numel() for p in model.parameters()):,}")
print("\\nGradient flow comparison:")
compare_gradients()`,
              explanation:
                "Deep ResNet with skip connections enabling 8+ conv blocks without vanishing gradients. Demonstrates that residual connections preserve gradient flow — without them, deep networks suffer gradient degradation.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "dl-cnn-q1",
                  question: "A 5-layer Conv1D network with kernel size k=3 and no pooling has receptive field RF = 1 + L(k−1). What is the RF?",
                  options: [
                    { id: "dl-cnn-q1-a", text: "15 bars" },
                    { id: "dl-cnn-q1-b", text: "11 bars" },
                    { id: "dl-cnn-q1-c", text: "7 bars" },
                    { id: "dl-cnn-q1-d", text: "5 bars" },
                  ],
                  correctOptionId: "dl-cnn-q1-b",
                  explanation:
                    "RF = 1 + L(k−1) = 1 + 5·(3−1) = 1 + 10 = 11 bars. Each layer adds (k−1) to the receptive field.",
                },
                {
                  id: "dl-cnn-q2",
                  question: "Why does dilated convolution with dilation d=[1,2,4,8] achieve larger receptive fields than standard convolutions?",
                  options: [
                    { id: "dl-cnn-q2-a", text: "It uses larger kernel sizes" },
                    { id: "dl-cnn-q2-b", text: "It spaces kernel elements d steps apart, exponentially growing effective kernel size without extra parameters" },
                    { id: "dl-cnn-q2-c", text: "It applies pooling between layers" },
                    { id: "dl-cnn-q2-d", text: "It increases the number of filters" },
                  ],
                  correctOptionId: "dl-cnn-q2-b",
                  explanation:
                    "Dilation d spaces kernel weights d positions apart. With d=[1,2,4,8], you cover 1+2·(2)+4·(2)+8·(2) = 1+4+8+16 = 29 bars with only 4 layers of k=3 kernels (12 params per filter), vs 29-kernel standard conv (29 params).",
                },
                {
                  id: "dl-cnn-q3",
                  question: "In a ResNet, why does the skip connection y = F(x) + x prevent vanishing gradients?",
                  options: [
                    { id: "dl-cnn-q3-a", text: "It increases the number of parameters" },
                    { id: "dl-cnn-q3-b", text: "During backprop, ∂L/∂x = ∂L/∂y(∂F/∂x + I). The identity I ensures gradient flows even if ∂F/∂x → 0" },
                    { id: "dl-cnn-q3-c", text: "It applies batch normalization automatically" },
                    { id: "dl-cnn-q3-d", text: "It prevents overfitting by adding regularization" },
                  ],
                  correctOptionId: "dl-cnn-q3-b",
                  explanation:
                    "The skip connection provides a direct gradient path: ∂L/∂x always includes the identity term I from ∂y/∂x = I (from y = F(x) + x). Even if layers F become saturated (∂F/∂x → 0), gradients flow through the shortcut.",
                },
                {
                  id: "dl-cnn-q4",
                  question: "Max pooling with pool_size=4 detects a hammer candlestick at bars [10,11,12,13]. If the hammer is at bar 11, what does pooling do?",
                  options: [
                    { id: "dl-cnn-q4-a", text: "Returns the price at bar 11" },
                    { id: "dl-cnn-q4-b", text: "Returns max activation across [10,11,12,13], providing local translation invariance — pattern detected regardless of exact position" },
                    { id: "dl-cnn-q4-c", text: "Averages activations across the window" },
                    { id: "dl-cnn-q4-d", text: "Discards all activations except bar 11" },
                  ],
                  correctOptionId: "dl-cnn-q4-b",
                  explanation:
                    "Max pooling selects the strongest activation in the window. Whether the hammer fired at bar 10, 11, 12, or 13, the pooled output is the same (the max). This makes the model invariant to small temporal shifts.",
                },
                {
                  id: "dl-cnn-q5",
                  question: "A Conv1D layer with 5 input channels (OHLCV), 32 output filters, kernel k=7 has how many parameters?",
                  options: [
                    { id: "dl-cnn-q5-a", text: "1152 (32·5·7 + 32)" },
                    { id: "dl-cnn-q5-b", text: "1120 (32·5·7 only)" },
                    { id: "dl-cnn-q5-c", text: "224 (32·7)" },
                    { id: "dl-cnn-q5-d", text: "5600 (32·5·7·5)" },
                  ],
                  correctOptionId: "dl-cnn-q5-a",
                  explanation:
                    "Parameters = C_out · C_in · k (weights) + C_out (biases) = 32·5·7 + 32 = 1120 + 32 = 1152. Each of 32 filters has 5·7=35 weights plus 1 bias.",
                },
                {
                  id: "dl-cnn-q6",
                  question: "What is the key advantage of Conv1D over fully-connected layers for variable-length time series?",
                  options: [
                    { id: "dl-cnn-q6-a", text: "Conv1D trains faster on GPUs" },
                    { id: "dl-cnn-q6-b", text: "Conv1D parameter count is independent of sequence length; trained on 60-bar windows, it generalizes to 240-bar windows" },
                    { id: "dl-cnn-q6-c", text: "Conv1D has higher accuracy than fully-connected" },
                    { id: "dl-cnn-q6-d", text: "Conv1D requires less data to train" },
                  ],
                  correctOptionId: "dl-cnn-q6-b",
                  explanation:
                    "Fully-connected layers have T_in·T_out weights — tied to input length. Conv has C_in·C_out·k weights, independent of T. A conv model trained on 60-step sequences works on 1000-step sequences without retraining.",
                },
                {
                  id: "dl-cnn-q7",
                  question: "You want to detect head-and-shoulders patterns spanning 20 bars. Best architecture?",
                  options: [
                    { id: "dl-cnn-q7-a", text: "Single Conv1D layer with k=20" },
                    { id: "dl-cnn-q7-b", text: "Stack 5 Conv1D layers with k=3 and dilation [1,2,4,8,16] → RF=31" },
                    { id: "dl-cnn-q7-c", text: "Fully-connected layer on flattened 20-bar window" },
                    { id: "dl-cnn-q7-d", text: "LSTM with 20-step input" },
                  ],
                  correctOptionId: "dl-cnn-q7-b",
                  explanation:
                    "Stacking dilated convs is more parameter-efficient and learns hierarchical features (candles → sub-patterns → full head-and-shoulders). Single k=20 has 20·C params per filter; dilated stack has 5·3·C params for larger RF=31.",
                },
              ],
            },
            {
              type: "practice",
              title: "Build Multi-Scale Conv1D Feature Extractor",
              description:
                "Implement a multi-scale CNN with 3 parallel branches (short/medium/long-term patterns via dilations [1,2,4]). Train on EUR/USD hourly data to predict next-bar direction. Extract and visualize learned filters — do any resemble known indicators? Compare against feedforward net with hand-crafted features (RSI, MACD, ATR).",
              tasks: [
                "Load EUR/USD 1H OHLCV (2020-2023), split train/val/test chronologically",
                "Build 3-branch CNN: d=1 (3-bar), d=2 (7-bar), d=4 (15-bar) receptive fields",
                "Concatenate branches, apply 1×1 conv fusion, global pooling, classifier",
                "Train with Adam, BCE loss, cosine annealing LR, early stopping",
                "Visualize first-layer filters: plot weight heatmap (filters × time × channels)",
                "Compare val accuracy vs feedforward net using [RSI, MACD, BB, ATR] features",
              ],
            },
            {
              type: "practice",
              title: "Receptive Field vs Performance Analysis",
              description:
                "Train CNNs with varying receptive fields (RF = 7, 15, 31, 63 bars) and measure validation accuracy vs computational cost. Hypothesis: larger RF captures longer patterns but risks overfitting. Find optimal RF for 1H forex prediction.",
              tasks: [
                "Design 4 architectures: (1) 3 layers k=3 (RF=7), (2) 5 layers k=3 (RF=11) + pooling (effective RF≈22), (3) dilated [1,2,4,8] (RF=31), (4) dilated [1,2,4,8,16] (RF=63)",
                "Train each on same data, track train/val accuracy, inference time, param count",
                "Plot: x=RF, y={val_acc, train-val gap, FLOPs}. Identify sweet spot.",
                "Hypothesis: RF ∈ [15, 31] optimal for 1H bars (captures intraday structure without over-contextualizing)",
                "Test on held-out 2024 data. Does best-val RF also win on test set?",
              ],
            },
          ],
        },
        {
          id: "dl-batch-norm-optimizers",
          title: "Advanced Training: BatchNorm, Optimizers & Schedulers",
          description:
            "Master the training infrastructure that makes deep networks converge reliably — batch normalization, modern optimizers, learning rate schedulers, and gradient clipping for stable forex model training.",
          estimatedMinutes: 45,
          difficulty: "advanced",
          prerequisites: ["dl-regularization"],
          sections: [
            {
              type: "objective",
              content:
                "After this lesson you will understand why batch normalization accelerates training, compare modern optimizers (SGD, Adam, AdamW, LAMB), configure learning rate schedulers (cosine annealing, warmup, one-cycle), and apply gradient clipping to stabilize training on noisy financial data.",
              keyTakeaways: [
                "BatchNorm normalizes activations per mini-batch: x̂ = (x − μ_B) / √(σ²_B + ε), then scales via learnable γ, β",
                "LayerNorm normalizes across features (not batch) — preferred for sequence models and small batches",
                "AdamW decouples weight decay from the gradient update, providing better regularization than Adam's L2",
                "Cosine annealing with warmup: linearly increase LR for W steps, then decay via α_t = α_min + ½(α_max − α_min)(1 + cos(πt/T))",
              ],
            },
            {
              type: "theory",
              title: "Normalization, Optimizers & Scheduling Deep Dive",
              content:
                "**Batch Normalization** (Ioffe & Szegedy, 2015) addresses **internal covariate shift** — the distribution of each layer's inputs changes during training as parameters update. For a mini-batch B = {x₁, …, xₘ}, BN computes: μ_B = (1/m)∑xᵢ, σ²_B = (1/m)∑(xᵢ − μ_B)², x̂ᵢ = (xᵢ − μ_B)/√(σ²_B + ε), yᵢ = γx̂ᵢ + β. The learnable parameters γ and β allow the network to recover the original representation if needed. During inference, running estimates of μ and σ² are used. **Layer Normalization** normalizes across feature dimensions instead of the batch dimension: this makes it independent of batch size and preferred for RNNs/Transformers where batch statistics are unreliable.\n\n**Optimizer comparison**: **SGD with momentum** uses vₜ = βvₜ₋₁ + ∇L, θₜ = θₜ₋₁ − α·vₜ — simple but requires careful LR tuning. **Adam** combines momentum with adaptive per-parameter learning rates using first moment m̂ₜ = mₜ/(1−β₁ᵗ) and second moment v̂ₜ = vₜ/(1−β₂ᵗ): θₜ = θₜ₋₁ − α·m̂ₜ/(√v̂ₜ + ε). **AdamW** (Loshchilov & Hutter, 2019) fixes Adam's flawed weight decay by decoupling it: θₜ = (1 − λ)θₜ₋₁ − α·m̂ₜ/(√v̂ₜ + ε), preventing the adaptive learning rate from counteracting regularization. **LAMB** (Layer-wise Adaptive Moments for Batch training) scales updates by the ratio of parameter norm to update norm, enabling massive batch training.\n\n**Learning rate schedulers** control the learning rate trajectory. **Linear warmup** gradually increases α from 0 to α_max over W steps, preventing large gradient updates from randomly initialized parameters. **Cosine annealing** decays α_t = α_min + ½(α_max − α_min)(1 + cos(πt/T)), providing smooth decay with a flat region near α_min. **One-cycle policy** (Smith, 2018) combines warmup to α_max, cosine decay to α_min, and optional momentum cycling — often converges faster than fixed schedules. **Gradient clipping** caps ‖∇L‖ ≤ c (typically c = 1.0), preventing exploding gradients from corrupting parameters during volatile market periods.",
            },
            {
              type: "intuition",
              title: "The GPS Recalibration Analogy",
              analogy:
                "Optimizers are different GPS routing algorithms; schedulers control your driving speed; BatchNorm keeps the road level so every algorithm can navigate efficiently.",
              content:
                "Imagine driving to a destination (loss minimum) through mountainous terrain. **SGD** follows the steepest downhill slope — fast on smooth highways but oscillates wildly on switchbacks. **Adam** has a smart GPS that adapts speed per road segment — slow on winding mountain passes, fast on straight stretches. **AdamW** adds proper guardrails (weight decay) that SGD and Adam handle clumsily. The **learning rate scheduler** is your cruise control: **warmup** starts slow leaving the parking lot (random initialization), **cosine annealing** gradually slows as you approach the destination to avoid overshooting, and **one-cycle** hits maximum speed on the highway then decelerates smoothly. **BatchNorm** is like a road-levelling crew that flattens bumps before each intersection (layer) — every optimizer benefits from smoother terrain. **Gradient clipping** is a speed limiter that prevents dangerous acceleration on steep downhill segments (exploding gradients from noisy financial data).",
              emoji: "🧭",
            },
            {
              type: "code",
              title: "Optimizer & Scheduler Comparison on Forex Data",
              language: "python",
              code: `import torch
import torch.nn as nn
import torch.optim as optim
from torch.optim.lr_scheduler import CosineAnnealingLR, OneCycleLR
from torch.utils.data import DataLoader, TensorDataset

class ForexNet(nn.Module):
    def __init__(self, n_features: int = 10, hidden: int = 128):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_features, hidden),
            nn.BatchNorm1d(hidden),    # BN: x_hat = (x - mu_B) / sqrt(sigma2_B + eps)
            nn.ReLU(),
            nn.Linear(hidden, hidden),
            nn.LayerNorm(hidden),      # LN: normalize across features, not batch
            nn.ReLU(),
            nn.Linear(hidden, 1),
            nn.Sigmoid(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)

# Dummy data (replace with real forex features)
X = torch.randn(1024, 10)
y = torch.randint(0, 2, (1024, 1)).float()
loader = DataLoader(TensorDataset(X, y), batch_size=64, shuffle=True)

configs = {
    "Adam": lambda m: (optim.Adam(m.parameters(), lr=1e-3),
                        CosineAnnealingLR(optim.Adam(m.parameters(), lr=1e-3), T_max=50)),
    "AdamW+Cosine": lambda m: (
        optim.AdamW(m.parameters(), lr=1e-3, weight_decay=1e-4),
        CosineAnnealingLR(optim.AdamW(m.parameters(), lr=1e-3, weight_decay=1e-4), T_max=50),
    ),
    "AdamW+OneCycle": lambda m: (
        optim.AdamW(m.parameters(), lr=1e-4, weight_decay=1e-4),
        OneCycleLR(optim.AdamW(m.parameters(), lr=1e-4, weight_decay=1e-4),
                   max_lr=1e-3, epochs=50, steps_per_epoch=len(loader)),
    ),
}

results = {}
for name, config_fn in configs.items():
    model = ForexNet()
    opt, sched = config_fn(model)
    criterion = nn.BCELoss()
    losses = []
    for epoch in range(50):
        model.train()
        epoch_loss = 0.0
        for xb, yb in loader:
            pred = model(xb)
            loss = criterion(pred, yb)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            opt.step()
            if isinstance(sched, OneCycleLR):
                sched.step()
            epoch_loss += loss.item()
        if not isinstance(sched, OneCycleLR):
            sched.step()
        losses.append(epoch_loss / len(loader))
    results[name] = losses
    print(f"{name:20s} | Final loss: {losses[-1]:.4f} | Best: {min(losses):.4f}")`,
              explanation:
                "We compare three optimizer+scheduler configurations on the same forex model architecture. AdamW properly decouples weight decay from adaptive gradients. CosineAnnealingLR provides smooth LR decay, while OneCycleLR combines warmup and decay for faster convergence. Gradient clipping (max_norm=1.0) prevents exploding gradients from noisy financial data. Log all results for systematic comparison.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "dl-optim-q1",
                  question: "When should you use LayerNorm instead of BatchNorm in a forex model?",
                  options: [
                    { id: "dl-optim-q1-a", text: "LayerNorm is always better than BatchNorm" },
                    { id: "dl-optim-q1-b", text: "When using sequence models (RNNs, Transformers) or small batch sizes, because LayerNorm normalizes across features independently of the batch, avoiding noisy batch statistics" },
                    { id: "dl-optim-q1-c", text: "When the model has fewer than 3 layers" },
                    { id: "dl-optim-q1-d", text: "When using SGD instead of Adam" },
                  ],
                  correctOptionId: "dl-optim-q1-b",
                  explanation:
                    "BatchNorm computes statistics across the batch dimension — unreliable with small batches or variable-length sequences. LayerNorm normalizes across features within each sample, making it batch-size independent and the standard choice for Transformers and RNNs.",
                },
                {
                  id: "dl-optim-q2",
                  question: "Why is AdamW preferred over Adam with L2 regularization for forex models?",
                  options: [
                    { id: "dl-optim-q2-a", text: "AdamW converges faster because it uses a larger learning rate" },
                    { id: "dl-optim-q2-b", text: "AdamW decouples weight decay from the adaptive gradient, preventing the per-parameter learning rate from counteracting regularization" },
                    { id: "dl-optim-q2-c", text: "AdamW uses less memory than Adam" },
                    { id: "dl-optim-q2-d", text: "AdamW does not require setting the weight decay hyperparameter" },
                  ],
                  correctOptionId: "dl-optim-q2-b",
                  explanation:
                    "In Adam, L2 regularization adds λθ to the gradient, which gets divided by √v̂ₜ — parameters with large gradients receive less decay than intended. AdamW applies decay directly: θ ← (1−λ)θ − α·update, ensuring uniform regularization regardless of gradient magnitude.",
                },
                {
                  id: "dl-optim-q3",
                  question: "What is the purpose of learning rate warmup at the start of training?",
                  options: [
                    { id: "dl-optim-q3-a", text: "It reduces the total number of epochs needed" },
                    { id: "dl-optim-q3-b", text: "It prevents large gradient updates from randomly initialized parameters from destabilizing early training" },
                    { id: "dl-optim-q3-c", text: "It ensures the model memorizes the training data first" },
                    { id: "dl-optim-q3-d", text: "It is only needed when using SGD, not Adam" },
                  ],
                  correctOptionId: "dl-optim-q3-b",
                  explanation:
                    "At initialization, gradients can be very large and poorly directed. A high learning rate amplifies these noisy updates, potentially pushing parameters into bad regions. Warmup starts with a small LR, letting the optimizer build reliable momentum and second-moment estimates before ramping up to the target LR.",
                },
              ],
            },
            {
              type: "practice",
              title: "Optimizer Ablation Study",
              description:
                "Train the same forex direction model with 3 different optimizer+scheduler combinations: (1) SGD + StepLR, (2) Adam + CosineAnnealing, (3) AdamW + OneCycleLR. Log loss curves, learning rate trajectories, and validation accuracy. Which combination converges fastest? Which achieves the lowest validation loss?",
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
        {
          id: "dl-temporal-fusion",
          title: "Temporal Fusion Transformers for Forecasting",
          description:
            "Explore the Temporal Fusion Transformer architecture that combines variable selection, gating mechanisms, and interpretable attention for multi-horizon probabilistic forex forecasting.",
          estimatedMinutes: 55,
          difficulty: "advanced",
          prerequisites: ["dl-transformers", "dl-rnn-lstm"],
          sections: [
            {
              type: "objective",
              content:
                "After this lesson you will understand the TFT architecture — variable selection networks, gated residual networks, interpretable multi-head attention, and quantile regression outputs — and apply it to multi-horizon forex price forecasting with confidence intervals.",
              keyTakeaways: [
                "Variable Selection Networks (VSNs) learn which inputs matter via softmax-weighted Grn gates, providing built-in feature importance",
                "Gated Residual Networks (GRNs) use GLU gating: GRN(x) = LayerNorm(x + GLU(W₁·ELU(W₂·x)))",
                "Interpretable multi-head attention reveals which historical time steps the model attends to for each prediction horizon",
                "Quantile outputs (τ = 0.1, 0.5, 0.9) provide probabilistic forecasts with calibrated confidence intervals",
              ],
            },
            {
              type: "theory",
              title: "TFT Architecture: Variable Selection, Gating & Quantile Forecasting",
              content:
                "The **Temporal Fusion Transformer** (Lim et al., 2021) is purpose-built for multi-horizon time series forecasting with heterogeneous inputs. Unlike vanilla Transformers that treat all inputs equally, TFT introduces **Variable Selection Networks** (VSNs) that learn input importance via softmax gates: v = Softmax(GRN_v(Ξ)) where Ξ is the flattened input embedding and each variable receives a weight vⱼ ∈ [0,1]. This provides interpretable feature importance — the model might learn that RSI matters more than Bollinger Bandwidth for EUR/USD forecasting. The VSN is applied separately to static covariates (e.g., pair identity), known future inputs (e.g., day-of-week, scheduled news events), and past observed inputs (e.g., OHLCV, technical indicators).\n\nThe core building block is the **Gated Residual Network** (GRN): GRN(a, c) = LayerNorm(a + GLU(η₁)) where η₁ = W₁·η₂ + b₁, η₂ = ELU(W₂·a + W₃·c + b₂), and GLU(γ) = σ(γ₁) ⊙ γ₂ is the Gated Linear Unit that controls information flow. The optional context vector c allows static metadata to modulate temporal processing. The encoder uses a sequence-to-sequence architecture with LSTM for local processing followed by **interpretable multi-head attention** that restricts each head to attend with a single value vector: InterpretableMultiHead(Q,K,V) = (1/H)∑ₕ Aₕ · VWᵥ, making attention weights directly interpretable — each head's attention pattern shows which historical bars influence each forecast horizon.\n\nThe decoder produces **quantile forecasts** rather than point predictions: for quantiles τ ∈ {0.1, 0.5, 0.9}, the model outputs q̂τ(t+h) at each horizon h via separate linear heads. Training minimizes the **quantile loss** QL_τ(y, q̂) = max(τ(y − q̂), (τ−1)(y − q̂)), which is asymmetric — the 0.9 quantile penalizes under-prediction 9× more than over-prediction. This gives calibrated confidence intervals: the true value should fall between q̂₀.₁ and q̂₀.₉ approximately 80% of the time.",
            },
            {
              type: "intuition",
              title: "The Smart Secretary Analogy",
              analogy:
                "TFT is like a smart executive secretary who decides which memos matter (variable selection), remembers relevant context (encoder), and gives forecasts with confidence ranges rather than single guesses.",
              content:
                "Imagine an executive secretary preparing a market brief. Each morning, she receives dozens of reports: economic indicators, technical signals, news summaries, calendar events. A mediocre secretary dumps everything on the desk — information overload. The **smart secretary** (TFT) first **selects** which reports matter today (Variable Selection Network) — 'RSI divergence is critical this week, ignore the moon phase report'. She then **encodes context** by reading through the relevant history, using **attention** to highlight key past events ('remember the flash crash on March 3rd — it's similar to today's setup'). Finally, instead of saying 'EUR/USD will be at 1.0850', she says 'I'm 80% confident it'll be between 1.0820 and 1.0880, with my best guess at 1.0850' — that's the **quantile forecast**. The attention weights are her footnotes: 'I focused on bars 15, 42, and 58 because they showed similar volatility patterns'. This interpretability is what sets TFT apart from black-box Transformers.",
              emoji: "📋",
            },
            {
              type: "code",
              title: "TFT-Style Model with Variable Selection and Quantile Output",
              language: "python",
              code: `import torch
import torch.nn as nn
import torch.nn.functional as F

class GatedResidualNetwork(nn.Module):
    """GRN: core building block of TFT with GLU gating."""
    def __init__(self, d_input: int, d_hidden: int, d_output: int, dropout: float = 0.1):
        super().__init__()
        self.fc1 = nn.Linear(d_input, d_hidden)
        self.fc2 = nn.Linear(d_hidden, d_output * 2)  # *2 for GLU split
        self.norm = nn.LayerNorm(d_output)
        self.dropout = nn.Dropout(dropout)
        self.skip = nn.Linear(d_input, d_output) if d_input != d_output else nn.Identity()

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        residual = self.skip(x)
        h = F.elu(self.fc1(x))
        h = self.dropout(self.fc2(h))
        gate, value = h.chunk(2, dim=-1)  # GLU: sigma(gate) * value
        h = torch.sigmoid(gate) * value
        return self.norm(residual + h)

class VariableSelectionNetwork(nn.Module):
    """VSN: learns which input variables matter most."""
    def __init__(self, n_vars: int, d_model: int, dropout: float = 0.1):
        super().__init__()
        self.grns = nn.ModuleList([GatedResidualNetwork(1, d_model, d_model, dropout)
                                   for _ in range(n_vars)])
        self.gate = nn.Sequential(
            nn.Linear(n_vars * d_model, n_vars), nn.Softmax(dim=-1)
        )
        self.d_model = d_model

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (batch, seq_len, n_vars)
        var_outputs = [grn(x[:, :, i:i+1]) for i, grn in enumerate(self.grns)]
        stacked = torch.stack(var_outputs, dim=-1)  # (batch, seq, d_model, n_vars)
        flat = torch.cat(var_outputs, dim=-1)        # (batch, seq, n_vars * d_model)
        weights = self.gate(flat).unsqueeze(2)       # (batch, seq, 1, n_vars)
        selected = (stacked * weights).sum(dim=-1)   # (batch, seq, d_model)
        return selected, weights.squeeze(2)

class TFTForexModel(nn.Module):
    """Simplified TFT with variable selection and quantile output."""
    def __init__(self, n_features: int = 10, d_model: int = 64,
                 n_heads: int = 4, n_quantiles: int = 3, horizon: int = 5):
        super().__init__()
        self.vsn = VariableSelectionNetwork(n_features, d_model)
        self.encoder_lstm = nn.LSTM(d_model, d_model, num_layers=1, batch_first=True)
        attn_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=n_heads, dim_feedforward=d_model * 2,
            dropout=0.1, batch_first=True)
        self.attention = nn.TransformerEncoder(attn_layer, num_layers=1)
        self.grn_out = GatedResidualNetwork(d_model, d_model, d_model)
        self.quantile_heads = nn.Linear(d_model, horizon * n_quantiles)
        self.horizon = horizon
        self.n_quantiles = n_quantiles

    def forward(self, x: torch.Tensor):
        selected, var_weights = self.vsn(x)          # variable selection
        lstm_out, _ = self.encoder_lstm(selected)     # local temporal processing
        attn_out = self.attention(lstm_out)            # interpretable attention
        out = self.grn_out(attn_out[:, -1, :])        # last position -> GRN
        quantiles = self.quantile_heads(out)           # (batch, horizon * n_quantiles)
        return quantiles.view(-1, self.horizon, self.n_quantiles), var_weights

def quantile_loss(preds: torch.Tensor, targets: torch.Tensor,
                  quantiles: list[float] = [0.1, 0.5, 0.9]) -> torch.Tensor:
    losses = []
    for i, q in enumerate(quantiles):
        errors = targets - preds[:, :, i]
        losses.append(torch.max(q * errors, (q - 1) * errors).mean())
    return sum(losses)

# --- Usage ---
model = TFTForexModel(n_features=10, d_model=64, horizon=5)
x = torch.randn(32, 60, 10)   # (batch, seq_len=60, features=10)
q_preds, importance = model(x) # q_preds: (32, 5, 3), importance: (32, 60, 10)
print(f"Quantile predictions shape: {q_preds.shape}")
print(f"Variable importance shape:  {importance.shape}")
print(f"Top-3 important features:   {importance[0, -1].topk(3).indices.tolist()}")`,
              explanation:
                "A simplified TFT implementation with three key components: (1) Variable Selection Network that learns which of the 10 input features matter most via softmax gating, (2) LSTM encoder + Transformer attention for temporal processing, and (3) quantile output heads that produce probabilistic forecasts at τ = 0.1, 0.5, 0.9 for each of 5 forecast horizons. The quantile loss function is asymmetric, penalizing under/over-prediction differently per quantile.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "dl-tft-q1",
                  question: "What is the purpose of the Variable Selection Network in the TFT architecture?",
                  options: [
                    { id: "dl-tft-q1-a", text: "To reduce the model's parameter count" },
                    { id: "dl-tft-q1-b", text: "To learn which input features are most relevant for forecasting via softmax-weighted gating, providing built-in interpretable feature importance" },
                    { id: "dl-tft-q1-c", text: "To select which time steps to attend to" },
                    { id: "dl-tft-q1-d", text: "To remove outliers from the input data" },
                  ],
                  correctOptionId: "dl-tft-q1-b",
                  explanation:
                    "The VSN applies GRN transformations to each input variable, then computes softmax weights v = Softmax(GRN(Ξ)) to gate variable contributions. A weight near 1 means the variable is critical; near 0 means it's ignored. This provides interpretable feature importance without post-hoc methods like SHAP.",
                },
                {
                  id: "dl-tft-q2",
                  question: "Why are quantile forecasts (e.g., τ = 0.1, 0.5, 0.9) more useful than point forecasts for forex trading?",
                  options: [
                    { id: "dl-tft-q2-a", text: "Quantile forecasts are always more accurate than point forecasts" },
                    { id: "dl-tft-q2-b", text: "Quantile forecasts provide calibrated confidence intervals, enabling risk-aware position sizing — wide intervals signal uncertainty, narrow intervals signal conviction" },
                    { id: "dl-tft-q2-c", text: "Quantile forecasts require less training data" },
                    { id: "dl-tft-q2-d", text: "Quantile forecasts eliminate the need for stop-loss orders" },
                  ],
                  correctOptionId: "dl-tft-q2-b",
                  explanation:
                    "Point forecasts give a single number with no uncertainty estimate. Quantile forecasts at τ = 0.1, 0.5, 0.9 say: 'I expect the price between q₀.₁ and q₀.₉ with 80% confidence'. Wide intervals (high uncertainty) → reduce position size. Narrow intervals (high conviction) → increase exposure. This is essential for risk management.",
                },
                {
                  id: "dl-tft-q3",
                  question: "When does TFT outperform a vanilla Transformer for time series forecasting?",
                  options: [
                    { id: "dl-tft-q3-a", text: "When the dataset is very small (< 100 samples)" },
                    { id: "dl-tft-q3-b", text: "When inputs are heterogeneous (mix of static, known future, and observed features) and interpretability is needed" },
                    { id: "dl-tft-q3-c", text: "When the sequence length exceeds 10,000 time steps" },
                    { id: "dl-tft-q3-d", text: "When only a single forecast horizon is needed" },
                  ],
                  correctOptionId: "dl-tft-q3-b",
                  explanation:
                    "TFT's architecture is designed for heterogeneous inputs: static features (pair identity), known future inputs (calendar events), and observed past data (prices, indicators). Its variable selection, gating, and interpretable attention add structure that vanilla Transformers lack. For simple homogeneous sequences, a vanilla Transformer may suffice.",
                },
              ],
            },
            {
              type: "practice",
              title: "TFT Multi-Horizon Forex Forecasting",
              description:
                "Configure a TFT model from the model catalog with your forex features as observed inputs and day-of-week/hour-of-day as known future inputs. Train with quantile loss at τ = [0.1, 0.5, 0.9] for a 5-step forecast horizon. Evaluate quantile calibration: does the 80% prediction interval (q₀.₁ to q₀.₉) actually contain ~80% of true values? Inspect the variable selection weights to identify the most important features.",
              catalogModelId: "transformer-vs-lstm",
            },
          ],
        },
      ],
    },
  ],
};
