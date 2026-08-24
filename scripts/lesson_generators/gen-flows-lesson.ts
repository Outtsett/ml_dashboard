{
  id: "gen-normalizing-flows",
  title: "Normalizing Flows for Distribution Modeling",
  description: "Master normalizing flows — a family of generative models that learn complex probability distributions through sequences of invertible transformations. Derive the change of variables formula, implement coupling layers (RealNVP) and autoregressive flows (MAF/IAF), understand the Glow architecture, and apply these models to capture fat-tailed forex return distributions for precise density estimation and risk quantification.",
  estimatedMinutes: 80,
  difficulty: "advanced",
  relatedModels: ["vae"],
  prerequisites: ["gen-vae"],
  sections: [
    {
      type: "objective",
      content: "By the end of this lesson you will understand the mathematical foundations of normalizing flows, implement coupling and autoregressive flow architectures from scratch, and apply them to model complex financial return distributions for density estimation and tail-risk measurement.",
      keyTakeaways: [
        "Derive the change of variables formula from probability conservation and compute Jacobian determinants for composed transformations",
        "Implement affine coupling layers (RealNVP) with efficiently computable triangular Jacobians and exact invertibility",
        "Contrast MAF (fast density, slow sampling) vs IAF (fast sampling, slow density) and understand when each is appropriate",
        "Understand the Glow architecture: actnorm, invertible 1×1 convolutions with LU decomposition, and multi-scale design",
        "Train normalizing flows on forex return data to capture fat tails, skewness, and volatility clustering that Gaussian models miss",
        "Use trained flow models to compute Value-at-Risk (VaR) and Conditional VaR (CVaR) from the learned density",
        "Recognize the fundamental tradeoff: flows give exact likelihoods (unlike VAEs) but require invertible architectures that constrain expressivity",
        "Apply multi-asset joint distribution modeling with flows for portfolio risk assessment"
      ]
    },
    {
      type: "theory",
      title: "Change of Variables Formula — Full Derivation",
      content: `The change of variables formula is the mathematical bedrock of normalizing flows. It tells us how probability density transforms when we warp the space through an invertible function. We begin from first principles.

**1D Derivation from Probability Conservation**

Start with a fundamental axiom: probability is conserved under a change of variables. If z is a random variable with density p_Z(z), and we define x = f(z) where f is a differentiable, invertible function, then the probability of landing in a small interval must be preserved:

    p_X(x)|dx| = p_Z(z)|dz|

Dividing both sides by |dx|:

    p_X(x) = p_Z(z) · |dz/dx| = p_Z(f⁻¹(x)) · |d(f⁻¹(x))/dx|

The term |d(f⁻¹)/dx| is the absolute value of the derivative of the inverse mapping. Equivalently, since z = f⁻¹(x), we can write |dz/dx| = 1/|df/dz|, so:

    p_X(x) = p_Z(z) / |df/dz|    where z = f⁻¹(x)

**Concrete Numerical Example (1D):** Let f(z) = z³, so z ~ N(0,1). We want p_X(x) at x = 8.

Step 1 — Find the inverse: z = f⁻¹(x) = x^(1/3) = 8^(1/3) = 2.
Step 2 — Compute the base density: p_Z(2) = (1/√(2π)) · exp(-2²/2) = (1/2.5066) · exp(-2) = 0.3989 · 0.1353 = 0.05399.
Step 3 — Compute the Jacobian (derivative): df/dz = 3z² = 3(2)² = 12. So |dz/dx| = 1/12.
Step 4 — Apply change of variables: p_X(8) = p_Z(2) · |dz/dx| = 0.05399 · (1/12) = 0.004499.

Verification: we can also compute |d(f⁻¹)/dx| = d(x^(1/3))/dx = (1/3)x^(-2/3) = (1/3)(8)^(-2/3) = (1/3)(1/4) = 1/12. Same result. ✓

**Multivariate Extension**

For z ∈ ℝᵈ and x = f(z) with f: ℝᵈ → ℝᵈ invertible and differentiable, probability conservation over volumes gives:

    p_X(x) = p_Z(f⁻¹(x)) · |det(∂f⁻¹/∂x)|

The term ∂f⁻¹/∂x is the d×d Jacobian matrix of the inverse transformation, and det(·) is its determinant. The absolute value of this determinant measures how the transformation locally shrinks or expands volume. If J_f = ∂f/∂z is the Jacobian of f, then by the inverse function theorem:

    det(∂f⁻¹/∂x) = 1 / det(J_f)

So equivalently: p_X(x) = p_Z(z) · |det(J_f)|⁻¹, where z = f⁻¹(x).

**Composed Transformations (Flow)**

A normalizing flow constructs a complex transformation as a composition of K simpler invertible transformations: x = f_K ∘ f_{K-1} ∘ ... ∘ f_1(z_0), where z_0 ~ p_0 (typically N(0,I)). Defining intermediate variables z_k = f_k(z_{k-1}), the chain rule for Jacobians gives:

    J = J_K · J_{K-1} · ... · J_1

Taking the determinant: det(J) = ∏ₖ det(J_k). In log-space (for numerical stability):

    log p(x) = log p_0(z_0) - Σₖ₌₁ᴷ log|det(J_k)|

This is the key training objective. Each flow layer f_k is designed so that (a) det(J_k) is cheap to compute (ideally O(d) not O(d³)), and (b) f_k is easily invertible. The entire art of normalizing flow design is choosing architectures that make these two properties hold while remaining expressive.

**Why the log-determinant matters:** Without the Jacobian term, the model would ignore how it distorts volume. It could concentrate all probability into a tiny region (making densities artificially high) without paying a penalty. The log|det(J)| acts as a regularizer that enforces proper probability normalization.`
    },
    {
      type: "theory",
      title: "Coupling Layers and RealNVP",
      content: `Coupling layers, introduced in NICE (Dinh et al., 2014) and extended to affine couplings in RealNVP (Dinh et al., 2016), are the most elegant solution to the invertibility and Jacobian computation challenges. The key insight: split the input dimensions into two groups and update one group as a function of the other.

**Affine Coupling Layer — Construction**

Given input z ∈ ℝᵈ, split into two partitions z = [z₁, z₂] where z₁ ∈ ℝᵈ¹ and z₂ ∈ ℝᵈ². The affine coupling transformation is:

    x₁ = z₁                                    (identity — unchanged)
    x₂ = z₂ ⊙ exp(s(z₁)) + t(z₁)             (affine transform)

where s(·) and t(·) are arbitrary neural networks (scale and translation) that take z₁ as input and output vectors of dimension d₂, and ⊙ denotes element-wise multiplication. Crucially, s and t do NOT need to be invertible — only the overall coupling layer must be.

**Jacobian Computation**

The Jacobian of this transformation has a special structure. Writing it as a block matrix:

    J = ∂x/∂z = [ ∂x₁/∂z₁  ∂x₁/∂z₂ ]   =   [ I        0              ]
                 [ ∂x₂/∂z₁  ∂x₂/∂z₂ ]       [ ∂x₂/∂z₁  diag(exp(s(z₁))) ]

This is a lower-triangular block matrix! The determinant of a triangular matrix is the product of its diagonal entries:

    det(J) = det(I) · det(diag(exp(s(z₁)))) = 1 · ∏ⱼ exp(sⱼ(z₁)) = exp(Σⱼ sⱼ(z₁))

Therefore: log|det(J)| = Σⱼ sⱼ(z₁). This is O(d) — just a sum of the scale network outputs! No matrix inversion or O(d³) determinant computation needed.

**Exact Inverse — Analytical Form**

Given output x = [x₁, x₂], inversion is trivial:

    z₁ = x₁                                    (identity)
    z₂ = (x₂ - t(x₁)) ⊙ exp(-s(x₁))          (invert the affine)

Both forward and inverse passes have the same computational cost. This is a unique advantage over autoregressive flows.

**Numerical Example (4D Input)**

Let z = [z₁, z₂, z₃, z₄] = [1.0, -0.5, 2.0, 0.3]. Split: z_A = [z₁, z₂] = [1.0, -0.5], z_B = [z₃, z₄] = [2.0, 0.3].

Suppose the scale network outputs s(z_A) = [0.5, -0.2] and the translation network outputs t(z_A) = [1.0, -1.0].

Forward pass:
    x_A = z_A = [1.0, -0.5]
    x_B = z_B ⊙ exp(s(z_A)) + t(z_A)
        = [2.0, 0.3] ⊙ [exp(0.5), exp(-0.2)] + [1.0, -1.0]
        = [2.0, 0.3] ⊙ [1.6487, 0.8187] + [1.0, -1.0]
        = [3.2974, 0.2456] + [1.0, -1.0]
        = [4.2974, -0.7544]

Output: x = [1.0, -0.5, 4.2974, -0.7544].

Log-det-Jacobian: log|det(J)| = 0.5 + (-0.2) = 0.3.

Inverse verification:
    z_A = x_A = [1.0, -0.5]
    z_B = (x_B - t(x_A)) ⊙ exp(-s(x_A))
        = ([4.2974, -0.7544] - [1.0, -1.0]) ⊙ [exp(-0.5), exp(0.2)]
        = [3.2974, 0.2456] ⊙ [0.6065, 1.2214]
        = [2.0000, 0.3000] ✓

**Alternating Masks for Full Expressivity**

A single coupling layer leaves z₁ unchanged. To ensure all dimensions are transformed, RealNVP alternates which dimensions are passed through unchanged. Layer 1 updates the second half given the first; layer 2 updates the first half given the second. After K layers (typically 4-8), all dimensions have been nonlinearly transformed multiple times. The alternation is implemented via binary masks: mask = [1,1,0,0] for even layers, mask = [0,0,1,1] for odd layers. The masked dimensions pass through unchanged; the unmasked dimensions receive the affine transformation.`
    },
    {
      type: "theory",
      title: "Autoregressive Flows: MAF and IAF",
      content: `Autoregressive flows exploit the chain rule of probability to decompose a joint distribution into a product of conditionals. They achieve triangular Jacobians by construction but face a fundamental speed asymmetry between density evaluation and sampling.

**Masked Autoregressive Flow (MAF)**

MAF (Papamakarios et al., 2017) models each dimension of x as an affine function of the corresponding z dimension, conditioned on all previous x dimensions:

    x₁ = z₁ · σ₁ + μ₁                          (no conditioning — marginal)
    x₂ = z₂ · σ₂(x₁) + μ₂(x₁)                 (conditioned on x₁)
    x₃ = z₃ · σ₃(x₁, x₂) + μ₃(x₁, x₂)        (conditioned on x₁, x₂)
    ...
    xᵢ = zᵢ · σᵢ(x₁:ᵢ₋₁) + μᵢ(x₁:ᵢ₋₁)

Here σᵢ > 0 and μᵢ are outputs of a neural network (e.g., a MADE — Masked Autoencoder for Distribution Estimation) that takes x₁:ᵢ₋₁ as input. The key property: the Jacobian ∂x/∂z is lower-triangular because xᵢ depends on zᵢ but not on zⱼ for j > i:

    ∂xᵢ/∂zⱼ = 0 for j > i,    ∂xᵢ/∂zᵢ = σᵢ

Therefore: det(J) = ∏ᵢ σᵢ, and log|det(J)| = Σᵢ log σᵢ. Again O(d).

**Numerical Example (3D):** Let z = [0.5, -1.0, 0.8] ~ N(0, I). Suppose the MADE network produces:

    Layer for x₁: μ₁ = 0.0, σ₁ = 1.0 → x₁ = 0.5 · 1.0 + 0.0 = 0.5
    Layer for x₂: given x₁ = 0.5, μ₂ = 0.3, σ₂ = 1.5 → x₂ = (-1.0)(1.5) + 0.3 = -1.2
    Layer for x₃: given x₁ = 0.5, x₂ = -1.2, μ₃ = -0.1, σ₃ = 0.8 → x₃ = 0.8 · 0.8 + (-0.1) = 0.54

    log|det(J)| = log(1.0) + log(1.5) + log(0.8) = 0 + 0.4055 + (-0.2231) = 0.1824

**Density Evaluation (Inverse Direction):** Given observed x = [0.5, -1.2, 0.54], we compute z in one parallel pass through the MADE:

    z₁ = (x₁ - μ₁)/σ₁ = (0.5 - 0.0)/1.0 = 0.5
    z₂ = (x₂ - μ₂(x₁))/σ₂(x₁) = (-1.2 - 0.3)/1.5 = -1.0
    z₃ = (x₃ - μ₃(x₁,x₂))/σ₃(x₁,x₂) = (0.54 - (-0.1))/0.8 = 0.8

All μ and σ values can be computed simultaneously with one MADE forward pass, since the conditioning variables x₁:ᵢ₋₁ are all known. This is why density evaluation is fast (single parallel forward pass).

**Sampling (Forward Direction):** To sample, we must compute sequentially:
1. Draw z ~ N(0, I) = [0.5, -1.0, 0.8]
2. Compute x₁ = z₁ · σ₁ + μ₁ (need no conditioning)
3. Compute x₂ = z₂ · σ₂(x₁) + μ₂(x₁) (need x₁ first!)
4. Compute x₃ = z₃ · σ₃(x₁, x₂) + μ₃(x₁, x₂) (need x₁, x₂ first!)

This requires d sequential network evaluations — O(d) forward passes. For d = 1000, that is 1000× slower than density evaluation.

**Inverse Autoregressive Flow (IAF)**

IAF (Kingma et al., 2016) flips the conditioning direction:

    xᵢ = zᵢ · σᵢ(z₁:ᵢ₋₁) + μᵢ(z₁:ᵢ₋₁)

Now sampling is fast (one parallel pass, since all z values are known), but density evaluation is slow (sequential, since computing z from x requires sequential inversion). This makes IAF ideal as a posterior approximation in VAEs (where sampling from the approximate posterior must be fast), while MAF is preferred for density estimation tasks (where evaluating p(x) must be fast).

**Summary of Tradeoffs:**
| Property              | MAF                    | IAF                    |
|----------------------|------------------------|------------------------|
| Density p(x)         | O(1) — one pass        | O(d) — sequential      |
| Sampling             | O(d) — sequential      | O(1) — one pass        |
| Primary use case     | Density estimation     | Variational inference  |
| Training signal      | Direct log-likelihood  | ELBO (as VAE posterior)|`
    },
    {
      type: "theory",
      title: "Glow Architecture and 1×1 Convolutions",
      content: `Glow (Kingma & Dhariwal, 2018) builds on RealNVP with three key innovations that improve expressivity and training stability: actnorm, invertible 1×1 convolutions, and a multi-scale architecture. While originally designed for images, these principles apply to any high-dimensional density estimation problem including multivariate financial time series.

**Actnorm (Activation Normalization)**

Actnorm replaces batch normalization (which is not invertible in general) with a learnable affine transformation initialized via data-dependent normalization. For input z ∈ ℝᵈ:

    x = z ⊙ s + b

where s, b ∈ ℝᵈ are learnable parameters. On the first data batch, s and b are initialized so that the output has zero mean and unit variance per dimension (like batch norm). After initialization, s and b are treated as regular trainable parameters updated by gradient descent. The log-det-Jacobian is simply: log|det(J)| = Σⱼ log|sⱼ|. For a spatial tensor of height H and width W (or a time series of length T), each channel shares one scale/bias pair, so the contribution is H·W·Σⱼlog|sⱼ| (or T·Σⱼlog|sⱼ|).

**Invertible 1×1 Convolutions**

RealNVP uses fixed permutations (alternating masks) to shuffle which dimensions get updated. Glow replaces these with learnable invertible 1×1 convolutions, which are equivalent to a learnable linear transformation W ∈ ℝᶜˣᶜ applied independently to each spatial (or temporal) position across the c channels:

    x_{h,w} = W · z_{h,w}     for each position (h, w)

The Jacobian determinant contribution per position is det(W), and over all H×W positions: log|det(J)| = H · W · log|det(W)|.

Naively computing det(W) costs O(c³). Glow's optimization: parameterize W via LU decomposition W = P · L · U, where P is a fixed permutation matrix (set once at initialization), L is lower-triangular with ones on the diagonal, and U is upper-triangular. Then:

    det(W) = det(P) · det(L) · det(U) = ±1 · 1 · ∏ᵢ Uᵢᵢ

So log|det(W)| = Σᵢ log|Uᵢᵢ|, computed in O(c) — a massive speedup from O(c³). The learnable parameters are the off-diagonal entries of L and U plus the diagonal entries of U (with a sign variable to track det(P)).

**Numerical Example (c=3 channels):** Suppose after LU decomposition:

    P = [[0,1,0],[1,0,0],[0,0,1]]  (det = -1)
    L = [[1,0,0],[0.5,1,0],[-0.3,0.2,1]]  (det = 1)
    U = [[2.0,0.4,-0.1],[0,1.5,0.3],[0,0,0.8]]

    det(W) = (-1) · 1 · (2.0 · 1.5 · 0.8) = -2.4
    log|det(W)| = log(2.4) = 0.8755
    For H=W=1 (1D series): total contribution = 1 · 0.8755 = 0.8755

**Multi-Scale Architecture**

Glow processes data at multiple resolutions. After every group of K flow steps (typically K=32), half of the dimensions are factored out — they are directly modeled by the current Gaussian and removed from further processing. This serves two purposes: (1) computational efficiency — later layers operate on smaller tensors, and (2) modeling multi-scale structure — coarse features are captured by early layers while fine details are refined by later layers.

The factoring works as follows. At level l, the representation z_l is split: z_l = [z_l^a, z_l^b]. z_l^b is output directly (modeled as Gaussian given the current transformation), while z_l^a continues through the next group of flow steps. The total log-likelihood decomposes as:

    log p(x) = log p(z_L^a) + Σₗ log p(z_l^b) + Σₗ Σₖ log|det(J_{l,k})|

This multi-scale approach halves the dimension at each level: if input is d-dimensional, after 3 levels we have d/8 dimensions in the deepest layer. For a 50-dimensional forex feature vector, this would be 50 → 25 → 12 → 6 dimensions through the levels.`
    },
    {
      type: "intuition",
      title: "Normalizing Flows as Spatial Warping",
      analogy: "Imagine you have a perfectly flat, circular pizza dough (a simple Gaussian distribution). A normalizing flow is like a series of careful stretches, folds, and reshaping operations performed by a master pizza chef. Each operation (flow layer) warps the dough in a specific way — stretching it in some directions, compressing in others — until the flat circle has been transformed into a complex shape like a croissant or pretzel (your target distribution). The magic is that every single operation is reversible: given the final pretzel shape, you can 'undo' each step to recover the original flat circle. The Jacobian determinant at each step tells you exactly how much the dough's area changed — did the chef stretch it to twice its size (det=2) or compress it to half (det=0.5)? By tracking this area change at every step, you know the exact density of dough at any point in the final shape. In finance, your 'pretzel' is the true distribution of forex returns — fat-tailed, skewed, and nothing like the original Gaussian circle.",
      content: "This analogy captures the three essential properties of normalizing flows: (1) **Invertibility** — every warping step can be undone, so you can map between the simple base distribution and the complex target in both directions. (2) **Tractable Jacobian** — the 'area change factor' is efficiently computable at each step, enabling exact log-likelihood computation. (3) **Composition** — simple individual warps compose into arbitrarily complex transformations, just as simple stretches and folds create complex pastry shapes. The key constraint is that each operation must be invertible — you can't 'cut' the dough (that would be a non-invertible operation that destroys information), which limits what individual layers can do and is why we need many layers stacked together.",
      emoji: "🥨"
    },
    {
      type: "intuition",
      title: "MAF vs IAF: The One-Way Mirror",
      analogy: "Think of a one-way assembly line in a factory. In MAF (Masked Autoregressive Flow), the assembly line is set up for quality inspection (density evaluation): you can place a finished product on the conveyor and instantly read off measurements at every station simultaneously because each station only looks backward at already-visible parts. But building a new product (sampling) requires going through the line sequentially — station 1 must finish before station 2 can start, because each station's output feeds into the next. IAF is the same factory but reversed: the assembly line is optimized for rapid production (sampling) — you can build products in one parallel burst because each station uses readily available raw materials (z values). But inspecting a finished product (density evaluation) now requires sequential disassembly. It is like the difference between a language where reading is easy but writing is hard (MAF — evaluating existing text is fast, generating new text is slow) versus a language where writing flows naturally but proofreading is painstaking (IAF).",
      content: "This asymmetry arises from the autoregressive structure. In MAF, the conditioning is on x variables. During density evaluation, all x values are observed, so the MADE network can compute all μᵢ and σᵢ in one parallel pass. During sampling, each xᵢ depends on previous x values that haven't been computed yet, forcing sequential computation. IAF conditions on z variables instead — since z is drawn all at once from the base distribution, sampling is parallel. But inverting to find z from x requires sequential 'peeling back' of each layer. In practice, if your application primarily needs to evaluate densities (e.g., computing portfolio risk metrics from observed returns), use MAF. If you primarily need to generate samples (e.g., Monte Carlo simulation of future returns), use IAF or consider coupling-layer flows like RealNVP which are fast in both directions.",
      emoji: "🪞"
    },
    {
      type: "code",
      title: "RealNVP Flow for Forex Return Modeling",
      language: "python",
      code: `import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np

class CouplingLayer(nn.Module):
    def __init__(self, dim, hidden=64, mask_even=True):
        super().__init__()
        self.mask = torch.arange(dim) % 2 == int(mask_even)
        d_in = self.mask.sum().item()
        d_out = dim - d_in
        self.scale_net = nn.Sequential(
            nn.Linear(d_in, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
            nn.Linear(hidden, d_out), nn.Tanh()  # bound scale for stability
        )
        self.trans_net = nn.Sequential(
            nn.Linear(d_in, hidden), nn.ReLU(),
            nn.Linear(hidden, hidden), nn.ReLU(),
            nn.Linear(hidden, d_out)
        )

    def forward(self, z):
        z_masked = z[:, self.mask]
        s = self.scale_net(z_masked)
        t = self.trans_net(z_masked)
        x = z.clone()
        x[:, ~self.mask] = z[:, ~self.mask] * torch.exp(s) + t
        log_det = s.sum(dim=1)
        return x, log_det

    def inverse(self, x):
        x_masked = x[:, self.mask]
        s = self.scale_net(x_masked)
        t = self.trans_net(x_masked)
        z = x.clone()
        z[:, ~self.mask] = (x[:, ~self.mask] - t) * torch.exp(-s)
        return z

class RealNVP(nn.Module):
    def __init__(self, dim, n_layers=6, hidden=64):
        super().__init__()
        self.layers = nn.ModuleList([
            CouplingLayer(dim, hidden, mask_even=(i % 2 == 0))
            for i in range(n_layers)
        ])
        self.base = torch.distributions.MultivariateNormal(
            torch.zeros(dim), torch.eye(dim)
        )

    def forward(self, z):
        log_det_total = 0
        for layer in self.layers:
            z, log_det = layer(z)
            log_det_total += log_det
        return z, log_det_total

    def log_prob(self, x):
        z = x
        log_det_total = 0
        for layer in reversed(self.layers):
            z = layer.inverse(z)
            z_masked = z[:, layer.mask]
            s = layer.scale_net(z_masked)
            log_det_total -= s.sum(dim=1)
        return self.base.log_prob(z) + log_det_total

    def sample(self, n):
        z = self.base.sample((n,))
        x, _ = self.forward(z)
        return x.detach()

# Generate synthetic fat-tailed forex returns (Student-t with df=4)
np.random.seed(42)
torch.manual_seed(42)
dim = 4  # e.g. EUR/USD, GBP/USD, USD/JPY, AUD/USD
t_samples = np.random.standard_t(df=4, size=(5000, dim)) * 0.01
data = torch.tensor(t_samples, dtype=torch.float32)

model = RealNVP(dim=dim, n_layers=8, hidden=128)
optimizer = optim.Adam(model.parameters(), lr=1e-3)

for epoch in range(200):
    idx = np.random.permutation(len(data))[:512]
    batch = data[idx]
    loss = -model.log_prob(batch).mean()
    optimizer.zero_grad()
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    optimizer.step()
    if (epoch + 1) % 50 == 0:
        print(f"Epoch {epoch+1:3d} | NLL: {loss.item():.4f}")

samples = model.sample(1000).numpy()
print(f"\\nData   — mean: {data.numpy().mean(0).round(5)}, std: {data.numpy().std(0).round(5)}")
print(f"Samples — mean: {samples.mean(0).round(5)}, std: {samples.std(0).round(5)}")
print(f"Data kurtosis:    {((data.numpy()**4).mean(0) / (data.numpy()**2).mean(0)**2).round(2)}")
print(f"Sample kurtosis:  {((samples**4).mean(0) / (samples**2).mean(0)**2).round(2)}")`,
      explanation: "This implementation builds a complete RealNVP normalizing flow with alternating coupling layers. Each coupling layer splits dimensions using even/odd masks and applies learned scale (s) and translation (t) networks. The model is trained on synthetic fat-tailed forex returns (Student-t, df=4) via maximum likelihood — minimizing negative log-probability. After training, we verify the model captures the fat tails by comparing kurtosis between real and generated samples. True kurtosis for t(df=4) is 9.0 (vs 3.0 for Gaussian), and the flow should approximate this."
    },
    {
      type: "code",
      title: "Masked Autoregressive Flow (MAF) Implementation",
      language: "python",
      code: `import torch
import torch.nn as nn
import torch.optim as optim
import numpy as np

class MaskedLinear(nn.Linear):
    """Linear layer with a binary mask on weights for autoregressive property."""
    def __init__(self, in_features, out_features, mask):
        super().__init__(in_features, out_features)
        self.register_buffer("mask", mask.float())

    def forward(self, x):
        return nn.functional.linear(x, self.weight * self.mask, self.bias)

class MADE(nn.Module):
    """Masked Autoencoder for Distribution Estimation — outputs mu and log_sigma."""
    def __init__(self, dim, hidden=128):
        super().__init__()
        # Assign ordering: input units get degrees 0..dim-1
        self.dim = dim
        m_input = torch.arange(dim)
        m_hidden = torch.arange(hidden) % (dim - 1)  # degrees 0..dim-2

        # Build masks: connection allowed if m_hidden >= m_input (layer 1)
        mask1 = (m_hidden.unsqueeze(1) >= m_input.unsqueeze(0)).float()
        # Output mask: m_output > m_hidden (strictly greater for autoregressive)
        m_output = torch.arange(dim)
        mask2 = (m_output.unsqueeze(1) > m_hidden.unsqueeze(0)).float()

        self.net = nn.Sequential(
            MaskedLinear(dim, hidden, mask1),
            nn.ReLU(),
        )
        self.mu_layer = MaskedLinear(hidden, dim, mask2)
        self.logsigma_layer = MaskedLinear(hidden, dim, mask2)

    def forward(self, x):
        h = self.net(x)
        return self.mu_layer(h), self.logsigma_layer(h).clamp(-5, 3)

class MAFLayer(nn.Module):
    def __init__(self, dim, hidden=128):
        super().__init__()
        self.made = MADE(dim, hidden)

    def forward(self, x):
        mu, log_sigma = self.made(x)
        z = (x - mu) * torch.exp(-log_sigma)
        log_det = -log_sigma.sum(dim=1)
        return z, log_det

    def inverse(self, z):
        x = torch.zeros_like(z)
        for i in range(z.shape[1]):
            mu, log_sigma = self.made(x)
            x[:, i] = z[:, i] * torch.exp(log_sigma[:, i]) + mu[:, i]
        return x

class MAF(nn.Module):
    def __init__(self, dim, n_layers=5, hidden=128):
        super().__init__()
        self.layers = nn.ModuleList([MAFLayer(dim, hidden) for _ in range(n_layers)])
        self.base = torch.distributions.MultivariateNormal(
            torch.zeros(dim), torch.eye(dim)
        )

    def log_prob(self, x):
        log_det_sum = 0
        z = x
        for layer in self.layers:
            z, log_det = layer(z)
            log_det_sum += log_det
        return self.base.log_prob(z) + log_det_sum

    def sample(self, n):
        z = self.base.sample((n,))
        x = z
        for layer in reversed(self.layers):
            x = layer.inverse(x)
        return x.detach()

# Train on bimodal mixture (challenging for single Gaussian)
np.random.seed(0); torch.manual_seed(0)
dim = 3
mix = np.random.choice(2, size=5000, p=[0.4, 0.6])
data_np = np.where(mix[:, None] == 0,
    np.random.randn(5000, dim) * 0.5 + np.array([-2, 1, 0.5]),
    np.random.randn(5000, dim) * 0.3 + np.array([2, -1, -0.5]))
data = torch.tensor(data_np, dtype=torch.float32)

model = MAF(dim=dim, n_layers=5, hidden=128)
optimizer = optim.Adam(model.parameters(), lr=5e-4)

for epoch in range(300):
    idx = torch.randperm(len(data))[:256]
    loss = -model.log_prob(data[idx]).mean()
    optimizer.zero_grad()
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    optimizer.step()
    if (epoch + 1) % 75 == 0:
        with torch.no_grad():
            val_nll = -model.log_prob(data[:500]).mean().item()
        print(f"Epoch {epoch+1:3d} | Train NLL: {loss.item():.3f} | Val NLL: {val_nll:.3f}")

samples = model.sample(2000).numpy()
print(f"\\nData  means: {data.numpy().mean(0).round(3)}")
print(f"Sample means: {samples.mean(0).round(3)}")
print(f"Data  stds:  {data.numpy().std(0).round(3)}")
print(f"Sample stds: {samples.std(0).round(3)}")`,
      explanation: "This implements a full Masked Autoregressive Flow from scratch. The MADE network uses masked weight matrices to enforce the autoregressive property — each output dimension i depends only on input dimensions 1 through i-1. The forward pass (x→z) runs in parallel for fast density evaluation. The inverse pass (z→x) for sampling is sequential: each dimension must be computed one at a time since xᵢ depends on x₁:ᵢ₋₁. The model is trained on a bimodal Gaussian mixture to demonstrate that flows can capture multi-modal distributions that a single Gaussian cannot."
    },
    {
      type: "code",
      title: "Density Estimation and VaR/CVaR via Trained Flow",
      language: "python",
      code: `import torch
import torch.nn as nn
import numpy as np

# --- Reuse RealNVP architecture (abbreviated for focus on risk metrics) ---
class CouplingLayer(nn.Module):
    def __init__(self, dim, hidden=64, mask_even=True):
        super().__init__()
        self.mask = torch.arange(dim) % 2 == int(mask_even)
        d_in, d_out = self.mask.sum().item(), dim - self.mask.sum().item()
        self.s_net = nn.Sequential(nn.Linear(d_in, hidden), nn.ReLU(),
                                   nn.Linear(hidden, d_out), nn.Tanh())
        self.t_net = nn.Sequential(nn.Linear(d_in, hidden), nn.ReLU(),
                                   nn.Linear(hidden, d_out))
    def forward(self, z):
        zm = z[:, self.mask]; s = self.s_net(zm); t = self.t_net(zm)
        x = z.clone(); x[:, ~self.mask] = z[:, ~self.mask] * torch.exp(s) + t
        return x, s.sum(1)
    def inverse(self, x):
        xm = x[:, self.mask]; s = self.s_net(xm); t = self.t_net(xm)
        z = x.clone(); z[:, ~self.mask] = (x[:, ~self.mask] - t) * torch.exp(-s)
        return z, -s.sum(1)

class FlowModel(nn.Module):
    def __init__(self, dim, n_layers=8, hidden=64):
        super().__init__()
        self.layers = nn.ModuleList([CouplingLayer(dim, hidden, i%2==0) for i in range(n_layers)])
        self.base = torch.distributions.MultivariateNormal(torch.zeros(dim), torch.eye(dim))
    def log_prob(self, x):
        z, ld = x, 0
        for layer in reversed(self.layers):
            z, l = layer.inverse(z); ld += l
        return self.base.log_prob(z) + ld
    def sample(self, n):
        z = self.base.sample((n,))
        for layer in self.layers:
            z, _ = layer(z)
        return z.detach()

# Simulate fat-tailed returns and train
torch.manual_seed(7); np.random.seed(7)
returns_np = np.random.standard_t(df=3, size=(8000, 2)) * 0.015  # 2 assets
data = torch.tensor(returns_np, dtype=torch.float32)

model = FlowModel(dim=2, n_layers=8, hidden=128)
opt = torch.optim.Adam(model.parameters(), lr=8e-4)
for ep in range(250):
    batch = data[torch.randperm(len(data))[:512]]
    loss = -model.log_prob(batch).mean()
    opt.zero_grad(); loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0); opt.step()

print("=== Flow-Based Risk Metrics ===")
# Generate large sample for Monte Carlo risk estimation
mc_samples = model.sample(50000).numpy()
weights = np.array([0.6, 0.4])  # 60/40 portfolio
portfolio_returns = mc_samples @ weights

# VaR and CVaR at multiple confidence levels
for alpha in [0.95, 0.99, 0.995]:
    var = np.percentile(portfolio_returns, (1 - alpha) * 100)
    cvar = portfolio_returns[portfolio_returns <= var].mean()
    print(f"  {alpha*100:.1f}% VaR: {var*100:+.3f}%  |  CVaR: {cvar*100:+.3f}%")

# Compare with Gaussian assumption
mu_hat = portfolio_returns.mean()
sigma_hat = portfolio_returns.std()
from scipy.stats import norm
print("\\n=== Gaussian Assumption (underestimates tail risk) ===")
for alpha in [0.95, 0.99, 0.995]:
    g_var = norm.ppf(1 - alpha, mu_hat, sigma_hat)
    print(f"  {alpha*100:.1f}% Gaussian VaR: {g_var*100:+.3f}%")

# Density evaluation at specific return scenarios
scenarios = torch.tensor([[0.0, 0.0], [-0.03, -0.03], [-0.05, -0.05], [0.03, 0.03]], dtype=torch.float32)
with torch.no_grad():
    log_probs = model.log_prob(scenarios)
print("\\n=== Scenario Log-Densities ===")
labels = ["Flat market", "Moderate crash (-3%)", "Severe crash (-5%)", "Strong rally (+3%)"]
for lbl, lp in zip(labels, log_probs):
    print(f"  {lbl:25s}: log p = {lp.item():.3f}  (p = {torch.exp(lp).item():.6f})")

print(f"\\nFlow captures excess kurtosis: {((mc_samples**4).mean(0)/(mc_samples**2).mean(0)**2).round(2)}")
print(f"(Gaussian kurtosis would be 3.0 — higher values indicate heavier tails)")`,
      explanation: "This code demonstrates the practical financial application of normalizing flows: computing Value-at-Risk (VaR) and Conditional VaR (CVaR) from the learned distribution. After training a RealNVP flow on fat-tailed return data, we generate 50,000 Monte Carlo samples to estimate tail risk for a 60/40 portfolio. The comparison with Gaussian VaR reveals how much traditional models underestimate extreme losses. We also evaluate the trained flow's density at specific return scenarios — showing the model assigns appropriately low (but non-zero) probabilities to crash events, unlike Gaussian models that assign near-zero probability to 5-sigma events."
    },
    {
      type: "quiz",
      questions: [
        {
          id: "nf-q1",
          question: "Why must every layer in a normalizing flow be invertible?",
          options: [
            { id: "nf-q1-a", text: "Invertibility is needed to compute gradients via backpropagation through the network" },
            { id: "nf-q1-b", text: "The change of variables formula requires computing f⁻¹(x) to evaluate the base density p_Z(f⁻¹(x)), and without invertibility we cannot map observed data back to the latent space" },
            { id: "nf-q1-c", text: "Invertibility ensures the model parameters are identifiable and unique" },
            { id: "nf-q1-d", text: "Non-invertible layers would cause the Jacobian determinant to always be zero" }
          ],
          correctOptionId: "nf-q1-b",
          explanation: "The exact log-likelihood computation requires evaluating log p(x) = log p_Z(f⁻¹(x)) + log|det(∂f⁻¹/∂x)|. Both terms require f⁻¹: we need it to find the corresponding latent z and to compute the Jacobian of the inverse mapping. Without invertibility, we cannot perform this mapping from data space back to the base distribution, and exact likelihood computation becomes impossible (unlike VAEs which use an approximate ELBO instead)."
        },
        {
          id: "nf-q2",
          question: "In a RealNVP affine coupling layer with input z = [z₁, z₂, z₃, z₄] using mask [1,0,1,0] (1=unchanged), if s_net outputs [0.7, -0.3] and t_net outputs [2.0, 1.0], what is log|det(J)|?",
          options: [
            { id: "nf-q2-a", text: "0.4 (sum of absolute values: |0.7| + |-0.3|)" },
            { id: "nf-q2-b", text: "0.4 (sum of scale outputs: 0.7 + (-0.3))" },
            { id: "nf-q2-c", text: "2.1 (product: 0.7 × 3.0)" },
            { id: "nf-q2-d", text: "3.0 (sum of translation outputs: 2.0 + 1.0)" }
          ],
          correctOptionId: "nf-q2-b",
          explanation: "For an affine coupling layer, the Jacobian is lower-triangular with diagonal entries being 1 (for unchanged dimensions) and exp(sⱼ) (for transformed dimensions). The determinant is the product of diagonal entries: det(J) = exp(s₁) · exp(s₂) = exp(s₁ + s₂). Therefore log|det(J)| = s₁ + s₂ = 0.7 + (-0.3) = 0.4. The translation network t does not affect the Jacobian determinant because translation is a volume-preserving operation (shifting doesn't change area/volume)."
        },
        {
          id: "nf-q3",
          question: "A MAF with d=100 dimensions needs to generate 1,000 samples and evaluate density on 1,000 data points. Approximately how many sequential MADE forward passes are needed for each task?",
          options: [
            { id: "nf-q3-a", text: "Sampling: 1,000 passes; Density: 1,000 passes" },
            { id: "nf-q3-b", text: "Sampling: 100 passes; Density: 1 pass (batched)" },
            { id: "nf-q3-c", text: "Sampling: 1 pass (batched); Density: 100 passes" },
            { id: "nf-q3-d", text: "Both: 100 passes each" }
          ],
          correctOptionId: "nf-q3-b",
          explanation: "MAF's asymmetry: Density evaluation (x→z) is parallel because all conditioning variables x₁:ᵢ₋₁ are observed — one MADE forward pass computes all μᵢ and σᵢ simultaneously, so all 1,000 data points can be processed in a single batched pass. Sampling (z→x) is sequential because computing xᵢ requires x₁:ᵢ₋₁, which haven't been generated yet. Each of the d=100 dimensions requires one MADE forward pass, totaling 100 sequential passes per sample (samples across the batch can still be parallelized). This is per MAF layer — multiply by the number of layers for the total."
        },
        {
          id: "nf-q4",
          question: "What happens to the trained normalizing flow's density estimates if you remove the log|det(J)| term from the training loss, keeping only the base density log p_Z(z)?",
          options: [
            { id: "nf-q4-a", text: "The model trains normally but converges slightly slower" },
            { id: "nf-q4-b", text: "The model collapses: it learns to map everything to a small region near z=0 (the mode of the Gaussian) to maximize p_Z(z), producing artificially high densities that don't integrate to 1" },
            { id: "nf-q4-c", text: "The model only learns the mean of the data and ignores higher-order statistics" },
            { id: "nf-q4-d", text: "The model works fine for sampling but cannot evaluate densities" }
          ],
          correctOptionId: "nf-q4-b",
          explanation: "Without the Jacobian penalty, the model is incentivized to map all data points to z ≈ 0 (the mode of the standard Gaussian base distribution) to maximize log p_Z(z). This means the flow contracts all of data space into a tiny region — a massive volume reduction. The Jacobian determinant would be near zero (huge contraction), contributing a large negative log|det(J)| penalty. By removing this penalty, the model cheats: it claims everything has high density, but the resulting p(x) doesn't integrate to 1. The Jacobian term is essential for maintaining proper normalization."
        },
        {
          id: "nf-q5",
          question: "For forex risk management, why are normalizing flows preferable to fitting a parametric Student-t distribution to return data?",
          options: [
            { id: "nf-q5-a", text: "Flows always train faster than fitting a Student-t distribution" },
            { id: "nf-q5-b", text: "Flows can capture asymmetric tails, multi-modality, time-varying tail thickness, and complex cross-asset dependence structures that a symmetric, unimodal Student-t cannot represent" },
            { id: "nf-q5-c", text: "Student-t distributions cannot model fat tails at all" },
            { id: "nf-q5-d", text: "Flows require less data to estimate tail probabilities accurately" }
          ],
          correctOptionId: "nf-q5-b",
          explanation: "A Student-t distribution is symmetric and unimodal with a single tail-thickness parameter (degrees of freedom) shared by both tails. Real forex returns exhibit: (1) skewness — left tail often heavier than right, (2) time-varying volatility clustering, (3) complex cross-asset dependence structures (not captured by a correlation matrix), and (4) potential multi-modality during regime changes. Normalizing flows learn arbitrary distributions from data, capturing all these features. The cost is requiring more data and computation, but for risk management where tail accuracy matters, this flexibility is worth the tradeoff."
        },
        {
          id: "nf-q6",
          question: "In Glow's invertible 1×1 convolution with LU decomposition (W = P·L·U), what is the computational complexity of computing log|det(W)| for c channels?",
          options: [
            { id: "nf-q6-a", text: "O(c³) — standard determinant computation" },
            { id: "nf-q6-b", text: "O(c²) — matrix multiplication cost" },
            { id: "nf-q6-c", text: "O(c) — sum of log|Uᵢᵢ| along the diagonal of U" },
            { id: "nf-q6-d", text: "O(1) — the determinant is always 1 for orthogonal matrices" }
          ],
          correctOptionId: "nf-q6-c",
          explanation: "With the LU decomposition W = P·L·U: det(P) = ±1 (constant, set at init), det(L) = 1 (unit lower triangular — ones on the diagonal), and det(U) = ∏ᵢ Uᵢᵢ (product of diagonal entries of the upper triangular matrix). Therefore log|det(W)| = log|det(P)| + log|det(U)| = 0 + Σᵢ log|Uᵢᵢ|, which requires just c additions — O(c) complexity. This is a massive improvement over the naive O(c³) determinant computation, and it's what makes invertible 1×1 convolutions practical for high-channel-count architectures."
        },
        {
          id: "nf-q7",
          question: "You train a RealNVP flow with 4 coupling layers on 2D data. After training, you notice the model perfectly captures the marginal distributions of each dimension but completely misses the correlation structure. What is the most likely cause?",
          options: [
            { id: "nf-q7-a", text: "The learning rate was too high, causing the model to overfit to marginals" },
            { id: "nf-q7-b", text: "With only 4 coupling layers using alternating [0,1]/[1,0] masks on 2D data, each dimension has been transformed only twice conditioned on the other — insufficient layers for complex dependency modeling" },
            { id: "nf-q7-c", text: "RealNVP cannot model correlations in principle — only autoregressive flows can" },
            { id: "nf-q7-d", text: "The base distribution should have been changed from N(0,I) to a correlated Gaussian" }
          ],
          correctOptionId: "nf-q7-b",
          explanation: "In 2D RealNVP with alternating masks, layer 1 transforms x₂ given x₁, layer 2 transforms x₁ given x₂, layer 3 transforms x₂ given x₁, layer 4 transforms x₁ given x₂. While each dimension is transformed twice, the conditioning is shallow — each update sees the other dimension's value from only 1-2 transformations ago. For complex correlations (e.g., non-linear dependence, tail dependence), more layers are needed so that information passes back and forth between dimensions many times. Adding more layers (8-16) typically resolves this. RealNVP absolutely can model correlations — it just needs sufficient depth."
        }
      ]
    },
    {
      type: "practice",
      title: "Flow-Based Tail Risk Assessment (VaR/CVaR)",
      description: "Train a normalizing flow on historical forex return data to estimate the full return distribution. Use the trained model to compute Value-at-Risk (VaR) and Conditional VaR (CVaR) at the 95%, 99%, and 99.5% confidence levels via Monte Carlo sampling from the flow. Compare your flow-based risk estimates against Gaussian and Student-t parametric assumptions. Investigate how the flow captures asymmetric tail behavior by separately analyzing left-tail (losses) and right-tail (gains) quantiles. Visualize the learned density against a histogram of the training data to verify the model captures fat tails and any skewness.",
      catalogModelId: "vae"
    },
    {
      type: "practice",
      title: "Multi-Asset Joint Return Distribution Modeling",
      description: "Build a normalizing flow to jointly model returns of 4+ correlated forex pairs (e.g., EUR/USD, GBP/USD, USD/JPY, AUD/USD). Train the flow to capture the full joint distribution including cross-asset tail dependence — the tendency for multiple pairs to experience extreme moves simultaneously during crises. Use the trained model to: (1) estimate joint crash probabilities (e.g., P(all pairs drop > 2%)), (2) perform conditional density estimation (e.g., distribution of GBP/USD given EUR/USD dropped 3%), and (3) compute portfolio VaR for arbitrary weight vectors by sampling from the joint distribution. Compare results against a multivariate Gaussian copula approach.",
      catalogModelId: "vae"
    }
  ]
}
