/**
 * Blueprints — Statistical Models (Bayesian, GLM family, regression
 * techniques, probabilistic mixtures, survival analysis, forecasting and
 * time series).
 *
 * Most of these methods have few or no learned weights in the neural-network
 * sense: a GLM's linear predictor is the only trainable piece, a Kaplan-Meier
 * curve has none at all, and a mixture model's "parameters" are a handful of
 * rates and weights, not a tensor stack. Where a stage genuinely is a linear
 * map with a known coefficient count, `P.linear` gives that count; everywhere
 * else `params` is omitted and what is actually estimated or stored (a
 * threshold vector, a covariance matrix, a changepoint schedule) is stated in
 * `detail` instead, per the project convention set in unsupervised.ts.
 */

import type { ArchGraph } from '../types';
import type { EdgeSpec, NodeSpec } from '../blueprint';
import { DIM, P, blueprint, chain } from '../blueprint';

const F = DIM.features;
const T = DIM.window;
const C = DIM.classes;

// ─── Orders the diagrams are drawn at ───────────────────────────────────────
//
// Several models here are parameterised by an ORDER rather than by a layer
// width, so `P.linear` has nothing to say about them. Every `params` count
// below is still arithmetic over a named order — never a typed-in total — so a
// reader can re-derive it from the same number the node's sublabel shows.

/** ARIMA(2,1,1) — the orders drawn on the ARIMA diagram. */
const ARIMA_AR_ORDER = 2;
const ARIMA_MA_ORDER = 1;
/** SARIMA (1,1,1) x (1,1,1)_s. */
const SARIMA_AR_ORDER = 1;
const SARIMA_MA_ORDER = 1;
const SARIMA_SEASONAL_AR_ORDER = 1;
const SARIMA_SEASONAL_MA_ORDER = 1;
/** GARCH(1,1) — `arch`'s lagged-squared-shock and lagged-variance orders. */
const GARCH_ARCH_ORDER = 1;
const GARCH_GARCH_ORDER = 1;
/** Prophet, at this repo's intraday defaults. */
const PROPHET_CHANGEPOINTS = 25;
const PROPHET_DAILY_FOURIER_TERMS = 10;
const PROPHET_WEEKLY_FOURIER_TERMS = 3;
const PROPHET_EVENTS = 8;
/** Mixture of exponentials — component count K. */
const MIXTURE_COMPONENTS = 3;
/** Bayesian hierarchical model — instrument groups. */
const HIERARCHY_GROUPS = 4;
/** Multivariate regression / quantile regression — target and quantile counts. */
const MULTIVARIATE_TARGETS = 3;
/** PLSR latent components retained. */
const PLS_COMPONENTS = 8;
/** Quantile regression — the quantiles drawn on the diagram. */
const QUANTILES = [0.1, 0.5, 0.9] as const;
/** STL smoother widths (odd, in bars) — both are TWO-SIDED windows. */
const STL_TREND_WINDOW = 193;
const STL_SEASONAL_WINDOW = 13;

function barInputNode(column: number, lane = 0): NodeSpec {
  return {
    id: 'input', kind: 'input', label: 'Bar features', sublabel: `${F} indicators, this bar`,
    outShape: `B × ${F}`, column, lane,
    analogy: 'Think of it as the trader glancing at this bar\'s 35 indicator readings the instant it closes — no history, just this snapshot.',
  };
}

/** Shared skeleton for the exponential-family / IRLS-fit GLMs: linear
 * predictor -> link -> likelihood -> IRLS reweighting loop -> output. Every
 * member of this family (GLM, Logistic, Poisson, Probit, Gamma, Tweedie)
 * really is fit this same way, differing only in the link function and the
 * assumed noise distribution — see blueprint.ts's note that a blueprint
 * draws the algorithm the spec describes. */
function glmBlueprint(spec: {
  title: string;
  subtitle: string;
  linkLabel: string;
  linkSublabel: string;
  linkOutShape?: string;
  linkAnalogy?: string;
  likelihoodLabel: string;
  likelihoodSublabel: string;
  outputLabel: string;
  outputSublabel: string;
  outputShape?: string;
  irlsSublabel: string;
}): ArchGraph {
  return blueprint({
    title: spec.title,
    subtitle: spec.subtitle,
    nodes: [
      barInputNode(0),
      {
        id: 'linear_predictor', kind: 'linear', label: 'Linear predictor', sublabel: 'eta = X·beta + beta0',
        inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 1), column: 1,
        detail: { formula: `P.linear(${F} features, 1 output) = ${P.linear(F, 1)}` },
      },
      {
        id: 'link', kind: 'activation', label: spec.linkLabel, sublabel: spec.linkSublabel,
        inShape: 'B × 1', outShape: spec.linkOutShape ?? 'B × 1', column: 2,
        analogy: spec.linkAnalogy,
      },
      {
        id: 'irls', kind: 'compare', label: 'IRLS reweighting', sublabel: spec.irlsSublabel,
        outShape: 'B × 2', column: 2, lane: 1,
        detail: { 'what it produces': 'a working response z_i and a weight w_i per bar, which is what the next weighted least-squares solve reads' },
      },
      {
        id: 'likelihood', kind: 'compare', label: spec.likelihoodLabel, sublabel: spec.likelihoodSublabel,
        inShape: spec.linkOutShape ?? 'B × 1', outShape: 'B × 1', column: 3,
      },
      {
        id: 'output', kind: 'output', label: spec.outputLabel, sublabel: spec.outputSublabel,
        outShape: spec.outputShape ?? 'B × 1', column: 4,
      },
    ],
    edges: [
      ...chain('input', 'linear_predictor', 'link', 'likelihood', 'output'),
      ['linear_predictor', 'irls', 'context', 'current eta, mu'],
      ['likelihood', 'irls', 'context', 'deviance not yet converged'],
      ['irls', 'linear_predictor', 'context', 'reweighted least-squares update, repeat'],
    ],
  });
}

