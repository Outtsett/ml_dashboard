import { MLModelDefinition } from "@/ml/lib/types";

export const supervisedModels: MLModelDefinition[] = [
  {
    id: 'linear-regression',
    name: 'Linear Regression',
    shortName: 'LinReg',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Predicts a continuous target as a linear combination of input features. Foundational model for price movement and volatility prediction, serving as a baseline for comparison with more complex models.',
    principles: [
      'Linear Relationship: Models target as y = Xw + b + Îµ where w are coefficients',
      'Least Squares: Minimizes sum of squared residuals to find best-fit line',
      'Interpretability: Coefficients directly indicate feature impacts on predictions',
      'Closed-Form Solution: Computes optimal parameters via normal equation'
    ],
    applications: [
      'Predicts price movements or volatility as baseline with 0.80-0.85 RÂ²',
      'Models linear trends in technical indicators (moving averages)',
      'Estimates expected returns or drawdowns for portfolio sizing',
      'Quantifies impact of features (RSI, MACD) on price'
    ],
    keyFeatures: [
      'Simple to implement and computationally efficient',
      'Coefficients directly indicate feature impacts',
      'Fast training scaling well to moderate datasets',
      'Serves as baseline for evaluating complex models'
    ],
    hyperparameters: [
      { name: 'fit_intercept', type: 'boolean', default: true, description: 'Whether to calculate intercept' },
      { name: 'normalize', type: 'boolean', default: false, description: 'Normalize regressors before fitting' }
    ]
  },
  {
    id: 'ridge-regression',
    name: 'Ridge Regression',
    shortName: 'Ridge',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Extends linear regression with L2 regularization to penalize large coefficients, improving stability and handling multicollinearity in correlated market features.',
    principles: [
      'L2 Regularization: Adds Î»||w||Â² penalty shrinking coefficients toward zero',
      'Multicollinearity Handling: Stabilizes estimates for correlated features',
      'Bias-Variance Trade-Off: Balances model fit and complexity via Î»',
      'Closed-Form Solution: (X\'X + Î»I)â»Â¹X\'y computes optimal weights'
    ],
    applications: [
      'Predicts price movements improving RMSE by 5-10% over linear regression',
      'Models expected returns for portfolio optimization',
      'Captures linear trends in technical indicators',
      'Handles highly correlated market features effectively'
    ],
    keyFeatures: [
      'Stabilizes coefficients for correlated financial features',
      'L2 regularization reduces overfitting in noisy data',
      'Fast training with closed-form or gradient descent',
      'Coefficients reveal feature impacts (reduced by shrinkage)'
    ],
    hyperparameters: [
      { name: 'alpha', type: 'number', default: 1.0, min: 0.01, max: 100, step: 0.1, description: 'Regularization strength' },
      { name: 'solver', type: 'select', default: 'auto', options: ['auto', 'svd', 'cholesky', 'lsqr', 'sag'], description: 'Solver algorithm' },
      { name: 'fit_intercept', type: 'boolean', default: true, description: 'Whether to calculate intercept' }
    ]
  },
  {
    id: 'lasso-regression',
    name: 'Lasso Regression',
    shortName: 'Lasso',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Linear model with L1 regularization that promotes sparsity by driving some coefficients to zero, performing automatic feature selection for high-dimensional market data.',
    principles: [
      'L1 Regularization: Adds Î»||w||â‚ penalty inducing sparsity',
      'Feature Selection: Zeros out irrelevant features automatically',
      'Shrinkage: Non-zero coefficients shrunk toward zero',
      'Coordinate Descent: Efficient optimization via soft-thresholding'
    ],
    applications: [
      'Predicts price movements improving RMSE by 5-10% over linear regression',
      'Identifies key technical indicators (MACD, Bollinger Bands) for strategies',
      'Models expected returns for portfolio optimization',
      'Handles high-dimensional derived features efficiently'
    ],
    keyFeatures: [
      'Automatic feature selection via L1 penalty',
      'Produces sparse, interpretable models',
      'Robust to noisy financial data',
      'Non-zero coefficients reveal key predictors'
    ],
    hyperparameters: [
      { name: 'alpha', type: 'number', default: 0.1, min: 0.001, max: 10, step: 0.01, description: 'Regularization strength' },
      { name: 'max_iter', type: 'number', default: 1000, min: 100, max: 10000, description: 'Maximum iterations' },
      { name: 'tol', type: 'number', default: 0.0001, min: 0.00001, max: 0.01, step: 0.0001, description: 'Convergence tolerance' }
    ]
  },
  {
    id: 'elasticnet-regression',
    name: 'ElasticNet Regression',
    shortName: 'ElasticNet',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Combines L1 and L2 regularization to balance feature selection (sparsity) and coefficient shrinkage (stability), ideal for correlated high-dimensional market data.',
    principles: [
      'Hybrid Regularization: Î»[Î±||w||â‚ + (1-Î±)/2||w||Â²] combines L1 and L2',
      'Feature Selection: L1 component zeros out irrelevant features',
      'Multicollinearity: L2 component stabilizes correlated feature coefficients',
      'Mixing Parameter: Î± âˆˆ [0,1] controls L1/L2 balance'
    ],
    applications: [
      'Predicts price movements improving RMSE by 5-10% over linear regression',
      'Selects key technical indicators while handling correlations',
      'Models expected returns for risk management',
      'Handles high-dimensional multi-timeframe indicators'
    ],
    keyFeatures: [
      'Balances sparsity and stability for financial features',
      'Groups correlated features more effectively than Lasso',
      'Robust to noisy, multicollinear datasets',
      'Coefficients reveal feature impacts on predictions'
    ],
    hyperparameters: [
      { name: 'alpha', type: 'number', default: 0.5, min: 0.01, max: 10, step: 0.1, description: 'Overall regularization strength' },
      { name: 'l1_ratio', type: 'number', default: 0.5, min: 0, max: 1, step: 0.1, description: 'L1/L2 mixing (0=Ridge, 1=Lasso)' },
      { name: 'max_iter', type: 'number', default: 1000, min: 100, max: 10000, description: 'Maximum iterations' }
    ]
  },
  {
    id: 'bayesian-ridge',
    name: 'Bayesian Ridge Regression',
    shortName: 'BayesRidge',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Extends ridge regression with Bayesian inference to estimate parameters and hyperparameters, providing uncertainty quantification critical for risk management in trading.',
    principles: [
      'Bayesian Inference: Treats coefficients as random variables with priors',
      'Automatic Hyperparameter Tuning: Learns regularization from data',
      'Uncertainty Quantification: Provides confidence intervals for predictions',
      'Gaussian Assumptions: Prior w ~ N(0, Î»â»Â¹I), noise ~ N(0, ÏƒÂ²)'
    ],
    applications: [
      'Predicts price movements with uncertainty bounds for risk assessment',
      'Quantifies prediction confidence for stop-loss and position sizing',
      'Models linear relationships with built-in regularization',
      'Identifies influential features via posterior variance'
    ],
    keyFeatures: [
      'Provides prediction confidence intervals for risk management',
      'Automatically tunes regularization parameters',
      'Handles noisy, multicollinear data robustly',
      'Posterior analysis reveals feature importance'
    ],
    hyperparameters: [
      { name: 'alpha_init', type: 'number', default: 1, min: 0.000001, max: 10, description: 'Initial noise precision' },
      { name: 'lambda_init', type: 'number', default: 1, min: 0.000001, max: 10, description: 'Initial coefficient precision' },
      { name: 'n_iter', type: 'number', default: 300, min: 50, max: 1000, description: 'Maximum iterations' },
      { name: 'compute_score', type: 'boolean', default: true, description: 'Compute log marginal likelihood' }
    ]
  },
  {
    id: 'lars',
    name: 'Least Angle Regression',
    shortName: 'LARS',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Efficiently computes the entire Lasso regularization path by iteratively adding features in a stepwise manner, ideal for high-dimensional feature selection in market data.',
    principles: [
      'Stepwise Selection: Adds features iteratively minimizing angle with residual',
      'Regularization Path: Computes solutions for all L1 penalty strengths',
      'Equiangular Direction: Moves equally toward all active features',
      'Efficient Computation: O(Np min(N,p)) for full path'
    ],
    applications: [
      'Predicts price movements improving RMSE by 5-10% over linear regression',
      'Identifies key technical indicators for trading strategies',
      'Efficiently selects features from high-dimensional indicator sets',
      'Models expected returns for portfolio optimization'
    ],
    keyFeatures: [
      'Produces sparse models via L1-style selection',
      'Computes full regularization path efficiently',
      'Handles correlated features effectively',
      'Non-zero coefficients reveal key predictors'
    ],
    hyperparameters: [
      { name: 'n_nonzero_coefs', type: 'number', default: 500, min: 1, max: 1000, description: 'Maximum non-zero coefficients' },
      { name: 'fit_intercept', type: 'boolean', default: true, description: 'Whether to fit intercept' },
      { name: 'eps', type: 'number', default: 0.0000000001, min: 0.0000000001, max: 0.001, description: 'Machine precision regularization' }
    ]
  },
  {
    id: 'logistic-regression',
    name: 'Logistic Regression',
    shortName: 'LogReg',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Classification model predicting class probabilities via the logistic (sigmoid) function applied to a linear combination of features. Core model for trading signal classification.',
    principles: [
      'Linear Decision Boundary: log(p/(1-p)) = Xw + b models log-odds',
      'Sigmoid Function: Maps linear predictions to [0,1] probabilities',
      'Maximum Likelihood: Optimizes parameters to maximize label likelihood',
      'Regularization: L1/L2 penalties prevent overfitting'
    ],
    applications: [
      'Classifies trading signals (buy/sell) achieving 70-80% accuracy',
      'Predicts market regimes (trending/ranging) with probabilities',
      'Estimates trade success probabilities for position sizing',
      'Classifies candlestick patterns with interpretable confidence'
    ],
    keyFeatures: [
      'Probabilistic outputs for risk assessment',
      'Coefficients reveal feature impacts on class probabilities',
      'Regularization handles noisy or correlated features',
      'Simple baseline for complex classification tasks'
    ],
    hyperparameters: [
      { name: 'C', type: 'number', default: 1.0, min: 0.01, max: 100, step: 0.1, description: 'Inverse regularization strength' },
      { name: 'penalty', type: 'select', default: 'l2', options: ['l1', 'l2', 'elasticnet', 'none'], description: 'Regularization type' },
      { name: 'solver', type: 'select', default: 'lbfgs', options: ['newton-cg', 'lbfgs', 'liblinear', 'sag', 'saga'], description: 'Optimization algorithm' },
      { name: 'max_iter', type: 'number', default: 100, min: 50, max: 1000, description: 'Maximum iterations' }
    ]
  },
  {
    id: 'probit-regression',
    name: 'Probit Regression',
    shortName: 'Probit',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Classification model using the cumulative normal distribution (probit) function instead of sigmoid, suitable for data with normally distributed latent variables.',
    principles: [
      'Latent Variable: z = w\'x + b + Îµ where Îµ ~ N(0,1) determines class',
      'Probit Link: P(y=1|x) = Î¦(w\'x + b) using normal CDF',
      'Maximum Likelihood: Optimizes parameters for observed labels',
      'Gaussian Errors: Suits data with normal noise assumptions'
    ],
    applications: [
      'Classifies trading signals (buy/sell) achieving 70-80% accuracy',
      'Predicts market conditions (volatile/stable) with calibrated probabilities',
      'Estimates trade probabilities for position sizing',
      'Alternative to logistic when normal errors assumed'
    ],
    keyFeatures: [
      'Probabilistic outputs for risk assessment',
      'Gaussian error assumption suits normally distributed noise',
      'Coefficients reveal feature impacts on latent variable',
      'Supports ordinal extensions for volatility levels'
    ],
    hyperparameters: [
      { name: 'alpha', type: 'number', default: 1.0, min: 0.01, max: 100, step: 0.1, description: 'Regularization strength' },
      { name: 'fit_intercept', type: 'boolean', default: true, description: 'Include intercept term' },
      { name: 'max_iter', type: 'number', default: 100, min: 50, max: 1000, description: 'Maximum iterations' }
    ]
  },
  {
    id: 'ordinal-regression',
    name: 'Ordinal Regression',
    shortName: 'OrdReg',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Predicts ordered categorical outcomes (e.g., low/medium/high volatility) preserving their ordinal nature using threshold-based cumulative probability models.',
    principles: [
      'Ordinal Outcome: Preserves category order unlike nominal classification',
      'Threshold Model: Divides latent variable into ordered segments',
      'Cumulative Probabilities: P(Y â‰¤ k|x) = Ïƒ(w\'x + Î¸â‚–) for thresholds Î¸â‚–',
      'Proportional Odds: Common coefficients across thresholds'
    ],
    applications: [
      'Predicts ordinal volatility levels achieving 65-75% accuracy',
      'Classifies trend strength (weak/moderate/strong) for strategy selection',
      'Estimates ordinal risk levels for position sizing',
      'Classifies ordered pattern strengths'
    ],
    keyFeatures: [
      'Preserves order of categories for market states',
      'Provides calibrated probabilities for each level',
      'Coefficients reveal feature impacts on ordinal outcomes',
      'More appropriate than nominal classification for ordered data'
    ],
    hyperparameters: [
      { name: 'alpha', type: 'number', default: 1.0, min: 0.01, max: 100, step: 0.1, description: 'Regularization strength' },
      { name: 'max_iter', type: 'number', default: 1000, min: 100, max: 10000, description: 'Maximum iterations' }
    ]
  },
  {
    id: 'quantile-regression',
    name: 'Quantile Regression',
    shortName: 'QuantReg',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Predicts specific quantiles (e.g., median, 10th/90th percentile) of the target distribution, providing robust estimates and prediction intervals for risk assessment.',
    principles: [
      'Conditional Quantiles: Models Q_y(Ï„|x) = x\'w_Ï„ for quantile Ï„',
      'Pinball Loss: Ï_Ï„(u) = u(Ï„ - I{u<0}) asymmetrically penalizes errors',
      'Heteroscedasticity: Captures varying relationships across distribution',
      'Robustness: Outlier-resistant unlike mean-based regression'
    ],
    applications: [
      'Predicts price quantiles improving risk assessment by 5-10%',
      'Estimates Value-at-Risk (VaR) for position sizing',
      'Models upper/lower bounds of price trends',
      'Quantifies return distributions for portfolio allocation'
    ],
    keyFeatures: [
      'Models specific percentiles for tail risk assessment',
      'Robust to outliers and heteroscedasticity',
      'Provides prediction intervals for uncertainty quantification',
      'Coefficients vary by quantile revealing distributional effects'
    ],
    hyperparameters: [
      { name: 'quantile', type: 'number', default: 0.5, min: 0.01, max: 0.99, step: 0.05, description: 'Target quantile (0.5 = median)' },
      { name: 'alpha', type: 'number', default: 0.0, min: 0, max: 10, step: 0.1, description: 'Regularization strength' },
      { name: 'max_iter', type: 'number', default: 1000, min: 100, max: 10000, description: 'Maximum iterations' }
    ]
  },
  {
    id: 'sgd-classifier',
    name: 'Stochastic Gradient Descent',
    shortName: 'SGD',
    category: 'supervised',
    subcategory: 'linear',
    overview: 'Optimization technique training linear models by updating parameters using gradients from individual samples or mini-batches, enabling efficient training on large datasets and online learning.',
    principles: [
      'Stochastic Updates: Computes gradients from single/mini-batch samples',
      'Gradient Descent: Updates w â† w - Î·âˆ‡L in direction minimizing loss',
      'Regularization: Supports L1/L2 penalties for overfitting control',
      'Online Learning: Adapts incrementally to streaming data'
    ],
    applications: [
      'Trains models on large market datasets achieving 85-90% of batch performance',
      'Updates models in real-time with streaming price data',
      'Predicts price movements or classifies signals efficiently',
      'Handles high-dimensional derived features scalably'
    ],
    keyFeatures: [
      'Efficiently handles large datasets with incremental updates',
      'Supports both regression and classification tasks',
      'Stochasticity helps escape local minima',
      'Enables online learning for real-time trading'
    ],
    hyperparameters: [
      { name: 'loss', type: 'select', default: 'log_loss', options: ['hinge', 'log_loss', 'squared_error', 'huber'], description: 'Loss function' },
      { name: 'penalty', type: 'select', default: 'l2', options: ['l1', 'l2', 'elasticnet'], description: 'Regularization type' },
      { name: 'alpha', type: 'number', default: 0.0001, min: 0.000001, max: 0.1, step: 0.0001, description: 'Regularization strength' },
      { name: 'learning_rate', type: 'select', default: 'optimal', options: ['constant', 'optimal', 'invscaling', 'adaptive'], description: 'Learning rate schedule' },
      { name: 'eta0', type: 'number', default: 0.01, min: 0.0001, max: 1, step: 0.01, description: 'Initial learning rate' }
    ]
  },
  {
    id: 'random-forest',
    name: 'Random Forest',
    shortName: 'RF',
    category: 'supervised',
    subcategory: 'ensemble',
    overview: 'Ensemble of decision trees trained on random subsets of data and features, combining predictions via voting (classification) or averaging (regression) for robust predictions.',
    principles: [
      'Bootstrap Aggregation: Trains each tree on random data subset with replacement',
      'Random Feature Selection: Uses random feature subsets at each split',
      'Ensemble Voting: Aggregates trees via majority vote or averaging',
      'Decorrelation: Randomness ensures diverse, uncorrelated tree predictions'
    ],
    applications: [
      'Predicts trading signals achieving 5-10% higher accuracy than single trees',
      'Classifies market regimes (trending/ranging) robustly',
      'Regresses future price movements using technical features',
      'Identifies unusual price movements via OOB error analysis'
    ],
    keyFeatures: [
      'High accuracy through ensemble averaging',
      'Resistant to overfitting via bagging and feature randomness',
      'Provides feature importance for trading insights',
      'Handles mixed numerical/categorical features'
    ],
    hyperparameters: [
      { name: 'n_estimators', type: 'number', default: 100, min: 10, max: 1000, description: 'Number of trees' },
      { name: 'max_depth', type: 'number', default: 10, min: 1, max: 50, description: 'Maximum tree depth (null=unlimited)' },
      { name: 'max_features', type: 'select', default: 'sqrt', options: ['sqrt', 'log2', 'auto'], description: 'Features per split' },
      { name: 'min_samples_split', type: 'number', default: 2, min: 2, max: 20, description: 'Minimum samples to split' },
      { name: 'min_samples_leaf', type: 'number', default: 1, min: 1, max: 10, description: 'Minimum samples per leaf' }
    ]
  },
  {
    id: 'stacking',
    name: 'Stacked Generalization',
    shortName: 'Stacking',
    category: 'supervised',
    subcategory: 'ensemble',
    overview: 'Combines predictions from multiple diverse base models (level-0) using a meta-learner (level-1) that learns optimal combination weights, capturing complementary model strengths.',
    principles: [
      'Meta-Learning: Level-1 model learns to combine base model predictions',
      'Diverse Base Models: Uses varied algorithms (RF, XGB, SVM) for complementarity',
      'Out-of-Fold Predictions: Generates meta-features via cross-validation',
      'Hierarchical Structure: Stacks multiple model layers'
    ],
    applications: [
      'Predicts trading signals achieving 5-15% higher accuracy than single models',
      'Combines diverse predictors for robust market regime classification',
      'Regresses future prices using complementary feature representations',
      'Integrates price, volume, and sentiment model predictions'
    ],
    keyFeatures: [
      'Captures complementary strengths of diverse models',
      'Cross-validation prevents overfitting in meta-features',
      'Meta-learner weights reveal base model contributions',
      'Flexible: any base models and meta-learner'
    ],
    hyperparameters: [
      { name: 'cv_folds', type: 'number', default: 5, min: 2, max: 10, description: 'Cross-validation folds' },
      { name: 'passthrough', type: 'boolean', default: false, description: 'Include original features in meta-features' },
      { name: 'stack_method', type: 'select', default: 'auto', options: ['auto', 'predict_proba', 'decision_function', 'predict'], description: 'Stacking method' }
    ]
  },
  {
    id: 'gbm',
    name: 'Gradient Boosting Machine',
    shortName: 'GBM',
    category: 'supervised',
    subcategory: 'boosting',
    overview: 'Sequentially builds decision trees, each correcting errors of previous ones via gradient descent on a loss function. Highly effective for complex market patterns.',
    principles: [
      'Sequential Correction: Each tree fits residuals (negative gradients) of prior ensemble',
      'Additive Ensemble: f(x) = Î£ Î·hâ‚œ(x) combines weak learners',
      'Gradient Descent: Minimizes differentiable loss function iteratively',
      'Regularization: Shrinkage, depth limits, subsampling control complexity'
    ],
    applications: [
      'Predicts trading signals achieving 5-10% higher accuracy than baselines',
      'Regresses future price movements using technical features',
      'Classifies candlestick patterns with feature importance',
      'Predicts volatility for portfolio risk management'
    ],
    keyFeatures: [
      'High accuracy on complex financial datasets',
      'Handles classification, regression, and ranking',
      'Feature importance and partial dependence plots',
      'Regularization prevents overfitting'
    ],
    hyperparameters: [
      { name: 'n_estimators', type: 'number', default: 100, min: 10, max: 1000, description: 'Number of boosting stages' },
      { name: 'learning_rate', type: 'number', default: 0.1, min: 0.001, max: 1, step: 0.01, description: 'Shrinkage rate' },
      { name: 'max_depth', type: 'number', default: 3, min: 1, max: 15, description: 'Maximum tree depth' },
      { name: 'subsample', type: 'number', default: 1.0, min: 0.5, max: 1, step: 0.1, description: 'Fraction of samples per tree' },
      { name: 'min_samples_split', type: 'number', default: 2, min: 2, max: 20, description: 'Minimum samples to split' }
    ]
  },
  {
    id: 'xgboost',
    name: 'XGBoost',
    shortName: 'XGB',
    category: 'supervised',
    subcategory: 'boosting',
    overview: 'Highly optimized gradient boosting with regularized objective, second-order gradients, and parallel tree construction. Industry standard for structured data.',
    principles: [
      'Regularized Objective: L1/L2 penalties on leaf weights prevent overfitting',
      'Second-Order Gradients: Uses Hessians for better optimization',
      'Level-Wise Growth: Builds trees level by level with optimal splits',
      'Parallel Split Finding: Accelerates training via parallelization'
    ],
    applications: [
      'Predicts trading signals achieving 5-15% higher accuracy than baselines',
      'Regresses future price movements with high precision',
      'Classifies market regimes with SHAP interpretability',
      'Predicts volatility for risk management'
    ],
    keyFeatures: [
      'Regularized objective prevents overfitting',
      'Second-order gradients improve convergence',
      'Handles missing values natively',
      'SHAP values provide feature interpretability'
    ],
    hyperparameters: [
      { name: 'n_estimators', type: 'number', default: 100, min: 10, max: 1000, description: 'Number of boosting rounds' },
      { name: 'learning_rate', type: 'number', default: 0.1, min: 0.001, max: 1, step: 0.01, description: 'Step size shrinkage' },
      { name: 'max_depth', type: 'number', default: 6, min: 1, max: 15, description: 'Maximum tree depth' },
      { name: 'reg_lambda', type: 'number', default: 1, min: 0, max: 10, step: 0.1, description: 'L2 regularization' },
      { name: 'reg_alpha', type: 'number', default: 0, min: 0, max: 10, step: 0.1, description: 'L1 regularization' },
      { name: 'subsample', type: 'number', default: 0.8, min: 0.5, max: 1, step: 0.1, description: 'Row subsampling ratio' },
      { name: 'colsample_bytree', type: 'number', default: 0.8, min: 0.5, max: 1, step: 0.1, description: 'Column subsampling ratio' }
    ]
  },
  {
    id: 'lightgbm',
    name: 'LightGBM',
    shortName: 'LGBM',
    category: 'supervised',
    subcategory: 'boosting',
    overview: 'High-performance gradient boosting optimized for speed and scalability using histogram-based splitting and leaf-wise tree growth.',
    principles: [
      'Histogram-Based Splitting: Bins features into histograms for fast split finding',
      'Leaf-Wise Growth: Grows trees by splitting leaf with highest loss reduction',
      'Gradient-Based One-Side Sampling: Focuses on data with larger gradients',
      'Exclusive Feature Bundling: Bundles sparse features for efficiency'
    ],
    applications: [
      'Predicts trading signals achieving 5-15% higher accuracy than baselines',
      'Handles large market datasets 20-50% faster than traditional GBM',
      'Classifies market regimes with native categorical support',
      'Predicts volatility with efficient memory usage'
    ],
    keyFeatures: [
      'Histogram-based splits reduce training time 20-50%',
      'Leaf-wise growth produces more accurate models',
      'Native categorical feature handling',
      'Low memory footprint for large datasets'
    ],
    hyperparameters: [
      { name: 'n_estimators', type: 'number', default: 100, min: 10, max: 1000, description: 'Number of boosting iterations' },
      { name: 'learning_rate', type: 'number', default: 0.1, min: 0.001, max: 1, step: 0.01, description: 'Boosting learning rate' },
      { name: 'num_leaves', type: 'number', default: 31, min: 10, max: 256, description: 'Maximum leaves per tree' },
      { name: 'max_depth', type: 'number', default: -1, min: -1, max: 50, description: 'Maximum tree depth (-1=unlimited)' },
      { name: 'reg_lambda', type: 'number', default: 0, min: 0, max: 10, step: 0.1, description: 'L2 regularization' },
      { name: 'feature_fraction', type: 'number', default: 0.8, min: 0.5, max: 1, step: 0.1, description: 'Column subsampling ratio' },
      { name: 'bagging_fraction', type: 'number', default: 0.8, min: 0.5, max: 1, step: 0.1, description: 'Row subsampling ratio' }
    ]
  },
  {
    id: 'catboost',
    name: 'CatBoost',
    shortName: 'CatBoost',
    category: 'supervised',
    subcategory: 'boosting',
    overview: 'Gradient boosting optimized for categorical features using target-based encoding and ordered boosting to prevent overfitting.',
    principles: [
      'Ordered Boosting: Uses ordered target statistics for unbiased gradients',
      'Automatic Categorical Encoding: Target-based encoding reduces preprocessing',
      'Symmetric Trees: Identical splits at each level for speed and stability',
      'Overfitting Prevention: Ordered target statistics prevent target leakage'
    ],
    applications: [
      'Predicts trading signals achieving 5-15% higher accuracy than baselines',
      'Handles categorical market regime features automatically',
      'Classifies candlestick patterns with minimal preprocessing',
      'Predicts volatility with robust regularization'
    ],
    keyFeatures: [
      'Automatic categorical feature handling',
      'Ordered boosting prevents overfitting',
      'Symmetric trees for fast training',
      'GPU acceleration for large datasets'
    ],
    hyperparameters: [
      { name: 'iterations', type: 'number', default: 100, min: 10, max: 1000, description: 'Number of boosting iterations' },
      { name: 'learning_rate', type: 'number', default: 0.1, min: 0.001, max: 1, step: 0.01, description: 'Boosting learning rate' },
      { name: 'depth', type: 'number', default: 6, min: 1, max: 16, description: 'Tree depth' },
      { name: 'l2_leaf_reg', type: 'number', default: 3, min: 0, max: 10, step: 0.1, description: 'L2 regularization' },
      { name: 'border_count', type: 'number', default: 254, min: 1, max: 255, description: 'Histogram bins for numerical features' },
      { name: 'bagging_temperature', type: 'number', default: 1, min: 0, max: 10, step: 0.1, description: 'Bayesian bootstrap temperature' }
    ]
  },
  {
    id: 'calibrated-classifier',
    name: 'Calibrated Classifier',
    shortName: 'CalibratedCV',
    category: 'supervised',
    subcategory: 'meta-learner',
    overview: 'Adjusts classifier probability outputs to better reflect true probabilities using Platt scaling or isotonic regression, critical for reliable risk assessment.',
    principles: [
      'Probability Calibration: Adjusts raw scores to match empirical frequencies',
      'Platt Scaling: Fits sigmoid to map scores to calibrated probabilities',
      'Isotonic Regression: Non-parametric monotonic mapping for flexibility',
      'Cross-Validation: Prevents overfitting on calibration data'
    ],
    applications: [
      'Enhances trading signals with reliable probability estimates',
      'Improves risk management by 10-20% in calibration error',
      'Classifies market regimes with trustworthy confidence',
      'Quantifies trade risk using calibrated probabilities'
    ],
    keyFeatures: [
      'Produces reliable probability estimates for decisions',
      'Works with any base classifier',
      'Platt scaling for parametric, isotonic for flexible calibration',
      'Cross-validation prevents calibration overfitting'
    ],
    hyperparameters: [
      { name: 'method', type: 'select', default: 'sigmoid', options: ['sigmoid', 'isotonic'], description: 'Calibration method (sigmoid=Platt, isotonic=non-parametric)' },
      { name: 'cv', type: 'number', default: 5, min: 2, max: 10, description: 'Cross-validation folds' },
      { name: 'ensemble', type: 'boolean', default: true, description: 'Ensemble calibrated classifiers' }
    ]
  },
  {
    id: 'autoencoder',
    name: 'Autoencoder',
    shortName: 'AE',
    category: 'unsupervised',
    subcategory: 'deep-learning',
    overview: 'Neural network that learns to compress and reconstruct data via an encoder-decoder architecture, extracting latent features for dimensionality reduction and anomaly detection.',
    principles: [
      'Encoder-Decoder: Compresses input to latent space z = f(x), reconstructs xÌ‚ = g(z)',
      'Reconstruction Loss: Minimizes ||x - xÌ‚||Â² to learn meaningful representations',
      'Bottleneck: Lower-dimensional latent space forces feature compression',
      'Non-Linear Modeling: Neural networks capture complex patterns unlike PCA'
    ],
    applications: [
      'Extracts latent market features improving prediction accuracy by 5-10%',
      'Detects anomalies via high reconstruction error',
      'Filters noise from high-frequency market data',
      'Discovers hidden volatility regimes for strategy development'
    ],
    keyFeatures: [
      'Non-linear dimensionality reduction',
      'Automatic latent feature extraction',
      'Anomaly detection via reconstruction error',
      'Flexible architecture (dense, convolutional, LSTM)'
    ],
    hyperparameters: [
      { name: 'latent_dim', type: 'number', default: 10, min: 2, max: 100, description: 'Latent space dimensions' },
      { name: 'hidden_layers', type: 'number', default: 2, min: 1, max: 5, description: 'Number of hidden layers' },
      { name: 'hidden_units', type: 'number', default: 64, min: 16, max: 512, description: 'Units per hidden layer' },
      { name: 'activation', type: 'select', default: 'relu', options: ['relu', 'tanh', 'sigmoid', 'leaky_relu'], description: 'Activation function' },
      { name: 'dropout', type: 'number', default: 0.2, min: 0, max: 0.5, step: 0.05, description: 'Dropout rate' },
      { name: 'learning_rate', type: 'number', default: 0.001, min: 0.0001, max: 0.1, step: 0.0001, description: 'Learning rate' }
    ]
  },
  {
    id: 'dcn',
    name: 'Deep Clustering Network',
    shortName: 'DCN',
    category: 'unsupervised',
    subcategory: 'deep-learning',
    overview: 'Integrates autoencoder-based feature learning with clustering objective, simultaneously learning latent representations and cluster assignments.',
    principles: [
      'Joint Optimization: Combines reconstruction loss with clustering loss',
      'Autoencoder Backbone: Learns latent representations via encoder-decoder',
      'Soft Assignments: Uses Student\'s t-distribution for cluster probabilities',
      'KL Divergence: Sharpens cluster assignments via auxiliary target distribution'
    ],
    applications: [
      'Clusters market patterns achieving silhouette scores of 0.4-0.6',
      'Groups trading behaviors (scalping vs. microstructure) automatically',
      'Segments instruments by volatility/correlation characteristics',
      'Discovers hidden market regimes for strategy development'
    ],
    keyFeatures: [
      'Jointly learns features and clusters end-to-end',
      'Non-linear feature extraction via neural networks',
      'Soft clustering with probabilistic assignments',
      'Outperforms separate clustering approaches'
    ],
    hyperparameters: [
      { name: 'n_clusters', type: 'number', default: 5, min: 2, max: 20, description: 'Number of clusters' },
      { name: 'latent_dim', type: 'number', default: 10, min: 2, max: 100, description: 'Latent space dimensions' },
      { name: 'hidden_layers', type: 'number', default: 2, min: 1, max: 5, description: 'Number of hidden layers' },
      { name: 'lambda', type: 'number', default: 0.1, min: 0.01, max: 1, step: 0.01, description: 'Clustering loss weight' },
      { name: 'pretrain_epochs', type: 'number', default: 50, min: 10, max: 200, description: 'Autoencoder pretraining epochs' },
      { name: 'learning_rate', type: 'number', default: 0.001, min: 0.0001, max: 0.1, step: 0.0001, description: 'Learning rate' }
    ]
  }
];

