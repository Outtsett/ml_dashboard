"""Density classifiers: the catalog's generative models run as Bayes-rule classifiers.

A generative model of the CURRENT causal feature row is fitted per outcome
class on the fold's training rows — K = 2 (down, up) for the direction model,
K train-quantile bins of the price target (``bridges.binning.TargetBins``) for
the price model — and the class posterior is Bayes' rule over the class
scores with the training priors and one temperature fitted on the validation
rows:

    P(k | x) = softmax_k( inverse_temperature * score_k(x) + log prior_k )

``score_k`` is the model's own (log) likelihood of the row under class k:
exact for the flows and the autoregressive token models, a bound for the
variational autoencoder, the Bayesian mixture and the deep Boltzmann machine,
a denoising error for the diffusion family and the masked autoencoder, and a
joint log-density (whose normaliser is shared by every class, so no prior is
added) for the energy-based model and the Boltzmann machine. The price
forecast is the posterior-weighted mean target of the bins.

    adapter.py          ``DensityClassifierAdapter``: data, classes, priors,
                        the epoch loop, the validation temperature, save / load
    common.py           ``TorchDensity`` (what a variant writes), MLPs,
                        embeddings, the fixed noise grids
    flow.py             ``normalizing_flow`` (conditional RealNVP),
                        ``continuous_flow`` (FFJORD neural ODE, torchdiffeq)
    autoregressive.py   ``pixel_autoregressive`` (PixelCNN / PixelRNN over
                        quantile tokens), ``generative_transformer`` (GPT)
    latent.py           ``variational_autoencoder`` (IWAE scoring),
                        ``bayesian_mixture`` (Dirichlet-process Gaussian
                        mixture), ``masked_autoencoder`` (random masks or MADE)
    energy.py           ``joint_energy`` (JEM with Langevin negatives),
                        ``deep_boltzmann_machine`` (Gaussian-Bernoulli DBM)
    diffusion.py        ``diffusion`` (DDPM, MLP or 1-D U-Net denoiser),
                        ``score_matching`` (NCSN), ``perceptual_diffusion``

Causality: every statistic (standardisation, token edges, target bins, class
priors, network weights) is fitted on training rows; validation rows set only
the early-stopping epoch and the one temperature; a prediction at bar t reads
only row t of the feature matrix.
"""