export const STATISTICAL_BLUEPRINTS: Record<string, ArchGraph> = {
  // ─── Bayesian Models ────────────────────────────────────────────────────

  'statistical-models-bayesian-models-bayesian-hierarchical-model': blueprint({
    title: 'Bayesian Hierarchical Model',
    subtitle: `${HIERARCHY_GROUPS} instrument groups, partial pooling toward a shared population prior`,
    nodes: [
      { ...barInputNode(0), label: 'Grouped bar features', sublabel: `${HIERARCHY_GROUPS} instrument groups, ${F} features each`, outShape: `${HIERARCHY_GROUPS} × B × ${F}` },
      {
        id: 'population_prior', kind: 'memory', label: 'Population-level prior', sublabel: 'mu_beta, sigma_beta shared across groups',
        column: 1, lane: 1, params: 2 * F,
        detail: { formula: `2 × ${F} features = ${2 * F} (population mean + population scale, one per feature)` },
        analogy: 'Think of it as the "house view" every instrument starts from before its own data has a say.',
      },
      {
        id: 'mcmc', kind: 'stochastic', label: 'Gibbs / HMC sampling', sublabel: 'alternates group and population updates',
        column: 1, lane: 2,
      },
      {
        id: 'group_beta', kind: 'embedding', label: 'Per-group coefficients', sublabel: `${HIERARCHY_GROUPS} groups, shrunk toward the population mean`,
        inShape: `${HIERARCHY_GROUPS} × B × ${F}`, outShape: `${HIERARCHY_GROUPS} × ${F}`, params: P.embedding(HIERARCHY_GROUPS, F), column: 2,
        detail: { formula: `P.embedding(${HIERARCHY_GROUPS} groups, ${F} features) = ${P.embedding(HIERARCHY_GROUPS, F)}` },
        analogy: 'Think of it as a thinly-traded pair leaning on the pattern learned from the whole basket instead of overfitting its own short history.',
      },
      {
        id: 'likelihood', kind: 'compare', label: 'Bar-level likelihood', sublabel: 'Gaussian likelihood per bar within its group',
        inShape: `${HIERARCHY_GROUPS} × ${F}`, outShape: `${HIERARCHY_GROUPS} × B × 1`, column: 3,
      },
      {
        id: 'output', kind: 'output', label: 'Per-group posterior predictive', sublabel: 'shrunk forecast + uncertainty, one per group',
        inShape: `${HIERARCHY_GROUPS} × B × 1`, outShape: `${HIERARCHY_GROUPS} × B × 2`, column: 4,
      },
      {
        id: 'new_group', kind: 'output', label: 'New instrument (no history)', sublabel: 'predicted from the population prior alone',
        outShape: 'B × 2', column: 4, lane: 1,
      },
    ],
    edges: [
      ['input', 'group_beta', 'flow'],
      ['population_prior', 'group_beta', 'flow', 'shrinkage'],
      ['group_beta', 'likelihood', 'flow'],
      ['likelihood', 'output', 'flow'],
      ['likelihood', 'mcmc', 'context', 'current fit'],
      ['mcmc', 'population_prior', 'context', 'update population hyperparameters'],
      ['mcmc', 'group_beta', 'context', 'update per-group coefficients'],
      ['population_prior', 'new_group', 'context', 'cold start: use the population mean directly'],
    ],
  }),

  'statistical-models-bayesian-models-bayesian-linear-regression': blueprint({
    title: 'Bayesian Linear Regression',
    subtitle: 'conjugate Gaussian prior, closed-form posterior, sequential updating',
    nodes: [
      barInputNode(0),
      {
        id: 'prior', kind: 'memory', label: 'Gaussian prior', sublabel: 'beta ~ N(mu0, tau^2 I)',
        column: 1, lane: 1,
      },
      {
        id: 'likelihood', kind: 'compare', label: 'Gaussian likelihood', sublabel: 'y | X,beta,sigma^2 ~ N(X beta, sigma^2 I)',
        inShape: `B × ${F}`, outShape: `${F + 1} × ${F + 1}`, column: 1,
        detail: { 'sufficient statistics': `X^T X (${F + 1} × ${F + 1}) and X^T y (${F + 1} × 1) — everything the conjugate update reads off the data` },
      },
      {
        id: 'posterior', kind: 'memory', label: 'Posterior N(mu_N, Sigma_N)', sublabel: 'closed-form conjugate update',
        inShape: `${F + 1} × ${F + 1}`, outShape: `${F + 1} × 1`, params: P.linear(F, 1), column: 2,
        detail: { formula: `posterior mean: P.linear(${F}, 1) = ${P.linear(F, 1)} numbers; posterior covariance: ${F + 1}×${F + 1} stored, not counted as "learned weights"` },
        analogy: 'Think of it as updating a belief instead of computing one guess: the model keeps a whole cloud of plausible coefficient vectors and narrows that cloud as bars arrive.',
      },
      {
        id: 'predictive', kind: 'compare', label: 'Posterior predictive', sublabel: 'y* ~ N(x*^T mu_N, x*^T Sigma_N x* + sigma^2)',
        inShape: `${F + 1} × 1`, outShape: 'B × 2', column: 3,
      },
      { id: 'output', kind: 'output', label: 'Forecast + credible interval', sublabel: 'widens automatically on thin data', outShape: 'B × 2', column: 4 },
    ],
    edges: [
      ['input', 'likelihood', 'flow'],
      ['prior', 'posterior', 'context', 'prior belief'],
      ['likelihood', 'posterior', 'flow'],
      ['posterior', 'predictive', 'flow'],
      ['predictive', 'output', 'flow'],
      ['posterior', 'prior', 'context', 'this posterior becomes the next window\'s prior (sequential update)'],
    ],
  }),

  // ─── Forecasting & Additive Models ──────────────────────────────────────

  'statistical-models-forecasting-additive-models-prophet-forecasting-model': blueprint({
    title: 'Prophet Forecasting Model',
    subtitle: 'piecewise-linear trend + Fourier seasonality + holiday effects, additive',
    nodes: [
      { id: 'input', kind: 'input', label: 'Session series', sublabel: `${T}-bar volume or volatility history`, outShape: `${T} × 1`, column: 0 },
      {
        id: 'trend', kind: 'linear', label: 'Piecewise-linear trend', sublabel: `base rate k + offset m + ${PROPHET_CHANGEPOINTS} changepoint rate adjustments`,
        column: 1, lane: 0, params: PROPHET_CHANGEPOINTS + 2,
        detail: { formula: `${PROPHET_CHANGEPOINTS} changepoints × 1 rate adjustment each + base growth rate k + offset m = ${PROPHET_CHANGEPOINTS + 2} (a Laplace prior keeps most of the ${PROPHET_CHANGEPOINTS} adjustments near zero)` },
        analogy: 'Think of it as a ruler bent at a handful of knees — mostly straight, but allowed to change slope exactly where the level genuinely shifted.',
      },
      {
        id: 'seasonal_daily', kind: 'linear', label: 'Daily seasonality', sublabel: `${PROPHET_DAILY_FOURIER_TERMS}-term Fourier series, period 1 day`,
        column: 1, lane: 1, params: 2 * PROPHET_DAILY_FOURIER_TERMS,
        detail: { formula: `2 × ${PROPHET_DAILY_FOURIER_TERMS} Fourier terms (a sine and a cosine coefficient each) = ${2 * PROPHET_DAILY_FOURIER_TERMS}` },
      },
      {
        id: 'seasonal_weekly', kind: 'linear', label: 'Weekly seasonality', sublabel: `${PROPHET_WEEKLY_FOURIER_TERMS}-term Fourier series, period 7 days`,
        column: 1, lane: 2, params: 2 * PROPHET_WEEKLY_FOURIER_TERMS,
        detail: { formula: `2 × ${PROPHET_WEEKLY_FOURIER_TERMS} Fourier terms = ${2 * PROPHET_WEEKLY_FOURIER_TERMS}` },
      },
      {
        id: 'holiday', kind: 'linear', label: 'Holiday / event effects', sublabel: `${PROPHET_EVENTS} known economic-release dates`,
        column: 1, lane: 3, params: PROPHET_EVENTS,
        detail: { formula: `${PROPHET_EVENTS} events × 1 effect size each = ${PROPHET_EVENTS}` },
      },
      {
        id: 'sum', kind: 'fusion', label: 'Additive combination', sublabel: 'y(t) = trend + daily + weekly + holiday',
        column: 2, lane: 0,
        analogy: 'Think of it as stacking four transparent overlays — the slow drift, the daily rhythm, the weekly rhythm and the known release dates — to get the expected level.',
      },
      { id: 'posterior_fit', kind: 'compare', label: 'MAP / MCMC fit', sublabel: 'Laplace prior on trend deltas, normal priors on Fourier & holiday terms', column: 2, lane: 1 },
      { id: 'output', kind: 'output', label: 'Forecast + uncertainty interval', sublabel: 'decomposed into trend, seasonal, holiday', column: 3 },
    ],
    edges: [
      ['input', 'trend', 'flow'], ['input', 'seasonal_daily', 'flow'], ['input', 'seasonal_weekly', 'flow'], ['input', 'holiday', 'flow'],
      ['trend', 'sum', 'flow'], ['seasonal_daily', 'sum', 'flow'], ['seasonal_weekly', 'sum', 'flow'], ['holiday', 'sum', 'flow'],
      ['sum', 'output', 'flow'],
      ['sum', 'posterior_fit', 'context', 'residual vs. observed'],
      ['posterior_fit', 'trend', 'context', 'MAP update'],
      ['posterior_fit', 'seasonal_daily', 'context', 'MAP update'],
      ['posterior_fit', 'seasonal_weekly', 'context', 'MAP update'],
      ['posterior_fit', 'holiday', 'context', 'MAP update'],
    ],
  }),

  // ─── Generalized Linear Models ──────────────────────────────────────────

  'statistical-models-generalized-linear-models-generalized-linear-model-glm': glmBlueprint({
    title: 'Generalized Linear Model (GLM)',
    subtitle: 'exponential-family response, canonical link, IRLS maximum likelihood',
    linkLabel: 'Link function g^-1',
    linkSublabel: 'mu = g^-1(eta), family-specific',
    linkAnalogy: 'Think of it as a valve that squeezes the raw linear score into whatever range the target actually lives in — a probability, a count, a positive magnitude.',
    likelihoodLabel: 'Exponential-family likelihood',
    likelihoodSublabel: 'variance tied to the mean: Var(y) = phi·V(mu)',
    outputLabel: 'Predicted mean',
    outputSublabel: 'probability, count, or magnitude — family-dependent',
    irlsSublabel: 'z_i = eta_i + (y_i-mu_i)g\'(mu_i); w_i = 1/(V(mu_i)g\'(mu_i)^2)',
  }),

  'statistical-models-generalized-linear-models-logistic-regression': glmBlueprint({
    title: 'Logistic Regression',
    subtitle: 'Binomial response, logit link, Newton-Raphson maximum likelihood',
    linkLabel: 'Sigmoid',
    linkSublabel: 'p = 1 / (1 + e^-eta)',
    linkAnalogy: 'Think of it as squashing an unbounded log-odds score into a clean 0-to-1 probability of an up bar.',
    likelihoodLabel: 'Binary cross-entropy',
    likelihoodSublabel: '-sum[y·log(p) + (1-y)·log(1-p)]',
    outputLabel: 'P(up bar)',
    outputSublabel: 'calibrated probability of the positive class',
    irlsSublabel: 'w_i = p_i(1-p_i); Newton step beta <- beta - H^-1 g',
  }),

  'statistical-models-generalized-linear-models-multinomial-logistic-regression': blueprint({
    title: 'Multinomial Logistic Regression',
    subtitle: '3-class softmax (down / flat / up), one reference class fixed at zero',
    nodes: [
      barInputNode(0),
      { id: 'linear_k1', kind: 'linear', label: 'Linear score — down', sublabel: 'z_1 = X·beta_1', inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 1), column: 1, lane: 0 },
      { id: 'linear_k2', kind: 'linear', label: 'Linear score — flat (reference)', sublabel: 'beta_ref = 0, fixed for identifiability', inShape: `B × ${F}`, outShape: 'B × 1', column: 1, lane: 1 },
      { id: 'linear_k3', kind: 'linear', label: 'Linear score — up', sublabel: 'z_3 = X·beta_3', inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 1), column: 1, lane: 2 },
      {
        id: 'softmax', kind: 'activation', label: 'Softmax', sublabel: 'p_k = e^z_k / sum_j e^z_j',
        outShape: `B × ${C}`, column: 2,
        detail: { 'input': `the ${C} per-class scores above, each B × 1, stacked into one B × ${C} vector` },
        analogy: 'Think of it as one analyst per outcome — down, flat, up — each scoring how much this bar looks like their own case, then normalizing the three scores into probabilities that sum to one.',
      },
      { id: 'likelihood', kind: 'compare', label: 'Categorical cross-entropy', sublabel: '-sum_k y_k·log(p_k)', column: 3 },
      { id: 'output', kind: 'output', label: 'Down · flat · up probabilities', outShape: `B × ${C}`, column: 4 },
    ],
    edges: [
      ['input', 'linear_k1', 'flow'], ['input', 'linear_k2', 'flow'], ['input', 'linear_k3', 'flow'],
      ['linear_k1', 'softmax', 'flow'], ['linear_k2', 'softmax', 'flow'], ['linear_k3', 'softmax', 'flow'],
      ['softmax', 'likelihood', 'flow'], ['likelihood', 'output', 'flow'],
      ['likelihood', 'linear_k1', 'context', 'joint Newton update, repeat'],
      ['likelihood', 'linear_k3', 'context', 'joint Newton update, repeat'],
    ],
  }),

  'statistical-models-generalized-linear-models-ordinal-regression': blueprint({
    title: 'Ordinal Regression',
    subtitle: 'proportional-odds model, one latent score, 2 ordered thresholds',
    nodes: [
      barInputNode(0),
      {
        id: 'latent_score', kind: 'linear', label: 'Latent linear score', sublabel: 'eta = X·beta, no intercept',
        inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 1, false), column: 1, lane: 0,
        detail: { formula: `P.linear(${F}, 1, bias=false) = ${P.linear(F, 1, false)} — the thresholds absorb the intercept` },
      },
      {
        id: 'thresholds', kind: 'memory', label: 'Ordered thresholds', sublabel: `${C - 1} cut-points, theta_1 < theta_2`,
        column: 1, lane: 1, params: C - 1,
        detail: { formula: `DIM.classes - 1 = ${C - 1} ordered cut-points` },
      },
      { id: 'cumulative_link', kind: 'activation', label: 'Cumulative logit', sublabel: 'P(y<=k) = sigma(theta_k - eta)', column: 2 },
      {
        id: 'difference', kind: 'compare', label: 'Class probability by differencing', sublabel: 'P(y=k) = P(y<=k) - P(y<=k-1)',
        column: 3,
        analogy: 'Think of it as one continuous "how bullish" score sliding past a fence of ordered thresholds — which panels it clears decides the bucket.',
      },
      { id: 'output', kind: 'output', label: 'Ordered bucket probabilities', outShape: `B × ${C}`, column: 4 },
    ],
    edges: [
      ['input', 'latent_score', 'flow'],
      ['latent_score', 'cumulative_link', 'flow'],
      ['thresholds', 'cumulative_link', 'context', 'ordered cut-points'],
      ['cumulative_link', 'difference', 'flow'],
      ['difference', 'output', 'flow'],
      ['difference', 'latent_score', 'context', 'joint Newton update, repeat'],
      ['difference', 'thresholds', 'context', 'joint Newton update, repeat'],
    ],
  }),

  'statistical-models-generalized-linear-models-poisson-regression': glmBlueprint({
    title: 'Poisson Regression',
    subtitle: 'count response, log link, equidispersion Var(y) = lambda',
    linkLabel: 'Exponential',
    linkSublabel: 'lambda = e^eta',
    linkAnalogy: 'Think of it as converting a log-rate score into a guaranteed-positive expected trade count.',
    likelihoodLabel: 'Poisson log-likelihood',
    likelihoodSublabel: 'sum[y·log(lambda) - lambda]',
    outputLabel: 'Expected count',
    outputSublabel: 'trades / ticks in the next bar',
    irlsSublabel: 'z_i = eta_i + (y_i-lambda_i)/lambda_i; w_i = lambda_i',
  }),

  'statistical-models-generalized-linear-models-probit-regression': glmBlueprint({
    title: 'Probit Regression',
    subtitle: 'latent Gaussian threshold-crossing model, normal-CDF link',
    linkLabel: 'Normal CDF',
    linkSublabel: 'p = Phi(eta)',
    linkAnalogy: 'Think of it as an unobserved net-buying-pressure gauge with Gaussian jitter — the bar closes up exactly when that gauge crosses zero.',
    likelihoodLabel: 'Binary cross-entropy (probit)',
    likelihoodSublabel: '-sum[y·log(Phi(eta)) + (1-y)·log(1-Phi(eta))]',
    outputLabel: 'P(up bar)',
    outputSublabel: 'calibrated probability via the latent-threshold story',
    irlsSublabel: 'w_i = phi(eta_i)^2 / [Phi(eta_i)(1-Phi(eta_i))]',
  }),

  'statistical-models-generalized-linear-models-tweedie-regression': glmBlueprint({
    title: 'Tweedie Regression',
    subtitle: 'compound Poisson-Gamma, power parameter p in (1,2), zero-mass + continuous',
    linkLabel: 'Exponential',
    linkSublabel: 'mu = e^eta',
    linkAnalogy: 'Think of it as turning a log-scale score into an expected move size that already blends how often nothing happens at all with how big it gets when something does.',
    likelihoodLabel: 'Tweedie deviance (compound Poisson-Gamma)',
    likelihoodSublabel: 'Var(y) = phi·mu^p, profiled over p in [1.1, 1.9]',
    outputLabel: 'Expected magnitude',
    outputSublabel: 'blends P(zero) and expected value when nonzero',
    irlsSublabel: 'w_i = mu_i^(2-p) after the power p is profiled by grid search',
  }),

  'statistical-models-generalized-linear-models-zero-inflated-poisson-model': blueprint({
    title: 'Zero-Inflated Poisson Model',
    subtitle: 'two-component mixture: structural zero vs. Poisson-rate activity, EM-fit',
    nodes: [
      barInputNode(0),
      { id: 'zero_branch', kind: 'linear', label: 'Structural-zero predictor', sublabel: 'gamma: logit link', inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 1), column: 1, lane: 0 },
      { id: 'count_branch', kind: 'linear', label: 'Poisson-rate predictor', sublabel: 'beta: log link', inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 1), column: 1, lane: 1 },
      { id: 'em_loop', kind: 'compare', label: 'EM responsibility (E-step)', sublabel: 'posterior P(structural zero | y=0)', column: 1, lane: 2 },
      { id: 'zero_link', kind: 'activation', label: 'Sigmoid → pi', sublabel: 'pi = 1/(1+e^-gamma^T x)', inShape: 'B × 1', outShape: 'B × 1', column: 2, lane: 0 },
      { id: 'rate_link', kind: 'activation', label: 'Exponential → lambda', sublabel: 'lambda = e^(beta^T x)', inShape: 'B × 1', outShape: 'B × 1', column: 2, lane: 1 },
      {
        id: 'mixture', kind: 'fusion', label: 'Mixture combination', sublabel: 'P(0)=pi+(1-pi)e^-lambda; P(k>0)=(1-pi)Pois(k;lambda)',
        outShape: 'B × 1', column: 3,
        detail: { 'input': 'pi from the sigmoid branch and lambda from the exponential branch, each B × 1' },
        analogy: 'Think of it as separately asking "was any large participant active at all" and "how many events, given one was" — instead of blurring both into one average rate.',
      },
      { id: 'output', kind: 'output', label: 'Expected combined count', sublabel: 'E[y] = (1-pi)·lambda', inShape: 'B × 1', outShape: 'B × 1', column: 4 },
    ],
    edges: [
      ['input', 'zero_branch', 'flow'], ['input', 'count_branch', 'flow'],
      ['zero_branch', 'zero_link', 'flow'], ['count_branch', 'rate_link', 'flow'],
      ['zero_link', 'mixture', 'flow'], ['rate_link', 'mixture', 'flow'],
      ['mixture', 'output', 'flow'],
      ['mixture', 'em_loop', 'context', 'posterior structural-zero probability'],
      ['em_loop', 'zero_branch', 'context', 'M-step reweighted logistic fit'],
      ['em_loop', 'count_branch', 'context', 'M-step reweighted Poisson fit'],
    ],
  }),

  'statistical-models-generalized-linear-models-gamma-regression': glmBlueprint({
    title: 'Gamma Regression',
    subtitle: 'strictly positive, right-skewed response, log link, Var(y) = phi·mu^2',
    linkLabel: 'Exponential',
    linkSublabel: 'mu = e^eta',
    linkAnalogy: 'Think of it as forecasting expected stop distance on a scale that can never go negative and whose uncertainty grows proportionally with the forecast itself.',
    likelihoodLabel: 'Gamma deviance',
    likelihoodSublabel: 'd(y,mu) = 2[-log(y/mu) + (y-mu)/mu]',
    outputLabel: 'Expected magnitude',
    outputSublabel: 'realized range, fill duration, slippage',
    irlsSublabel: 'z_i = eta_i + (y_i-mu_i)/mu_i; w_i = 1',
  }),

  // ─── Probabilistic Mixture Models ───────────────────────────────────────

  'statistical-models-probabilistic-mixture-models-mixture-of-exponentials': blueprint({
    title: 'Mixture of Exponentials',
    subtitle: `${MIXTURE_COMPONENTS} latent-rate regimes (hyperexponential), EM-fit`,
    nodes: [
      { id: 'input', kind: 'input', label: 'Observed durations', sublabel: 'inter-trade or order-fill times', outShape: 'B × 1', column: 0 },
      { id: 'init', kind: 'stochastic', label: `Initialize ${MIXTURE_COMPONENTS} rates`, sublabel: 'random spread around 1/mean, many restarts', column: 1 },
      {
        id: 'e_step', kind: 'compare', label: 'E-step: responsibilities', sublabel: 'gamma_ik = pi_k·lambda_k·e^-lambda_k·y / sum_j(...)',
        column: 2,
        analogy: 'Think of it as sorting each gap into how much it looks like the fast-market clock versus the slow-market clock, as a percentage, never a hard guess.',
      },
      {
        id: 'm_step', kind: 'cluster', label: 'M-step: refit rates & weights', sublabel: 'lambda_k, pi_k from responsibility-weighted durations',
        column: 3, params: 2 * MIXTURE_COMPONENTS - 1,
        detail: { formula: `2K - 1 = 2×${MIXTURE_COMPONENTS} - 1 = ${2 * MIXTURE_COMPONENTS - 1} (${MIXTURE_COMPONENTS} rates + ${MIXTURE_COMPONENTS} weights, one weight fixed by sum-to-one)` },
      },
      { id: 'loglik', kind: 'compare', label: 'Log-likelihood convergence check', column: 4 },
      { id: 'output', kind: 'output', label: 'Regime probabilities + rates', outShape: `B × ${MIXTURE_COMPONENTS}`, column: 5 },
    ],
    edges: [
      ...chain('input', 'init', 'e_step', 'm_step', 'loglik', 'output'),
      ['loglik', 'e_step', 'context', 'iterate E/M until Delta log-likelihood < eps'],
    ],
  }),

  // ─── Regression Techniques ──────────────────────────────────────────────

  'statistical-models-regression-techniques-linear-regression': blueprint({
    title: 'Linear Regression',
    subtitle: 'ordinary least squares, closed-form normal equations',
    nodes: [
      barInputNode(0),
      {
        id: 'normal_eq', kind: 'linear', label: 'Normal equations (QR / SVD)', sublabel: 'beta_hat = (X^T X)^-1 X^T y',
        inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 1), column: 1,
      },
      { id: 'residual', kind: 'compare', label: 'Residuals', sublabel: 'r = y - X·beta_hat', inShape: 'B × 1', outShape: 'B × 1', column: 2 },
      { id: 'robust_se', kind: 'compare', label: 'Newey-West standard errors', sublabel: 'HAC-adjusted for autocorrelation', column: 2, lane: 1 },
      { id: 'output', kind: 'output', label: 'Point forecast + prediction interval', outShape: 'B × 2', column: 3 },
    ],
    edges: [
      ['input', 'normal_eq', 'flow'],
      ['normal_eq', 'residual', 'flow'],
      ['residual', 'robust_se', 'context', 'used for inference, not fitting'],
      ['normal_eq', 'output', 'flow'],
      ['residual', 'output', 'context', 'residual variance sets interval width'],
    ],
  }),

  'statistical-models-regression-techniques-multivariate-regression': blueprint({
    title: 'Multivariate Regression',
    subtitle: `${MULTIVARIATE_TARGETS} correlated targets, shared design matrix, joint residual covariance`,
    nodes: [
      barInputNode(0),
      {
        id: 'coefficient_matrix', kind: 'linear', label: 'Per-target coefficient matrix B', sublabel: `${F} × ${MULTIVARIATE_TARGETS}`,
        inShape: `B × ${F}`, outShape: `B × ${MULTIVARIATE_TARGETS}`, params: P.linear(F, MULTIVARIATE_TARGETS), column: 1,
        detail: { formula: `P.linear(${F}, ${MULTIVARIATE_TARGETS}) = ${P.linear(F, MULTIVARIATE_TARGETS)} — numerically identical to ${MULTIVARIATE_TARGETS} separate OLS fits` },
      },
      { id: 'residual_matrix', kind: 'compare', label: 'Residual matrix E', sublabel: 'E = Y - XB', inShape: `B × ${MULTIVARIATE_TARGETS}`, outShape: `B × ${MULTIVARIATE_TARGETS}`, column: 2 },
      {
        id: 'covariance', kind: 'memory', label: 'Residual covariance Sigma', sublabel: `${MULTIVARIATE_TARGETS}×${MULTIVARIATE_TARGETS} cross-target covariance`,
        inShape: `B × ${MULTIVARIATE_TARGETS}`, outShape: `${MULTIVARIATE_TARGETS} × ${MULTIVARIATE_TARGETS}`, column: 2, lane: 1,
        detail: { stored: `${MULTIVARIATE_TARGETS}×${MULTIVARIATE_TARGETS + 1}/2 = ${(MULTIVARIATE_TARGETS * (MULTIVARIATE_TARGETS + 1)) / 2} unique entries — how the ${MULTIVARIATE_TARGETS} targets' errors co-move` },
        analogy: 'Think of it as reading not just each pair\'s forecast, but which pairs tend to miss together on the same news surprise.',
      },
      { id: 'output', kind: 'output', label: 'Joint forecast + cross-target covariance', inShape: `B × ${MULTIVARIATE_TARGETS}`, outShape: `B × ${MULTIVARIATE_TARGETS}`, column: 3 },
    ],
    edges: [
      ['input', 'coefficient_matrix', 'flow'],
      ['coefficient_matrix', 'residual_matrix', 'flow'],
      ['residual_matrix', 'covariance', 'flow'],
      ['coefficient_matrix', 'output', 'flow'],
      ['covariance', 'output', 'context', 'joint predictive covariance'],
    ],
  }),

  'statistical-models-regression-techniques-partial-least-squares-regression-plsr': blueprint({
    title: 'Partial Least Squares Regression (PLSR)',
    subtitle: `${PLS_COMPONENTS} latent components, NIPALS sequential extraction and deflation`,
    nodes: [
      barInputNode(0),
      { id: 'standardize', kind: 'norm', label: 'Standardize', sublabel: 'center + scale X and y', inShape: `B × ${F}`, outShape: `B × ${F}`, column: 1 },
      {
        id: 'nipals', kind: 'compare', label: 'NIPALS extraction', sublabel: 'maximize Cov(Xw, y)^2, sequential deflation',
        inShape: `B × ${F}`, outShape: `B × ${F}`, column: 2,
        detail: { 'what leaves this stage': `the deflated X (still B × ${F}) plus one weight vector w_a, one component at a time` },
      },
      {
        id: 'components', kind: 'embedding', label: 'Latent components T', sublabel: `${PLS_COMPONENTS} components, orthogonal scores by construction`,
        inShape: `B × ${F}`, outShape: `B × ${PLS_COMPONENTS}`, params: P.linear(F, PLS_COMPONENTS, false), column: 3,
        detail: { formula: `P.linear(${F}, ${PLS_COMPONENTS}, bias=false) = ${P.linear(F, PLS_COMPONENTS, false)} loading weights` },
        analogy: 'Think of it as compressing dozens of correlated indicators down to a handful of directions chosen specifically because they track the target, not just because they spread the data out.',
      },
      {
        id: 'regress', kind: 'linear', label: 'Regress y on components', sublabel: 'gamma: T -> y',
        inShape: `B × ${PLS_COMPONENTS}`, outShape: 'B × 1', params: P.linear(PLS_COMPONENTS, 1), column: 4,
        detail: { formula: `P.linear(${PLS_COMPONENTS} components, 1 output) = ${P.linear(PLS_COMPONENTS, 1)}` },
      },
      { id: 'output', kind: 'output', label: 'Point forecast', inShape: 'B × 1', outShape: 'B × 1', column: 5 },
    ],
    edges: [
      ...chain('input', 'standardize', 'nipals', 'components', 'regress', 'output'),
      ['components', 'nipals', 'context', 'deflate X and y, extract next component'],
    ],
  }),

  'statistical-models-regression-techniques-quantile-regression': blueprint({
    title: 'Quantile Regression',
    subtitle: `${QUANTILES.length} quantiles (${QUANTILES.map((q) => q.toFixed(2)).join(' / ')}), pinball loss, linear-program fit`,
    nodes: [
      barInputNode(0),
      ...QUANTILES.map((tau, lane): NodeSpec => ({
        id: `q${Math.round(tau * 100)}`, kind: 'linear', label: `Linear predictor, tau=${tau.toFixed(2)}`,
        sublabel: 'its own independent coefficient vector beta_tau',
        inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 1), column: 1, lane,
        detail: { formula: `P.linear(${F} features, 1 output) = ${P.linear(F, 1)} per quantile` },
      })),
      {
        id: 'pinball', kind: 'compare', label: 'Pinball (check) loss', sublabel: 'rho_tau(u) = tau·u if u >= 0, else (tau-1)·u — one linear program per tau',
        outShape: `B × ${QUANTILES.length}`, column: 2,
        detail: { 'input': `the ${QUANTILES.length} per-quantile predictions above, each B × 1` },
      },
      {
        id: 'noncrossing', kind: 'compare', label: 'Non-crossing check',
        sublabel: `enforce ${QUANTILES.map((q) => `Q(${q.toFixed(2)})`).join(' <= ')}`, column: 2, lane: 1,
      },
      {
        id: 'output', kind: 'output', label: 'Predicted quantile band', outShape: `B × ${QUANTILES.length}`, column: 3,
        analogy: 'Think of it as three separate forecasters betting on the bad case, the typical case and the good case — the gap between them is how wide your stop should be.',
      },
    ],
    edges: [
      ...QUANTILES.flatMap((tau): EdgeSpec[] => [
        ['input', `q${Math.round(tau * 100)}`, 'flow'],
        [`q${Math.round(tau * 100)}`, 'pinball', 'flow'],
        [`q${Math.round(tau * 100)}`, 'noncrossing', 'context', 'check ordering'],
      ]),
      ['pinball', 'output', 'flow'],
      ['pinball', `q${Math.round(QUANTILES[0]! * 100)}`, 'context', 'interior-point LP iterate, repeat'],
      ['noncrossing', 'output', 'context', 'band width informs position size'],
    ],
  }),

  'statistical-models-regression-techniques-robust-regression': blueprint({
    title: 'Robust Regression',
    subtitle: 'Huber M-estimator, IRLS with residual-capped influence',
    nodes: [
      barInputNode(0),
      {
        id: 'ols_init', kind: 'linear', label: 'OLS initialization', sublabel: 'starting value for the SAME beta, from an ordinary fit',
        inShape: `B × ${F}`, outShape: 'B × 1', column: 1,
        detail: { 'parameters': `0 of its own — this stage writes the starting value of the ${P.linear(F, 1)} coefficients estimated at the weighted least-squares update, it does not add a second set` },
      },
      { id: 'residuals', kind: 'compare', label: 'Residuals', sublabel: 'r_i = y_i - x_i^T·beta', inShape: 'B × 1', outShape: 'B × 1', column: 2 },
      {
        id: 'huber_weight', kind: 'compare', label: 'Huber weighting', sublabel: 'w_i = 1 if |r_i|<=delta, else delta/|r_i|',
        inShape: 'B × 1', outShape: 'B × 1', column: 3,
        analogy: 'Think of it as a flash-crash bar getting its vote capped instead of being allowed to swing the whole fit on its own.',
      },
      {
        id: 'wls_update', kind: 'linear', label: 'Weighted least-squares update', sublabel: 'beta <- (X^T W X)^-1 X^T W y',
        inShape: 'B × 1', outShape: 'B × 1', params: P.linear(F, 1), column: 4,
        detail: { formula: `P.linear(${F} features, 1 output) = ${P.linear(F, 1)} — the model's only coefficients, re-solved each IRLS pass` },
      },
      { id: 'output', kind: 'output', label: 'Outlier-resistant point forecast', outShape: 'B × 1', column: 5 },
    ],
    edges: [
      ...chain('input', 'ols_init', 'residuals', 'huber_weight', 'wls_update', 'output'),
      ['wls_update', 'residuals', 'context', 'repeat IRLS until convergence'],
    ],
  }),

  // ─── Survival Analysis ───────────────────────────────────────────────────

  'statistical-models-survival-analysis-accelerated-failure-time-model-aft': blueprint({
    title: 'Accelerated Failure Time Model (AFT)',
    subtitle: 'Weibull family, features multiplicatively stretch or compress log-duration',
    nodes: [
      barInputNode(0),
      {
        id: 'linear_predictor', kind: 'linear', label: 'Linear predictor', sublabel: 'eta = beta0 + x^T·beta',
        inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 1), column: 1, lane: 0,
        detail: {
          formula: `P.linear(${F}, 1) = ${P.linear(F, 1)}`,
          'why an intercept': 'an AFT model estimates beta0 because it sets the baseline duration scale; it is Cox that has none, because there the baseline hazard is never estimated',
        },
      },
      { id: 'scale', kind: 'memory', label: 'Scale parameter sigma', sublabel: 'estimated jointly by maximum likelihood', column: 1, lane: 1, params: 1, detail: { formula: '1 scale parameter sigma, fit alongside the coefficients' } },
      {
        id: 'distribution_choice', kind: 'compare', label: 'Parametric family', sublabel: 'Weibull / log-normal / log-logistic, chosen by AIC',
        inShape: 'B × 1', outShape: 'B × 1', column: 2,
        analogy: 'Think of it as committing up front to whether a trade gets riskier the longer it stays open, safer, or most fragile in its first few bars — that choice IS the family, and picking the wrong one bends every number downstream.',
      },
      { id: 'likelihood', kind: 'compare', label: 'Censored log-likelihood', sublabel: 'event: log f(t); censored: log S(t)', column: 3 },
      {
        id: 'output', kind: 'output', label: 'Predicted duration scale', sublabel: 'exp(beta0 + x^T·beta); Weibull median = that × (ln 2)^sigma',
        outShape: 'B × 1', column: 4,
        detail: { 'read it as': 'exp(eta) is the acceleration factor — the whole time axis stretched or squeezed. The median and the mean are each a fixed multiple of it set by the family and sigma, not equal to it.' },
        analogy: 'Think of it as directly answering "how many bars longer or shorter does this feature make the trade last" instead of only a relative risk.',
      },
    ],
    edges: [
      ['input', 'linear_predictor', 'flow'],
      ['linear_predictor', 'distribution_choice', 'flow'],
      ['scale', 'distribution_choice', 'context', 'shapes the hazard over time'],
      ['distribution_choice', 'likelihood', 'flow'],
      ['likelihood', 'output', 'flow'],
      ['likelihood', 'linear_predictor', 'context', 'Newton update, repeat'],
    ],
  }),

  'statistical-models-survival-analysis-survival-models-cox-proportional-hazards': blueprint({
    title: 'Survival Models - Cox Proportional Hazards',
    subtitle: 'semi-parametric hazard ratio, baseline hazard left unspecified',
    nodes: [
      barInputNode(0),
      {
        id: 'linear_predictor', kind: 'linear', label: 'Linear predictor (log relative risk)', sublabel: 'eta = x^T·beta, no intercept',
        inShape: `B × ${F}`, outShape: 'B × 1', params: P.linear(F, 1, false), column: 1,
        detail: {
          formula: `P.linear(${F}, 1, bias=false) = ${P.linear(F, 1, false)}`,
          'why no intercept': 'a constant would cancel out of every partial-likelihood ratio; it lives inside the unestimated baseline hazard instead',
        },
      },
      { id: 'risk_set', kind: 'memory', label: 'Risk set at each event time', sublabel: 'everyone still at risk just before t_(j)', column: 2 },
      {
        id: 'partial_likelihood', kind: 'compare', label: 'Cox partial likelihood', sublabel: 'ratio of failed subject risk to risk-set sum',
        column: 3,
        analogy: 'Think of it as comparing this trade\'s risk score only against everyone else still open right now — the unknown baseline hazard cancels out completely.',
      },
      { id: 'baseline_hazard', kind: 'memory', label: 'Baseline hazard h0(t)', sublabel: 'left fully nonparametric, never estimated during the beta fit', column: 3, lane: 1 },
      { id: 'output', kind: 'output', label: 'Hazard ratios + relative risk score', column: 4 },
    ],
    edges: [
      ['input', 'linear_predictor', 'flow'],
      ['input', 'risk_set', 'flow', 'durations + censoring flags'],
      ['linear_predictor', 'partial_likelihood', 'flow'],
      ['risk_set', 'partial_likelihood', 'flow', 'denominator: who is still at risk'],
      ['partial_likelihood', 'output', 'flow'],
      ['partial_likelihood', 'baseline_hazard', 'context', 'estimated only after beta is fixed (Breslow)'],
      ['baseline_hazard', 'output', 'context', 'combine for an absolute survival curve'],
      ['partial_likelihood', 'linear_predictor', 'context', 'Newton update, repeat'],
    ],
  }),

  'statistical-models-survival-analysis-survival-models-kaplan-meier-estimator': blueprint({
    title: 'Survival Models - Kaplan-Meier Estimator',
    subtitle: 'nonparametric product-limit survival curve, censoring handled exactly',
    nodes: [
      { id: 'input', kind: 'input', label: 'Durations + censoring flags', sublabel: 'trade holding times, still-open trades marked censored', outShape: 'B × 2', column: 0 },
      { id: 'sort', kind: 'reshape', label: 'Sort distinct event times', sublabel: 't_(1) < t_(2) < ...', column: 1 },
      { id: 'risk_set', kind: 'memory', label: 'At-risk count n_j', sublabel: 'everyone with duration >= t_(j)', column: 2 },
      { id: 'event_count', kind: 'compare', label: 'Event count d_j', sublabel: 'failures exactly at t_(j)', column: 2, lane: 1 },
      {
        id: 'product_limit', kind: 'compare', label: 'Product-limit multiplication', sublabel: 'S_hat(t) = product(1 - d_j/n_j)',
        column: 3,
        analogy: 'Think of it as tracking what fraction of open trades are still alive, multiplying in a fresh survival percentage each time one closes — a still-open trade counts as having survived at least this long, never as vanished.',
      },
      { id: 'greenwood', kind: 'compare', label: "Greenwood's variance", sublabel: 'confidence band around S_hat(t)', column: 3, lane: 1 },
      { id: 'output', kind: 'output', label: 'Survival curve + median duration', column: 4 },
    ],
    edges: [
      ['input', 'sort', 'flow'],
      ['sort', 'risk_set', 'flow'], ['sort', 'event_count', 'flow'],
      ['risk_set', 'product_limit', 'flow'], ['event_count', 'product_limit', 'flow'],
      ['product_limit', 'output', 'flow'],
      ['product_limit', 'greenwood', 'context', 'variance at each step'],
      ['greenwood', 'output', 'context', 'confidence band'],
    ],
  }),

  // ─── Time Series Models ──────────────────────────────────────────────────

  'statistical-models-time-series-models-time-series-arima': blueprint({
    title: 'Time Series - ARIMA',
    subtitle: `ARIMA(${ARIMA_AR_ORDER},1,${ARIMA_MA_ORDER}): differencing + autoregressive + moving-average, Kalman-filter MLE`,
    nodes: [
      { id: 'input', kind: 'input', label: 'Price / log-price series', sublabel: `${T}-bar history`, outShape: `${T} × 1`, column: 0 },
      {
        id: 'diff', kind: 'reshape', label: 'Differencing', sublabel: 'd=1: w_t = y_t - y_{t-1}',
        inShape: `${T} × 1`, outShape: `${T - 1} × 1`, column: 1,
        analogy: 'Think of it as throwing away the price level and keeping only the bar-to-bar change, because a drifting level has no stable relationship to model but the changes might.',
      },
      {
        id: 'ar', kind: 'linear', label: 'Autoregressive terms', sublabel: `p=${ARIMA_AR_ORDER} lags of the differenced series`,
        inShape: `${T - 1} × 1`, outShape: `${T - 1} × 1`, column: 2, lane: 0, params: ARIMA_AR_ORDER,
        detail: { formula: `AR order p = ${ARIMA_AR_ORDER} coefficients` },
      },
      {
        id: 'ma', kind: 'linear', label: 'Moving-average terms', sublabel: `q=${ARIMA_MA_ORDER} lag of the FORECAST ERROR eps_{t-1}, not of the series`,
        inShape: `${T - 1} × 1`, outShape: `${T - 1} × 1`, column: 2, lane: 1, params: ARIMA_MA_ORDER,
        detail: { formula: `MA order q = ${ARIMA_MA_ORDER} coefficient` },
      },
      {
        id: 'kalman', kind: 'compare', label: 'Kalman-filter likelihood', sublabel: 'state-space maximum likelihood via BFGS',
        outShape: 'horizon × 1', column: 3,
        detail: {
          'scale': 'forecasts leave this stage on the DIFFERENCED scale; the next stage undoes that',
          'not drawn as its own stage': `this same likelihood also estimates the innovation variance sigma^2, and a drift constant c when the differenced series has one, so the ${ARIMA_AR_ORDER + ARIMA_MA_ORDER} ARMA coefficients counted here are not the whole fitted parameter set`,
        },
      },
      { id: 'invert', kind: 'reshape', label: 'Invert differencing', sublabel: 'cumulative sum back to price scale', inShape: 'horizon × 1', outShape: 'horizon × 1', column: 4 },
      { id: 'output', kind: 'output', label: 'Forecast + closed-form interval', outShape: 'horizon × 3', sublabel: 'point forecast + lower and upper bound per step', column: 5 },
    ],
    edges: [
      ['input', 'diff', 'flow'],
      ['diff', 'ar', 'flow'], ['diff', 'ma', 'flow'],
      ['ar', 'kalman', 'flow'], ['ma', 'kalman', 'flow'],
      ['kalman', 'invert', 'flow'], ['invert', 'output', 'flow'],
      ['kalman', 'ar', 'context', 'BFGS update, repeat'],
      ['kalman', 'ma', 'context', 'BFGS update, repeat'],
    ],
  }),

  'statistical-models-time-series-models-time-series-garch': blueprint({
    title: 'Time Series - GARCH',
    subtitle: 'GARCH(1,1): conditional variance depends on the last shock and the last variance',
    nodes: [
      { id: 'input', kind: 'input', label: 'Return series', sublabel: `${T}-bar log returns`, outShape: `${T} × 1`, column: 0 },
      {
        id: 'mean_eq', kind: 'linear', label: 'Mean equation', sublabel: 'r_t = mu + eps_t',
        inShape: `${T} × 1`, outShape: `${T} × 1`, column: 1, params: 1,
        detail: { formula: '1 constant mean parameter mu, fit by the same likelihood' },
      },
      { id: 'shock', kind: 'compare', label: 'Squared shock', sublabel: 'eps_{t-1}^2', inShape: `${T} × 1`, outShape: `${T} × 1`, column: 2 },
      {
        id: 'variance_recursion', kind: 'recurrent', label: `GARCH(${GARCH_ARCH_ORDER},${GARCH_GARCH_ORDER}) variance recursion`, sublabel: 'sigma_t^2 = omega + alpha·eps_{t-1}^2 + beta·sigma_{t-1}^2',
        inShape: `${T} × 1`, outShape: `${T} × 1`,
        column: 3, params: GARCH_ARCH_ORDER + GARCH_GARCH_ORDER + 1,
        detail: { formula: `ARCH order ${GARCH_ARCH_ORDER} (alpha) + GARCH order ${GARCH_GARCH_ORDER} (beta) + omega = ${GARCH_ARCH_ORDER + GARCH_GARCH_ORDER + 1}` },
        analogy: 'Think of it as the model raising its alarm level right after a big move, then letting that alarm fade gradually back to normal rather than snapping back the very next bar.',
      },
      { id: 'memory_carry', kind: 'memory', label: 'Past variance sigma_{t-1}^2', sublabel: `mean-reverts toward omega / (1 - alpha - beta)`, outShape: '1', column: 3, lane: 1 },
      {
        id: 'likelihood', kind: 'compare', label: 'Conditional log-likelihood', sublabel: "Gaussian or Student's t innovations",
        inShape: `${T} × 1`, outShape: 'horizon × 1', column: 4,
        detail: { 'not drawn as its own stage': "choosing Student's t innovations adds one more estimated parameter, the degrees of freedom nu, on top of the 4 counted above" },
      },
      { id: 'output', kind: 'output', label: 'Forecasted volatility path', outShape: 'horizon × 1', column: 5 },
    ],
    edges: [
      ...chain('input', 'mean_eq', 'shock', 'variance_recursion', 'likelihood', 'output'),
      ['memory_carry', 'variance_recursion', 'context', 'sigma_{t-1}^2 feeds forward'],
      ['variance_recursion', 'memory_carry', 'context', 'write new sigma_t^2, carry to next step'],
      ['likelihood', 'variance_recursion', 'context', 'BFGS update omega, alpha, beta, repeat'],
    ],
  }),

  'statistical-models-time-series-models-time-series-sarima': blueprint({
    title: 'Time Series - SARIMA',
    subtitle: `(${SARIMA_AR_ORDER},1,${SARIMA_MA_ORDER}) ordinary × (${SARIMA_SEASONAL_AR_ORDER},1,${SARIMA_SEASONAL_MA_ORDER}) seasonal, multiplied lag polynomials`,
    nodes: [
      { id: 'input', kind: 'input', label: 'Session-volume series', sublabel: `${T}-bar history`, outShape: `${T} × 1`, column: 0 },
      { id: 'ordinary_diff', kind: 'reshape', label: 'Ordinary differencing', sublabel: 'd=1: w_t = y_t - y_{t-1}', inShape: `${T} × 1`, outShape: `${T - 1} × 1`, column: 1, lane: 0 },
      { id: 'seasonal_diff', kind: 'reshape', label: 'Seasonal differencing', sublabel: 'D=1 at lag s: w_t = y_t - y_{t-s}', inShape: `${T} × 1`, outShape: `${T} - s × 1`, column: 1, lane: 1 },
      {
        id: 'ordinary_arma', kind: 'linear', label: 'Ordinary AR / MA', sublabel: `p=${SARIMA_AR_ORDER}, q=${SARIMA_MA_ORDER}`,
        column: 2, lane: 0, params: SARIMA_AR_ORDER + SARIMA_MA_ORDER,
        detail: { formula: `ordinary p + q = ${SARIMA_AR_ORDER} + ${SARIMA_MA_ORDER} = ${SARIMA_AR_ORDER + SARIMA_MA_ORDER}` },
      },
      {
        id: 'seasonal_arma', kind: 'linear', label: 'Seasonal AR / MA', sublabel: `P=${SARIMA_SEASONAL_AR_ORDER}, Q=${SARIMA_SEASONAL_MA_ORDER} at lag s`,
        column: 2, lane: 1, params: SARIMA_SEASONAL_AR_ORDER + SARIMA_SEASONAL_MA_ORDER,
        detail: { formula: `seasonal P + Q = ${SARIMA_SEASONAL_AR_ORDER} + ${SARIMA_SEASONAL_MA_ORDER} = ${SARIMA_SEASONAL_AR_ORDER + SARIMA_SEASONAL_MA_ORDER}` },
      },
      {
        id: 'multiply', kind: 'fusion', label: 'Multiplicative combination', sublabel: 'phi(L)·Phi(L^s)·w_t = theta(L)·Theta(L^s)·eps_t',
        column: 3,
        analogy: 'Think of it as separating "what happened a few bars ago" from "what happened this same time last week", instead of blending both into one lag structure.',
      },
      {
        id: 'kalman', kind: 'compare', label: 'Kalman-filter likelihood', sublabel: 'state vector of order s, so cost scales with the seasonal period',
        outShape: 'horizon × 1', column: 4,
        detail: {
          'not drawn as its own stage': 'the innovation variance sigma^2 is estimated here too, so the ordinary and seasonal coefficients counted above are not the whole fitted parameter set',
          'measured cost': 'one SARIMAX(1,1,1)x(1,1,1,96) fit on 600 bars took 269 s by default and 14 s with simple_differencing=True',
        },
      },
      { id: 'invert', kind: 'reshape', label: 'Invert both differencing steps', inShape: 'horizon × 1', outShape: 'horizon × 1', column: 5 },
      { id: 'output', kind: 'output', label: 'Forecast + closed-form interval', outShape: 'horizon × 3', sublabel: 'point forecast + lower and upper bound per step', column: 6 },
    ],
    edges: [
      ['input', 'ordinary_diff', 'flow'], ['input', 'seasonal_diff', 'flow'],
      ['ordinary_diff', 'ordinary_arma', 'flow'], ['seasonal_diff', 'seasonal_arma', 'flow'],
      ['ordinary_arma', 'multiply', 'flow'], ['seasonal_arma', 'multiply', 'flow'],
      ['multiply', 'kalman', 'flow'], ['kalman', 'invert', 'flow'], ['invert', 'output', 'flow'],
      ['kalman', 'ordinary_arma', 'context', 'MLE update, repeat'],
      ['kalman', 'seasonal_arma', 'context', 'MLE update, repeat'],
    ],
  }),

  'statistical-models-time-series-models-time-series-seasonal-decomposition': blueprint({
    title: 'Time Series - Seasonal Decomposition',
    subtitle: `STL: robust Loess trend + seasonal extraction, exact reconstruction — TWO-SIDED, see the ${STL_TREND_WINDOW}-bar trend node`,
    nodes: [
      { id: 'input', kind: 'input', label: 'Raw series', sublabel: `${T}-bar volume or range history`, outShape: `${T} × 1`, column: 0 },
      {
        id: 'trend_smooth', kind: 'pool', label: 'Trend extraction (NOT causal)', sublabel: `Loess smoothing, trend window ${STL_TREND_WINDOW} bars, both sides of t`,
        inShape: `${T} × 1`, outShape: `${T} × 1`, column: 1,
        detail: {
          'causality': `Loess at bar t fits a local regression over bars on BOTH sides of t, so T_t reads roughly ${(STL_TREND_WINDOW - 1) / 2} bars into the future. This is the method, not a shortcut in the drawing.`,
          'using it live': `either swap in a strictly trailing one-sided smoother, or accept a reporting lag of about ${(STL_TREND_WINDOW - 1) / 2} bars — the spec's Training Methodology states the same constraint.`,
        },
        analogy: 'Think of it as squinting at the whole chart until the daily wiggle disappears and only the slow drift is left — which is why it needs the bars after t as well as before.',
      },
      { id: 'detrend', kind: 'compare', label: 'Detrend', sublabel: 'y_t - T_t (additive)', inShape: `${T} × 1`, outShape: `${T} × 1`, column: 2 },
      {
        id: 'seasonal_extract', kind: 'pool', label: 'Seasonal averaging (NOT causal)', sublabel: `Loess-smoothed average by seasonal position, window ${STL_SEASONAL_WINDOW} bars`,
        inShape: `${T} × 1`, outShape: `${T} × 1`, column: 3,
        detail: { 'causality': `two-sided like the trend smoother: each seasonal position is smoothed across the cycles on both sides of it` },
      },
      {
        id: 'robust_reweight', kind: 'compare', label: 'Robustness reweighting', sublabel: 'down-weight large-remainder points, repeat',
        column: 2, lane: 1,
        analogy: 'Think of it as ignoring a single flash-crash bar when deciding what "normal Tuesday afternoon" looks like.',
      },
      { id: 'remainder', kind: 'compare', label: 'Remainder', sublabel: 'R_t = y_t - T_t - S_t', inShape: `${T} × 1`, outShape: `${T} × 1`, column: 4 },
      { id: 'output', kind: 'output', label: 'Trend + seasonal + remainder', sublabel: 'sums back to the original series exactly', outShape: `${T} × 3`, column: 5 },
    ],
    edges: [
      ['input', 'trend_smooth', 'flow'],
      ['trend_smooth', 'detrend', 'flow'], ['input', 'detrend', 'flow'],
      ['detrend', 'seasonal_extract', 'flow'],
      ['detrend', 'remainder', 'flow'], ['seasonal_extract', 'remainder', 'flow'],
      ['remainder', 'output', 'flow'], ['trend_smooth', 'output', 'flow'], ['seasonal_extract', 'output', 'flow'],
      ['detrend', 'robust_reweight', 'context', 'large remainders down-weighted'],
      ['robust_reweight', 'trend_smooth', 'context', 'STL inner + outer loop, repeat'],
      ['robust_reweight', 'seasonal_extract', 'context', 'repeat with robustness weights'],
    ],
  }),
};
