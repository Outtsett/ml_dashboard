"""HDP-HMM model constants and prior defaults."""

# Truncation level (max possible regimes in the DP approximation).
# Unused components naturally collapse to their prior during Gibbs sampling.
K_TRUNC = 20

# Normal-Inverse-Gamma prior hyperparameters.
# mu_0 and b_0 are set from data at init time; these are structural constants.
NIG_PRIOR = {
    "lambda_0": 0.01,    # weak prior on mean location
    "a_0": 2.0,          # IG shape (> 1 ensures finite variance mean)
}
