import type { LearningPath } from "../types";

export const classicalMlPath: LearningPath = {
  id: "classical-ml",
  title: "Classical Machine Learning",
  description:
    "Master the supervised learning algorithms that power production trading systems — from linear models and decision trees to gradient-boosted ensembles — with a focus on proper time-series validation and forex-specific pitfalls.",
  icon: "Brain",
  color: "emerald",
  difficulty: "intermediate",
  estimatedHours: 18,
  modules: [
    {
      id: "supervised",
      title: "Supervised Learning",
      description:
        "Learn the foundational supervised algorithms — linear regression, logistic regression, decision trees, and random forests — applied to forex direction prediction and regime detection.",
      lessons: [
        {
          id: "cml-linear-models",
          title: "Linear & Logistic Regression",
          description:
            "Understand OLS regression, L1/L2 regularization, and logistic regression for predicting forex return direction from technical indicators.",
          estimatedMinutes: 50,
          difficulty: "intermediate",
          prerequisites: ["found-descriptive-stats", "found-optimization"],
          sections: [
            {
              type: "objective",
              content:
                "By the end of this lesson you will be able to explain Ordinary Least Squares (OLS), derive the regularized loss functions for Ridge (L2) and Lasso (L1), and train a logistic regression model to predict the direction of next-bar forex returns using technical indicator features.",
              keyTakeaways: [
                "OLS minimizes L(θ) = ‖y − Xθ‖² and has closed-form solution θ* = (XᵀX)⁻¹Xᵀy",
                "Ridge (L2) adds λ‖θ‖² to the loss, shrinking coefficients toward zero to combat overfitting",
                "Lasso (L1) adds λ‖θ‖₁, driving some coefficients to exactly zero — performing feature selection",
                "Logistic regression models P(y=1|x) = σ(θᵀx) where σ is the sigmoid function, ideal for direction prediction",
              ],
            },
            {
              type: "theory",
              title: "From OLS to Regularized Logistic Regression",
              content:
                "**Ordinary Least Squares** fits a linear model ŷ = Xθ by minimizing the sum of squared residuals: L(θ) = ∑ᵢ (yᵢ − xᵢᵀθ)². The closed-form solution θ* = (XᵀX)⁻¹Xᵀy exists but is sensitive to multicollinearity — common when using correlated indicators like RSI, Stochastic %K, and Williams %R.\n\n**Ridge regression** adds an L2 penalty: L(θ) = ‖y − Xθ‖² + λ‖θ‖². This shrinks all coefficients proportionally and stabilizes the inverse (XᵀX + λI)⁻¹. **Lasso** uses an L1 penalty: L(θ) = ‖y − Xθ‖² + λ‖θ‖₁, which drives some θⱼ to exactly zero — effectively selecting features.\n\nFor **classification** (e.g., predicting up/down), logistic regression models the probability P(y = 1 | x) = σ(θᵀx) = 1 / (1 + e^(−θᵀx)). The loss becomes the negative log-likelihood (cross-entropy): L(θ) = −∑ᵢ [yᵢ log(ŷᵢ) + (1−yᵢ) log(1−ŷᵢ)], which is convex and optimized via gradient descent or L-BFGS.",
            },
            {
              type: "intuition",
              title: "The Elastic Band Analogy",
              analogy:
                "Regularization is like attaching elastic bands to each model coefficient, pulling it back toward zero.",
              content:
                "Imagine each coefficient θⱼ is a slider you can push left or right to fit the data. Without regularization, sliders can fly to extreme positions to overfit noise. **Ridge (L2)** attaches a rubber band to each slider — it resists large values but never forces any slider to exactly zero. **Lasso (L1)** uses a sticky pad instead: once a slider gets close to zero, the friction holds it there. This is why Lasso performs feature selection — unimportant indicators get 'stuck' at zero. For forex, where you might have 30+ correlated indicators, Lasso automatically selects the 5–10 that actually matter.",
              emoji: "🪢",
            },
            {
              type: "code",
              title: "Logistic Regression for Forex Direction Prediction",
              language: "python",
              code: `import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import classification_report

# Load features and create binary target: 1 if next-bar return > 0
df = pd.read_csv("eurusd_features.csv", parse_dates=["timestamp"])
df["target"] = (df["close"].shift(-1) > df["close"]).astype(int)
df = df.dropna()

feature_cols = ["rsi_14", "macd", "macd_signal", "bb_width",
                "atr_14", "adx_14", "cci_20", "roc_10"]

# Time-based train/test split (never shuffle time series!)
split_idx = int(len(df) * 0.8)
X_train, X_test = df[feature_cols].iloc[:split_idx], df[feature_cols].iloc[split_idx:]
y_train, y_test = df["target"].iloc[:split_idx], df["target"].iloc[split_idx:]

# Standardize features
scaler = StandardScaler()
X_train_s = scaler.fit_transform(X_train)
X_test_s = scaler.transform(X_test)

# Logistic regression with L1 regularization (Lasso)
model = LogisticRegression(penalty="l1", C=0.5, solver="saga", max_iter=2000)
model.fit(X_train_s, y_train)

# Evaluate
y_pred = model.predict(X_test_s)
print(classification_report(y_test, y_pred, target_names=["Down", "Up"]))

# Feature importance via coefficients
coefs = pd.Series(model.coef_[0], index=feature_cols).sort_values(key=abs, ascending=False)
print("\\nCoefficients (L1-regularized):")
for feat, coef in coefs.items():
    marker = " [zeroed]" if abs(coef) < 1e-6 else ""
    print(f"  {feat:>15}: {coef:+.4f}{marker}")`,
              explanation:
                "We create a binary target (next-bar direction) and train logistic regression with L1 regularization (C = 0.5 controls inverse regularization strength). The critical detail: we use a time-ordered split, never shuffling, because shuffled splits leak future information. L1 regularization zeros out uninformative indicators, and the remaining coefficients show which features drive the model's predictions.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "cml-lm-q1",
                  question:
                    "What is the key difference between Ridge (L2) and Lasso (L1) regularization?",
                  options: [
                    { id: "cml-lm-q1-a", text: "Ridge uses gradient descent while Lasso uses closed-form solutions" },
                    { id: "cml-lm-q1-b", text: "Ridge shrinks coefficients toward zero but Lasso can set them exactly to zero" },
                    { id: "cml-lm-q1-c", text: "Lasso always produces better accuracy than Ridge" },
                    { id: "cml-lm-q1-d", text: "Ridge is for regression and Lasso is for classification" },
                  ],
                  correctOptionId: "cml-lm-q1-b",
                  explanation:
                    "The L1 (Lasso) penalty has a sharp corner at zero in its constraint geometry, which causes some coefficients to be driven to exactly zero — performing automatic feature selection. L2 (Ridge) shrinks all coefficients proportionally but never eliminates any entirely.",
                },
                {
                  id: "cml-lm-q2",
                  question:
                    "Why should you NEVER use random shuffled train/test splits for forex prediction tasks?",
                  options: [
                    { id: "cml-lm-q2-a", text: "Shuffling increases training time" },
                    { id: "cml-lm-q2-b", text: "Shuffling causes look-ahead bias by placing future data points in the training set" },
                    { id: "cml-lm-q2-c", text: "Shuffling removes the need for standardization" },
                    { id: "cml-lm-q2-d", text: "Shuffling makes the model deterministic" },
                  ],
                  correctOptionId: "cml-lm-q2-b",
                  explanation:
                    "Time series data has temporal dependencies. Randomly shuffling mixes future and past data in both train and test sets, causing information leakage (look-ahead bias). The model appears to perform well in testing but fails in live trading because it was trained on 'future' data.",
                },
                {
                  id: "cml-lm-q3",
                  question:
                    "In logistic regression, what does the sigmoid function σ(z) = 1/(1 + e⁻ᶻ) output?",
                  options: [
                    { id: "cml-lm-q3-a", text: "A value in (−∞, +∞) representing the predicted return" },
                    { id: "cml-lm-q3-b", text: "A probability in [0, 1] representing P(y=1 | x)" },
                    { id: "cml-lm-q3-c", text: "The gradient of the loss function" },
                    { id: "cml-lm-q3-d", text: "The regularization strength λ" },
                  ],
                  correctOptionId: "cml-lm-q3-b",
                  explanation:
                    "The sigmoid function squashes the linear combination θᵀx from the real line into the interval [0, 1], producing a calibrated probability estimate for the positive class.",
                },
              ],
            },
            {
              type: "practice",
              title: "Compare Regularization Strengths",
              description:
                "Train logistic regression models with C ∈ {0.01, 0.1, 1.0, 10.0} on your forex data. For each, record the number of non-zero coefficients and test accuracy. Plot regularization strength vs. accuracy and vs. number of selected features to find the optimal tradeoff.",
              catalogModelId: "logistic-regression",
            },
          ],
        },
        {
          id: "cml-tree-models",
          title: "Decision Trees & Random Forests",
          description:
            "Learn how decision trees split feature space, how random forests combine hundreds of trees via bagging, and how to extract feature importance for forex regime detection.",
          estimatedMinutes: 55,
          difficulty: "intermediate",
          prerequisites: ["cml-linear-models"],
          sections: [
            {
              type: "objective",
              content:
                "You will understand how decision trees recursively partition the feature space using information gain or Gini impurity, how Random Forests aggregate many decorrelated trees via bagging, and how to train a RandomForestClassifier for detecting market regimes (trending vs. ranging).",
              keyTakeaways: [
                "Decision trees split on the feature and threshold that maximally reduces impurity (Gini or entropy)",
                "Individual trees overfit easily — pruning (max_depth, min_samples_leaf) controls complexity",
                "Random Forests bag multiple trees on bootstrap samples with random feature subsets (√p features per split)",
                "Feature importance from forests reveals which indicators drive regime transitions",
              ],
            },
            {
              type: "theory",
              title: "Splitting Criteria & Ensemble Bagging",
              content:
                "A **decision tree** recursively partitions feature space by finding the split (feature j, threshold t) that maximally reduces impurity. **Gini impurity** for a node with class proportions pₖ is: G = 1 − ∑ₖ pₖ². A pure node (one class) has G = 0. **Information gain** uses entropy H = −∑ₖ pₖ log₂(pₖ) instead. The best split maximizes ΔG = G_parent − (nₗ/n)G_left − (nᵣ/n)G_right.\n\nSingle trees overfit because they can memorize noise. **Random Forests** combat this with **bagging** (bootstrap aggregating): train B trees on B bootstrap samples (random samples with replacement), each considering only a random subset of √p features at each split. The final prediction is the majority vote of all B trees.\n\nThis **decorrelation** is key: if one dominant feature exists, individual trees all look similar. Random feature subsets force trees to find diverse patterns, reducing variance while maintaining low bias. The **out-of-bag (OOB) error** provides a free validation estimate — each sample is excluded from ≈ 37% of bootstrap samples.",
            },
            {
              type: "intuition",
              title: "The Committee of Experts",
              analogy:
                "A Random Forest is like a committee of traders who each see a different subset of indicators.",
              content:
                "Imagine you have 500 traders, but each one can only see a random subset of 4 out of 15 indicators on their screen. Each trader independently decides 'trending' or 'ranging' based on their limited view. Some will be wrong, but their errors are *different* because they see different information. When you take a majority vote across all 500, the random errors cancel out and the consensus is remarkably accurate. That's bagging with random feature subsets. A single tree is one overconfident trader staring at all 15 indicators — they memorize past patterns (overfit) instead of finding robust signals.",
              emoji: "🌲",
            },
            {
              type: "code",
              title: "Random Forest for Regime Detection",
              language: "python",
              code: `import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, accuracy_score

# Load data with regime labels (0 = ranging, 1 = trending)
df = pd.read_csv("eurusd_regimes.csv", parse_dates=["timestamp"])
feature_cols = ["adx_14", "atr_14", "bb_width", "rsi_14",
                "macd", "volume_ma_ratio", "cci_20", "roc_10"]

X = df[feature_cols].values
y = df["regime"].values  # 0 = ranging, 1 = trending

# Time-ordered split
split = int(len(X) * 0.8)
X_train, X_test = X[:split], X[split:]
y_train, y_test = y[:split], y[split:]

# Train Random Forest
rf = RandomForestClassifier(
    n_estimators=500,
    max_depth=8,
    min_samples_leaf=20,
    max_features="sqrt",     # √p random features per split
    oob_score=True,
    random_state=42,
    n_jobs=-1,
)
rf.fit(X_train, y_train)

print(f"OOB Accuracy:  {rf.oob_score_:.4f}")
print(f"Test Accuracy: {accuracy_score(y_test, rf.predict(X_test)):.4f}\\n")
print(classification_report(y_test, rf.predict(X_test),
                            target_names=["Ranging", "Trending"]))

# Feature importance
importances = pd.Series(rf.feature_importances_, index=feature_cols)
importances = importances.sort_values(ascending=False)
print("Feature Importance (MDI):")
for feat, imp in importances.items():
    bar = "█" * int(imp * 50)
    print(f"  {feat:>18}: {imp:.4f} {bar}")`,
              explanation:
                "We train a 500-tree Random Forest with max_depth=8 and min_samples_leaf=20 to prevent overfitting. The max_features='sqrt' ensures each split considers only √8 ≈ 3 random features, decorrelating the trees. OOB score provides a built-in validation metric. Feature importance (Mean Decrease in Impurity) reveals that ADX and ATR typically dominate regime detection, which aligns with their role as trend-strength and volatility measures.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "cml-tree-q1",
                  question:
                    "Why does a Random Forest use only √p features at each split instead of all p?",
                  options: [
                    { id: "cml-tree-q1-a", text: "To speed up training by reducing the number of splits to evaluate" },
                    { id: "cml-tree-q1-b", text: "To decorrelate the trees so their errors are independent, reducing ensemble variance" },
                    { id: "cml-tree-q1-c", text: "To ensure every feature is used equally often" },
                    { id: "cml-tree-q1-d", text: "To make the trees deeper" },
                  ],
                  correctOptionId: "cml-tree-q1-b",
                  explanation:
                    "If all features are considered at every split, all trees tend to split on the same dominant feature first, making them correlated. Random feature subsets force diversity among trees, so their prediction errors are more independent — reducing the variance of the ensemble average.",
                },
                {
                  id: "cml-tree-q2",
                  question:
                    "What does a Gini impurity of 0 at a tree node mean?",
                  options: [
                    { id: "cml-tree-q2-a", text: "The node contains an equal mix of all classes" },
                    { id: "cml-tree-q2-b", text: "The node contains samples from only one class (perfectly pure)" },
                    { id: "cml-tree-q2-c", text: "The node has not been split yet" },
                    { id: "cml-tree-q2-d", text: "The feature at this node is unimportant" },
                  ],
                  correctOptionId: "cml-tree-q2-b",
                  explanation:
                    "Gini impurity G = 1 − ∑ pₖ² equals 0 when one class has probability 1 (and all others have 0). This means the node is pure — all samples belong to the same class.",
                },
              ],
            },
            {
              type: "practice",
              title: "Tune Forest Hyperparameters",
              description:
                "Using the dashboard's model catalog, select a Random Forest model and experiment with n_estimators (100, 500, 1000), max_depth (4, 8, 16, None), and min_samples_leaf (5, 20, 50). Compare OOB scores and test accuracy. Which combination gives the best generalization on out-of-sample forex data?",
              catalogModelId: "random-forest-regime",
            },
          ],
        },
      ],
    },
    {
      id: "ensemble",
      title: "Ensemble & Boosting",
      description:
        "Go beyond bagging into sequential boosting methods — XGBoost, LightGBM — and learn proper model validation for time series to avoid the most common pitfalls in trading ML.",
      lessons: [
        {
          id: "cml-boosting",
          title: "Gradient Boosting (XGBoost/LightGBM)",
          description:
            "Understand how gradient boosting builds trees sequentially to correct prior errors, and train an XGBoost model with early stopping on forex data.",
          estimatedMinutes: 55,
          difficulty: "intermediate",
          prerequisites: ["cml-tree-models"],
          sections: [
            {
              type: "objective",
              content:
                "You will understand how Gradient Boosted Decision Trees (GBDT) differ from Random Forests, explain the additive training process where each tree fits the negative gradient of the loss, and implement XGBoost with early stopping on a forex classification task.",
              keyTakeaways: [
                "Boosting trains trees sequentially: each tree corrects the residual errors of the ensemble so far",
                "The update rule is F_{m}(x) = F_{m-1}(x) + η · hₘ(x), where η is the learning rate and hₘ is the new tree",
                "XGBoost adds L2 regularization on leaf weights and uses Newton-Raphson (second-order gradients) for faster convergence",
                "LightGBM grows trees leaf-wise (best-first) instead of level-wise, often reaching lower loss faster",
              ],
            },
            {
              type: "theory",
              title: "Gradient Boosting: Sequential Error Correction",
              content:
                "While Random Forests train trees **independently** on bootstrap samples (bagging), Gradient Boosting trains trees **sequentially**. At step m, the ensemble is Fₘ(x) = Fₘ₋₁(x) + η · hₘ(x), where hₘ is a shallow tree fit to the **negative gradient** of the loss: rᵢₘ = −∂L(yᵢ, Fₘ₋₁(xᵢ)) / ∂Fₘ₋₁(xᵢ). For squared-error loss, these are simply the residuals yᵢ − Fₘ₋₁(xᵢ).\n\n**XGBoost** improves on basic GBDT with: (1) second-order Taylor expansion of the loss (using both gradient gᵢ and Hessian hᵢ), (2) L2 regularization on leaf weights Ω(h) = γT + ½λ∑ⱼwⱼ², (3) column and row subsampling, and (4) built-in handling of missing values.\n\n**LightGBM** grows trees leaf-wise (expanding the leaf with the largest loss reduction) rather than level-wise, and uses histogram-based splitting for O(n) rather than O(n log n) per split. This makes it faster on large datasets while often achieving slightly better accuracy.\n\n**Early stopping** monitors validation loss and halts training when it hasn't improved for `early_stopping_rounds`, preventing overfitting from too many boosting rounds.",
            },
            {
              type: "intuition",
              title: "The Exam Correction Analogy",
              analogy:
                "Boosting is like taking an exam repeatedly, where each retake focuses only on the questions you got wrong before.",
              content:
                "Imagine a student taking a 100-question exam. After the first attempt, they get 30 wrong. For the next attempt, they study *only* those 30 questions. Now they get 10 wrong. The third study session targets just those 10. Each round focuses effort where errors remain — that's boosting. The **learning rate η** controls how much each round's corrections are trusted (a cautious student might not fully adopt new answers). **Early stopping** is like a teacher saying 'stop studying — your score on practice tests hasn't improved in 5 rounds, you're just memorizing the answer key now.' Random Forests, by contrast, are like 500 students all taking the exam independently — wisdom of crowds rather than iterative correction.",
              emoji: "📝",
            },
            {
              type: "code",
              title: "XGBoost with Early Stopping for Forex Classification",
              language: "python",
              code: `import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import accuracy_score, classification_report

# Prepare data
df = pd.read_csv("eurusd_features.csv", parse_dates=["timestamp"])
df["target"] = (df["close"].shift(-1) > df["close"]).astype(int)
df = df.dropna()

feature_cols = ["rsi_14", "macd", "bb_width", "atr_14",
                "adx_14", "cci_20", "stoch_k", "roc_10",
                "volume_ma_ratio", "mom_10"]

# 60/20/20 time-ordered split (train / validation / test)
n = len(df)
X = df[feature_cols].values
y = df["target"].values
X_train, y_train = X[: int(n * 0.6)], y[: int(n * 0.6)]
X_val, y_val = X[int(n * 0.6) : int(n * 0.8)], y[int(n * 0.6) : int(n * 0.8)]
X_test, y_test = X[int(n * 0.8) :], y[int(n * 0.8) :]

# Train XGBoost with early stopping
model = xgb.XGBClassifier(
    n_estimators=1000,          # max rounds (early stopping will cut)
    max_depth=5,
    learning_rate=0.05,         # η — small for better generalization
    subsample=0.8,              # row subsampling per tree
    colsample_bytree=0.8,      # column subsampling per tree
    reg_lambda=1.0,             # L2 regularization on leaf weights
    reg_alpha=0.1,              # L1 regularization on leaf weights
    eval_metric="logloss",
    early_stopping_rounds=30,
    random_state=42,
    n_jobs=-1,
)
model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=50)

print(f"\\nBest iteration: {model.best_iteration}")
print(f"Test Accuracy:  {accuracy_score(y_test, model.predict(X_test)):.4f}\\n")
print(classification_report(y_test, model.predict(X_test),
                            target_names=["Down", "Up"]))`,
              explanation:
                "We use a three-way time-ordered split: training, validation (for early stopping), and test (for final evaluation). XGBoost trains up to 1000 rounds but stops if validation logloss doesn't improve for 30 consecutive rounds. The small learning rate η = 0.05 combined with early stopping typically yields better generalization than a large η with fewer rounds. Subsample and colsample_bytree add further regularization.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "cml-boost-q1",
                  question:
                    "What is the fundamental difference between bagging (Random Forest) and boosting (XGBoost)?",
                  options: [
                    { id: "cml-boost-q1-a", text: "Bagging uses trees and boosting uses linear models" },
                    { id: "cml-boost-q1-b", text: "Bagging trains trees independently in parallel; boosting trains them sequentially, each correcting prior errors" },
                    { id: "cml-boost-q1-c", text: "Boosting always achieves higher accuracy than bagging" },
                    { id: "cml-boost-q1-d", text: "Bagging requires a validation set but boosting does not" },
                  ],
                  correctOptionId: "cml-boost-q1-b",
                  explanation:
                    "Bagging trains each tree independently on a bootstrap sample (reducting variance via averaging). Boosting trains trees sequentially — each new tree fits the negative gradient (errors) of the current ensemble, directly reducing bias.",
                },
                {
                  id: "cml-boost-q2",
                  question:
                    "What does early stopping prevent in gradient boosting?",
                  options: [
                    { id: "cml-boost-q2-a", text: "Underfitting due to insufficient trees" },
                    { id: "cml-boost-q2-b", text: "Overfitting by halting training when validation performance stops improving" },
                    { id: "cml-boost-q2-c", text: "The learning rate from decreasing" },
                    { id: "cml-boost-q2-d", text: "Feature importance from being computed" },
                  ],
                  correctOptionId: "cml-boost-q2-b",
                  explanation:
                    "Early stopping monitors a held-out validation set. When the validation metric hasn't improved for a specified number of rounds, training halts. This prevents the model from continuing to reduce training loss at the expense of overfitting to training data noise.",
                },
              ],
            },
            {
              type: "practice",
              title: "XGBoost vs LightGBM Comparison",
              description:
                "Train both an XGBoost and LightGBM model on the same forex dataset with equivalent hyperparameters. Compare training speed, final validation loss, test accuracy, and feature importance rankings. Use the dashboard's model comparison view to visualize the differences.",
              catalogModelId: "xgboost-direction",
            },
          ],
        },
        {
          id: "cml-model-selection",
          title: "Model Selection & Validation",
          description:
            "Learn the critical pitfalls of cross-validation for time series, implement walk-forward validation and purged CV, and understand the bias-variance tradeoff in the context of trading models.",
          estimatedMinutes: 50,
          difficulty: "intermediate",
          prerequisites: ["cml-linear-models"],
          sections: [
            {
              type: "objective",
              content:
                "You will understand why standard k-fold cross-validation fails for time series data, implement walk-forward and purged cross-validation, and diagnose overfitting vs. underfitting using the bias-variance decomposition.",
              keyTakeaways: [
                "Standard k-fold CV shuffles data and leaks future information — never use it for time series",
                "TimeSeriesSplit provides expanding-window walk-forward validation respecting temporal order",
                "Purged CV adds an embargo gap between train and test to prevent information leakage from overlapping targets",
                "High bias = underfitting (model too simple); high variance = overfitting (model too complex)",
              ],
            },
            {
              type: "theory",
              title: "Walk-Forward & Purged Cross-Validation",
              content:
                "**Standard k-fold CV** randomly partitions data into k subsets and trains on k−1 folds. For i.i.d. data this is valid, but time series have **autocorrelation** and **temporal ordering**: randomly placing future data in the training set causes **look-ahead bias**, inflating metrics by 5–30%.\n\n**Walk-forward validation** (TimeSeriesSplit) uses expanding or sliding windows: fold 1 trains on [1, T₁] and tests on (T₁, T₂]; fold 2 trains on [1, T₂] and tests on (T₂, T₃]; etc. This mimics real-world deployment where models are retrained periodically.\n\n**Purged CV** goes further: if the target yₜ depends on returns over [t, t+h], then test samples near the train/test boundary have targets that overlap with training data. Purging removes an **embargo** window of h bars after each training fold to prevent this leakage.\n\nThe **bias-variance tradeoff** states: E[(y − ŷ)²] = Bias² + Variance + σ²_noise. Bias measures systematic error (underfitting); variance measures sensitivity to training data (overfitting). Walk-forward CV reveals this: if train accuracy >> test accuracy across folds, the model has high variance.",
            },
            {
              type: "intuition",
              title: "The Newspaper Archive Analogy",
              analogy:
                "Walk-forward CV is like predicting tomorrow's headlines using only past newspapers.",
              content:
                "Imagine predicting tomorrow's newspaper headline. **Standard k-fold** lets you peek at random pages from the entire archive, including next week's papers — of course your predictions are great! **Walk-forward** only lets you read papers up to yesterday. Each 'fold' advances the date: first you predict January headlines using December's data, then February using December–January, and so on. **Purged CV** goes further: it also removes the last few days before each prediction, because if today's headline says 'Market rally continues', that leaks information about yesterday. The embargo gap ensures your training data contains no hints about the test period.",
              emoji: "📰",
            },
            {
              type: "code",
              title: "Walk-Forward Validation with TimeSeriesSplit",
              language: "python",
              code: `import numpy as np
import pandas as pd
from sklearn.model_selection import TimeSeriesSplit
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score

# Load data
df = pd.read_csv("eurusd_features.csv", parse_dates=["timestamp"])
df["target"] = (df["close"].shift(-1) > df["close"]).astype(int)
df = df.dropna()

feature_cols = ["rsi_14", "macd", "bb_width", "atr_14",
                "adx_14", "cci_20", "stoch_k", "roc_10"]
X = df[feature_cols].values
y = df["target"].values

# Walk-forward CV with 5 expanding-window splits
tscv = TimeSeriesSplit(n_splits=5)
embargo = 24  # purge 24 bars (1 day for hourly data) after each train fold

fold_results = []
for fold, (train_idx, test_idx) in enumerate(tscv.split(X)):
    # Purge: remove last 'embargo' samples from training set
    train_idx_purged = train_idx[:-embargo] if len(train_idx) > embargo else train_idx

    X_train, y_train = X[train_idx_purged], y[train_idx_purged]
    X_test, y_test = X[test_idx], y[test_idx]

    model = RandomForestClassifier(
        n_estimators=200, max_depth=6, min_samples_leaf=20,
        random_state=42, n_jobs=-1,
    )
    model.fit(X_train, y_train)

    train_acc = accuracy_score(y_train, model.predict(X_train))
    test_acc = accuracy_score(y_test, model.predict(X_test))
    fold_results.append({"fold": fold + 1, "train_acc": train_acc, "test_acc": test_acc})
    print(f"Fold {fold+1}: train={train_acc:.4f}  test={test_acc:.4f}  "
          f"gap={train_acc - test_acc:.4f}  train_n={len(train_idx_purged)}  test_n={len(test_idx)}")

results = pd.DataFrame(fold_results)
print(f"\\nMean Test Accuracy: {results['test_acc'].mean():.4f} ± {results['test_acc'].std():.4f}")
print(f"Mean Train-Test Gap: {(results['train_acc'] - results['test_acc']).mean():.4f}")
print("→ Large gap indicates overfitting (high variance)")`,
              explanation:
                "TimeSeriesSplit creates expanding training windows that respect temporal order. We add a 24-bar embargo (purge) to prevent target leakage at fold boundaries. The train–test accuracy gap across folds diagnoses overfitting: a gap > 5% suggests the model is memorizing training patterns. The mean and standard deviation of test accuracy across folds indicate both expected performance and stability.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "cml-val-q1",
                  question:
                    "A model shows 92% train accuracy and 51% test accuracy in walk-forward CV. What does this indicate?",
                  options: [
                    { id: "cml-val-q1-a", text: "The model is underfitting — increase complexity" },
                    { id: "cml-val-q1-b", text: "The model is overfitting — reduce complexity or add regularization" },
                    { id: "cml-val-q1-c", text: "The data has no predictive signal at all" },
                    { id: "cml-val-q1-d", text: "The walk-forward split is too small" },
                  ],
                  correctOptionId: "cml-val-q1-b",
                  explanation:
                    "A 41% gap between train and test accuracy is a classic high-variance (overfitting) signal. The model memorizes training noise rather than learning generalizable patterns. Solutions include reducing tree depth, increasing min_samples_leaf, adding regularization, or simplifying the feature set.",
                },
                {
                  id: "cml-val-q2",
                  question:
                    "Why is an embargo (purge) gap needed between training and test sets in purged CV?",
                  options: [
                    { id: "cml-val-q2-a", text: "To make training faster by using less data" },
                    { id: "cml-val-q2-b", text: "To prevent information leakage when targets span multiple bars, ensuring train labels don't contain test-period information" },
                    { id: "cml-val-q2-c", text: "To ensure the test set is always larger than the train set" },
                    { id: "cml-val-q2-d", text: "To randomize the temporal ordering of samples" },
                  ],
                  correctOptionId: "cml-val-q2-b",
                  explanation:
                    "When targets like 'forward return over next 24 hours' span multiple bars, the last training samples' targets overlap with the test period's price action. The embargo removes these ambiguous samples, ensuring a clean separation between what the model learns and what it's tested on.",
                },
              ],
            },
            {
              type: "practice",
              title: "Diagnose Your Model's Bias-Variance Profile",
              description:
                "Pick any model from the dashboard catalog and run walk-forward CV with 5 and 10 folds. Compare the mean train/test gap. Then try varying model complexity (e.g., max_depth from 2 to 20) and plot the train accuracy vs. test accuracy curves to identify the sweet spot where the gap is small and test accuracy is maximized.",
            },
          ],
        },
      ],
    },
  ],
};