export type ValidationMethod = 'percentage' | 'time-based' | 'walk-forward' | 'k-fold';

export interface ValidationConfig {
  method: ValidationMethod;
  percentageSplit?: number;
  timeBasedConfig?: {
    trainWindow: number;
    trainUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
    testWindow: number;
    testUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
    gapWindow: number;
    gapUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
  };
  walkForwardConfig?: {
    trainWindow: number;
    trainUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
    testWindow: number;
    testUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
    stepSize: number;
    stepUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
    windowType: 'rolling' | 'expanding';
    embargoWindow: number;
    embargoUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
  };
  kFoldConfig?: {
    nFolds: number;
    foldType: 'standard' | 'purged' | 'combinatorial-purged';
    purgeGap: number;
    purgeUnit: 'bars' | 'minutes' | 'hours' | 'days' | 'weeks';
    embargoRatio: number;
  };
}

export const defaultValidationConfig: ValidationConfig = {
  method: 'percentage',
  percentageSplit: 0.2,
  timeBasedConfig: {
    trainWindow: 30,
    trainUnit: 'days',
    testWindow: 7,
    testUnit: 'days',
    gapWindow: 0,
    gapUnit: 'days',
  },
  walkForwardConfig: {
    trainWindow: 30,
    trainUnit: 'days',
    testWindow: 7,
    testUnit: 'days',
    stepSize: 7,
    stepUnit: 'days',
    windowType: 'rolling',
    embargoWindow: 1,
    embargoUnit: 'days',
  },
  kFoldConfig: {
    nFolds: 5,
    foldType: 'standard',
    purgeGap: 1,
    purgeUnit: 'days',
    embargoRatio: 0.01,
  },
};



