"""The ``glm_bridge`` family: generalized linear models run as Model Cycle adapters.

One adapter (``adapter.GlmBridgeAdapter``), eight mechanisms (``variants``),
chosen by the registry entry's ``direction.fixed.variant``:

    ordinal                 cumulative link (proportional odds), grades cut from the
                            scaled h-bar move with a threshold at exactly 0
    multinomial             softmax over down / flat / up; P(up) = p_up / (p_up + p_down)
    glm_link                Binomial GLM with a logit, probit, cloglog or cauchit link
    gamma                   two Gamma GLMs (up and down magnitudes), contest of the means
    poisson                 two Poisson GLMs (up-bar and down-bar counts), Skellam contest
    tweedie                 two Tweedie GLMs (positive and negative parts), zero-mass contest
    zero_inflated_poisson   two zero-inflated Poisson models (up and down impulse counts)
    multivariate            multi-horizon ridge with a residual covariance, Phi(y_h / sd_h)

``design.py`` holds the train-fitted standardisation and the target builders;
``links.py`` the inverse links and the cumulative-link probabilities. Every
fit reads targets only at training rows (``MarketView`` read rules) and every
prediction reads only the bar's own feature row, so a bar's P(up) never
depends on a later bar.
"""
