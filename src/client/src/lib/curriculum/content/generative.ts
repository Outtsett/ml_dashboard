import type { LearningPath } from "../types";

export const generativePath: LearningPath = {
  id: "generative",
  title: "Generative & Probabilistic",
  description:
    "Master generative models and Bayesian methods for financial markets. Learn to synthesize realistic market data, detect anomalies in price action, and quantify prediction uncertainty using VAEs, GANs, Gaussian Processes, and MCMC.",
  icon: "Sparkles",
  color: "pink",
  difficulty: "advanced",
  estimatedHours: 18,
  modules: [
    // ────────────────────────────────────────────────────────────
    // Module 1 — Generative Models
    // ────────────────────────────────────────────────────────────
    {
      id: "gen-models",
      title: "Generative Models",
      description:
        "Build deep generative architectures that learn the underlying distribution of financial time series and produce synthetic data indistinguishable from real markets.",
      lessons: [
        // ── Lesson 1: Variational Autoencoders ──────────────────
        {
          id: "gen-vae",
          title: "Variational Autoencoders",
          description:
            "Understand the encoder-decoder framework, latent space geometry, the ELBO objective, and the reparameterization trick — then apply VAEs to anomaly detection and synthetic return generation.",
          estimatedMinutes: 55,
          difficulty: "advanced",
          relatedModels: ["vae", "autoencoder"],
          sections: [
            {
              type: "objective",
              content:
                "By the end of this lesson you will be able to explain the VAE objective (ELBO), implement the reparameterization trick in PyTorch, and train a VAE that generates synthetic forex return distributions for anomaly detection.",
              keyTakeaways: [
                "VAEs learn a continuous latent space z ∈ ℝᵈ that captures the generating factors of market data",
                "The ELBO = 𝔼[log p(x|z)] − KL(q(z|x) ‖ p(z)) balances reconstruction fidelity and latent regularization",
                "The reparameterization trick z = μ + σ ⊙ ε enables gradient flow through stochastic sampling",
                "High reconstruction error flags anomalous price action — regime changes, flash crashes, liquidity gaps",
              ],
            },
            {
              type: "theory",
              title: "From Autoencoders to Variational Inference",
              content:
                "A standard autoencoder compresses input x into a bottleneck code and reconstructs x̂. The latent space, however, is unstructured — nearby codes may decode to wildly different outputs, making generation unreliable.\n\nVAEs impose probabilistic structure. The encoder outputs parameters μ and log σ² of a Gaussian q(z|x) = 𝒩(μ, σ²I). We sample z ~ q(z|x) and decode. Training maximizes the Evidence Lower Bound:\n\n  ELBO = 𝔼_q[log p(x|z)] − KL(q(z|x) ‖ p(z))\n\nThe first term is reconstruction likelihood; the second is a regularizer that keeps the approximate posterior close to the prior p(z) = 𝒩(0, I). For financial returns r ∈ ℝᵀ the decoder learns to reproduce the temporal correlation structure, fat tails, and volatility clustering that characterize real markets.\n\nAnomaly scoring is straightforward: compute reconstruction error ‖x − x̂‖² or the negative ELBO for a new sample — values above a threshold θ indicate out-of-distribution regimes.",
            },
            {
              type: "intuition",
              title: "The Latent Space as a Map of Market Regimes",
              analogy:
                "Think of the latent space as a map of a city. Each neighborhood (cluster in z-space) represents a distinct market regime — trending, mean-reverting, high-volatility, low-volatility. The encoder tells you which neighborhood a given price window belongs to. The decoder lets you generate realistic 'street views' (synthetic returns) from any point on the map. If a new observation lands in an empty lot — far from any known neighborhood — the VAE flags it as anomalous.",
              content:
                "The KL term acts like urban planning: it prevents the encoder from cramming all observations into a single block (mode collapse) and ensures smooth interpolation. Walking between two regime clusters produces plausible intermediate dynamics, which is essential for data augmentation and stress testing.",
              emoji: "🗺️",
            },
            {
              type: "code",
              title: "PyTorch VAE for Synthetic Forex Returns",
              language: "python",
              code: `import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np

class ForexVAE(nn.Module):
    """VAE that learns to generate synthetic forex return windows."""

    def __init__(self, window: int = 60, latent_dim: int = 8):
        super().__init__()
        # Encoder: x → (μ, log σ²)
        self.enc = nn.Sequential(
            nn.Linear(window, 128), nn.ReLU(),
            nn.Linear(128, 64), nn.ReLU(),
        )
        self.fc_mu = nn.Linear(64, latent_dim)
        self.fc_logvar = nn.Linear(64, latent_dim)
        # Decoder: z → x̂
        self.dec = nn.Sequential(
            nn.Linear(latent_dim, 64), nn.ReLU(),
            nn.Linear(64, 128), nn.ReLU(),
            nn.Linear(128, window),
        )

    def encode(self, x: torch.Tensor):
        h = self.enc(x)
        return self.fc_mu(h), self.fc_logvar(h)

    def reparameterize(self, mu: torch.Tensor, logvar: torch.Tensor):
        # z = μ + σ ⊙ ε,  ε ~ 𝒩(0, I)
        std = torch.exp(0.5 * logvar)
        eps = torch.randn_like(std)
        return mu + std * eps

    def decode(self, z: torch.Tensor):
        return self.dec(z)

    def forward(self, x):
        mu, logvar = self.encode(x)
        z = self.reparameterize(mu, logvar)
        return self.decode(z), mu, logvar


def vae_loss(x_hat, x, mu, logvar):
    """ELBO = reconstruction + KL divergence."""
    recon = F.mse_loss(x_hat, x, reduction="sum")
    kl = -0.5 * torch.sum(1 + logvar - mu.pow(2) - logvar.exp())
    return recon + kl


# ── Training loop ────────────────────────────────────────────
returns = np.random.randn(5000, 60).astype(np.float32) * 0.01
dataset = torch.from_numpy(returns)
loader = torch.utils.data.DataLoader(dataset, batch_size=128, shuffle=True)

model = ForexVAE(window=60, latent_dim=8)
optim = torch.optim.Adam(model.parameters(), lr=1e-3)

for epoch in range(20):
    total = 0.0
    for batch in loader:
        x_hat, mu, logvar = model(batch)
        loss = vae_loss(x_hat, batch, mu, logvar)
        optim.zero_grad(); loss.backward(); optim.step()
        total += loss.item()
    print(f"Epoch {epoch+1:02d}  ELBO ≈ {total / len(dataset):.4f}")

# Generate synthetic returns from the prior p(z)
with torch.no_grad():
    z_sample = torch.randn(256, 8)
    synthetic = model.decode(z_sample).numpy()
    print(f"Synthetic shape: {synthetic.shape}  μ={synthetic.mean():.5f}  σ={synthetic.std():.5f}")`,
              explanation:
                "The ForexVAE encodes 60-bar return windows into an 8-dimensional latent space. The reparameterization trick (z = μ + σ ⊙ ε) keeps the sampling differentiable. The combined loss balances MSE reconstruction against KL divergence from 𝒩(0, I). After training, sampling z ~ 𝒩(0, I) and decoding produces synthetic return sequences whose statistical properties (mean ≈ 0, realistic σ) mirror the training data.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "gen-vae-q1",
                  question:
                    "What does the KL divergence term in the ELBO objective accomplish?",
                  options: [
                    { id: "gen-vae-q1-a", text: "Minimizes reconstruction error between input and output" },
                    { id: "gen-vae-q1-b", text: "Regularizes the encoder posterior q(z|x) toward the prior p(z) = 𝒩(0, I)" },
                    { id: "gen-vae-q1-c", text: "Maximizes the mutual information between x and z" },
                    { id: "gen-vae-q1-d", text: "Prevents vanishing gradients in deep decoder networks" },
                  ],
                  correctOptionId: "gen-vae-q1-b",
                  explanation:
                    "The KL(q(z|x) ‖ p(z)) term penalizes the encoder for producing posteriors that deviate from the standard normal prior. This ensures the latent space is smooth, continuous, and suitable for generation by sampling z ~ 𝒩(0, I).",
                },
                {
                  id: "gen-vae-q2",
                  question:
                    "Why is the reparameterization trick essential for training VAEs?",
                  options: [
                    { id: "gen-vae-q2-a", text: "It reduces the memory footprint of the latent space" },
                    { id: "gen-vae-q2-b", text: "It converts the discrete sampling step into a continuous function of μ and σ so gradients can flow through z" },
                    { id: "gen-vae-q2-c", text: "It eliminates the need for a decoder network" },
                    { id: "gen-vae-q2-d", text: "It normalizes the input data to zero mean and unit variance" },
                  ],
                  correctOptionId: "gen-vae-q2-b",
                  explanation:
                    "Sampling z ~ 𝒩(μ, σ²) is a stochastic node that blocks backpropagation. The reparameterization z = μ + σ ⊙ ε moves the randomness to ε ~ 𝒩(0, I), making z a deterministic, differentiable function of the encoder outputs.",
                },
              ],
            },
            {
              type: "practice",
              title: "Anomaly Detection on Live Forex Data",
              description:
                "Train a VAE on EUR/USD 1-hour returns from your QuestDB pipeline. Score each window by reconstruction error and visualize the anomaly timeline against realized volatility spikes. Experiment with latent dimensions d ∈ {4, 8, 16} and observe how it affects the anomaly threshold.",
              catalogModelId: "vae",
            },
          ],
        },

        // ── Lesson 2: GANs for Financial Data ───────────────────
        {
          id: "gen-gan",
          title: "GANs for Financial Data",
          description:
            "Master adversarial training dynamics, understand mode collapse and training instability, and implement Wasserstein GANs tailored for generating realistic financial return distributions.",
          estimatedMinutes: 50,
          difficulty: "advanced",
          relatedModels: ["gan", "wgan"],
          prerequisites: ["gen-vae"],
          sections: [
            {
              type: "objective",
              content:
                "By the end of this lesson you will understand the minimax GAN objective, diagnose training instabilities, implement a Wasserstein GAN with gradient penalty, and generate synthetic return distributions that preserve the fat tails and volatility clustering of real forex data.",
              keyTakeaways: [
                "GANs pit a generator G(z) against a discriminator D(x) in a minimax game: min_G max_D 𝔼[log D(x)] + 𝔼[log(1 − D(G(z)))]",
                "Mode collapse occurs when G produces only a narrow subset of the true distribution — critical for financial data where tail events matter",
                "Wasserstein distance (Earth Mover's) provides smoother gradients and more stable training than JS divergence",
                "TimeGAN extends the framework with an embedding network and supervised loss to preserve temporal dynamics",
              ],
            },
            {
              type: "theory",
              title: "Adversarial Training & the Wasserstein Objective",
              content:
                "The original GAN objective minimizes the Jensen-Shannon divergence between the real distribution p_data and the generated distribution p_G. When the supports of these distributions don't overlap — common in early training — JS divergence saturates and gradients vanish.\n\nThe Wasserstein GAN (WGAN) replaces JS with the Earth Mover's distance W(p_data, p_G), which metrizes weak convergence and provides informative gradients everywhere:\n\n  W(p_data, p_G) = sup_{‖f‖_L ≤ 1} 𝔼_{x~p_data}[f(x)] − 𝔼_{x~p_G}[f(x)]\n\nThe Lipschitz constraint ‖f‖_L ≤ 1 is enforced via gradient penalty (WGAN-GP):\n\n  λ 𝔼_{x̂}[(‖∇_{x̂} D(x̂)‖₂ − 1)²]\n\nwhere x̂ = αx + (1−α)G(z) is an interpolation between real and fake samples. For financial time series, the critic D should process temporal structure — 1D convolutions or small LSTMs work well. The generator should output sequences whose autocorrelation, kurtosis, and volatility clustering statistics match real market data.",
            },
            {
              type: "intuition",
              title: "The Counterfeiter and the Detective",
              analogy:
                "Imagine a counterfeiter (Generator) trying to print banknotes and a detective (Discriminator) inspecting them. Early on, the fakes are obvious — wrong paper, blurry ink. The detective catches everything. But each round, the counterfeiter improves. In WGAN terms, instead of a binary 'real/fake' verdict, the detective gives a continuous quality score — 'this note scores 7.2, real ones score 9.5' — which gives the counterfeiter actionable feedback even when all notes are still clearly fake.",
              content:
                "Mode collapse is like the counterfeiter discovering that one denomination (say $20) fools the detective most often and only printing $20s — ignoring $5s, $10s, $50s, and $100s. Gradient penalty forces the detective to remain calibrated across the full range, preventing this degenerate equilibrium. For markets, this means the GAN must faithfully reproduce both calm periods and extreme tail events.",
              emoji: "🕵️",
            },
            {
              type: "code",
              title: "WGAN-GP for Synthetic Return Distributions",
              language: "python",
              code: `import torch
import torch.nn as nn
import numpy as np

class Generator(nn.Module):
    def __init__(self, noise_dim: int = 16, out_dim: int = 60):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(noise_dim, 64), nn.ReLU(),
            nn.Linear(64, 128), nn.ReLU(),
            nn.Linear(128, out_dim),
        )

    def forward(self, z):
        return self.net(z)


class Critic(nn.Module):
    def __init__(self, in_dim: int = 60):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, 128), nn.LeakyReLU(0.2),
            nn.Linear(128, 64), nn.LeakyReLU(0.2),
            nn.Linear(64, 1),
        )

    def forward(self, x):
        return self.net(x)


def gradient_penalty(critic, real, fake, device="cpu", lam=10.0):
    """WGAN-GP: penalize ‖∇_x̂ D(x̂)‖₂ deviating from 1."""
    alpha = torch.rand(real.size(0), 1, device=device)
    x_hat = (alpha * real + (1 - alpha) * fake).requires_grad_(True)
    scores = critic(x_hat)
    grads = torch.autograd.grad(
        scores, x_hat, grad_outputs=torch.ones_like(scores),
        create_graph=True, retain_graph=True,
    )[0]
    return lam * ((grads.norm(2, dim=1) - 1) ** 2).mean()


# ── Synthetic data (replace with real OHLCV returns) ─────────
real_returns = np.random.standard_t(df=5, size=(4000, 60)).astype(np.float32) * 0.005
real_tensor = torch.from_numpy(real_returns)

G = Generator(noise_dim=16, out_dim=60)
C = Critic(in_dim=60)
opt_G = torch.optim.Adam(G.parameters(), lr=1e-4, betas=(0.0, 0.9))
opt_C = torch.optim.Adam(C.parameters(), lr=1e-4, betas=(0.0, 0.9))

n_critic = 5
for epoch in range(30):
    idx = torch.randperm(len(real_tensor))
    for i in range(0, len(idx) - 128, 128):
        batch = real_tensor[idx[i:i + 128]]
        # ── Train Critic n_critic times ──
        for _ in range(n_critic):
            z = torch.randn(128, 16)
            fake = G(z).detach()
            loss_C = C(fake).mean() - C(batch).mean() + gradient_penalty(C, batch, fake)
            opt_C.zero_grad(); loss_C.backward(); opt_C.step()
        # ── Train Generator ──
        z = torch.randn(128, 16)
        loss_G = -C(G(z)).mean()
        opt_G.zero_grad(); loss_G.backward(); opt_G.step()
    print(f"Epoch {epoch+1:02d}  W ≈ {-loss_C.item():.4f}  G_loss = {loss_G.item():.4f}")

# ── Evaluate: compare kurtosis of real vs synthetic ──────────
from scipy.stats import kurtosis
with torch.no_grad():
    synth = G(torch.randn(1000, 16)).numpy()
print(f"Real kurtosis:  {kurtosis(real_returns.flatten()):.2f}")
print(f"Synth kurtosis: {kurtosis(synth.flatten()):.2f}")`,
              explanation:
                "The Critic outputs an unbounded score (not a probability) — the Wasserstein objective maximizes the gap between real and fake scores. Gradient penalty constrains the critic to be 1-Lipschitz by penalizing gradient norms along interpolations x̂. The generator is trained less frequently (1:5 ratio) to let the critic converge first. We validate by comparing the kurtosis of synthetic returns to the heavy-tailed real data (Student-t with df=5).",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "gen-gan-q1",
                  question:
                    "What problem does the Wasserstein distance solve compared to JS divergence in GANs?",
                  options: [
                    { id: "gen-gan-q1-a", text: "It requires less training data" },
                    { id: "gen-gan-q1-b", text: "It provides meaningful gradients even when real and generated distributions have non-overlapping supports" },
                    { id: "gen-gan-q1-c", text: "It eliminates the need for a discriminator network" },
                    { id: "gen-gan-q1-d", text: "It guarantees convergence in a fixed number of epochs" },
                  ],
                  correctOptionId: "gen-gan-q1-b",
                  explanation:
                    "When p_data and p_G have disjoint supports (common early in training), JS divergence saturates at log 2, yielding zero gradients. The Wasserstein (Earth Mover's) distance varies smoothly with the distance between supports, providing informative gradients throughout training.",
                },
                {
                  id: "gen-gan-q2",
                  question:
                    "Why is mode collapse especially dangerous when generating financial data?",
                  options: [
                    { id: "gen-gan-q2-a", text: "It causes the model to overfit to the training set" },
                    { id: "gen-gan-q2-b", text: "It makes the generator produce only calm-market returns, omitting critical tail events like crashes and squeezes" },
                    { id: "gen-gan-q2-c", text: "It increases the computational cost of training" },
                    { id: "gen-gan-q2-d", text: "It prevents the discriminator from converging" },
                  ],
                  correctOptionId: "gen-gan-q2-b",
                  explanation:
                    "Mode collapse means the generator covers only a fraction of the true distribution. For financial data, this typically means generating only normal-volatility returns while failing to reproduce the fat tails — extreme drawdowns, gap opens, and volatility spikes — that are essential for realistic risk assessment.",
                },
                {
                  id: "gen-gan-q3",
                  question:
                    "In WGAN-GP, the gradient penalty is computed over which samples?",
                  options: [
                    { id: "gen-gan-q3-a", text: "Only real samples from the training set" },
                    { id: "gen-gan-q3-b", text: "Only fake samples from the generator" },
                    { id: "gen-gan-q3-c", text: "Random interpolations x̂ = αx_real + (1−α)x_fake between real and generated samples" },
                    { id: "gen-gan-q3-d", text: "The latent noise vectors z fed to the generator" },
                  ],
                  correctOptionId: "gen-gan-q3-c",
                  explanation:
                    "The gradient penalty enforces the 1-Lipschitz constraint on the critic by sampling points x̂ along straight lines between real and generated samples — where violations are most likely to occur — and penalizing ‖∇_{x̂} D(x̂)‖₂ deviating from 1.",
                },
              ],
            },
            {
              type: "practice",
              title: "TimeGAN for Multi-Asset Synthetic Series",
              description:
                "Extend the WGAN-GP to a TimeGAN architecture: add an embedding network and a supervised loss that captures step-by-step temporal dynamics. Train on 4-hour returns from EUR/USD, GBP/USD, and USD/JPY. Evaluate using t-SNE visualization of real vs. synthetic embeddings and compare autocorrelation functions at lags 1–20.",
              catalogModelId: "gan",
            },
          ],
        },
      ],
    },

    // ────────────────────────────────────────────────────────────
    // Module 2 — Bayesian Methods
    // ────────────────────────────────────────────────────────────
    {
      id: "bayesian",
      title: "Bayesian Methods",
      description:
        "Embrace uncertainty as a first-class citizen. Learn to update beliefs with data using Bayes' theorem, quantify parameter uncertainty with MCMC, and make non-parametric predictions with Gaussian Processes.",
      lessons: [
        // ── Lesson 1: Bayesian Inference ────────────────────────
        {
          id: "gen-bayesian",
          title: "Bayesian Inference",
          description:
            "Learn prior-posterior updating, conjugate priors, Markov Chain Monte Carlo, and how Bayesian uncertainty quantification gives you confidence intervals that frequentist point estimates cannot.",
          estimatedMinutes: 50,
          difficulty: "advanced",
          relatedModels: ["bayesian-regression"],
          sections: [
            {
              type: "objective",
              content:
                "By the end of this lesson you will be able to derive posterior distributions for simple conjugate models, implement a Metropolis-Hastings MCMC sampler, and interpret Bayesian credible intervals for trading signal parameters.",
              keyTakeaways: [
                "Bayes' theorem: p(θ|D) = p(D|θ) · p(θ) / p(D) — posterior ∝ likelihood × prior",
                "Conjugate priors yield closed-form posteriors: Normal-Normal, Beta-Binomial, Gamma-Poisson",
                "MCMC (Metropolis-Hastings, HMC) samples from p(θ|D) when closed-form solutions don't exist",
                "Bayesian credible intervals reflect genuine parameter uncertainty, not just sampling variability",
              ],
            },
            {
              type: "theory",
              title: "From Priors to Posteriors via MCMC",
              content:
                "Bayesian inference treats model parameters θ as random variables. We start with a prior belief p(θ) — perhaps that the mean daily return μ of EUR/USD is close to zero — and update it with observed data D via Bayes' theorem:\n\n  p(θ|D) ∝ p(D|θ) · p(θ)\n\nFor a Gaussian likelihood with known variance σ² and a Gaussian prior μ ~ 𝒩(μ₀, τ₀²), the posterior is also Gaussian:\n\n  μ|D ~ 𝒩( (τ₀⁻² μ₀ + n σ⁻² x̄) / (τ₀⁻² + n σ⁻²) ,  1 / (τ₀⁻² + n σ⁻²) )\n\nThe posterior mean is a precision-weighted average of the prior mean and the sample mean — more data pulls the estimate toward x̄.\n\nWhen conjugacy is unavailable (e.g., regime-switching models, non-linear signal functions), MCMC constructs a Markov chain whose stationary distribution is p(θ|D). Metropolis-Hastings proposes θ* ~ q(θ*|θ) and accepts with probability min(1, [p(θ*|D) q(θ|θ*)] / [p(θ|D) q(θ*|θ)]). After a burn-in period, the chain samples approximate the posterior.",
            },
            {
              type: "intuition",
              title: "Updating Your Market View Like a Bayesian",
              analogy:
                "You're a portfolio manager with a prior belief: 'EUR/USD tends to drift up ~2 pips/day on average.' Each day of new data is like a new piece of evidence that either reinforces or weakens this belief. After 5 days of strong down-moves, your posterior shifts toward a negative drift. The key insight: you never throw away your prior completely — you blend it with evidence, weighted by how confident each source is. A vague prior (wide σ) gets overridden quickly; a strong prior (narrow σ) takes more data to move.",
              content:
                "MCMC is like exploring a mountain range in fog. You can't see the whole landscape (posterior), but by walking uphill more often than downhill (accept/reject) and recording your GPS coordinates at each step, you eventually map out where the high-probability peaks and ridges are — even in a complex, multi-modal terrain.",
              emoji: "🔮",
            },
            {
              type: "code",
              title: "Bayesian Linear Regression via MCMC",
              language: "python",
              code: `import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

np.random.seed(42)

# ── Simulate: return_t = α + β · momentum_t + ε ─────────────
n = 200
momentum = np.random.randn(n)
alpha_true, beta_true, sigma_true = 0.001, 0.005, 0.01
returns = alpha_true + beta_true * momentum + np.random.normal(0, sigma_true, n)

# ── Log-posterior (Gaussian likelihood + flat priors) ────────
def log_posterior(alpha, beta, log_sigma, x=momentum, y=returns):
    sigma = np.exp(log_sigma)
    residuals = y - alpha - beta * x
    ll = -n * np.log(sigma) - 0.5 * np.sum((residuals / sigma) ** 2)
    # Weakly informative priors: 𝒩(0, 1) on α, β; 𝒩(0, 2) on log σ
    lp = -0.5 * (alpha**2 + beta**2 + (log_sigma / 2)**2)
    return ll + lp

# ── Metropolis-Hastings sampler ──────────────────────────────
n_samples, burn_in = 10_000, 2_000
samples = np.zeros((n_samples, 3))
current = np.array([0.0, 0.0, np.log(0.01)])
current_lp = log_posterior(*current)
proposal_scale = np.array([0.001, 0.002, 0.1])
accepted = 0

for i in range(n_samples):
    proposal = current + proposal_scale * np.random.randn(3)
    prop_lp = log_posterior(*proposal)
    if np.log(np.random.rand()) < prop_lp - current_lp:
        current, current_lp = proposal, prop_lp
        accepted += 1
    samples[i] = current

posterior = samples[burn_in:]
print(f"Acceptance rate: {accepted / n_samples:.1%}")
print(f"α  posterior: μ={posterior[:,0].mean():.5f}  95% CI [{np.percentile(posterior[:,0], 2.5):.5f}, {np.percentile(posterior[:,0], 97.5):.5f}]")
print(f"β  posterior: μ={posterior[:,1].mean():.5f}  95% CI [{np.percentile(posterior[:,1], 2.5):.5f}, {np.percentile(posterior[:,1], 97.5):.5f}]")
print(f"σ  posterior: μ={np.exp(posterior[:,2]).mean():.5f}")`,
              explanation:
                "We model returns as a linear function of a momentum signal with Gaussian noise. The log-posterior combines a Gaussian log-likelihood with weakly informative 𝒩(0,1) priors on α and β. Metropolis-Hastings proposes new (α, β, log σ) values and accepts them proportionally to the posterior ratio. After discarding the burn-in, the remaining samples approximate p(θ|D). The 95% credible intervals directly quantify our uncertainty about the momentum coefficient β.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "gen-bayes-q1",
                  question:
                    "In Bayesian inference, what happens to the posterior as the amount of observed data n → ∞?",
                  options: [
                    { id: "gen-bayes-q1-a", text: "It converges to the prior distribution regardless of the data" },
                    { id: "gen-bayes-q1-b", text: "It concentrates around the true parameter value, overwhelming the prior" },
                    { id: "gen-bayes-q1-c", text: "It becomes uniform over all possible parameter values" },
                    { id: "gen-bayes-q1-d", text: "It oscillates between the prior and the maximum likelihood estimate" },
                  ],
                  correctOptionId: "gen-bayes-q1-b",
                  explanation:
                    "As n grows, the likelihood dominates the prior. Under regularity conditions, the posterior concentrates around the MLE (Bernstein-von Mises theorem). The prior's influence vanishes — it only matters when data is scarce.",
                },
                {
                  id: "gen-bayes-q2",
                  question:
                    "What is the purpose of the burn-in period in MCMC sampling?",
                  options: [
                    { id: "gen-bayes-q2-a", text: "To pre-compute the normalizing constant p(D)" },
                    { id: "gen-bayes-q2-b", text: "To allow the chain to converge from its arbitrary starting point to the stationary (posterior) distribution" },
                    { id: "gen-bayes-q2-c", text: "To reduce the dimensionality of the parameter space" },
                    { id: "gen-bayes-q2-d", text: "To estimate the prior distribution from the data" },
                  ],
                  correctOptionId: "gen-bayes-q2-b",
                  explanation:
                    "The MCMC chain is initialized at an arbitrary point that may be far from the high-probability region of the posterior. Burn-in samples are discarded because they reflect the chain's transient behavior, not the stationary distribution we want to approximate.",
                },
              ],
            },
            {
              type: "practice",
              title: "Bayesian Regime Detection with PyMC",
              description:
                "Use PyMC to build a Bayesian regime-switching model for EUR/USD daily returns. Define two latent states (trending, mean-reverting), each with its own μ and σ, plus a transition matrix. Sample the posterior with NUTS (No-U-Turn Sampler) and visualize the posterior probability of each regime over time. Compare with a frequentist HMM fit.",
              catalogModelId: "bayesian-regression",
            },
          ],
        },

        // ── Lesson 2: Gaussian Processes ────────────────────────
        {
          id: "gen-gp",
          title: "Gaussian Processes",
          description:
            "Explore non-parametric Bayesian regression with Gaussian Processes. Learn kernel functions, posterior predictive distributions, and how GP uncertainty bands provide principled confidence intervals for price and volatility forecasts.",
          estimatedMinutes: 50,
          difficulty: "advanced",
          relatedModels: ["gaussian-process"],
          prerequisites: ["gen-bayesian"],
          sections: [
            {
              type: "objective",
              content:
                "By the end of this lesson you will understand how Gaussian Processes define distributions over functions, select and combine kernel functions, compute the posterior predictive, and apply GP regression to forex price forecasting with calibrated uncertainty bands.",
              keyTakeaways: [
                "A GP is fully specified by its mean function m(x) and kernel k(x, x′): f ~ GP(m, k)",
                "The posterior predictive at test points x* is Gaussian: f*|X, y, x* ~ 𝒩(μ*, Σ*) with closed-form μ* and Σ*",
                "Common kernels: RBF (smooth), Matérn (tunable roughness ν), Periodic (seasonality), their sums and products",
                "GP uncertainty bands widen where training data is sparse — a natural guardrail for out-of-sample predictions",
              ],
            },
            {
              type: "theory",
              title: "Functions as Random Variables: The GP Framework",
              content:
                "A Gaussian Process places a prior over functions: any finite collection of function values f(x₁), …, f(xₙ) is jointly Gaussian. The kernel k(xᵢ, xⱼ) specifies how correlated function values at different inputs are.\n\nGiven training inputs X and outputs y = f(X) + ε with noise variance σ²_n, the posterior predictive at test points x* is:\n\n  μ* = K(x*, X) [K(X, X) + σ²_n I]⁻¹ y\n  Σ* = K(x*, x*) − K(x*, X) [K(X, X) + σ²_n I]⁻¹ K(X, x*)\n\nThe RBF kernel k(x, x′) = σ² exp(−‖x − x′‖² / 2ℓ²) produces smooth functions; the length-scale ℓ controls how quickly correlations decay with distance. The Matérn kernel generalizes this with a roughness parameter ν — Matérn-3/2 and Matérn-5/2 are popular for financial data because they allow the function to be less smooth than RBF assumes.\n\nFor volatility surface modeling, kernels can be composed: a product of RBF (over moneyness) and Matérn (over time-to-expiry) captures different smoothness scales along each axis. Kernel hyperparameters are optimized by maximizing the log marginal likelihood log p(y|X, θ).",
            },
            {
              type: "intuition",
              title: "Drawing Curves Through Uncertain Territory",
              analogy:
                "Imagine you're sketching a mountain range on a foggy day. Where you can see peaks clearly (training data), your sketch is precise and confident. Between peaks, you interpolate — but your pencil strokes become wider and fuzzier, reflecting genuine uncertainty. Far beyond any visible peak, the sketch reverts to a generic prior (flat, with wide error bars). A GP works exactly this way: tight predictions near data, honest uncertainty elsewhere.",
              content:
                "The kernel is your artistic style — RBF produces gentle rolling hills (smooth interpolation), Matérn allows jagged cliffs (rougher functions), and a Periodic kernel captures repeating patterns. Composing kernels is like combining techniques: 'smooth overall trend × seasonal oscillation + noise' can model a currency pair's intraday pattern with appropriate uncertainty.",
              emoji: "⛰️",
            },
            {
              type: "code",
              title: "GP Regression for Price Prediction with Uncertainty",
              language: "python",
              code: `import numpy as np
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import Matern, WhiteKernel, ConstantKernel

np.random.seed(42)

# ── Simulate daily mid-prices with trend + noise ─────────────
n_days = 120
t = np.arange(n_days).reshape(-1, 1).astype(float)
trend = 1.0800 + 0.0002 * t.ravel()
noise = np.cumsum(np.random.normal(0, 0.001, n_days))
prices = trend + noise

# ── Train on first 100 days, predict next 20 ────────────────
t_train, y_train = t[:100], prices[:100]
t_test = t[100:]

# Composite kernel: Matérn-5/2 (trend) + WhiteKernel (noise)
kernel = (
    ConstantKernel(1.0, constant_value_bounds=(1e-3, 1e3))
    * Matern(length_scale=10.0, nu=2.5, length_scale_bounds=(1.0, 100.0))
    + WhiteKernel(noise_level=1e-5, noise_level_bounds=(1e-8, 1e-2))
)

gp = GaussianProcessRegressor(kernel=kernel, n_restarts_optimizer=10)
gp.fit(t_train, y_train)

# Posterior predictive: μ* ± 2σ*
mu_star, sigma_star = gp.predict(t_test, return_std=True)

print("GP Kernel (optimized):", gp.kernel_)
print(f"Log marginal likelihood: {gp.log_marginal_likelihood_value_:.2f}")
print(f"\\nForecast for days 100–119:")
for i in range(len(t_test)):
    lo, hi = mu_star[i] - 2 * sigma_star[i], mu_star[i] + 2 * sigma_star[i]
    actual = prices[100 + i]
    hit = "✓" if lo <= actual <= hi else "✗"
    print(f"  Day {100+i}: μ*={mu_star[i]:.5f}  95% CI [{lo:.5f}, {hi:.5f}]  actual={actual:.5f} {hit}")

coverage = np.mean(
    (prices[100:] >= mu_star - 2 * sigma_star)
    & (prices[100:] <= mu_star + 2 * sigma_star)
)
print(f"\\n95% CI coverage: {coverage:.0%}")`,
              explanation:
                "We fit a GP with a Matérn-5/2 × Constant + White kernel to 100 days of simulated EUR/USD mid-prices. The Matérn kernel captures the trend's smoothness while allowing some roughness. After fitting, predict() returns the posterior mean μ* and standard deviation σ*. The 95% confidence intervals (μ* ± 2σ*) naturally widen as we forecast further into the future, reflecting growing uncertainty. Coverage should be near 95% if the model is well-calibrated.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "gen-gp-q1",
                  question:
                    "What happens to GP posterior uncertainty as test points move further from the training data?",
                  options: [
                    { id: "gen-gp-q1-a", text: "Uncertainty decreases because the model extrapolates the learned trend" },
                    { id: "gen-gp-q1-b", text: "Uncertainty increases and eventually reverts to the prior variance" },
                    { id: "gen-gp-q1-c", text: "Uncertainty remains constant regardless of distance from training data" },
                    { id: "gen-gp-q1-d", text: "Uncertainty oscillates due to the periodic component of the kernel" },
                  ],
                  correctOptionId: "gen-gp-q1-b",
                  explanation:
                    "Far from training data, the posterior covariance Σ* approaches the prior covariance K(x*, x*) because the conditioning on observed data has diminishing influence. This is a key strength: the GP honestly reports 'I don't know' in data-sparse regions.",
                },
                {
                  id: "gen-gp-q2",
                  question:
                    "Why is the Matérn kernel often preferred over RBF for financial time series?",
                  options: [
                    { id: "gen-gp-q2-a", text: "Matérn kernels are computationally cheaper to evaluate" },
                    { id: "gen-gp-q2-b", text: "Matérn kernels allow tunable roughness via the ν parameter, producing functions that aren't unrealistically smooth" },
                    { id: "gen-gp-q2-c", text: "Matérn kernels guarantee positive-definite covariance matrices while RBF does not" },
                    { id: "gen-gp-q2-d", text: "Matérn kernels automatically detect seasonality in the data" },
                  ],
                  correctOptionId: "gen-gp-q2-b",
                  explanation:
                    "The RBF kernel produces infinitely differentiable (very smooth) functions, which may be unrealistic for financial data with sudden moves and regime shifts. The Matérn kernel's ν parameter controls smoothness: ν = 1/2 gives rough (Ornstein-Uhlenbeck-like) paths, ν = 3/2 is once-differentiable, and ν → ∞ recovers RBF. Financial data typically suits ν ∈ {3/2, 5/2}.",
                },
                {
                  id: "gen-gp-q3",
                  question:
                    "How are GP kernel hyperparameters (length-scale ℓ, signal variance σ²) typically optimized?",
                  options: [
                    { id: "gen-gp-q3-a", text: "By cross-validation on a held-out test set" },
                    { id: "gen-gp-q3-b", text: "By maximizing the log marginal likelihood log p(y|X, θ)" },
                    { id: "gen-gp-q3-c", text: "By minimizing the mean squared error on the training set" },
                    { id: "gen-gp-q3-d", text: "By grid search over a predefined set of values" },
                  ],
                  correctOptionId: "gen-gp-q3-b",
                  explanation:
                    "The log marginal likelihood log p(y|X, θ) = −½ yᵀ K⁻¹ y − ½ log|K| − n/2 log 2π naturally balances data fit (first term) against model complexity (second term). Maximizing it with gradient-based optimization yields hyperparameters that avoid both underfitting and overfitting without a separate validation set.",
                },
              ],
            },
            {
              type: "practice",
              title: "GP Volatility Surface Modeling",
              description:
                "Build a 2D Gaussian Process to model the implied volatility surface of EUR/USD options. Use moneyness (strike/spot) and time-to-expiry as inputs. Experiment with product kernels: Matérn(moneyness) × RBF(expiry). Visualize the posterior mean surface and ±2σ uncertainty bands as a 3D plot. Compare GP-predicted IVs against market quotes.",
              catalogModelId: "gaussian-process",
            },
          ],
        },
      ],
    },
  ],
};
