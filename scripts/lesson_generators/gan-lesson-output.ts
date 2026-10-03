export default {
  id: "gen-gan",
  title: "GANs for Financial Data",
  description: "A deep dive into Generative Adversarial Networks for financial time-series synthesis, covering the minimax objective, Nash equilibrium, training instability, Wasserstein GANs with gradient penalty, conditional GANs, and TimeGAN architectures for generating realistic forex price paths and multi-asset synthetic data.",
  estimatedMinutes: 80,
  difficulty: "advanced" as const,
  relatedModels: ["gan", "wgan"],
  prerequisites: ["gen-vae"],
  sections: [
    // ─── OBJECTIVE ──────────────────────────────────────────────────────
    {
      type: "objective" as const,
      content: "This lesson equips you with a rigorous understanding of Generative Adversarial Networks and their specialised variants for financial time-series generation. You will derive the minimax value function from first principles, prove the optimal discriminator, analyse training pathologies such as mode collapse and vanishing gradients, and master the Wasserstein distance framework that resolves them. By the end you will be able to implement WGAN-GP, conditional GANs, and TimeGAN-inspired architectures in PyTorch to produce statistically faithful synthetic forex data.",
      keyTakeaways: [
        "Derive the GAN minimax objective V(G,D) and prove the optimal discriminator D*(x) = p_data(x) / (p_data(x) + p_g(x))",
        "Show that minimising the generator objective is equivalent to minimising 2·JSD(p_data || p_g) − log 4",
        "Identify mode collapse and vanishing-gradient failure modes and explain their root causes in terms of support overlap",
        "Define the Earth Mover (Wasserstein-1) distance and state the Kantorovich–Rubinstein duality theorem",
        "Implement WGAN-GP with the gradient penalty term λ E[(||∇D(x̂)||₂ − 1)²] enforcing the Lipschitz constraint",
        "Construct conditional GANs that condition on volatility regime labels for targeted scenario generation",
        "Build a TimeGAN-inspired architecture with embedding, recovery, supervised, and adversarial losses for temporal coherence",
        "Validate synthetic forex paths using distributional tests (KS, ACF of squared returns, fat-tail statistics)"
      ],
    },

    // ─── THEORY 1: Minimax Objective and Nash Equilibrium ───────────────
    {
      type: "theory" as const,
      title: "The Minimax Objective and Nash Equilibrium",
      content: `A Generative Adversarial Network consists of two neural networks—a generator G and a discriminator D—trained simultaneously in a two-player minimax game. The generator maps a latent vector z ~ p_z(z) (typically standard normal) to a synthetic sample G(z), while the discriminator outputs a scalar D(x) ∈ (0,1) representing the probability that x came from the real data distribution p_data rather than the generator distribution p_g. The value function of this game is:

V(G, D) = E_{x ~ p_data}[log D(x)] + E_{z ~ p_z}[log(1 − D(G(z)))]

The discriminator wants to maximise V (correctly classify reals as 1 and fakes as 0), while the generator wants to minimise V (fool the discriminator). Formally: min_G max_D V(G, D). This is the foundational equation of GAN training.

To find the optimal discriminator for a fixed generator, we write V as an integral over x. For each x the integrand is: p_data(x) log D(x) + p_g(x) log(1 − D(x)). Treating D(x) as a free variable a ∈ (0,1), we maximise f(a) = α log a + β log(1 − a) where α = p_data(x) and β = p_g(x). Taking the derivative: f'(a) = α/a − β/(1 − a) = 0  ⟹  α(1 − a) = βa  ⟹  a = α/(α + β). Therefore the optimal discriminator is D*(x) = p_data(x) / (p_data(x) + p_g(x)). As a concrete numerical example: suppose at a particular point x₀ the true density is p_data(x₀) = 0.8 and the generator density is p_g(x₀) = 0.3. Then D*(x₀) = 0.8 / (0.8 + 0.3) = 0.8 / 1.1 ≈ 0.727. The discriminator assigns about 72.7% probability that x₀ is real—sensible because p_data > p_g there.

Now substitute D* back into V to obtain the generator's cost C(G). We get C(G) = E_{x ~ p_data}[log(p_data(x)/(p_data(x)+p_g(x)))] + E_{x ~ p_g}[log(p_g(x)/(p_data(x)+p_g(x)))]. Add and subtract log 2 inside each expectation: log(p_data/(p_data+p_g)) = log(2 · p_data/(p_data+p_g)) − log 2 = log(p_data / ((p_data+p_g)/2)) − log 2. Recognising the KL divergence pattern: C(G) = −log 4 + KL(p_data || m) + KL(p_g || m) where m = (p_data + p_g)/2. The sum of these two KL divergences is exactly 2 · JSD(p_data || p_g), the Jensen–Shannon divergence. Therefore C(G) = −log 4 + 2 · JSD(p_data || p_g). Since JSD ≥ 0 and equals 0 if and only if p_data = p_g, the global minimum C(G) = −log 4 is achieved precisely when the generator perfectly replicates the data distribution.

This result reveals the Nash equilibrium of the game: at equilibrium p_g = p_data and D*(x) = 1/2 everywhere—the discriminator cannot distinguish real from fake. In financial terms, if G perfectly learned the distribution of EUR/USD 5-minute log-returns, no statistical test (the discriminator) could tell synthetic paths from historical ones. The equilibrium value −log 4 ≈ −1.386 serves as a theoretical lower bound for the generator loss. In practice we never reach it exactly, but monitoring how close C(G) approaches −1.386 provides a useful convergence diagnostic.`,
    },

    // ─── THEORY 2: Training Instability ─────────────────────────────────
    {
      type: "theory" as const,
      title: "Training Instability: Mode Collapse and Vanishing Gradients",
      content: `Despite the elegant theory, training GANs is notoriously unstable. Two primary pathologies plague standard GAN training: vanishing gradients and mode collapse. Understanding their root causes is essential before we introduce the Wasserstein fix.

Vanishing gradients arise when the discriminator becomes too strong too quickly. When p_data and p_g have disjoint or nearly disjoint supports (which is common in high dimensions—two low-dimensional manifolds generically do not overlap), the discriminator can achieve near-perfect classification. In this regime D(x) → 1 for real data and D(G(z)) → 0 for fake data. Consider the generator's gradient signal: it comes from ∂/∂θ log(1 − D(G(z))). When D(G(z)) → 0, log(1 − D(G(z))) → log(1) = 0, and its gradient vanishes. More formally, when supports are disjoint the JSD saturates at its maximum value of log 2 ≈ 0.693, regardless of how far apart the distributions are. Since C(G) = −log 4 + 2·JSD, we get C(G) → −log 4 + 2 log 2 = −log 4 + log 4 = 0. The loss surface becomes flat and the generator receives no useful gradient signal to improve. Numerically: if D(G(z)) = 0.01 for all generated samples, then log(1 − 0.01) = log(0.99) ≈ −0.01, and ∂log(1−a)/∂a|_{a=0.01} = −1/0.99 ≈ −1.01. This gradient is small and, crucially, it does not indicate the direction the generator should move to better match p_data. It only says "you are being detected" without saying "move towards these modes of p_data."

Mode collapse occurs when the generator finds a single point (or a small set of points) that reliably fools the discriminator and maps all latent codes to that region. Formally, instead of learning the full p_data, G collapses to p_g = δ(x − x*) for some x*. The discriminator eventually learns to reject x*, so G shifts to another point x**, and the training oscillates without converging. In financial data this is especially harmful: a mode-collapsed generator might produce only flat or trending paths and completely miss ranging, volatile, or gap-move regimes. For example, if EUR/USD returns have a trimodal distribution (trending up, ranging, trending down), a collapsed generator might only output returns centred near +0.001 (a single trend mode), ignoring the ±0.0005 ranging mode and the −0.001 downtrend mode entirely. Portfolio risk models trained on such synthetic data would dangerously underestimate drawdown risk.

The fundamental issue is that the original GAN objective uses the Jensen–Shannon divergence, which is bounded and becomes uninformative when distributions do not overlap. The JSD between any two distributions with disjoint supports is always log 2, whether they are "close" (e.g., shifted by epsilon) or "far apart." This means the loss landscape provides no gradient information about how to move p_g closer to p_data. The training dynamics become a cat-and-mouse game: the discriminator wins easily, the generator gets no signal, its weights drift randomly, and eventually it collapses to whatever mode accidentally fools D for a few iterations. Practical remedies in standard GANs—label smoothing, instance noise, feature matching—are band-aids. The principled solution is to replace JSD with a distance metric that varies smoothly even when supports do not overlap: the Wasserstein distance, which we derive next.`,
    },

    // ─── INTUITION 1 ────────────────────────────────────────────────────
    {
      type: "intuition" as const,
      title: "The Counterfeiter and the Detective",
      emoji: "🕵️",
      analogy: "A GAN is like a counterfeiter (generator) trying to produce fake banknotes that fool a detective (discriminator). Early on, the counterfeiter's fakes are crude—wrong paper, blurry watermark—and the detective catches them easily. But with each round, the counterfeiter studies why fakes were rejected and improves. The detective, in turn, develops sharper techniques. At Nash equilibrium, the counterfeiter's notes are indistinguishable from real currency, and the detective is reduced to random guessing (D = 0.5). Mode collapse is like the counterfeiter learning to perfectly forge only the $20 bill but never attempting $5, $10, $50, or $100 notes—a narrow but locally optimal strategy. Vanishing gradients correspond to a detective so skilled that the counterfeiter receives only the verdict 'fake' with no feedback about what specifically is wrong, leaving them unable to improve.",
      content: "In the financial context, the 'banknotes' are synthetic price return sequences. The generator must learn not just the marginal distribution (correct mean and variance of returns) but also the serial dependence structure (autocorrelation of squared returns, leverage effect, volatility clustering). A detective that only checks the histogram is easy to fool; one that also examines the ACF structure and tail behaviour is much harder. This is why financial GAN architectures must incorporate temporal structure—simple feedforward generators that produce i.i.d. samples will be caught by any discriminator that looks at sequential patterns.",
    },

    // ─── THEORY 3: Wasserstein Distance and WGAN-GP ─────────────────────
    {
      type: "theory" as const,
      title: "Wasserstein Distance and WGAN-GP",
      content: `The Wasserstein-1 distance (Earth Mover's distance) between two distributions p and q on a metric space is defined as W₁(p, q) = inf_{γ ∈ Π(p,q)} E_{(x,y) ~ γ}[||x − y||], where Π(p,q) is the set of all joint distributions (couplings) whose marginals are p and q. Intuitively, if p and q describe two piles of earth, W₁ is the minimum cost of transporting one pile into the shape of the other, where cost = amount × distance moved. Unlike JSD, W₁ is continuous and differentiable even when p and q have disjoint supports: if p = δ(0) and q = δ(θ), then W₁ = |θ|, giving a clean gradient ∂W₁/∂θ = sign(θ) that always points toward the target. Contrast this with JSD(δ(0), δ(θ)) = log 2 for all θ ≠ 0—completely flat, zero gradient.

Computing W₁ directly via the infimum over couplings is intractable for complex distributions. The Kantorovich–Rubinstein duality theorem provides a tractable alternative: W₁(p, q) = sup_{||f||_L ≤ 1} { E_{x ~ p}[f(x)] − E_{x ~ q}[f(x)] }, where the supremum is over all 1-Lipschitz functions f (i.e., |f(x) − f(y)| ≤ ||x − y|| for all x, y). In the WGAN framework, we parameterise f as a neural network (the "critic" D, no longer outputting probabilities) and train it to approximate this supremum. The WGAN objective becomes: max_D { E_{x ~ p_data}[D(x)] − E_{z ~ p_z}[D(G(z))] } subject to D being 1-Lipschitz, and min_G { −E_{z ~ p_z}[D(G(z))] }. The original WGAN enforced the Lipschitz constraint by weight clipping: after each gradient step, clamp all weights w of D to [−c, c]. This is crude—it biases D toward simple functions and makes training sensitive to the choice of c.

WGAN-GP (Gradient Penalty) replaces weight clipping with a soft penalty on the gradient norm. The key insight is that a differentiable function is 1-Lipschitz if and only if ||∇_x f(x)||₂ ≤ 1 everywhere. Rather than enforcing this at every point (intractable), WGAN-GP penalises violations along interpolations between real and fake samples: x̂ = α·x_real + (1 − α)·x_fake, where α ~ Uniform(0,1). The critic loss becomes: L_D = E[D(G(z))] − E[D(x)] + λ · E_{x̂}[(||∇_{x̂} D(x̂)||₂ − 1)²]. The gradient penalty (GP) term encourages ||∇D|| = 1 (not just ≤ 1), which empirically works better because the optimal critic has gradient norm exactly 1 almost everywhere under mild conditions. The hyperparameter λ is typically set to 10.

Numerical example of the gradient penalty computation: suppose we have a real sample x_real = [0.12, −0.05, 0.03] (three consecutive log-returns) and a fake sample x_fake = [0.08, 0.01, −0.02]. Draw α = 0.6. Then x̂ = 0.6·[0.12, −0.05, 0.03] + 0.4·[0.08, 0.01, −0.02] = [0.072+0.032, −0.030+0.004, 0.018−0.008] = [0.104, −0.026, 0.010]. Feed x̂ through the critic to get D(x̂) = 1.37 (a scalar, no sigmoid). Compute ∇_{x̂} D(x̂) via autograd; suppose we get [2.1, −0.8, 0.5]. The gradient norm is ||[2.1, −0.8, 0.5]||₂ = √(4.41 + 0.64 + 0.25) = √5.30 ≈ 2.302. The penalty for this sample is (2.302 − 1)² = (1.302)² ≈ 1.695. With λ = 10 the contribution to the loss is 16.95. This large penalty drives the critic to reduce its gradient norm toward 1, ensuring the Lipschitz constraint is approximately satisfied. Over a batch of 64 interpolated points, we average these penalties. As training converges, the average GP term should decrease toward 0, indicating the critic is close to 1-Lipschitz.`,
    },

    // ─── THEORY 4: Conditional GANs and TimeGAN ─────────────────────────
    {
      type: "theory" as const,
      title: "Conditional GANs and TimeGAN for Temporal Financial Data",
      content: `A conditional GAN (cGAN) extends the standard GAN by providing both the generator and discriminator with additional conditioning information y. The objective becomes: min_G max_D V(G, D) = E_{x ~ p_data}[log D(x | y)] + E_{z ~ p_z}[log(1 − D(G(z | y) | y))]. The generator now takes both z and y as inputs: G(z, y), and the discriminator evaluates D(x, y) to judge whether x is a plausible sample given condition y. In finance, y could be a volatility regime label (low / medium / high), a macroeconomic indicator, a day-of-week encoding, or a market-state vector. For example, conditioning on y = "high volatility" forces the generator to produce return sequences with fat tails and large swings characteristic of crisis periods. This is crucial for stress testing: banks need synthetic data specifically from tail regimes, not just average-case scenarios. The conditioning is typically implemented by concatenating a one-hot or embedding vector of y to the latent z for the generator, and concatenating y to the input features for the discriminator.

TimeGAN (Yoon, Jarrett & van der Schaar, 2019) addresses a fundamental limitation of standard GANs for time-series: they ignore the autoregressive temporal structure. TimeGAN introduces four network components trained jointly: (1) an embedding function e that maps real sequences x_{1:T} to a latent space h_{1:T}, (2) a recovery function r that maps h_{1:T} back to data space x̂_{1:T}, (3) a generator g that produces synthetic latent sequences ĥ_{1:T} from noise z_{1:T}, and (4) a discriminator d that distinguishes real latent sequences h from synthetic ĥ. The training uses three losses simultaneously: (a) Reconstruction loss L_R = ||x − r(e(x))||₂ ensures the autoencoder preserves information. (b) Supervised loss L_S = ||h_t − g_s(h_{<t}, z_t)||₂ is a stepwise prediction loss where the generator, given the true previous latent states, must predict the next state. This loss explicitly teaches the generator the transition dynamics of the latent space, rather than expecting the adversarial loss alone to discover temporal patterns. (c) Adversarial loss L_A is the standard GAN loss applied in the latent space between e(x) and g(z).

The total training objective is: min_{e,r,g} max_d { L_R + η·L_S + L_A }, where η weights the supervised loss (typically η = 1 or tuned via validation). The supervised loss L_S is the key innovation: by forcing g to learn one-step-ahead predictions in latent space, TimeGAN captures autoregressive dynamics (volatility clustering, mean reversion, momentum) that a standard GAN would struggle to learn from the adversarial signal alone. The training alternates between three phases: (Phase 1) train e, r to minimise L_R (autoencoder pretraining); (Phase 2) train g with L_S using real latent codes from e (supervised pretraining); (Phase 3) joint training of all four networks on L_R + η·L_S + L_A. In a forex application, the embedding network might reduce 10-dimensional OHLCV + indicator features to a 4-dimensional latent space. The supervised loss ensures that if the latent state at time t encodes "trending up with increasing volume," the generator's next state transitions coherently (e.g., continued trend or a reversal with specific probability), rather than jumping to an unrelated state. Evaluation of TimeGAN output uses discriminative score (train a post-hoc classifier on real vs. synthetic—score near 0.5 is ideal), predictive score (train on synthetic, evaluate on real—close to train-on-real baseline), and visualization (t-SNE/PCA of real vs. synthetic latent codes should overlap).`,
    },

    // ─── INTUITION 2 ────────────────────────────────────────────────────
    {
      type: "intuition" as const,
      title: "Earth Mover's Distance as Trucking Cost",
      emoji: "🚚",
      analogy: "Imagine two cities with different population distributions. City A has 1000 people clustered downtown and City B has 1000 people spread across suburbs. The Earth Mover's distance is the minimum total fuel cost to relocate everyone from City A's arrangement into City B's arrangement, where fuel cost = (number of people moved) × (distance moved). JSD would just say 'these cities are different' (a constant log 2) regardless of whether City B's suburbs are 1 mile or 100 miles from downtown. The Wasserstein distance actually captures how far apart the distributions are—100 miles costs 100× more than 1 mile—and this smooth, proportional signal is exactly the gradient information the generator needs to learn.",
      content: "For forex data, think of the real return distribution as a target landscape with multiple peaks (trending-up mode, ranging mode, trending-down mode, and a fat left tail for crashes). The generator starts as a single spike somewhere. JSD says 'you are wrong' with the same intensity whether the spike is near a mode or far from all modes—useless for gradient-based optimisation. The Wasserstein distance says 'you are 0.3 units from the nearest mode' or '2.1 units from the nearest mode,' giving a gradient that smoothly guides the generator's spike toward the closest data mode and then broadens it. This is why WGAN training is dramatically more stable for financial data, where the target distribution is multimodal and heavy-tailed.",
    },

    // ─── CODE 1: WGAN-GP for Forex Returns ──────────────────────────────
    {
      type: "code" as const,
      title: "WGAN-GP Training Loop for Synthetic Forex Returns",
      language: "python" as const,
      code: `import torch
import torch.nn as nn
import numpy as np

# --- Hyperparameters ---
SEQ_LEN, Z_DIM, H_DIM, BATCH = 20, 16, 64, 128
LR_C, LR_G, LAMBDA_GP, N_CRITIC = 1e-4, 1e-4, 10, 5
EPOCHS = 300

# --- Synthetic "real" forex data (replace with actual returns) ---
np.random.seed(42)
real_returns = np.random.standard_t(df=5, size=(5000, SEQ_LEN)).astype(np.float32) * 0.001
real_tensor = torch.from_numpy(real_returns)

class Critic(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(SEQ_LEN, H_DIM), nn.LeakyReLU(0.2),
            nn.Linear(H_DIM, H_DIM), nn.LeakyReLU(0.2),
            nn.Linear(H_DIM, 1))
    def forward(self, x):
        return self.net(x)

class Generator(nn.Module):
    def __init__(self):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(Z_DIM, H_DIM), nn.ReLU(),
            nn.Linear(H_DIM, H_DIM), nn.ReLU(),
            nn.Linear(H_DIM, SEQ_LEN))
    def forward(self, z):
        return self.net(z)

def gradient_penalty(critic, real, fake):
    alpha = torch.rand(real.size(0), 1)
    interp = (alpha * real + (1 - alpha) * fake).requires_grad_(True)
    d_interp = critic(interp)
    grads = torch.autograd.grad(d_interp, interp,
        grad_outputs=torch.ones_like(d_interp),
        create_graph=True, retain_graph=True)[0]
    gp = ((grads.norm(2, dim=1) - 1) ** 2).mean()
    return gp

C, G = Critic(), Generator()
opt_c = torch.optim.Adam(C.parameters(), lr=LR_C, betas=(0.0, 0.9))
opt_g = torch.optim.Adam(G.parameters(), lr=LR_G, betas=(0.0, 0.9))

for epoch in range(EPOCHS):
    idx = torch.randint(0, len(real_tensor), (BATCH,))
    x_real = real_tensor[idx]
    # --- Train Critic n_critic times ---
    for _ in range(N_CRITIC):
        z = torch.randn(BATCH, Z_DIM)
        x_fake = G(z).detach()
        loss_c = C(x_fake).mean() - C(x_real).mean() + LAMBDA_GP * gradient_penalty(C, x_real, x_fake)
        opt_c.zero_grad(); loss_c.backward(); opt_c.step()
    # --- Train Generator ---
    z = torch.randn(BATCH, Z_DIM)
    loss_g = -C(G(z)).mean()
    opt_g.zero_grad(); loss_g.backward(); opt_g.step()
    if (epoch + 1) % 50 == 0:
        print(f"Epoch {epoch+1}/{EPOCHS}  Critic: {loss_c.item():.4f}  Gen: {loss_g.item():.4f}")

# --- Evaluation ---
with torch.no_grad():
    synthetic = G(torch.randn(1000, Z_DIM)).numpy()
print(f"Real  mean={real_returns.mean():.6f}  std={real_returns.std():.6f}  kurt={float(np.mean(((real_returns - real_returns.mean())/real_returns.std())**4)):.2f}")
print(f"Synth mean={synthetic.mean():.6f}  std={synthetic.std():.6f}  kurt={float(np.mean(((synthetic - synthetic.mean())/synthetic.std())**4)):.2f}")`,
      explanation: `This WGAN-GP implementation demonstrates the core training loop for generating synthetic forex return sequences. Key implementation details: (1) The critic (not "discriminator"—it outputs unbounded scalars, not probabilities) is trained N_CRITIC=5 times per generator step, which is standard for WGANs. (2) The gradient_penalty function computes x̂ = α·x_real + (1−α)·x_fake, passes it through the critic, computes the gradient ∇_{x̂} D(x̂) via autograd, and penalises deviations of ||∇||₂ from 1. (3) The Adam optimiser uses betas=(0.0, 0.9) as recommended by the WGAN-GP paper—no momentum on the first moment. (4) The real data uses Student-t returns with df=5 to simulate the fat tails observed in actual forex returns. The evaluation block compares mean, standard deviation, and kurtosis between real and synthetic samples to verify distributional fidelity.`,
    },

    // ─── CODE 2: Conditional GAN ────────────────────────────────────────
    {
      type: "code" as const,
      title: "Conditional GAN Conditioned on Volatility Regime",
      language: "python" as const,
      code: `import torch
import torch.nn as nn
import numpy as np

SEQ_LEN, Z_DIM, H_DIM, N_REGIMES, BATCH = 20, 16, 64, 3, 128
EPOCHS = 400

# --- Synthetic data: 3 volatility regimes ---
np.random.seed(7)
scales = [0.0003, 0.001, 0.003]  # low, medium, high vol
data, labels = [], []
for regime in range(N_REGIMES):
    block = np.random.randn(2000, SEQ_LEN).astype(np.float32) * scales[regime]
    data.append(block)
    labels.append(np.full(2000, regime, dtype=np.int64))
data = torch.from_numpy(np.concatenate(data))
labels = torch.from_numpy(np.concatenate(labels))

class CondGenerator(nn.Module):
    def __init__(self):
        super().__init__()
        self.embed = nn.Embedding(N_REGIMES, 8)
        self.net = nn.Sequential(
            nn.Linear(Z_DIM + 8, H_DIM), nn.ReLU(),
            nn.Linear(H_DIM, H_DIM), nn.ReLU(),
            nn.Linear(H_DIM, SEQ_LEN))
    def forward(self, z, y):
        return self.net(torch.cat([z, self.embed(y)], dim=1))

class CondDiscriminator(nn.Module):
    def __init__(self):
        super().__init__()
        self.embed = nn.Embedding(N_REGIMES, 8)
        self.net = nn.Sequential(
            nn.Linear(SEQ_LEN + 8, H_DIM), nn.LeakyReLU(0.2),
            nn.Linear(H_DIM, H_DIM), nn.LeakyReLU(0.2),
            nn.Linear(H_DIM, 1), nn.Sigmoid())
    def forward(self, x, y):
        return self.net(torch.cat([x, self.embed(y)], dim=1))

G, D = CondGenerator(), CondDiscriminator()
opt_g = torch.optim.Adam(G.parameters(), lr=2e-4, betas=(0.5, 0.999))
opt_d = torch.optim.Adam(D.parameters(), lr=2e-4, betas=(0.5, 0.999))
bce = nn.BCELoss()

for epoch in range(EPOCHS):
    idx = torch.randint(0, len(data), (BATCH,))
    x_real, y = data[idx], labels[idx]
    ones, zeros = torch.ones(BATCH, 1), torch.zeros(BATCH, 1)
    # Discriminator
    z = torch.randn(BATCH, Z_DIM)
    x_fake = G(z, y).detach()
    loss_d = bce(D(x_real, y), ones) + bce(D(x_fake, y), zeros)
    opt_d.zero_grad(); loss_d.backward(); opt_d.step()
    # Generator
    z = torch.randn(BATCH, Z_DIM)
    x_fake = G(z, y)
    loss_g = bce(D(x_fake, y), ones)
    opt_g.zero_grad(); loss_g.backward(); opt_g.step()
    if (epoch + 1) % 100 == 0:
        print(f"Epoch {epoch+1}/{EPOCHS}  D_loss: {loss_d.item():.4f}  G_loss: {loss_g.item():.4f}")

# --- Generate regime-specific samples ---
with torch.no_grad():
    for regime, name in enumerate(["low-vol", "med-vol", "high-vol"]):
        y_cond = torch.full((500,), regime, dtype=torch.int64)
        samples = G(torch.randn(500, Z_DIM), y_cond).numpy()
        print(f"Regime {name}: mean={samples.mean():.6f}  std={samples.std():.6f}")`,
      explanation: `This conditional GAN conditions generation on one of three volatility regimes (low, medium, high). The regime label y is embedded via nn.Embedding into an 8-dimensional vector and concatenated to the noise z for the generator and to the input x for the discriminator. This forces the generator to learn regime-specific return distributions: low-vol samples should have tight distributions (std ≈ 0.0003), high-vol samples should have wide distributions (std ≈ 0.003). The evaluation block generates 500 samples per regime and prints their statistics, allowing us to verify that the conditional generation properly separates the regimes. In practice, y could be derived from a Hidden Markov Model regime detector applied to historical forex data.`,
    },

    // ─── CODE 3: TimeGAN-inspired Temporal Generator ────────────────────
    {
      type: "code" as const,
      title: "TimeGAN-Inspired Temporal Generator with Autoregressive Structure",
      language: "python" as const,
      code: `import torch
import torch.nn as nn
import numpy as np

SEQ_LEN, FEAT_DIM, H_DIM, Z_DIM, BATCH = 24, 1, 32, 8, 64
EPOCHS_AE, EPOCHS_SUP, EPOCHS_JOINT = 200, 200, 300

# --- Synthetic temporal data with volatility clustering ---
np.random.seed(99)
def gen_garch_paths(n, T):
    paths = np.zeros((n, T), dtype=np.float32)
    for i in range(n):
        sigma2 = 1e-6
        for t in range(T):
            sigma2 = 1e-7 + 0.1 * paths[i, t-1]**2 + 0.85 * sigma2 if t > 0 else 1e-6
            paths[i, t] = np.sqrt(sigma2) * np.random.randn()
    return paths
real_data = torch.from_numpy(gen_garch_paths(3000, SEQ_LEN)).unsqueeze(-1)  # (N, T, 1)

class Embedder(nn.Module):
    def __init__(self):
        super().__init__()
        self.rnn = nn.GRU(FEAT_DIM, H_DIM, batch_first=True)
    def forward(self, x):
        h, _ = self.rnn(x)
        return h

class Recovery(nn.Module):
    def __init__(self):
        super().__init__()
        self.fc = nn.Linear(H_DIM, FEAT_DIM)
    def forward(self, h):
        return self.fc(h)

class TemporalGenerator(nn.Module):
    def __init__(self):
        super().__init__()
        self.rnn = nn.GRU(Z_DIM, H_DIM, batch_first=True)
    def forward(self, z):
        h, _ = self.rnn(z)
        return h

class TemporalDiscriminator(nn.Module):
    def __init__(self):
        super().__init__()
        self.rnn = nn.GRU(H_DIM, H_DIM, batch_first=True)
        self.fc = nn.Linear(H_DIM, 1)
    def forward(self, h):
        out, _ = self.rnn(h)
        return torch.sigmoid(self.fc(out[:, -1, :]))

E, R, TG, TD = Embedder(), Recovery(), TemporalGenerator(), TemporalDiscriminator()
mse = nn.MSELoss()
bce = nn.BCELoss()

# Phase 1: Autoencoder pretraining
opt_er = torch.optim.Adam(list(E.parameters()) + list(R.parameters()), lr=1e-3)
for ep in range(EPOCHS_AE):
    idx = torch.randint(0, len(real_data), (BATCH,))
    x = real_data[idx]
    loss = mse(R(E(x)), x)
    opt_er.zero_grad(); loss.backward(); opt_er.step()
    if (ep+1) % 100 == 0:
        print(f"AE Phase  Epoch {ep+1}/{EPOCHS_AE}  Recon: {loss.item():.6f}")

# Phase 2: Supervised pretraining of generator
opt_g = torch.optim.Adam(TG.parameters(), lr=1e-3)
for ep in range(EPOCHS_SUP):
    idx = torch.randint(0, len(real_data), (BATCH,))
    h_real = E(real_data[idx]).detach()
    z = torch.randn(BATCH, SEQ_LEN, Z_DIM)
    h_fake = TG(z)
    loss_s = mse(h_fake[:, 1:, :], h_real[:, 1:, :])  # supervised: match next-step
    opt_g.zero_grad(); loss_s.backward(); opt_g.step()
    if (ep+1) % 100 == 0:
        print(f"Sup Phase Epoch {ep+1}/{EPOCHS_SUP}  Supervised: {loss_s.item():.6f}")

# Phase 3: Joint adversarial training
opt_g2 = torch.optim.Adam(list(TG.parameters()) + list(E.parameters()) + list(R.parameters()), lr=5e-4)
opt_d = torch.optim.Adam(TD.parameters(), lr=5e-4)
for ep in range(EPOCHS_JOINT):
    idx = torch.randint(0, len(real_data), (BATCH,))
    x = real_data[idx]
    h_real = E(x)
    z = torch.randn(BATCH, SEQ_LEN, Z_DIM)
    h_fake = TG(z)
    ones, zeros = torch.ones(BATCH, 1), torch.zeros(BATCH, 1)
    # Discriminator step
    loss_d = bce(TD(h_real.detach()), ones) + bce(TD(h_fake.detach()), zeros)
    opt_d.zero_grad(); loss_d.backward(); opt_d.step()
    # Generator + AE step
    loss_adv = bce(TD(h_fake), ones)
    loss_rec = mse(R(h_real), x)
    loss_sup = mse(h_fake[:, 1:, :], h_real[:, 1:, :].detach())
    loss_all = loss_adv + 10.0 * loss_rec + loss_sup
    opt_g2.zero_grad(); loss_all.backward(); opt_g2.step()
    if (ep+1) % 100 == 0:
        print(f"Joint     Epoch {ep+1}/{EPOCHS_JOINT}  D:{loss_d.item():.4f} Adv:{loss_adv.item():.4f} Rec:{loss_rec.item():.6f}")

# --- Generate synthetic temporal data ---
with torch.no_grad():
    z = torch.randn(500, SEQ_LEN, Z_DIM)
    synthetic = R(TG(z)).squeeze(-1).numpy()
    real_np = real_data[:500].squeeze(-1).numpy()
print(f"Real  std={real_np.std():.6f}  autocorr_sq={np.corrcoef(real_np[:,:-1].ravel()**2, real_np[:,1:].ravel()**2)[0,1]:.4f}")
print(f"Synth std={synthetic.std():.6f}  autocorr_sq={np.corrcoef(synthetic[:,:-1].ravel()**2, synthetic[:,1:].ravel()**2)[0,1]:.4f}")`,
      explanation: `This TimeGAN-inspired implementation demonstrates the three-phase training procedure. Phase 1 trains the autoencoder (Embedder + Recovery) to compress and reconstruct GARCH-simulated return sequences. Phase 2 trains the temporal generator with a supervised loss to learn one-step-ahead dynamics in the latent space—this is the key innovation that captures volatility clustering. Phase 3 jointly trains all components with adversarial, reconstruction, and supervised losses. The real data is generated from a GARCH(1,1) process to provide temporal dependence (volatility clustering). The evaluation compares not just the marginal standard deviation but also the autocorrelation of squared returns—a hallmark of volatility clustering that standard GANs fail to reproduce. A successful TimeGAN should produce synthetic data where both statistics closely match the real data.`,
    },

    // ─── QUIZ ───────────────────────────────────────────────────────────
    {
      type: "quiz" as const,
      questions: [
        {
          id: "gan-q1",
          question: "Given p_data(x₀) = 0.6 and p_g(x₀) = 0.4, what is the optimal discriminator output D*(x₀)?",
          options: [
            { id: "a", text: "0.40" },
            { id: "b", text: "0.50" },
            { id: "c", text: "0.60" },
            { id: "d", text: "0.67" },
          ],
          correctOptionId: "c",
          explanation: "The optimal discriminator is D*(x) = p_data(x) / (p_data(x) + p_g(x)). Substituting: D*(x₀) = 0.6 / (0.6 + 0.4) = 0.6 / 1.0 = 0.60. The discriminator assigns 60% probability that x₀ is real, which makes sense since p_data(x₀) = 0.6 is larger than p_g(x₀) = 0.4 but not overwhelmingly so.",
        },
        {
          id: "gan-q2",
          question: "At the Nash equilibrium of the GAN game, what is the value of D*(x) for all x in the support of p_data?",
          options: [
            { id: "a", text: "0" },
            { id: "b", text: "0.5" },
            { id: "c", text: "1" },
            { id: "d", text: "It depends on x" },
          ],
          correctOptionId: "b",
          explanation: "At Nash equilibrium, p_g = p_data. Substituting into the optimal discriminator formula: D*(x) = p_data(x) / (p_data(x) + p_data(x)) = p_data(x) / (2·p_data(x)) = 1/2 for all x. The discriminator is reduced to random guessing—it cannot distinguish real from synthetic samples. This corresponds to C(G) = −log 4 ≈ −1.386 and JSD = 0.",
        },
        {
          id: "gan-q3",
          question: "Why does standard GAN training suffer from vanishing gradients when p_data and p_g have disjoint supports?",
          options: [
            { id: "a", text: "The learning rate is too small for high-dimensional data" },
            { id: "b", text: "The Jensen–Shannon divergence saturates at log 2, making the loss landscape flat with no useful gradient" },
            { id: "c", text: "The generator network has too few parameters to represent the data distribution" },
            { id: "d", text: "Batch normalisation causes gradient issues in the discriminator" },
          ],
          correctOptionId: "b",
          explanation: "When p_data and p_g have disjoint supports, the discriminator achieves perfect classification, and JSD(p_data || p_g) = log 2 regardless of the distance between the supports. Since C(G) = −log 4 + 2·JSD = −log 4 + 2·log 2 = 0, the loss is constant and ∂C/∂θ_G = 0. The generator receives no gradient information about which direction to move p_g to approach p_data. This is a fundamental limitation of JSD, not an architectural or hyperparameter issue.",
        },
        {
          id: "gan-q4",
          question: "In WGAN-GP, if the gradient ∇_{x̂} D(x̂) = [0.8, 0.6] for an interpolated sample x̂, what is the gradient penalty term (before multiplying by λ)?",
          options: [
            { id: "a", text: "0.00" },
            { id: "b", text: "0.04" },
            { id: "c", text: "0.36" },
            { id: "d", text: "1.00" },
          ],
          correctOptionId: "a",
          explanation: "First compute the L2 norm: ||[0.8, 0.6]||₂ = √(0.64 + 0.36) = √1.00 = 1.0. The gradient penalty for this sample is (||∇D||₂ − 1)² = (1.0 − 1)² = 0². = 0.00. The gradient norm is exactly 1, so there is zero penalty—this is the ideal case. The critic already satisfies the 1-Lipschitz constraint at this interpolation point. In practice the average GP across a batch will be small but nonzero, and training drives it toward zero.",
        },
        {
          id: "gan-q5",
          question: "What would happen if you set the gradient penalty coefficient λ = 0 in WGAN-GP?",
          options: [
            { id: "a", text: "Training would proceed normally since the Wasserstein distance doesn't need the Lipschitz constraint" },
            { id: "b", text: "The critic would no longer be constrained to be Lipschitz, making the Wasserstein estimate unbounded and training unstable" },
            { id: "c", text: "The generator would converge faster due to stronger gradient signals" },
            { id: "d", text: "The model would reduce to a standard GAN with sigmoid outputs" },
          ],
          correctOptionId: "b",
          explanation: "The Kantorovich–Rubinstein duality requires the critic to be 1-Lipschitz for the critic's output to be a valid estimate of the Wasserstein distance. With λ = 0, there is no constraint on the critic's gradient norm, so the critic can have arbitrarily large Lipschitz constant. The supremum in the dual becomes unbounded—the critic can make its outputs arbitrarily large in magnitude, and the 'Wasserstein estimate' diverges to infinity. In practice this manifests as exploding critic values and training collapse. The gradient penalty is not optional; it is the mechanism that makes the Wasserstein formulation valid.",
        },
        {
          id: "gan-q6",
          question: "In TimeGAN, what is the purpose of the supervised loss L_S that trains the generator to predict the next latent state given previous ones?",
          options: [
            { id: "a", text: "It regularises the generator to prevent overfitting to the noise distribution" },
            { id: "b", text: "It explicitly teaches the generator the temporal transition dynamics, capturing autoregressive patterns like volatility clustering" },
            { id: "c", text: "It forces the generator to produce outputs with zero mean and unit variance" },
            { id: "d", text: "It replaces the adversarial loss entirely, making TimeGAN a non-adversarial model" },
          ],
          correctOptionId: "b",
          explanation: "The supervised loss L_S = ||h_t − g(h_{<t}, z_t)||₂ forces the generator to learn one-step-ahead predictions in the latent space. Without it, the generator relies solely on the adversarial signal to discover temporal patterns—a much harder task. By directly training the generator to predict next-step latent states from previous ones, L_S captures autoregressive dynamics: if volatility was high at time t, the generator learns that volatility at t+1 should likely remain elevated (volatility clustering). This is TimeGAN's key innovation over applying a standard GAN to flattened time-series windows, which would miss temporal dependencies entirely.",
        },
        {
          id: "gan-q7",
          question: "A conditional GAN for forex is conditioned on regime y ∈ {low-vol, high-vol}. If you request y = high-vol but the generated returns have standard deviation similar to low-vol data, what is the most likely issue?",
          options: [
            { id: "a", text: "The generator has mode-collapsed and ignores the conditioning label" },
            { id: "b", text: "The discriminator is too weak and cannot distinguish regimes" },
            { id: "c", text: "The learning rate is too high for the generator" },
            { id: "d", text: "The latent dimension Z_DIM is too small" },
          ],
          correctOptionId: "a",
          explanation: "When a conditional GAN ignores its conditioning input y and produces the same output distribution regardless of the label, this is a form of mode collapse specific to cGANs called 'conditional mode collapse' or 'label ignoring.' The generator finds it easier to produce one distribution that partially fools the discriminator across all labels rather than learning label-specific distributions. This typically occurs when: (1) the discriminator does not effectively use the label y to judge conditional consistency, (2) the generator architecture makes it too easy to bypass the conditioning path (e.g., the label embedding is too small relative to z), or (3) training is insufficiently long. Solutions include projection discrimination, auxiliary classifier loss (AC-GAN), or stronger conditioning mechanisms.",
        },
      ],
    },

    // ─── PRACTICE 1 ─────────────────────────────────────────────────────
    {
      type: "practice" as const,
      title: "Generate Realistic Price Paths with Statistical Validation",
      description: "Implement a WGAN-GP to generate synthetic EUR/USD 5-minute log-return sequences of length 60 (representing 5 hours of trading). Train on historical data (or simulated GARCH data as a proxy). After training, generate 1000 synthetic paths and validate them against the real data using: (1) Kolmogorov–Smirnov test on the marginal return distribution (p-value > 0.05 for pass), (2) comparison of autocorrelation of squared returns at lags 1–10 (should show positive autocorrelation indicating volatility clustering), (3) comparison of kurtosis (real forex returns typically have kurtosis > 5), (4) visual QQ-plot of synthetic vs. real quantiles. Report all test statistics and discuss which properties the GAN captures well and which it struggles with.",
      catalogModelId: "gan",
    },

    // ─── PRACTICE 2 ─────────────────────────────────────────────────────
    {
      type: "practice" as const,
      title: "TimeGAN for Multi-Asset Synthetic Series",
      description: "Extend the TimeGAN architecture to generate correlated multi-asset return series for a 3-pair forex portfolio (EUR/USD, GBP/USD, USD/JPY). The feature dimension is 3 (one return per pair per timestep) and the sequence length is 48 (representing one trading day of 30-minute bars). Train the embedding, recovery, generator, and discriminator with all three loss terms (reconstruction, supervised, adversarial). Evaluate the synthetic data on: (1) per-asset marginal statistics (mean, std, skewness, kurtosis), (2) cross-asset correlation matrix (the 3×3 correlation structure should be preserved), (3) discriminative score (train a post-hoc LSTM classifier to distinguish real from synthetic—accuracy near 50% indicates high-quality generation), (4) predictive score (train a next-step predictor on synthetic data and test on real data—compare with a predictor trained on real data). Discuss the trade-offs between reconstruction fidelity and adversarial quality as you vary the supervised loss weight η.",
      catalogModelId: "gan",
    },
  ],
};

