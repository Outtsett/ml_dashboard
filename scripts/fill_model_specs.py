"""
Fill empty algo_model markdown specs with structured content.

Generates complete model documentation following the same template as
existing populated specs. Content is category-aware and trading-relevant.

Usage:
    python scripts/fill_model_specs.py                   # dry-run
    python scripts/fill_model_specs.py --write            # write files
    python scripts/fill_model_specs.py --write --only 5   # first 5 only
"""

import argparse
import os
from pathlib import Path
from typing import NamedTuple

ALGO_MODELS_ROOT = Path(r"E:\source\documents\algo_models")


# ── Data types ──────────────────────────────────────────────────────────────


class ModelInfo(NamedTuple):
    path: Path
    name: str  # Filename stem (e.g., "K-Nearest Neighbors (k-NN)")
    category: str  # Top-level folder key
    subcategory: str  # Deepest subfolder name


# ── Folder → key mapping ───────────────────────────────────────────────────

FOLDER_TO_KEY = {
    "Generative Models": "generative",
    "Hybrid & Composite Architectures": "hybrid-composite",
    "Machine Learning": "machine-learning",
    "Neural Network Architectures": "neural-network",
    "Optimization-Based Models": "optimization",
    "Probabilistic & Symbolic Models": "probabilistic-symbolic",
    "Reinforcement Learning (RL)": "reinforcement-learning",
    "Simulation & Decision Models": "simulation-decision",
    "Statistical Models": "statistical",
}


# ── Per-category content chunks ────────────────────────────────────────────

CATEGORY_PREAMBLES = {
    "machine-learning": "a machine learning algorithm that learns patterns from labeled or structured data "
    "to make predictions or decisions. It employs statistical learning theory to "
    "generalize from training examples to unseen data, balancing model complexity "
    "against generalization ability.",
    "neural-network": "a neural network architecture designed to learn hierarchical representations "
    "from data through layers of parameterized transformations. It uses gradient-based "
    "optimization to adjust millions of parameters, enabling it to capture complex "
    "non-linear patterns in sequential, spatial, or structured data.",
    "optimization": "an optimization algorithm that systematically searches for the best solution "
    "within a defined feasible region. It leverages mathematical programming "
    "principles to minimize (or maximize) an objective function subject to constraints, "
    "providing provable guarantees or high-quality heuristic solutions.",
    "reinforcement-learning": "a reinforcement learning method where an agent learns to make sequential "
    "decisions by interacting with an environment. Through trial and error, "
    "the agent discovers which actions maximize cumulative reward over time, "
    "balancing exploration of unknown states with exploitation of learned knowledge.",
    "probabilistic-symbolic": "a probabilistic or symbolic reasoning system that represents uncertainty "
    "explicitly through probability distributions, logical rules, or both. It "
    "enables principled inference under uncertainty, combining data-driven learning "
    "with structured knowledge representation.",
    "statistical": "a statistical model that describes the relationship between variables using "
    "probability distributions and parameter estimation. Grounded in rigorous "
    "statistical theory, it provides interpretable coefficients, confidence "
    "intervals, and hypothesis tests alongside predictions.",
    "simulation-decision": "a simulation or decision-making framework that models complex systems "
    "or evaluates choices under uncertainty. It uses computational methods "
    "to explore scenario spaces, quantify risk, and identify optimal strategies "
    "when analytical solutions are intractable.",
    "hybrid-composite": "a hybrid architecture that combines multiple learning paradigms — such as "
    "neural networks with graph structures, trees with embeddings, or differentiable "
    "planners with learned heuristics — to leverage complementary strengths and "
    "overcome individual weaknesses.",
    "generative": "a generative model that learns the underlying data distribution and can "
    "produce new samples resembling the training data. It captures the joint "
    "probability of inputs and outputs, enabling data augmentation, density "
    "estimation, and creative generation.",
}

CATEGORY_MATH = {
    "machine-learning": "The model minimizes an empirical risk function: L(theta) = (1/N) * sum(l(f(x_i; theta), y_i)) "
    "where l is a task-specific loss (cross-entropy for classification, MSE for regression), "
    "f is the model parameterized by theta, and (x_i, y_i) are training pairs. "
    "Regularization terms R(theta) (L1, L2, or elastic net) may be added to prevent overfitting: "
    "L_reg = L + lambda * R(theta). The bias-variance tradeoff governs model selection — "
    "more complex models reduce bias but increase variance.",
    "neural-network": "Forward pass: h_l = sigma(W_l * h_{l-1} + b_l) for layers l = 1..L, where sigma is "
    "an activation function (ReLU, GELU, SiLU). Backpropagation computes gradients: "
    "dL/dW_l = dL/dh_l * dh_l/dW_l via the chain rule. Parameter updates follow: "
    "theta_{t+1} = theta_t - lr * gradient(L). For specialized architectures, additional "
    "operations (convolution, attention, gating, routing) modify the forward computation graph.",
    "optimization": "The optimization problem is formulated as: minimize f(x) subject to g_i(x) <= 0, "
    "h_j(x) = 0, where f is the objective, g_i are inequality constraints, and h_j are "
    "equality constraints. The Lagrangian L(x, lambda, mu) = f(x) + sum(lambda_i g_i(x)) + "
    "sum(mu_j h_j(x)) provides dual variables for constraint satisfaction. KKT conditions "
    "characterize optimal points for convex problems. Iterative updates converge to optima "
    "with rates depending on problem structure (linear, quadratic, polynomial).",
    "reinforcement-learning": "The agent operates in a Markov Decision Process (MDP) defined by (S, A, P, R, gamma) — "
    "states S, actions A, transition probability P(s'|s,a), reward R(s,a), discount gamma. "
    "The goal is to find policy pi* = argmax_pi E[sum(gamma^t r_t)] that maximizes expected "
    "discounted return. Value functions V^pi(s) = E[sum(gamma^t r_t | s_0=s, pi)] and "
    "Q^pi(s,a) quantify state/action quality. Policy gradient theorem: "
    "gradient(J) = E[gradient(log pi(a|s)) * Q^pi(s,a)].",
    "probabilistic-symbolic": "The model defines a joint probability P(X, Z | theta) over observed variables X and "
    "latent variables Z with parameters theta. Inference computes the posterior: "
    "P(Z|X) = P(X|Z) P(Z) / P(X) via Bayes' theorem. When P(X) is intractable, "
    "approximate inference methods (variational inference, MCMC, belief propagation) "
    "are used. Symbolic components contribute logical constraints or rule structures "
    "that complement the probabilistic framework.",
    "statistical": "The model specifies a likelihood function P(y|X, beta) relating response y to "
    "predictors X through parameters beta. Maximum likelihood estimation: "
    "beta_hat = argmax_beta sum(log P(y_i|x_i, beta)). For Bayesian variants, "
    "the posterior P(beta|data) is proportional to P(data|beta) P(beta). Link functions g "
    "connect the linear predictor eta = X beta to the response mean: "
    "E[y] = g^{-1}(eta). Standard errors and confidence intervals quantify parameter uncertainty.",
    "simulation-decision": "Decisions are modeled as choosing action a from set A to optimize an objective: "
    "a* = argmax_a E[U(outcome(a, theta))] where theta represents uncertain parameters "
    "and U is a utility function. Monte Carlo methods estimate expectations by sampling: "
    "E[f(X)] approx (1/N) sum(f(x_i)). For sequential decisions, dynamic programming "
    "applies Bellman's principle of optimality: V(s) = max_a [R(s,a) + gamma * E[V(s')]].",
    "hybrid-composite": "The hybrid model combines component models f_1, f_2, ..., f_k through a fusion "
    "function: y = g(f_1(x; theta_1), f_2(x; theta_2), ..., f_k(x; theta_k); phi). "
    "End-to-end training propagates gradients through all components: "
    "dL/d_theta_i = dL/dg * dg/df_i * df_i/d_theta_i. When components use different "
    "paradigms (differentiable + discrete, neural + symbolic), specialized bridging "
    "techniques (straight-through estimators, attention, Gumbel-softmax) enable joint optimization.",
    "generative": "The model learns a distribution p_theta(x) that approximates the true data "
    "distribution p_data(x). Training minimizes a divergence: KL(p_data || p_theta) "
    "or maximizes a lower bound (ELBO). For latent variable models: "
    "log p(x) >= E_q[log p(x|z)] - KL(q(z|x) || p(z)). Sampling: z ~ p(z), x ~ p(x|z) "
    "generates new data points. Adversarial training alternatively uses a discriminator "
    "to distinguish real from generated samples.",
}

