"""The ``bayesian_predictive`` family: posterior-predictive models of the scaled h-bar move.

One adapter (``adapter.BayesianPredictiveAdapter``), four engines chosen by the
registry entry's ``direction.fixed.variant``:

    conjugate_linear      Bayesian linear regression in closed form, prior and noise
                          variances by evidence maximisation (MacKay)
    gaussian_process      scikit-learn GP regression on the last N training bars
    pymc_student_t        a PyMC Student-t regression sampled by NUTS through nutpie
                          (numba backend), or fitted by ADVI
    hierarchical_gibbs    time-of-day block weights partially pooled around a shared
                          mean, sampled by a conjugate Gibbs sampler

Every engine gives a predictive distribution of the scaled move for a bar;
P(up) is its mass above 0 and the price model is its mean. Fits read targets
only at training rows; predictions read only the bar's own feature row (and,
for the hierarchical model, the bar's own timestamp).
"""
