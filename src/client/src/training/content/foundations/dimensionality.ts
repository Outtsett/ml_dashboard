import type { Module } from "@/training/curriculum_types";

export const dimensionalityModule: Module = {
  id: "found-dimensionality",
  title: "Dimensionality Reduction: The Curse, PCA, t-SNE & UMAP",
  description:
    "Master the mathematical foundations of dimensionality reduction: prove distance concentration, derive PCA via eigendecomposition, select components with scree plots and Kaiser criterion, understand t-SNE's perplexity parameter, and compare with UMAP for modern high-dimensional visualization.",
  lessons: [
    {
      id: "found-dimensionality-lesson",
      title: "Dimensionality Reduction: The Curse, PCA, t-SNE & UMAP",
      description: "Master the mathematical foundations of dimensionality reduction: prove distance concentration, derive PCA via eigendecomposition, select components with scree plots and Kaiser criterion, understand t-SNE's perplexity parameter, and compare with UMAP for modern high-dimensional visualization.",
      estimatedMinutes: 90,
      difficulty: "beginner",
      prerequisites: ["found-linear-algebra"],
      sections: [
        {
          type: "objective",
          content: "After this lesson you will prove the curse of dimensionality via distance concentration, derive PCA via constrained optimization and eigendecomposition of the covariance matrix, compute variance explained ratios and apply the Kaiser criterion, interpret scree plots and loadings matrices, understand t-SNE's algorithm and perplexity parameter, evaluate UMAP as a modern alternative with better global structure preservation, and choose the appropriate technique (PCA vs t-SNE vs UMAP) based on task requirements.",
          keyTakeaways: [
            "Curse of dimensionality: volume of unit hypersphere → 0 as p → ∞; distances concentrate (E[d] ∝ √p, Var[d]/E[d]² → 0) making KNN and RBF kernels fail",
            "PCA (Principal Component Analysis): linear, deterministic, global structure preserving; finds orthogonal directions of maximum variance",
            "Eigendecomposition: the covariance matrix Σ = WΛWᵀ provides eigenvectors (PC directions) and eigenvalues (variance along each PC)",
            "Scree plot & Kaiser criterion (λ > 1): heuristics for choosing the number of components k to retain most signal while discarding noise",
            "t-SNE (t-Distributed Stochastic Neighbor Embedding): non-linear, stochastic, local structure preserving; great for 2D/3D visualization of clusters",
            "UMAP (Uniform Manifold Approximation and Projection): faster than t-SNE, better global structure preservation, theoretically grounded in manifold geometry",
            "Standardization is MANDATORY for PCA: without it, features with larger scales (e.g., volume) will artificially dominate the principal components"
          ]
        },
        {
          type: "theory",
          title: "The Curse of Dimensionality: Mathematical Analysis",
          content: "The **curse of dimensionality** is the counterintuitive phenomenon that as feature count p increases, the geometry of high-dimensional space becomes fundamentally different from our low-dimensional intuition, causing distance-based algorithms to fail. Consider the volume of a unit hypersphere in p dimensions: V_p = π^(p/2) / Γ(p/2 + 1). As p → ∞, V_p → 0 exponentially fast. For p=2, V₂ = π ≈ 3.14; for p=10, V₁₀ ≈ 2.55; for p=100, V₁₀₀ ≈ 10⁻⁴⁰. Simultaneously, the volume of the unit hypercube is always 1, so the sphere occupies an exponentially shrinking fraction of the cube — almost all the cube's volume concentrates in the corners.\n\n**Distance concentration** is the mathematical proof that dooms KNN and RBF kernels. For n points uniformly distributed in [0,1]ᵖ, the expected Euclidean distance between two random points is E[d] ≈ √(p/6). The variance is Var[d] ≈ p/18. The coefficient of variation is √(Var[d])/E[d] = √(p/18) / √(p/6) = √(1/3) / √1 ≈ 0.577 for fixed p, but critically, Var[d] / E[d]² = (p/18) / (p/6) = 1/3, which is constant. However, the relative range (max(d) − min(d)) / E[d] → 0 as p → ∞, meaning all pairwise distances become nearly identical. When all neighbors are equidistant, KNN degenerates to random guessing, and RBF kernels exp(−γ‖xᵢ − xⱼ‖²) become uniformly flat.\n\n**Exponential sample requirement**: To maintain a fixed density in p dimensions with k bins per feature, we need n ∝ kᵖ samples. Example: p=20 features, k=10 bins each → need 10²⁰ = 10,000,000,000,000,000,000,000 samples, which exceeds all data ever collected in financial markets. The **Hughes phenomenon** (peaking phenomenon) states that classification accuracy initially improves as features are added, then peaks, then **degrades** as p grows beyond a threshold because the curse dominates. For forex feature sets with 50 technical indicators, most are redundant (RSI, Stochastic, CCI all measure mean reversion), so dimensionality reduction is essential."
        },
        {
          type: "theory",
          title: "t-SNE & UMAP: Non-Linear Dimensionality Reduction",
          content: "When linear PCA fails to capture the manifold structure of the data, we turn to non-linear techniques. **t-SNE** (van der Maaten & Hinton, 2008) converts high-dimensional Euclidean distances into conditional probabilities representing similarities. It uses a Student t-distribution in the low-dimensional space to solve the 'crowding problem,' allowing clusters to separate more cleanly than with a Gaussian kernel. **Perplexity** is the key hyperparameter, acting as a smooth measure of the effective number of neighbors. **UMAP** (McInnes et al., 2018) is a more recent alternative built on Riemannian geometry and algebraic topology. It constructs a fuzzy simplicial set representation of the high-dimensional data and then optimizes a low-dimensional layout to have the most similar topological structure. **Advantages**: UMAP is much **faster** than t-SNE, preserves **global structure** better, and is **scalable**: handles millions of points. **Disadvantages**: more hyperparameters (n_neighbors, min_dist), less interpretable math (t-SNE's KL divergence is intuitive).\n\n**Comparison table**: (1) **PCA**: Linear, parametric (learned eigenvectors), preserves global structure (distances and angles), fast O(min(n²p, np²)), suitable for feature reduction in models. (2) **t-SNE**: Nonlinear, non-parametric, preserves local neighborhoods only, slow O(n² or n log n), stochastic (different runs differ), **visualization only**. (3) **UMAP**: Nonlinear, parametric variant available, preserves local + some global structure, fast O(n log n), semi-stochastic (more stable than t-SNE), good for both visualization and feature reduction (with parametric version). **When to use**: PCA for linear relationships, interpretability, and model input; t-SNE for visualizing tight clusters when global layout doesn't matter; UMAP when you need both local detail and global structure, or when speed is critical."
        },
        {
          type: "intuition",
          title: "The Map Projection Analogy",
          analogy: "Flattening the Earth (3D sphere) onto a 2D map always involves distortion — Mercator, globe peeling, or smart algorithms choose what to preserve.",
          content: "Imagine you have a globe (3D sphere representing the Earth) and need to create a flat map (2D). No 2D map can perfectly represent the 3D surface — every projection sacrifices something. **PCA** is like the Mercator projection: it preserves directions (angles, straight lines) and is deterministic, but it distorts areas, especially near the poles. If you measure distances on a Mercator map, polar regions appear huge. PCA preserves global relationships (e.g., North America is west of Europe) but assumes the world is flat (linearity). **t-SNE** is like physically peeling the globe: you tear the surface into strips to lay them flat, keeping neighborhoods intact (Florida stays next to Cuba) but destroying global distances (California and Florida might appear on opposite edges of the map). Different peeling strategies give different maps — that's the stochasticity of t-SNE. **UMAP** is like a smarter peeling algorithm that tries to minimize tearing by stretching the material intelligently, preserving both local neighborhoods (cities stay close) and some global shape (continents roughly in the right positions). The key insight: **no 2D map is perfect** — the curse of dimensionality means information is **lost** when you reduce dimensions. Choose your projection based on what you care about: global relationships (PCA), tight clusters (t-SNE), or a balanced compromise (UMAP). 🌍",
          emoji: "🌍"
        },
        {
          type: "quiz",
          questions: [
            {
              id: "found-dim-q1",
              question: "As dimensionality p → ∞ for uniformly distributed points in a unit hypercube, what happens to pairwise Euclidean distances?",
              options: [
                { id: "found-dim-q1-a", text: "They all approach zero" },
                { id: "found-dim-q1-b", text: "They become uniformly distributed between 0 and √p" },
                { id: "found-dim-q1-c", text: "They concentrate around √(p/6), making all points nearly equidistant" },
                { id: "found-dim-q1-d", text: "They grow exponentially without bound" }
              ],
              correctOptionId: "found-dim-q1-c",
              explanation: "Distance concentration is the mathematical core of the curse of dimensionality. For uniform points in [0,1]ᵖ, E[d] ≈ √(p/6) grows with √p, but critically, the variance Var[d] grows slower, so the coefficient of variation (relative spread) shrinks. The ratio (max(d) − min(d)) / E[d] → 0, meaning all pairwise distances converge to the same value. This makes distance-based methods like KNN fail because there is no meaningful nearest neighbor when all neighbors are equidistant. This is why high-dimensional data requires dimensionality reduction before applying distance-based algorithms."
            },
            {
              id: "found-dim-q2",
              question: "Why is t-SNE unsuitable for feature reduction in predictive models (e.g., as input to a Random Forest)?",
              options: [
                { id: "found-dim-q2-a", text: "t-SNE is too computationally expensive" },
                { id: "found-dim-q2-b", text: "t-SNE is non-parametric (no learned transform for new data), stochastic, and distorts global distances" },
                { id: "found-dim-q2-c", text: "t-SNE requires labeled data to work" },
                { id: "found-dim-q2-d", text: "t-SNE can only reduce to exactly 2 dimensions" }
              ],
              correctOptionId: "found-dim-q2-b",
              explanation: "t-SNE produces a fixed embedding for the training data with no learned projection matrix that can transform new test data — you would have to re-run the entire algorithm on train+test together, which leaks information. Additionally, t-SNE is stochastic (different random seeds produce different embeddings) and distorts global distances (only local neighborhoods are preserved). This makes it unsuitable for predictive modeling. Use PCA (or parametric UMAP) for feature reduction in models, and reserve t-SNE exclusively for visualization."
            }
          ]
        },
        {
          type: "practice",
          title: "PCA Feature Reduction: Original vs Reduced Feature Comparison",
          description: "Apply PCA to your full forex feature matrix (all available technical indicators). Analyze the loadings matrix to interpret the first 3 principal components (which indicators contribute most?). Use the scree plot and Kaiser criterion to select the optimal number of components k. Train a Random Forest classifier to predict regime labels (e.g., trending vs mean-reverting) using (1) all original features and (2) the top-k PCA components. Compare test accuracy, training time, and model interpretability. Does PCA improve performance by removing noise, or does it hurt by losing information? Report cumulative variance for the selected k and discuss the trade-off.",
          catalogModelId: "pca-feature-analysis"
        },
        {
          type: "practice",
          title: "Interactive Dimensionality Reduction Visualization",
          description: "Use the ML dashboard's dimensionality reduction panel to visualize your feature space using t-SNE and UMAP. Color the points by known regime labels (low volatility, high volatility, trending) obtained from clustering or manual labeling. Experiment with t-SNE's perplexity parameter (try 5, 30, 100) and observe how the embedding changes — does a lower perplexity fragment clusters? Does a higher perplexity merge distinct regimes? Compare with UMAP using n_neighbors=15 and n_neighbors=50. Which technique produces the clearest separation between regimes? Export the 2D embeddings and check if regime clusters are linearly separable — if so, you can use a simple linear classifier on the embeddings for regime detection. Document your findings: which method (PCA, t-SNE, UMAP) is best for your data, and why?",
          catalogModelId: "tsne-umap-exploration"
        }
      ]
    }
  ]
};