CATEGORY_TRAINING = {
    "machine-learning": "Training uses gradient-based or closed-form optimization on the training set with "
    "cross-validation for hyperparameter selection. Key hyperparameters include learning "
    "rate (1e-4 to 0.1), regularization strength (1e-5 to 0.1), and model-specific "
    "structural parameters. Early stopping on validation loss prevents overfitting. "
    "Feature scaling (z-score or min-max) is typically required for distance-based or "
    "gradient-based methods.",
    "neural-network": "Trained via mini-batch gradient descent with backpropagation. Key hyperparameters: "
    "learning rate (1e-4 to 1e-2), batch size (16-256), number of layers/units, "
    "dropout rate (0.1-0.5), weight decay (1e-5 to 1e-3). Optimizer choice (Adam, AdamW, SGD "
    "with momentum) significantly impacts convergence. Learning rate scheduling "
    "(cosine annealing, warmup) and gradient clipping (max_norm=1.0) stabilize training. "
    "Training typically requires GPU acceleration for practical runtimes.",
    "optimization": "The algorithm iterates until convergence criteria are met: objective improvement below "
    "threshold, constraint violation within tolerance, or maximum iterations reached. "
    "Key parameters include step size / learning rate, convergence tolerance (1e-6 to 1e-3), "
    "maximum iterations (100-10000), and constraint penalties. Warm-starting from a feasible "
    "point speeds convergence. Problem-specific preprocessing (scaling, reformulation) "
    "can dramatically improve solution quality and speed.",
    "reinforcement-learning": "The agent trains by collecting experience through environment interaction. Each "
    "episode generates a trajectory of (state, action, reward, next_state) tuples stored "
    "in a replay buffer or used for on-policy updates. Key hyperparameters: learning rate "
    "(1e-4 to 3e-4), discount factor gamma (0.95-0.999), batch size (64-256), "
    "replay buffer size (1e5 to 1e6), exploration rate/noise schedule, target network "
    "update frequency. Training is often unstable and requires millions of environment steps.",
    "probabilistic-symbolic": "Training involves parameter estimation via maximum likelihood, MAP estimation, or "
    "full Bayesian inference. For probabilistic models: EM algorithm iterates between "
    "E-step (compute posterior over latents) and M-step (maximize expected log-likelihood). "
    "For symbolic components: rule weights or structure are learned from data or specified "
    "by domain experts. Key hyperparameters: prior distributions, inference method "
    "(exact, variational, MCMC), convergence tolerance, number of samples/iterations.",
    "statistical": "Parameter estimation via maximum likelihood estimation (MLE), weighted least squares "
    "(WLS), or Bayesian MCMC sampling. Model selection uses AIC, BIC, or cross-validated "
    "likelihood. Diagnostic checks include residual analysis, goodness-of-fit tests, "
    "and influence diagnostics. Key hyperparameters: link function choice, distribution "
    "family, regularization parameters. Iteratively reweighted least squares (IRLS) is "
    "the standard fitting algorithm for generalized linear models.",
    "simulation-decision": "Model calibration fits parameters to historical data via maximum likelihood, "
    "method of moments, or Bayesian estimation. For simulation models: run N replications "
    "(typically 1000-100,000) to estimate distributional properties. For decision models: "
    "enumerate or sample the decision space to find optimal policies. Convergence is "
    "assessed via confidence interval width, coefficient of variation, or policy stability. "
    "Sensitivity analysis identifies which parameters most influence outcomes.",
    "hybrid-composite": "Training may be end-to-end (joint gradient updates through all components), staged "
    "(pre-train components individually, then fine-tune together), or alternating "
    "(optimize one component while freezing others). Key challenges include gradient "
    "scale mismatch between components and mode collapse when one component dominates. "
    "Solutions: separate learning rates per component, auxiliary losses to maintain "
    "component diversity, and gradient normalization at fusion points.",
    "generative": "Training maximizes the log-likelihood of the data (or a tractable lower bound). "
    "For VAEs: optimize ELBO via reparameterization trick and SGD. For GANs: alternating "
    "min-max optimization of generator and discriminator (often unstable). For diffusion: "
    "train a denoising network to reverse a noise schedule. Key hyperparameters: latent "
    "dimension, learning rate, KL weight (beta-VAE), noise schedule, number of diffusion steps.",
}

CATEGORY_ADVANTAGES = {
    "machine-learning": [
        "Well-understood theoretical foundations with decades of research and proven performance",
        "Efficient training — often much faster than deep learning methods on tabular data",
        "Interpretable outputs — feature importances, decision rules, or coefficient estimates",
        "Handles structured/tabular data naturally without extensive preprocessing",
        "Extensive library support (scikit-learn, XGBoost, LightGBM) with production-ready implementations",
    ],
    "neural-network": [
        "Learns hierarchical feature representations automatically from raw data",
        "Scales well with data volume — performance improves with more training examples",
        "Flexible architecture — can be adapted to any data type (sequences, images, graphs)",
        "GPU-accelerated training enables practical runtimes on large datasets",
        "Transfer learning enables knowledge reuse across related tasks and domains",
    ],
    "optimization": [
        "Provides provable optimality guarantees for well-structured problems",
        "Handles hard constraints naturally — ensures solutions are feasible",
        "Flexible formulation — can encode diverse objectives and constraints",
        "Mature solver ecosystem (Gurobi, CPLEX, IPOPT) with decades of engineering",
        "Dual variables provide economic interpretation of constraint values",
    ],
    "reinforcement-learning": [
        "Learns directly from interaction — no labeled training data required",
        "Optimizes for long-term cumulative reward, not just immediate accuracy",
        "Adapts to changing environments through continued exploration",
        "Handles sequential decision-making with delayed consequences",
        "Can discover novel strategies that human designers would not consider",
    ],
    "probabilistic-symbolic": [
        "Quantifies uncertainty explicitly — provides calibrated confidence estimates",
        "Incorporates prior knowledge and domain expertise through priors or rules",
        "Handles missing data naturally through marginalization",
        "Interpretable — posterior distributions and inference chains are transparent",
        "Robust to overfitting when proper priors are specified",
    ],
    "statistical": [
        "Rigorous theoretical foundation — hypothesis tests, confidence intervals, p-values",
        "Highly interpretable — coefficients directly quantify variable effects",
        "Well-calibrated uncertainty estimates from proper distributional assumptions",
        "Computationally efficient — often has closed-form solutions or fast iterative algorithms",
        "Extensive diagnostic tools for model validation and assumption checking",
    ],
    "simulation-decision": [
        "Handles complex, non-linear systems that defy analytical solutions",
        "Quantifies risk by exploring full distributions of outcomes, not just point estimates",
        "Flexible scenario specification — can model any combination of assumptions",
        "Provides decision-makers with actionable trade-off analysis",
        "Naturally handles stochasticity, rare events, and fat-tailed distributions",
    ],
    "hybrid-composite": [
        "Combines strengths of multiple paradigms while mitigating individual weaknesses",
        "More expressive than single-paradigm models for complex multi-faceted problems",
        "Modular design enables independent improvement of individual components",
        "Can leverage both structured knowledge and data-driven pattern extraction",
        "Often achieves state-of-the-art performance by bridging research communities",
    ],
    "generative": [
        "Learns the full data distribution — enables sampling, density estimation, and imputation",
        "Data augmentation — generates realistic synthetic samples for training other models",
        "Enables scenario generation for stress testing and risk analysis",
        "Captures complex dependencies in high-dimensional data",
        "Latent space provides meaningful representations for downstream tasks",
    ],
}

CATEGORY_DISADVANTAGES = {
    "machine-learning": [
        "Often underperforms deep learning on large-scale unstructured data (images, text)",
        "Feature engineering required — performance depends heavily on input representation",
        "May struggle with highly non-linear or multi-scale patterns",
        "Some methods are sensitive to hyperparameter choices and require careful tuning",
        "Assumes i.i.d. data — poor handling of temporal dependencies without feature engineering",
    ],
    "neural-network": [
        "Requires large amounts of training data to generalize well",
        "Computationally expensive — needs GPU hardware for practical training times",
        "Black-box nature — difficult to interpret learned representations and decisions",
        "Prone to overfitting without proper regularization (dropout, weight decay, data augmentation)",
        "Hyperparameter tuning is expensive — architecture, learning rate, and regularization all interact",
    ],
    "optimization": [
        "Problem formulation requires mathematical expertise — modeling errors can be costly",
        "Computational complexity grows rapidly with problem size (NP-hard for integer programs)",
        "Global optimality not guaranteed for non-convex problems",
        "Sensitive to numerical precision and constraint scaling",
        "May not handle stochastic or uncertain parameters without reformulation",
    ],
    "reinforcement-learning": [
        "Sample inefficient — requires millions of interactions for complex environments",
        "Training is inherently unstable — reward signal is sparse and delayed",
        "Difficult to debug — failures may be due to exploration, reward shaping, or architecture",
        "Sim-to-real gap — policies learned in simulation may not transfer to live markets",
        "Safety concerns — exploration can be dangerous in real financial environments",
    ],
    "probabilistic-symbolic": [
        "Exact inference is often intractable — approximations introduce errors",
        "Computational cost scales poorly with model complexity and number of variables",
        "Prior specification requires domain expertise — poor priors degrade results",
        "Symbolic components can be brittle when assumptions are violated",
        "Limited scalability to very high-dimensional data compared to deep learning",
    ],
    "statistical": [
        "Strong distributional assumptions — model misspecification leads to biased estimates",
        "Generally linear — cannot capture complex non-linear patterns without manual feature engineering",
        "Sensitive to outliers unless robust variants are used",
        "Requires careful assumption checking (normality, homoscedasticity, independence)",
        "Limited expressiveness compared to flexible ML/DL approaches for complex data",
    ],
    "simulation-decision": [
        "Computational cost scales with problem complexity and required accuracy",
        "Model risk — simulations are only as good as their underlying assumptions",
        "Difficult to validate — no ground truth for counterfactual scenarios",
        "Can be slow for real-time decision-making without pre-computation or approximation",
        "Results can be sensitive to random seed and number of simulation runs",
    ],
    "hybrid-composite": [
        "Increased complexity — harder to implement, debug, and maintain than single-paradigm models",
        "Risk of one component dominating, making others redundant",
        "Training instability from gradient scale mismatches between components",
        "Larger parameter count and memory footprint than individual components",
        "Integration engineering requires expertise across multiple paradigms",
    ],
    "generative": [
        "Training instability — GANs suffer mode collapse, VAEs produce blurry outputs",
        "Difficult to evaluate — no single metric captures generation quality",
        "Computationally expensive — both training and generation can be slow",
        "May memorize training data rather than learning true distribution",
        "Hard to control — directing generation toward desired attributes is challenging",
    ],
}

CATEGORY_APPLICATIONS = {
    "machine-learning": [
        "Classification of market regimes (bull, bear, sideways) from indicator features",
        "Prediction of directional price movements for signal generation",
        "Feature importance ranking for indicator selection in trading systems",
        "Anomaly detection in trade execution patterns",
        "Risk scoring and credit assessment for portfolio management",
    ],
    "neural-network": [
        "Sequence modeling of OHLCV bar data for multi-step price forecasting",
        "Feature extraction from raw market data for downstream classifiers",
        "Order book representation learning from MBP-10 depth data",
        "Pattern recognition across multiple timeframes and instruments",
        "End-to-end trading signal generation from raw market inputs",
    ],
    "optimization": [
        "Portfolio optimization — optimal asset allocation under risk constraints",
        "Execution scheduling — minimize market impact over multiple order batches",
        "Risk budget allocation across strategies and asset classes",
        "Strategy parameter tuning within defined feasibility regions",
        "Hedging optimization — minimize residual risk at minimum cost",
    ],
    "reinforcement-learning": [
        "Automated trading strategy learning from market interaction",
        "Optimal order execution — minimize slippage and market impact",
        "Dynamic portfolio rebalancing with transaction cost awareness",
        "Market-making with adaptive spread management",
        "Multi-asset strategy coordination with position limit constraints",
    ],
    "probabilistic-symbolic": [
        "Bayesian inference for model parameter uncertainty in trading signals",
        "Hidden state detection in market regime-switching models",
        "Rule-based filtering of trading signals with probabilistic confidence",
        "Causal inference for identifying genuine predictive factors",
        "Expert system encoding of domain-specific trading rules",
    ],
    "statistical": [
        "Return distribution modeling for VaR and CVaR risk metrics",
        "Volatility forecasting using GARCH-family time series models",
        "Hypothesis testing for trading signal alpha significance",
        "Regression analysis of factor exposures and risk premia",
        "Survival analysis for trade duration and stop-loss modeling",
    ],
    "simulation-decision": [
        "Monte Carlo simulation for portfolio risk and tail-event analysis",
        "Strategy backtesting across thousands of simulated market scenarios",
        "Game-theoretic modeling of multi-player market microstructure",
        "Scenario analysis for stress testing under extreme market conditions",
        "Decision tree analysis for trade entry/exit rule evaluation",
    ],
    "hybrid-composite": [
        "Combined neural-symbolic systems for interpretable trading signals",
        "Graph-attention networks for inter-asset dependency modeling",
        "Tree-boosted neural embeddings for tabular market data",
        "Differentiable planning for multi-step execution strategies",
        "Ensemble architectures combining diverse model types for robust prediction",
    ],
    "generative": [
        "Synthetic market data generation for strategy testing and augmentation",
        "Scenario generation for stress testing and tail-risk analysis",
        "Data augmentation for training classifiers on rare market events",
        "Imputation of missing market data in sparse or illiquid instruments",
        "Privacy-preserving market data sharing via generated synthetic datasets",
    ],
}

CATEGORY_COMPARE_2 = {
    "machine-learning": "classic ML methods (Random Forests, SVMs, Gradient Boosting) trade off interpretability for accuracy; neural networks offer more flexibility but need more data and compute",
    "neural-network": "compared to classical ML, neural networks offer greater capacity and automatic feature learning but require more data, compute, and careful regularization; compared to Transformers, recurrent models offer better streaming inference but worse parallelization",
    "optimization": "compared to heuristic methods, exact optimization provides guarantees but may be slower; greedy approaches are fast but may miss global optima; metaheuristics balance quality and speed for complex landscapes",
    "reinforcement-learning": "model-free methods are more flexible but less sample-efficient than model-based; policy gradient methods handle continuous actions better than value-based; hierarchical RL decomposes complexity but is harder to train",
    "probabilistic-symbolic": "compared to neural approaches, probabilistic models provide better uncertainty quantification but less capacity; symbolic systems offer interpretability but struggle with noise; hybrid neuro-symbolic approaches aim to combine the best of both",
    "statistical": "compared to ML methods, statistical models are more interpretable and provide uncertainty estimates but assume distributional forms; compared to Bayesian approaches, frequentist methods are faster but provide point estimates only",
    "simulation-decision": "compared to analytical solutions, simulation is more flexible but computationally expensive; compared to ML-based approximations, simulation provides distributional information but is slower at inference time",
    "hybrid-composite": "compared to single-paradigm models, hybrid architectures are more expressive but harder to train; the choice of fusion strategy (early, late, attention-based) significantly impacts performance",
    "generative": "VAEs provide stable training but blurry outputs; GANs produce sharper results but suffer from mode collapse; diffusion models offer the best quality but are slowest; normalizing flows enable exact likelihood computation but have architectural constraints",
}


# ── File discovery ──────────────────────────────────────────────────────────


def find_empty_files(root: Path) -> list[ModelInfo]:
    """Find all 0-byte .md files and extract metadata."""
    results = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for fname in filenames:
            if not fname.endswith(".md"):
                continue
            fpath = Path(dirpath) / fname
            if fpath.stat().st_size > 0:
                continue

            rel = fpath.relative_to(root)
            parts = rel.parts
            cat_folder = parts[0] if len(parts) >= 1 else "unknown"
            sub_folder = parts[-2] if len(parts) >= 3 else "General"

            cat_key = FOLDER_TO_KEY.get(cat_folder, cat_folder.lower().replace(" ", "-"))
            results.append(ModelInfo(fpath, fpath.stem, cat_key, sub_folder))

    return sorted(results, key=lambda m: str(m.path))


# ── Content generation ──────────────────────────────────────────────────────


def _abbrev(name: str) -> str:
    """Extract abbreviation from parentheses if present."""
    if "(" in name and ")" in name:
        inner = name[name.index("(") + 1 : name.index(")")]
        if len(inner) <= 15:
            return inner
    return ""


def _short_name(name: str) -> str:
    """Get concise name for references."""
    ab = _abbrev(name)
    return ab if ab else name.split("(")[0].strip()[:30]


def _safe_class_name(name: str) -> str:
    """Convert model name to a valid Python class name."""
    result = ""
    for ch in name:
        if ch.isalnum():
            result += ch
    return result or "Model"


def generate_spec(info: ModelInfo) -> str:
    """Generate full markdown spec for a model."""
    cat = info.category
    sub = info.subcategory
    name = info.name
    short = _short_name(name)
    cls_name = _safe_class_name(short)

    preamble = CATEGORY_PREAMBLES.get(cat, CATEGORY_PREAMBLES["machine-learning"])
    math_text = CATEGORY_MATH.get(cat, CATEGORY_MATH["machine-learning"])
    training_text = CATEGORY_TRAINING.get(cat, CATEGORY_TRAINING["machine-learning"])
    compare_text = CATEGORY_COMPARE_2.get(cat, "")

    advantages = CATEGORY_ADVANTAGES.get(cat, CATEGORY_ADVANTAGES["machine-learning"])
    disadvantages = CATEGORY_DISADVANTAGES.get(cat, CATEGORY_DISADVANTAGES["machine-learning"])
    applications = CATEGORY_APPLICATIONS.get(cat, CATEGORY_APPLICATIONS["machine-learning"])

    adv_bullets = "\n".join(f"- {a}" for a in advantages)
    dis_bullets = "\n".join(f"- {d}" for d in disadvantages)
    app_bullets = "\n".join(f"- {a}" for a in applications)

    # Build the spec
    lines = []
    lines.append(
        f"Below is a comprehensive overview of the **{name}** model, formatted for study. "
        f"The content covers the model's definition, mathematical foundation, architecture, "
        f"training, advantages, disadvantages, applications, and notable implementations."
    )
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append(f"# {name}")
    lines.append("")

    # Definition
    lines.append("## Definition")
    lines.append("")
    lines.append(f"**{name}** is {preamble}")
    lines.append("")
    lines.append(
        f"Within the **{sub}** domain, {short} addresses specific challenges by providing "
        f"a structured methodology for learning from data, making predictions, or optimizing "
        f"objectives. It is widely referenced in both academic literature and applied systems."
    )
    lines.append("")

    # Mathematical Foundation
    lines.append("## Mathematical Foundation")
    lines.append("")
    lines.append(math_text)
    lines.append("")
    lines.append(
        f"For {short} specifically, the mathematical framework is adapted to the "
        f"characteristics of its problem domain within {sub}, with modifications "
        f"to the objective function, constraints, or update rules as appropriate."
    )
    lines.append("")

    # Architecture
    lines.append("## Architecture")
    lines.append("")
    lines.append(_architecture_text(cat, name, short, sub))
    lines.append("")

    # Training
    lines.append("## Training")
    lines.append("")
    lines.append(training_text)
    lines.append("")

    # Advantages
    lines.append("## Advantages")
    lines.append("")
    lines.append(adv_bullets)
    lines.append("")

    # Disadvantages
    lines.append("## Disadvantages")
    lines.append("")
    lines.append(dis_bullets)
    lines.append("")

    # Applications
    lines.append("## Applications")
    lines.append("")
    lines.append(app_bullets)
    lines.append("")

    # Notable Implementations
    lines.append("## Notable Implementations")
    lines.append("")
    lines.append(_implementations_text(cat, name, short))
    lines.append("")

    # Comparison
    lines.append("## Comparison with Other Models")
    lines.append("")
    lines.append(
        f"Within the broader {cat.replace('-', ' ')} landscape, {compare_text}. "
        f"{short} occupies a specific niche defined by its balance of "
        f"computational efficiency, expressive power, and practical usability."
    )
    lines.append("")

    # Recent Advances
    lines.append("## Recent Advances")
    lines.append("")
    lines.append(_advances_text(cat, short))
    lines.append("")

    # Example Code
    lines.append("## Example Code")
    lines.append("")
    lines.append("```python")
    lines.append(_example_code(cat, name, short, cls_name))
    lines.append("```")
    lines.append("")

    # Resources
    lines.append("## Resources")
    lines.append("")
    lines.append(f"- Original paper and reference implementation for {name}")
    lines.append(
        f"- scikit-learn, PyTorch, or TensorFlow documentation for {short} (where applicable)"
    )
    lines.append("- Benchmark comparisons on standard datasets and financial applications")
    lines.append("- Community implementations and tutorials on GitHub")
    lines.append("")

    # Conclusion
    lines.append("## Conclusion")
    lines.append("")
    lines.append(
        f"{name} provides a well-defined approach to {_task_phrase(cat)} within the "
        f"{sub} domain. Its combination of {_strength_phrase(cat)} makes it a valuable "
        f"tool for quantitative trading research, particularly when {_use_case(cat)}. "
        f"Understanding its strengths and limitations relative to alternatives enables "
        f"informed model selection for different market analysis tasks."
    )
    lines.append("")

    return "\n".join(lines)


# ── Section helpers ─────────────────────────────────────────────────────────


def _architecture_text(cat: str, name: str, short: str, sub: str) -> str:
    architectures = {
        "machine-learning": f"{name} consists of a structured computational pipeline: (1) Input preprocessing "
        f"and feature transformation, (2) Model-specific computation (splitting, distance "
        f"calculation, weight updates, or kernel evaluation), (3) Output prediction "
        f"(class label, probability, or continuous value). The model's internal "
        f"representation is determined by its parametric form — tree structures store "
        f"decision rules, kernel methods store support vectors, and linear models store "
        f"weight coefficients. Complexity is controlled through hyperparameters that "
        f"govern model capacity (depth, number of components, regularization strength).",
        "neural-network": f"{name} is composed of interconnected layers of computational units: "
        f"an input layer receiving feature vectors, hidden layers performing learned "
        f"transformations (convolution, recurrence, attention, gating), and an output "
        f"layer producing task-specific predictions. The architecture's distinctive "
        f"characteristic — whether it be memory cells, routing mechanisms, parallel "
        f"pathways, or specialized connectivity patterns — enables it to capture "
        f"specific types of data structure that generic architectures miss. "
        f"Residual connections, normalization layers, and dropout are commonly added "
        f"for training stability.",
        "optimization": f"{name} operates through an iterative solver framework: (1) Problem formulation — "
        f"define objective function, constraints, and variable domains, (2) Initialization — "
        f"select starting point or initial population, (3) Search/update — apply the "
        f"algorithm's characteristic step (gradient, evolutionary operator, branching rule), "
        f"(4) Convergence check — test optimality conditions or termination criteria. "
        f"The algorithm's structure is tailored to exploit the mathematical properties "
        f"of the problem class it targets (convexity, linearity, decomposability).",
        "reinforcement-learning": f"{name} comprises several interacting components within the RL framework: "
        f"(1) Policy network pi(a|s) — maps states to actions, (2) Value network V(s) or "
        f"Q(s,a) — estimates expected returns, (3) Experience collection — generates "
        f"trajectories through environment interaction, (4) Update mechanism — the "
        f"algorithm's characteristic way of improving the policy from collected experience. "
        f"The architecture may include replay buffers, target networks, model networks, "
        f"or hierarchical decomposition depending on the specific RL paradigm.",
        "probabilistic-symbolic": f"{name} represents knowledge through a structured probabilistic or logical "
        f"framework: (1) Variable/node definitions with domains and relationships, "
        f"(2) Probability tables, potentials, or rule weights encoding dependencies, "
        f"(3) Inference engine for computing posterior beliefs or deriving conclusions, "
        f"(4) Learning/adaptation mechanism for updating parameters from data. "
        f"The model's graph structure (directed, undirected, factor graph) or logical "
        f"form (Horn clauses, first-order rules) determines its expressiveness and "
        f"computational properties.",
        "statistical": f"{name} is structured as: (1) Response distribution specification — the assumed "
        f"form of the outcome variable, (2) Linear predictor — weighted combination of "
        f"input features (possibly with basis expansions or interactions), (3) Link function — "
        f"connecting the linear predictor to the response mean, (4) Parameter estimation — "
        f"fitting procedure (MLE, IRLS, MCMC) with inference on coefficients. "
        f"Model diagnostics (residual plots, QQ plots, goodness-of-fit tests) are integral "
        f"to the workflow.",
        "simulation-decision": f"{name} is built around: (1) System model — equations or rules describing how "
        f"the system evolves over time or across scenarios, (2) Uncertainty representation — "
        f"probability distributions, scenarios, or fuzzy sets for unknown quantities, "
        f"(3) Decision/action space — the set of choices available to the decision-maker, "
        f"(4) Evaluation engine — simulation, enumeration, or sampling to assess outcomes, "
        f"(5) Decision criterion — utility maximization, risk minimization, or multi-criteria "
        f"aggregation to rank alternatives.",
        "hybrid-composite": f"{name} integrates multiple computational paradigms: (1) Component A — one "
        f"learning paradigm (e.g., neural network for feature extraction), (2) Component B — "
        f"a complementary paradigm (e.g., graph model for relational reasoning, tree model "
        f"for structured prediction, or symbolic system for rule application), (3) Fusion "
        f"module — combines component outputs through concatenation, attention, gating, or "
        f"learned aggregation, (4) End-to-end training with gradient flow through all "
        f"components (where differentiable) or alternating optimization.",
        "generative": f"{name} learns to model and sample from the data distribution through: "
        f"(1) Encoder/recognition network — maps data to latent representations, "
        f"(2) Latent space — lower-dimensional representation capturing data factors, "
        f"(3) Decoder/generator — maps latent codes back to data space, "
        f"(4) Training objective — reconstruction loss, adversarial loss, or likelihood "
        f"maximization that encourages the model to capture the data distribution. "
        f"Sampling from the latent space produces new data points.",
    }
    return architectures.get(cat, architectures["machine-learning"])


def _implementations_text(cat: str, name: str, short: str) -> str:
    base = [
        f"- **Original paper**: The foundational publication introducing {name} and establishing its theoretical framework.",
        f"- **Reference implementation**: Open-source code accompanying the original paper (typically Python/C++).",
        f"- **Library integrations**: Available in major ML frameworks — scikit-learn, PyTorch, TensorFlow, JAX (where applicable).",
        f"- **Production deployments**: Used in industry for quantitative finance, risk management, and automated trading systems.",
    ]
    extras = {
        "reinforcement-learning": [
            f"- **OpenAI Baselines / Stable-Baselines3**: Standardized RL algorithm implementations including related methods.",
            f"- **RLlib (Ray)**: Distributed RL framework with scalable training infrastructure.",
        ],
        "optimization": [
            f"- **Solver support**: Available in commercial (Gurobi, CPLEX) and open-source (SCIP, OR-Tools, SciPy) solvers.",
        ],
        "statistical": [
            f"- **R ecosystem**: statsmodels (Python), glm/lme4 (R), and Stan for Bayesian estimation.",
        ],
    }
    result = base + extras.get(cat, [])
    return "\n".join(result)


def _advances_text(cat: str, short: str) -> str:
    advances = {
        "machine-learning": f"Recent work on {short} includes: integration with deep learning for hybrid models, "
        f"automated hyperparameter tuning via Bayesian optimization, improved scalability "
        f"through distributed training frameworks, enhanced interpretability methods "
        f"(SHAP, LIME), and applications to alternative data sources (satellite imagery, "
        f"NLP sentiment, social media). Federated learning variants enable privacy-preserving "
        f"training across institutions.",
        "neural-network": f"Recent advances in {short} include: attention-based improvements for capturing "
        f"long-range dependencies, efficient inference through pruning and quantization, "
        f"self-supervised pre-training for transfer learning, architecture search (NAS) for "
        f"automated design, and mixed-precision training for faster GPU throughput. "
        f"Applications to financial time series have grown significantly with the availability "
        f"of large-scale market datasets.",
        "optimization": f"Recent developments in {short} include: learning-assisted solvers that use ML to "
        f"guide search, quantum-inspired optimization algorithms, improved decomposition "
        f"methods for large-scale problems, robust optimization under distributional "
        f"uncertainty, and integration with differentiable programming for end-to-end "
        f"learning pipelines. GPU-accelerated solvers have dramatically improved runtimes.",
        "reinforcement-learning": f"Recent advances in {short} include: offline RL methods that learn from static "
        f"datasets without further environment interaction, improved sample efficiency "
        f"through model-based and goal-conditioned approaches, better exploration via "
        f"intrinsic motivation and curiosity-driven learning, multi-agent extensions, "
        f"and application to real-world sequential decision problems including trading "
        f"and portfolio management.",
        "probabilistic-symbolic": f"Recent work on {short} includes: neural-symbolic integration combining deep "
        f"learning with logical reasoning, amortized inference for faster posterior "
        f"estimation, causal discovery from observational data, probabilistic programming "
        f"languages (Pyro, NumPyro) enabling flexible model specification, and applications "
        f"to explainable AI where interpretability is critical.",
        "statistical": f"Recent advances in {short} include: regularized extensions for high-dimensional "
        f"settings, Bayesian neural network connections, conformal prediction for "
        f"distribution-free uncertainty quantification, online/streaming estimation for "
        f"real-time applications, and integration with causal inference frameworks. "
        f"Modern computational tools have made Bayesian inference practical for complex models.",
        "simulation-decision": f"Recent developments in {short} include: ML-assisted simulation calibration "
        f"and surrogate modeling for speed, agent-based models incorporating RL agents, "
        f"digital twin frameworks for real-time system monitoring, GPU-accelerated "
        f"Monte Carlo methods, and integration with optimization for simulation-based "
        f"decision optimization under deep uncertainty.",
        "hybrid-composite": f"Recent advances in {short} include: differentiable programming enabling gradient "
        f"flow through traditionally non-differentiable components, attention-based fusion "
        f"mechanisms, multi-task learning for shared representations, and automated "
        f"architecture search for hybrid designs. Applications to multi-modal data "
        f"(text + numeric + graph) are particularly active.",
        "generative": f"Recent advances in {short} include: diffusion model improvements for higher "
        f"quality generation, conditional generation for controlled output, latent "
        f"consistency models for faster sampling, classifier-free guidance, and "
        f"applications to financial data synthesis for augmentation and stress testing.",
    }
    return advances.get(cat, advances["machine-learning"])


def _example_code(cat: str, name: str, short: str, cls_name: str) -> str:
    codes = {
        "machine-learning": (
            f"# {name} — Illustrative usage with market data\n"
            f"import numpy as np\n"
            f"from sklearn.model_selection import train_test_split\n"
            f"from sklearn.preprocessing import StandardScaler\n"
            f"\n"
            f"# Simulated market features: RSI, ATR, momentum, etc.\n"
            f"np.random.seed(42)\n"
            f"X = np.random.randn(2000, 8)  # 8 indicator features\n"
            f"y = (X[:, 0] + 0.5 * X[:, 1] > 0.3).astype(int)  # Binary regime\n"
            f"\n"
            f"scaler = StandardScaler()\n"
            f"X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)\n"
            f"X_train = scaler.fit_transform(X_train)\n"
            f"X_test = scaler.transform(X_test)\n"
            f"\n"
            f"# TODO: Replace with actual {short} implementation\n"
            f"# from sklearn.xxx import {cls_name}\n"
            f"# model = {cls_name}()\n"
            f"# model.fit(X_train, y_train)\n"
            f"# accuracy = model.score(X_test, y_test)\n"
            f'# print(f"{short} Accuracy: {{accuracy:.4f}}")'
        ),
        "neural-network": (
            f"# {name} — PyTorch implementation sketch\n"
            f"import torch\n"
            f"import torch.nn as nn\n"
            f"\n"
            f"class {cls_name}(nn.Module):\n"
            f"    def __init__(self, input_dim=31, hidden_dim=128, output_dim=3):\n"
            f"        super().__init__()\n"
            f"        self.net = nn.Sequential(\n"
            f"            nn.Linear(input_dim, hidden_dim),\n"
            f"            nn.ReLU(),\n"
            f"            nn.Dropout(0.2),\n"
            f"            nn.Linear(hidden_dim, hidden_dim // 2),\n"
            f"            nn.ReLU(),\n"
            f"            nn.Linear(hidden_dim // 2, output_dim),\n"
            f"        )\n"
            f"\n"
            f"    def forward(self, x):\n"
            f"        return self.net(x)\n"
            f"\n"
            f"# 60-bar window, 31 features -> 3-class regime\n"
            f"model = {cls_name}(input_dim=31, hidden_dim=128, output_dim=3)\n"
            f"x = torch.randn(16, 31)  # batch of 16 samples\n"
            f"logits = model(x)\n"
            f'print(f"Output shape: {{logits.shape}}")\n'
            f'print(f"Parameters: {{sum(p.numel() for p in model.parameters()):,}}")'
        ),
        "optimization": (
            f"# {name} — Problem setup sketch\n"
            f"import numpy as np\n"
            f"\n"
            f"# Portfolio optimization example using {short}\n"
            f"n_assets = 10\n"
            f"np.random.seed(42)\n"
            f"returns = np.random.randn(252, n_assets) * 0.02  # Daily returns\n"
            f"expected_returns = returns.mean(axis=0)\n"
            f"cov_matrix = np.cov(returns.T)\n"
            f"\n"
            f"# Define optimization problem\n"
            f"# minimize: w^T @ cov @ w  (portfolio variance)\n"
            f"# subject to: w^T @ mu >= target_return, sum(w) = 1, w >= 0\n"
            f"# TODO: Solve using {short}-specific solver or scipy.optimize\n"
            f"\n"
            f"from scipy.optimize import minimize\n"
            f"\n"
            f"def portfolio_variance(w):\n"
            f"    return w @ cov_matrix @ w\n"
            f"\n"
            f"constraints = [\n"
            f'    {{"type": "eq", "fun": lambda w: np.sum(w) - 1}},\n'
            f'    {{"type": "ineq", "fun": lambda w: w @ expected_returns - 0.001}},\n'
            f"]\n"
            f"bounds = [(0, 1)] * n_assets\n"
            f"w0 = np.ones(n_assets) / n_assets\n"
            f"\n"
            f'result = minimize(portfolio_variance, w0, method="SLSQP",\n'
            f"                  bounds=bounds, constraints=constraints)\n"
            f'print(f"Optimal weights: {{result.x.round(3)}}")\n'
            f'print(f"Portfolio std: {{np.sqrt(result.fun):.4f}}")'
        ),
        "reinforcement-learning": (
            f"# {name} — RL agent sketch\n"
            f"import numpy as np\n"
            f"\n"
            f"class {cls_name}Agent:\n"
            f"    def __init__(self, state_dim=31, action_dim=3, lr=1e-3):\n"
            f"        self.state_dim = state_dim\n"
            f"        self.action_dim = action_dim\n"
            f"        self.lr = lr\n"
            f"        # Initialize policy parameters\n"
            f"        self.weights = np.random.randn(state_dim, action_dim) * 0.01\n"
            f"\n"
            f"    def select_action(self, state, epsilon=0.1):\n"
            f'        """Epsilon-greedy action selection."""\n'
            f"        if np.random.random() < epsilon:\n"
            f"            return np.random.randint(self.action_dim)\n"
            f"        q_values = state @ self.weights\n"
            f"        return np.argmax(q_values)\n"
            f"\n"
            f"    def update(self, state, action, reward, next_state, done, gamma=0.99):\n"
            f'        """Single-step update (simplified)."""\n'
            f"        q_current = state @ self.weights\n"
            f"        q_next = next_state @ self.weights\n"
            f"        target = reward + (1 - done) * gamma * np.max(q_next)\n"
            f"        error = target - q_current[action]\n"
            f"        self.weights[:, action] += self.lr * error * state\n"
            f"        return error\n"
            f"\n"
            f"# Usage\n"
            f"agent = {cls_name}Agent(state_dim=31, action_dim=3)\n"
            f"state = np.random.randn(31)  # Market state vector\n"
            f"action = agent.select_action(state)\n"
            f'print(f"Selected action: {{action}} (0=hold, 1=buy, 2=sell)")'
        ),
        "probabilistic-symbolic": (
            f"# {name} — Probabilistic model sketch\n"
            f"import numpy as np\n"
            f"\n"
            f"class {cls_name}:\n"
            f"    def __init__(self, n_states=3):\n"
            f"        self.n_states = n_states\n"
            f"        # Initialize uniform priors\n"
            f"        self.prior = np.ones(n_states) / n_states\n"
            f"        self.params = {{}}\n"
            f"\n"
            f"    def fit(self, data):\n"
            f'        """Estimate parameters from data."""\n'
            f"        # Simplified parameter estimation\n"
            f'        self.params["mean"] = np.mean(data, axis=0)\n'
            f'        self.params["std"] = np.std(data, axis=0) + 1e-6\n'
            f"        return self\n"
            f"\n"
            f"    def predict_proba(self, x):\n"
            f'        """Return posterior probabilities."""\n'
            f"        # Simplified likelihood computation\n"
            f'        z = (x - self.params["mean"]) / self.params["std"]\n'
            f"        likelihood = np.exp(-0.5 * np.sum(z**2))\n"
            f"        posterior = self.prior * likelihood\n"
            f"        return posterior / (posterior.sum() + 1e-10)\n"
            f"\n"
            f"# Usage with market data\n"
            f"model = {cls_name}(n_states=3)  # 3 market regimes\n"
            f"data = np.random.randn(1000, 8)  # Historical features\n"
            f"model.fit(data)\n"
            f"probs = model.predict_proba(np.random.randn(8))\n"
            f'print(f"Regime probabilities: {{probs.round(3)}}")'
        ),
        "statistical": (
            f"# {name} — Statistical model sketch\n"
            f"import numpy as np\n"
            f"\n"
            f"# Simulated market data\n"
            f"np.random.seed(42)\n"
            f"n = 500\n"
            f"X = np.column_stack([\n"
            f"    np.random.randn(n),      # RSI (normalized)\n"
            f"    np.random.randn(n),      # ATR (normalized)\n"
            f"    np.random.randn(n),      # Momentum\n"
            f"    np.random.randn(n),      # Volume ratio\n"
            f"])\n"
            f"beta_true = np.array([0.5, -0.3, 0.8, 0.1])\n"
            f"y = X @ beta_true + np.random.randn(n) * 0.5  # Returns\n"
            f"\n"
            f"# Ordinary least squares as baseline\n"
            f"X_with_intercept = np.column_stack([np.ones(n), X])\n"
            f"beta_hat = np.linalg.lstsq(X_with_intercept, y, rcond=None)[0]\n"
            f"y_pred = X_with_intercept @ beta_hat\n"
            f"residuals = y - y_pred\n"
            f"r_squared = 1 - np.sum(residuals**2) / np.sum((y - y.mean())**2)\n"
            f"\n"
            f'print(f"Coefficients: {{beta_hat[1:].round(4)}}")\n'
            f'print(f"Intercept:    {{beta_hat[0]:.4f}}")\n'
            f'print(f"R-squared:    {{r_squared:.4f}}")\n'
            f'print(f"Residual std: {{residuals.std():.4f}}")'
        ),
        "simulation-decision": (
            f"# {name} — Simulation/decision model sketch\n"
            f"import numpy as np\n"
            f"\n"
            f"class {cls_name}:\n"
            f"    def __init__(self, n_scenarios=10000):\n"
            f"        self.n_scenarios = n_scenarios\n"
            f"\n"
            f"    def simulate(self, initial_value, mu, sigma, horizon=252):\n"
            f'        """Run Monte Carlo simulation for portfolio value."""\n'
            f"        dt = 1 / 252\n"
            f"        np.random.seed(42)\n"
            f"        paths = np.zeros((self.n_scenarios, horizon + 1))\n"
            f"        paths[:, 0] = initial_value\n"
            f"        for t in range(1, horizon + 1):\n"
            f"            z = np.random.randn(self.n_scenarios)\n"
            f"            paths[:, t] = paths[:, t-1] * np.exp(\n"
            f"                (mu - 0.5 * sigma**2) * dt + sigma * np.sqrt(dt) * z\n"
            f"            )\n"
            f"        return paths\n"
            f"\n"
            f"    def risk_metrics(self, paths, alpha=0.05):\n"
            f'        """Compute VaR and CVaR from simulated paths."""\n'
            f"        final = paths[:, -1]\n"
            f"        returns = final / paths[:, 0] - 1\n"
            f"        var = np.percentile(returns, alpha * 100)\n"
            f"        cvar = returns[returns <= var].mean()\n"
            f'        return {{"VaR": var, "CVaR": cvar, "mean": returns.mean()}}\n'
            f"\n"
            f"sim = {cls_name}(n_scenarios=10000)\n"
            f"paths = sim.simulate(100000, mu=0.08, sigma=0.20)\n"
            f"metrics = sim.risk_metrics(paths)\n"
            f"print(f\"Risk metrics: {{{{k: f'{{v:.4f}}' for k, v in metrics.items()}}}}\")"
        ),
        "hybrid-composite": (
            f"# {name} — Hybrid architecture sketch\n"
            f"import torch\n"
            f"import torch.nn as nn\n"
            f"\n"
            f"class {cls_name}(nn.Module):\n"
            f"    def __init__(self, input_dim=31, output_dim=3):\n"
            f"        super().__init__()\n"
            f"        # Component A: Neural feature extractor\n"
            f"        self.neural_path = nn.Sequential(\n"
            f"            nn.Linear(input_dim, 64), nn.ReLU(), nn.Dropout(0.2),\n"
            f"            nn.Linear(64, 32), nn.ReLU(),\n"
            f"        )\n"
            f"        # Component B: Alternative representation\n"
            f"        self.alt_path = nn.Sequential(\n"
            f"            nn.Linear(input_dim, 32), nn.Tanh(),\n"
            f"        )\n"
            f"        # Fusion\n"
            f"        self.fusion = nn.Sequential(\n"
            f"            nn.Linear(64, 32), nn.ReLU(),\n"
            f"            nn.Linear(32, output_dim),\n"
            f"        )\n"
            f"\n"
            f"    def forward(self, x):\n"
            f"        h1 = self.neural_path(x)\n"
            f"        h2 = self.alt_path(x)\n"
            f"        fused = torch.cat([h1, h2], dim=-1)\n"
            f"        return self.fusion(fused)\n"
            f"\n"
            f"model = {cls_name}(input_dim=31, output_dim=3)\n"
            f"x = torch.randn(16, 31)\n"
            f'print(f"Output: {{model(x).shape}}")'
        ),
        "generative": (
            f"# {name} — Generative model sketch\n"
            f"import torch\n"
            f"import torch.nn as nn\n"
            f"\n"
            f"class {cls_name}(nn.Module):\n"
            f"    def __init__(self, input_dim=31, latent_dim=16):\n"
            f"        super().__init__()\n"
            f"        self.encoder = nn.Sequential(\n"
            f"            nn.Linear(input_dim, 64), nn.ReLU(),\n"
            f"            nn.Linear(64, latent_dim * 2),  # mean and log_var\n"
            f"        )\n"
            f"        self.decoder = nn.Sequential(\n"
            f"            nn.Linear(latent_dim, 64), nn.ReLU(),\n"
            f"            nn.Linear(64, input_dim),\n"
            f"        )\n"
            f"        self.latent_dim = latent_dim\n"
            f"\n"
            f"    def forward(self, x):\n"
            f"        h = self.encoder(x)\n"
            f"        mu, log_var = h.chunk(2, dim=-1)\n"
            f"        z = mu + torch.randn_like(mu) * (0.5 * log_var).exp()\n"
            f"        return self.decoder(z), mu, log_var\n"
            f"\n"
            f"model = {cls_name}(input_dim=31, latent_dim=16)\n"
            f"x = torch.randn(16, 31)  # Market feature vectors\n"
            f"recon, mu, lv = model(x)\n"
            f'print(f"Reconstruction: {{recon.shape}}, Latent: {{mu.shape}}")'
        ),
    }
    return codes.get(cat, codes["machine-learning"])


def _task_phrase(cat: str) -> str:
    phrases = {
        "machine-learning": "pattern recognition and prediction from structured data",
        "neural-network": "learning hierarchical representations from sequential or structured data",
        "optimization": "finding optimal solutions under constraints",
        "reinforcement-learning": "sequential decision-making from experience",
        "probabilistic-symbolic": "reasoning under uncertainty with structured knowledge",
        "statistical": "statistical inference and modeling of data relationships",
        "simulation-decision": "evaluating decisions under uncertainty through computational methods",
        "hybrid-composite": "combining multiple paradigms for enhanced modeling capability",
        "generative": "learning and sampling from complex data distributions",
    }
    return phrases.get(cat, "data-driven analysis and prediction")


def _strength_phrase(cat: str) -> str:
    phrases = {
        "machine-learning": "computational efficiency, interpretability, and robust generalization",
        "neural-network": "representational capacity, automatic feature learning, and scalability",
        "optimization": "mathematical rigor, constraint handling, and provable quality guarantees",
        "reinforcement-learning": "adaptive learning, long-horizon optimization, and strategy discovery",
        "probabilistic-symbolic": "principled uncertainty handling, interpretability, and knowledge integration",
        "statistical": "rigorous inference, calibrated uncertainty, and interpretable parameters",
        "simulation-decision": "scenario flexibility, risk quantification, and decision support",
        "hybrid-composite": "paradigm complementarity, expressiveness, and modular extensibility",
        "generative": "distribution modeling, data synthesis, and representation learning",
    }
    return phrases.get(cat, "flexibility and practical applicability")


def _use_case(cat: str) -> str:
    cases = {
        "machine-learning": "tabular indicator features need efficient and interpretable classification or regression",
        "neural-network": "raw sequential market data needs to be transformed into actionable predictions",
        "optimization": "portfolio allocation, execution scheduling, or resource budgeting must satisfy hard constraints",
        "reinforcement-learning": "trading strategies need to adapt dynamically to changing market conditions",
        "probabilistic-symbolic": "uncertainty quantification and causal reasoning are essential for decision-making",
        "statistical": "hypothesis testing, interval estimation, or distributional modeling are required",
        "simulation-decision": "complex systems with stochastic elements must be evaluated across many scenarios",
        "hybrid-composite": "no single modeling paradigm adequately captures the problem's multi-faceted structure",
        "generative": "synthetic data generation, scenario simulation, or density estimation are needed",
    }
    return cases.get(cat, "data-driven insights are needed for informed decision-making")


# ── Main ────────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Fill empty algo model specs")
    parser.add_argument("--write", action="store_true", help="Write files (default: dry-run)")
    parser.add_argument("--only", type=int, default=0, help="Process first N only")
    args = parser.parse_args()

    empty = find_empty_files(ALGO_MODELS_ROOT)
    print(f"Found {len(empty)} empty .md files")

    if args.only > 0:
        empty = empty[: args.only]
        print(f"Processing first {args.only}")

    written = 0
    errors = 0
    for info in empty:
        try:
            content = generate_spec(info)
            if args.write:
                info.path.write_text(content, encoding="utf-8")
                written += 1
                print(
                    f"  WROTE: {info.path.relative_to(ALGO_MODELS_ROOT)} ({content.count(chr(10))} lines)"
                )
            else:
                print(
                    f"  DRY-RUN: {info.name} [{info.category}/{info.subcategory}] ({content.count(chr(10))} lines)"
                )
        except Exception as exc:
            errors += 1
            print(f"  ERROR: {info.name} — {exc}")

    print(f"\nDone: {written} written, {errors} errors")
    if not args.write:
        print("Run with --write to apply.")


if __name__ == "__main__":
    main()
