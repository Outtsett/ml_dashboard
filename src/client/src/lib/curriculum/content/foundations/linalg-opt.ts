import type { Module } from "../../types";

export const linalgOptModule: Module = {
      id: "linalg-opt",
      title: "Linear Algebra & Optimization",
      description:
        "Learn the linear algebra and optimization concepts that power every ML algorithm â€” from PCA for feature reduction to gradient descent for model training.",
      lessons: [
        {
          id: "found-linear-algebra",
          title: "Linear Algebra for ML",
          description:
            "Master the mathematical foundations of machine learning: matrices as data, eigendecomposition, SVD, covariance matrices, condition numbers, and PCA â€” with complete derivations and numerical examples from forex trading.",
          estimatedMinutes: 90,
          difficulty: "beginner",
          sections: [
            {
              type: "objective",
              content:
                "After completing this lesson you will understand how matrices encode datasets, derive eigendecomposition step-by-step, construct covariance matrices and prove their properties, decompose matrices via SVD, analyze numerical stability with condition numbers, and apply PCA to reduce high-dimensional technical indicator sets while preserving variance.",
              keyTakeaways: [
                "A dataset of n samples with p features is an n Ã— p matrix X âˆˆ â„â¿Ë£áµ–; matrix multiplication (AB)áµ¢â±¼ = Î£â‚– Aáµ¢â‚– Bâ‚–â±¼ represents linear transformations and weighted combinations",
                "The dot product aÂ·b = Î£áµ¢ aáµ¢báµ¢ = â€–aâ€–â€–bâ€–cos(Î¸) measures similarity; covariance matrix Î£ = (1/(n-1))XÌƒáµ€XÌƒ is symmetric and positive semi-definite (PSD)",
                "Eigendecomposition: Av = Î»v solved via det(A - Î»I) = 0; symmetric matrices have real eigenvalues and orthogonal eigenvectors; eigenvectors of Î£ are principal components",
                "SVD decomposes A = UÎ£Váµ€; singular values Ïƒáµ¢ = âˆšÎ»áµ¢(Aáµ€A); right singular vectors V are PCA components; condition number Îº(A) = Ïƒ_max/Ïƒ_min quantifies numerical stability",
                "Matrix inverse Aâ»Â¹ exists iff det(A) â‰  0; pseudo-inverse Aâº = VÎ£âºUáµ€ via SVD handles non-square or rank-deficient matrices",
                "High condition number (Îº >> 1) indicates ill-conditioning: small input changes â†’ large output changes; multicollinear features cause unstable regression",
                "PCA projects X onto top-k eigenvectors of covariance matrix: Z = XVâ‚–; variance retained = Î£áµ¢â‚Œâ‚áµ Î»áµ¢ / Î£áµ¢â‚Œâ‚áµ– Î»áµ¢",
                "Standardization (zero mean, unit variance) is essential before PCA to prevent features with large scales from dominating variance",
              ],
            },
            {
              type: "theory",
              title: "Vectors, Matrices & the Dot Product",
              content:
                "A **vector** in â„â¿ represents a point or direction in n-dimensional space. In ML, a feature vector x âˆˆ â„áµ– encodes p measurements: for a forex trading bar, x might be [RSI, MACD, ATR, volume]. A **matrix** X âˆˆ â„â¿Ë£áµ– stacks n such vectors as rows, representing n samples with p features.\n\nThe **dot product** (inner product) of two vectors a, b âˆˆ â„â¿ is aÂ·b = Î£áµ¢â‚Œâ‚â¿ aáµ¢báµ¢. Geometrically, aÂ·b = â€–aâ€–â€–bâ€–cos(Î¸), where Î¸ is the angle between them. **Derivation**: If a = â€–aâ€–Ã» and b = â€–bâ€–vÌ‚ (decomposed into magnitude Ã— unit vector), then aÂ·b = â€–aâ€–â€–bâ€–(Ã»Â·vÌ‚). For unit vectors, Ã»Â·vÌ‚ = cos(Î¸) by definition of angle in â„â¿. Thus, aÂ·b measures **similarity**: parallel vectors (Î¸ = 0) yield maximum dot product â€–aâ€–â€–bâ€–; orthogonal vectors (Î¸ = 90Â°) yield zero.\n\n**Matrix multiplication**: (AB)áµ¢â±¼ = Î£â‚– Aáµ¢â‚– Bâ‚–â±¼ is the dot product of row i of A with column j of B. Interpretation 1: **linear transformation** â€” multiplying vector x by matrix W transforms it to Wx = new coordinates. Interpretation 2: **weighted combination** â€” if W is a weight matrix and x is a feature vector, Wx computes weighted sums of features. **Numerical example**: Consider 3 trading bars Ã— 4 features: X = [[65, 0.003, 0.0045, 15000], [72, 0.008, 0.0038, 18500], [58, -0.002, 0.0052, 12000]] (RSI, MACD, ATR, volume). Weight vector w = [0.4, 0.3, 0.2, 0.1]. Row 1: Xw = 65(0.4) + 0.003(0.3) + 0.0045(0.2) + 15000(0.1) = 26 + 0.0009 + 0.0009 + 1500 = 1526.0018 â‰ˆ 1526.00. Similarly compute rows 2 and 3 to get a 3Ã—1 output vector.",
            },
            {
              type: "theory",
              title: "The Covariance Matrix & Its Properties",
              content:
                "The **covariance matrix** Î£ âˆˆ â„áµ–Ë£áµ– summarizes pairwise linear relationships between p features. **Construction**: Given n samples X âˆˆ â„â¿Ë£áµ–, center each feature by subtracting its mean: XÌƒ = X - Î¼ where Î¼ = (1/n)Î£áµ¢ Xáµ¢ (row-wise mean). Then Î£ = (1/(n-1)) XÌƒáµ€XÌƒ. The (i,j)-th entry is the sample covariance between features i and j.\n\n**Proof that Î£ is symmetric**: Î£áµ€ = [(1/(n-1)) XÌƒáµ€XÌƒ]áµ€ = (1/(n-1)) (XÌƒáµ€XÌƒ)áµ€ = (1/(n-1)) XÌƒáµ€(XÌƒáµ€)áµ€ = (1/(n-1)) XÌƒáµ€XÌƒ = Î£. (We used (AB)áµ€ = Báµ€Aáµ€ and (Aáµ€)áµ€ = A.)\n\n**Proof that Î£ is positive semi-definite (PSD)**: A matrix A is PSD if for any vector v, váµ€Av â‰¥ 0. Let v âˆˆ â„áµ– be arbitrary. Then váµ€Î£v = váµ€[(1/(n-1)) XÌƒáµ€XÌƒ]v = (1/(n-1)) váµ€XÌƒáµ€XÌƒv = (1/(n-1)) (XÌƒv)áµ€(XÌƒv) = (1/(n-1)) â€–XÌƒvâ€–Â² â‰¥ 0. (The norm squared is always non-negative.) Thus Î£ is PSD.\n\n**Diagonal and off-diagonal**: Î£áµ¢áµ¢ = Var(feature i); Î£áµ¢â±¼ = Cov(feature i, feature j). **Numerical example**: Two features, RSI and MACD, with 4 samples (centered): XÌƒ = [[5, 0.002], [-3, -0.001], [2, 0.003], [-4, -0.004]]. Compute Î£â‚â‚ = (1/3)[5Â² + (-3)Â² + 2Â² + (-4)Â²] = (1/3)[25 + 9 + 4 + 16] = 54/3 = 18.00. Î£â‚â‚‚ = Î£â‚‚â‚ = (1/3)[5(0.002) + (-3)(-0.001) + 2(0.003) + (-4)(-0.004)] = (1/3)[0.01 + 0.003 + 0.006 + 0.016] = 0.035/3 â‰ˆ 0.0117. Î£â‚‚â‚‚ = (1/3)[0.002Â² + 0.001Â² + 0.003Â² + 0.004Â²] = (1/3)[0.000004 + 0.000001 + 0.000009 + 0.000016] = 0.00003/3 = 0.00001. So Î£ = [[18.00, 0.0117], [0.0117, 0.00001]].",
            },
            {
              type: "theory",
              title: "Eigendecomposition: Step-by-Step Derivation",
              content:
                "An **eigenvector** v of matrix A satisfies Av = Î»v for some scalar **eigenvalue** Î». Rearranging: Av - Î»v = 0 âŸ¹ (A - Î»I)v = 0. For a non-trivial solution (v â‰  0), the matrix (A - Î»I) must be singular (non-invertible), so **det(A - Î»I) = 0**. This is the **characteristic polynomial**.\n\n**Complete 2Ã—2 example**: Let A = [[5, 2], [2, 2]]. Compute A - Î»I = [[5-Î», 2], [2, 2-Î»]]. Determinant: (5-Î»)(2-Î») - 2Â·2 = 10 - 5Î» - 2Î» + Î»Â² - 4 = Î»Â² - 7Î» + 6 = 0. Factor: (Î» - 6)(Î» - 1) = 0 âŸ¹ Î»â‚ = 6, Î»â‚‚ = 1. **Find eigenvectors**: For Î»â‚ = 6: (A - 6I)v = 0 âŸ¹ [[-1, 2], [2, -4]]v = 0. Row 2 is -2Ã—Row 1, so one equation: -vâ‚ + 2vâ‚‚ = 0 âŸ¹ vâ‚ = 2vâ‚‚. Choose vâ‚‚ = 1 âŸ¹ vâ‚ = [2, 1]áµ€ (unnormalized). For Î»â‚‚ = 1: (A - I)v = 0 âŸ¹ [[4, 2], [2, 1]]v = 0. Row 2 is (1/2)Ã—Row 1: 4vâ‚ + 2vâ‚‚ = 0 âŸ¹ vâ‚‚ = -2vâ‚. Choose vâ‚ = 1 âŸ¹ vâ‚‚ = [1, -2]áµ€. Normalize: vÌ‚â‚ = [2/âˆš5, 1/âˆš5], vÌ‚â‚‚ = [1/âˆš5, -2/âˆš5]. Verify orthogonality: vÌ‚â‚Â·vÌ‚â‚‚ = 2/5 - 2/5 = 0 âœ“.\n\n**Properties of symmetric matrices**: All real symmetric matrices have (1) real eigenvalues and (2) orthogonal eigenvectors. **Eigendecomposition**: A = VÎ›Váµ€ where V = [vâ‚, â€¦, vâ‚š] (eigenvectors as columns, orthonormal so Váµ€V = I) and Î› = diag(Î»â‚, â€¦, Î»â‚š). For our example: V = [[2/âˆš5, 1/âˆš5], [1/âˆš5, -2/âˆš5]], Î› = [[6, 0], [0, 1]]. Verify: VÎ›Váµ€ = A (left to reader).\n\n**Connection to PCA**: The covariance matrix Î£ is symmetric and PSD, so its eigenvectors are orthogonal and eigenvalues non-negative. The eigenvector with largest eigenvalue points in the direction of maximum variance. **PCA** = project data onto the top-k eigenvectors (principal components) to maximize retained variance.",
            },
            {
              type: "theory",
              title: "SVD, Condition Number & Numerical Stability",
              content:
                "The **Singular Value Decomposition (SVD)** factorizes any matrix A âˆˆ â„áµË£â¿ as A = UÎ£Váµ€, where U âˆˆ â„áµË£áµ is an orthogonal matrix of **left singular vectors**, Î£ âˆˆ â„áµË£â¿ is a diagonal matrix of **singular values** Ïƒâ‚ â‰¥ Ïƒâ‚‚ â‰¥ â€¦ â‰¥ Ïƒ_min â‰¥ 0, and V âˆˆ â„â¿Ë£â¿ is an orthogonal matrix of **right singular vectors**. Unlike eigendecomposition (requires square matrix), SVD works for any rectangular matrix.\n\n**Relationship to eigendecomposition**: The singular values of A are Ïƒáµ¢ = âˆšÎ»áµ¢(Aáµ€A) = âˆšÎ»áµ¢(AAáµ€). The right singular vectors V are eigenvectors of Aáµ€A, and left singular vectors U are eigenvectors of AAáµ€. **PCA connection**: For centered data matrix X âˆˆ â„â¿Ë£áµ–, the covariance Î£ = (1/(n-1))Xáµ€X. If X = UÎ£_xVáµ€, then Xáµ€X = VÎ£_xÂ²Váµ€ (using orthogonality of U). Thus, the right singular vectors V of X are the eigenvectors of the covariance matrix â€” precisely the principal components.\n\n**Condition number**: Îº(A) = Ïƒ_max / Ïƒ_min. A high condition number (Îº >> 1) means A is **ill-conditioned**: small changes in input cause large changes in output. **Numerical stability**: When solving Ax = b, if Îº is large, rounding errors in floating-point arithmetic are amplified, producing unreliable solutions. For instance, if Îº = 10â¶ and input has 16-digit precision, output may have only 10 accurate digits.\n\n**Pseudo-inverse**: For singular or non-square A, the ordinary inverse Aâ»Â¹ doesn't exist. The **Moore-Penrose pseudo-inverse** Aâº generalizes inversion: Aâº = VÎ£âºUáµ€, where Î£âº is formed by inverting non-zero singular values (Î£âºáµ¢áµ¢ = 1/Ïƒáµ¢ if Ïƒáµ¢ > 0, else 0). The solution x = Aâºb minimizes â€–Ax - bâ€–Â².\n\n**Financial relevance**: In forex, many technical indicators are **multicollinear** (e.g., RSI and Stochastic %K both measure momentum). This produces a nearly singular covariance matrix with very small eigenvalues, yielding high condition number. Fitting a regression model Î² = (Xáµ€X)â»Â¹Xáµ€y becomes unstable: small data perturbations drastically change Î². PCA mitigates this by discarding low-variance (small eigenvalue) directions, effectively regularizing the problem.",
            },
            {
              type: "intuition",
              title: "The Shadow Analogy",
              analogy:
                "PCA is like finding the best angle to cast a shadow of a 3D object onto a wall â€” the angle that preserves the most detail.",
              content:
                "Imagine a complex 3D sculpture (your high-dimensional data). You shine a flashlight at it and observe the 2D shadow on the wall. Most angles produce a blob, but there's **one specific angle** where the shadow preserves the sculpture's shape best â€” that's your first principal component. Rotating the flashlight 90Â° (orthogonal) gives the second-best shadow. PCA finds these optimal 'flashlight angles' automatically by solving an eigenvalue problem. The **eigenvalue** for each angle tells you how much detail (variance) that shadow captures. If the sculpture is really just a thin wire coiled in 3D space, one shadow might capture 95% of the information, and the other two shadows add little â€” PCA would recommend keeping just the first component. **SVD** is a more general decomposition: it works even if your 'sculpture' is a morphing object (non-square matrix) or has collapsing dimensions. **Condition number** measures how sensitive the shadow is to slight changes in flashlight position: if Îº is high, nudging the light a tiny bit drastically alters the shadow, making measurements unreliable.",
              emoji: "ðŸ”¦",
            },
            {
              type: "intuition",
              title: "The Orchestra Analogy",
              analogy:
                "Eigenvectors are independent instruments; eigenvalues are their volumes.",
              content:
                "Imagine a symphony recording (your data). **Eigenvectors** are the independent 'instruments' (violin, cello, trumpet, etc.) that combine to produce the full sound. **Eigenvalues** measure how loud each instrument plays. The first instrument (largest eigenvalue) dominates the recording; the last instrument (smallest eigenvalue) is barely audible. **PCA** = keeping only the loudest instruments and muting the quiet ones. You retain 95% of the sound with, say, 5 instruments instead of 20. **SVD** decomposes the recording into (1) the instruments (right singular vectors V), (2) their volumes (singular values Î£), and (3) the mixing pattern over time (left singular vectors U). **Condition number**: If one instrument is so quiet it's drowned out by background noise (Ïƒ_min â‰ˆ 0), removing it changes the music almost imperceptibly, but trying to isolate it amplifies noise and becomes numerically unstable. In trading, 'quiet instruments' are redundant indicators that add noise but no signal â€” PCA discards them.",
              emoji: "ðŸŽ»",
            },
            {
              type: "code",
              title: "Matrix Operations & Covariance Matrix from Scratch",
              language: "python",
              code: `import numpy as np
import pandas as pd

# Create feature matrix from 5 forex trading bars with 4 indicators
# Columns: RSI_14, MACD, ATR_14, Volume
X = np.array([
    [65.2, 0.0034, 0.0045, 15000],
    [72.8, 0.0081, 0.0038, 18500],
    [58.1, -0.0021, 0.0052, 12000],
    [61.5, 0.0012, 0.0048, 14200],
    [69.3, 0.0065, 0.0041, 17100],
])
n, p = X.shape
print(f"Feature matrix X: {n} samples Ã— {p} features")
print(X)

# Compute dot product manually for first two rows
a, b = X[0], X[1]
dot_product = sum(a[i] * b[i] for i in range(p))
print(f"\\nDot product of rows 1 & 2 (manual): {dot_product:.4f}")
print(f"Dot product of rows 1 & 2 (numpy):  {np.dot(a, b):.4f}")

# Matrix multiplication: X times weight vector w
w = np.array([0.4, 0.3, 0.2, 0.1])  # weights for each indicator
print(f"\\nWeight vector w: {w}")

# Manual computation for row 0
manual_result_0 = sum(X[0, k] * w[k] for k in range(p))
print(f"Row 0: {X[0, 0]}*{w[0]} + {X[0, 1]}*{w[1]} + {X[0, 2]}*{w[2]} + {X[0, 3]}*{w[3]}")
print(f"     = {X[0, 0]*w[0]:.4f} + {X[0, 1]*w[1]:.6f} + {X[0, 2]*w[2]:.6f} + {X[0, 3]*w[3]:.4f}")
print(f"     = {manual_result_0:.4f}")

# Full matrix-vector product
Xw = X @ w
print(f"\\nX @ w (all rows):")
for i, val in enumerate(Xw):
    print(f"  Row {i}: {val:.4f}")

# Build covariance matrix step-by-step
print(f"\\n{'='*60}")
print("COVARIANCE MATRIX CONSTRUCTION")
print('='*60)

# Step 1: Center the data (subtract column means)
mu = X.mean(axis=0)
print(f"Feature means Î¼: {mu}")
X_centered = X - mu
print(f"\\nCentered data XÌƒ (first 3 rows):")
print(X_centered[:3])

# Step 2: Compute XÌƒáµ€XÌƒ
XtX = X_centered.T @ X_centered
print(f"\\nXÌƒáµ€XÌƒ shape: {XtX.shape}")
print("XÌƒáµ€XÌƒ:")
print(XtX)

# Step 3: Divide by n-1 to get sample covariance
Sigma_manual = XtX / (n - 1)
print(f"\\nManual covariance Î£ = (1/{n-1}) XÌƒáµ€XÌƒ:")
print(Sigma_manual)

# Compare with numpy
Sigma_numpy = np.cov(X, rowvar=False)
print(f"\\nnumpy covariance:")
print(Sigma_numpy)
print(f"\\nMax difference: {np.abs(Sigma_manual - Sigma_numpy).max():.2e}")

# Verify symmetry
print(f"\\nÎ£ is symmetric: {np.allclose(Sigma_manual, Sigma_manual.T)}")

# Verify PSD: all eigenvalues should be â‰¥ 0
eigenvalues = np.linalg.eigvalsh(Sigma_manual)
print(f"Eigenvalues of Î£: {eigenvalues}")
print(f"Î£ is PSD (all Î» â‰¥ 0): {np.all(eigenvalues >= -1e-10)}")`,
              explanation:
                "We construct a 5Ã—4 feature matrix from forex indicators, manually compute dot products and matrix-vector products to show the mechanics, then build the covariance matrix step-by-step: center data, compute XÌƒáµ€XÌƒ, divide by n-1. We verify that Î£ is symmetric and positive semi-definite by checking eigenvalues are non-negative. This is the foundation PCA operates on.",
            },
            {
              type: "code",
              title: "Eigendecomposition Step-by-Step",
              language: "python",
              code: `import numpy as np
from scipy.linalg import eigh

# Use the 2Ã—2 covariance submatrix from previous example (RSI and MACD only)
# We'll use a simple symmetric matrix for pedagogical clarity
A = np.array([
    [5.0, 2.0],
    [2.0, 2.0],
])
print("Matrix A:")
print(A)
print(f"A is symmetric: {np.allclose(A, A.T)}")

# Compute characteristic polynomial: det(A - Î»I) = 0
# A - Î»I = [[5-Î», 2], [2, 2-Î»]]
# det = (5-Î»)(2-Î») - 2*2 = 10 - 5Î» - 2Î» + Î»Â² - 4 = Î»Â² - 7Î» + 6
# Solve Î»Â² - 7Î» + 6 = 0 using quadratic formula: Î» = (7 Â± âˆš(49-24))/2 = (7 Â± 5)/2

lambda1 = (7 + 5) / 2
lambda2 = (7 - 5) / 2
print(f"\\nEigenvalues from quadratic formula:")
print(f"  Î»â‚ = {lambda1:.4f}")
print(f"  Î»â‚‚ = {lambda2:.4f}")

# Find eigenvector for Î»â‚ = 6: (A - 6I)v = 0
# [[5-6, 2], [2, 2-6]] = [[-1, 2], [2, -4]]
# Row 1: -vâ‚ + 2vâ‚‚ = 0  âŸ¹  vâ‚ = 2vâ‚‚
# Choose vâ‚‚ = 1  âŸ¹  v = [2, 1]áµ€
v1_unnorm = np.array([2.0, 1.0])
v1 = v1_unnorm / np.linalg.norm(v1_unnorm)
print(f"\\nEigenvector vâ‚ (Î»=6, normalized): {v1}")

# Find eigenvector for Î»â‚‚ = 1: (A - I)v = 0
# [[5-1, 2], [2, 2-1]] = [[4, 2], [2, 1]]
# Row 1: 4vâ‚ + 2vâ‚‚ = 0  âŸ¹  vâ‚‚ = -2vâ‚
# Choose vâ‚ = 1  âŸ¹  v = [1, -2]áµ€
v2_unnorm = np.array([1.0, -2.0])
v2 = v2_unnorm / np.linalg.norm(v2_unnorm)
print(f"Eigenvector vâ‚‚ (Î»=1, normalized): {v2}")

# Verify orthogonality
print(f"\\nvâ‚ Â· vâ‚‚ = {np.dot(v1, v2):.6f}  (should be â‰ˆ 0)")

# Construct V and Î›
V = np.column_stack([v1, v2])
Lambda = np.diag([lambda1, lambda2])
print(f"\\nEigenvector matrix V:")
print(V)
print(f"\\nEigenvalue matrix Î›:")
print(Lambda)

# Verify A = VÎ›Váµ€
A_reconstructed = V @ Lambda @ V.T
print(f"\\nReconstructed A = VÎ›Váµ€:")
print(A_reconstructed)
print(f"Reconstruction error: {np.linalg.norm(A - A_reconstructed):.2e}")

# Compare with numpy's eigendecomposition
eigenvalues_np, eigenvectors_np = np.linalg.eigh(A)
print(f"\\nnumpy eigenvalues: {eigenvalues_np}")
print(f"numpy eigenvectors:")
print(eigenvectors_np)

# Apply to full covariance matrix from previous example
print(f"\\n{'='*60}")
print("EIGENDECOMPOSITION OF FULL COVARIANCE MATRIX")
print('='*60)

# Recreate the covariance matrix (4Ã—4)
X = np.array([
    [65.2, 0.0034, 0.0045, 15000],
    [72.8, 0.0081, 0.0038, 18500],
    [58.1, -0.0021, 0.0052, 12000],
    [61.5, 0.0012, 0.0048, 14200],
    [69.3, 0.0065, 0.0041, 17100],
])
Sigma = np.cov(X, rowvar=False)

# Eigendecomposition
eigenvalues_full, eigenvectors_full = eigh(Sigma)
# eigh returns in ascending order; reverse for descending
idx = eigenvalues_full.argsort()[::-1]
eigenvalues_full = eigenvalues_full[idx]
eigenvectors_full = eigenvectors_full[:, idx]

print(f"Eigenvalues (descending):")
for i, lam in enumerate(eigenvalues_full):
    print(f"  Î»{i+1} = {lam:.6f}")

# Variance explained
total_var = eigenvalues_full.sum()
explained_ratio = eigenvalues_full / total_var
cumulative = np.cumsum(explained_ratio)
print(f"\\nVariance explained:")
for i in range(len(eigenvalues_full)):
    print(f"  PC{i+1}: {explained_ratio[i]*100:.2f}%  (cumulative: {cumulative[i]*100:.2f}%)")

# PCA projection: project onto first 2 principal components
k = 2
V_k = eigenvectors_full[:, :k]
X_centered = X - X.mean(axis=0)
Z = X_centered @ V_k
print(f"\\nPCA projection onto top {k} components (Z = XÌƒV_k):")
print(f"Z shape: {Z.shape}")
print(Z)`,
              explanation:
                "We manually solve the characteristic polynomial for a 2Ã—2 matrix, find eigenvalues via the quadratic formula, compute eigenvectors by solving (A-Î»I)v=0, verify orthogonality, and reconstruct A = VÎ›Váµ€. We then apply eigendecomposition to the full 4Ã—4 covariance matrix, showing how eigenvalues quantify variance per principal component. This is the mathematical core of PCA.",
            },
            {
              type: "code",
              title: "SVD, Condition Number & Feature Stability Analysis",
              language: "python",
              code: `import numpy as np
from numpy.linalg import svd, cond

# Use the centered feature matrix from previous examples
X = np.array([
    [65.2, 0.0034, 0.0045, 15000],
    [72.8, 0.0081, 0.0038, 18500],
    [58.1, -0.0021, 0.0052, 12000],
    [61.5, 0.0012, 0.0048, 14200],
    [69.3, 0.0065, 0.0041, 17100],
])
X_centered = X - X.mean(axis=0)
n, p = X_centered.shape

print("Centered feature matrix XÌƒ:")
print(X_centered)
print(f"Shape: {n} samples Ã— {p} features\\n")

# Compute SVD: XÌƒ = U Î£ Váµ€
U, singular_values, Vt = svd(X_centered, full_matrices=False)
V = Vt.T

print(f"Singular values Ïƒ:")
for i, s in enumerate(singular_values):
    print(f"  Ïƒ{i+1} = {s:.6f}")

# Condition number
kappa = cond(X_centered)
print(f"\\nCondition number Îº(XÌƒ) = Ïƒ_max/Ïƒ_min = {singular_values[0]}/{singular_values[-1]:.6f} = {kappa:.2f}")

if kappa > 100:
    print("âš  High condition number indicates potential multicollinearity!")
else:
    print("âœ“ Condition number is acceptable.")

# Identify near-multicollinear features
# Features with very small contribution to smallest singular values are redundant
print(f"\\nRight singular vectors V (columns = principal directions):")
print(V)
print(f"\\nFeature loadings on smallest singular vector (PC{p}):")
feature_names = ["RSI_14", "MACD", "ATR_14", "Volume"]
loadings = V[:, -1]
for i, name in enumerate(feature_names):
    print(f"  {name}: {loadings[i]:.4f}")

# Compare SVD-based PCA with eigendecomposition-based PCA
# Eigenvalues from covariance = (singular values)Â² / (n-1)
eigenvalues_from_svd = (singular_values ** 2) / (n - 1)
print(f"\\nEigenvalues from SVD: ÏƒÂ² / (n-1)")
for i, lam in enumerate(eigenvalues_from_svd):
    print(f"  Î»{i+1} = {lam:.6f}")

# Direct eigendecomposition of covariance
Sigma = np.cov(X, rowvar=False)
eigenvalues_direct = np.linalg.eigvalsh(Sigma)[::-1]  # descending order
print(f"\\nEigenvalues from direct eigendecomposition of Î£:")
for i, lam in enumerate(eigenvalues_direct):
    print(f"  Î»{i+1} = {lam:.6f}")

print(f"\\nMax difference between methods: {np.abs(eigenvalues_from_svd - eigenvalues_direct).max():.2e}")
print("âœ“ SVD and eigendecomposition yield identical PCA results.")

# Variance explained via SVD
total_var_svd = eigenvalues_from_svd.sum()
explained_ratio = eigenvalues_from_svd / total_var_svd
cumulative = np.cumsum(explained_ratio)
print(f"\\nVariance explained by each PC:")
for i in range(p):
    print(f"  PC{i+1}: {explained_ratio[i]*100:.2f}%  (cumulative: {cumulative[i]*100:.2f}%)")

# Compute pseudo-inverse via SVD: Xâº = V Î£âº Uáµ€
# Î£âº: invert non-zero singular values
Sigma_plus = np.diag(1 / singular_values)  # all non-zero in this case
X_pseudo_inv = V @ Sigma_plus @ U.T
print(f"\\nPseudo-inverse Xâº via SVD:")
print(f"Shape: {X_pseudo_inv.shape}")
print(f"Verification: â€–XÌƒ Xâº XÌƒ - XÌƒâ€– = {np.linalg.norm(X_centered @ X_pseudo_inv @ X_centered - X_centered):.2e}")`,
              explanation:
                "We compute the SVD of the centered feature matrix, extract singular values and condition number to assess multicollinearity, and verify that SVD-based PCA yields identical results to eigendecomposition-based PCA. We also compute the pseudo-inverse via SVD. High condition number signals ill-conditioning due to redundant features â€” critical for detecting unstable regression scenarios in trading models.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "found-la-q1",
                  question:
                    "Given the 2Ã—2 matrix A = [[3, 1], [1, 3]], compute its eigenvalues by solving det(A - Î»I) = 0.",
                  options: [
                    { id: "found-la-q1-a", text: "Î»â‚ = 4, Î»â‚‚ = 2" },
                    { id: "found-la-q1-b", text: "Î»â‚ = 3, Î»â‚‚ = 1" },
                    { id: "found-la-q1-c", text: "Î»â‚ = 5, Î»â‚‚ = 1" },
                    { id: "found-la-q1-d", text: "Î»â‚ = 6, Î»â‚‚ = 0" },
                  ],
                  correctOptionId: "found-la-q1-a",
                  explanation:
                    "det(A - Î»I) = (3-Î»)(3-Î») - 1Â·1 = Î»Â² - 6Î» + 9 - 1 = Î»Â² - 6Î» + 8 = 0. Factoring: (Î»-4)(Î»-2) = 0, so Î»â‚ = 4 and Î»â‚‚ = 2. This characteristic polynomial approach is the foundation of eigendecomposition.",
                },
                {
                  id: "found-la-q2",
                  question:
                    "Why is it essential to standardize features (zero mean, unit variance) before applying PCA?",
                  options: [
                    { id: "found-la-q2-a", text: "PCA algorithm only works with integers" },
                    { id: "found-la-q2-b", text: "Features on larger scales dominate variance and bias the principal components" },
                    { id: "found-la-q2-c", text: "Standardization converts the covariance matrix to the identity matrix" },
                    { id: "found-la-q2-d", text: "It guarantees all eigenvalues are equal" },
                  ],
                  correctOptionId: "found-la-q2-b",
                  explanation:
                    "PCA maximizes variance. If one feature ranges [0, 10000] (e.g., volume) and another ranges [0, 1] (e.g., MACD), the large-scale feature will dominate the first principal component regardless of its informational value. Standardizing to zero mean and unit variance puts all features on equal footing, ensuring PCA captures true data structure rather than artificial scale differences.",
                },
                {
                  id: "found-la-q3",
                  question:
                    "A covariance matrix has eigenvalues Î»â‚=8.0, Î»â‚‚=1.5, Î»â‚ƒ=0.4, Î»â‚„=0.1. Which features are likely multicollinear?",
                  options: [
                    { id: "found-la-q3-a", text: "Features corresponding to Î»â‚" },
                    { id: "found-la-q3-b", text: "Features corresponding to Î»â‚ƒ and Î»â‚„ (small eigenvalues)" },
                    { id: "found-la-q3-c", text: "All features are multicollinear" },
                    { id: "found-la-q3-d", text: "Eigenvalues don't reveal multicollinearity" },
                  ],
                  correctOptionId: "found-la-q3-b",
                  explanation:
                    "Small eigenvalues indicate directions with low variance, meaning the data is nearly constant along those directions â€” a hallmark of multicollinearity (linear dependencies among features). The features with high loadings on eigenvectors corresponding to Î»â‚ƒ and Î»â‚„ are redundant. Large eigenvalues indicate independent variation.",
                },
                {
                  id: "found-la-q4",
                  question:
                    "What does a high condition number Îº(A) = Ïƒ_max/Ïƒ_min >> 1 signify?",
                  options: [
                    { id: "found-la-q4-a", text: "The matrix is well-conditioned and numerically stable" },
                    { id: "found-la-q4-b", text: "The matrix is ill-conditioned; small input changes cause large output changes" },
                    { id: "found-la-q4-c", text: "All singular values are equal" },
                    { id: "found-la-q4-d", text: "The matrix has no inverse" },
                  ],
                  correctOptionId: "found-la-q4-b",
                  explanation:
                    "A high condition number (Îº >> 1) means the matrix is ill-conditioned: small perturbations in input data are amplified in the output, leading to numerical instability. This occurs when features are multicollinear (smallest singular value Ïƒ_min â‰ˆ 0), making inversion or regression unstable. For trading models, high Îº signals that feature engineering or regularization is needed.",
                },
                {
                  id: "found-la-q5",
                  question:
                    "If PCA retains k=3 components with eigenvalues Î»â‚=5.0, Î»â‚‚=2.0, Î»â‚ƒ=1.0 from a total of Î£Î»áµ¢=10, what is the fraction of variance retained?",
                  options: [
                    { id: "found-la-q5-a", text: "50%" },
                    { id: "found-la-q5-b", text: "80%" },
                    { id: "found-la-q5-c", text: "70%" },
                    { id: "found-la-q5-d", text: "30%" },
                  ],
                  correctOptionId: "found-la-q5-b",
                  explanation:
                    "Variance retained = (Î»â‚ + Î»â‚‚ + Î»â‚ƒ) / Î£Î»áµ¢ = (5.0 + 2.0 + 1.0) / 10 = 8.0 / 10 = 80%. Three components capture 80% of the total variance, a significant dimensionality reduction from the original feature set.",
                },
                {
                  id: "found-la-q6",
                  question:
                    "What happens if you apply PCA without first centering the data (subtracting the mean)?",
                  options: [
                    { id: "found-la-q6-a", text: "PCA still works correctly" },
                    { id: "found-la-q6-b", text: "The first principal component becomes dominated by the mean offset, obscuring variance structure" },
                    { id: "found-la-q6-c", text: "All eigenvalues become zero" },
                    { id: "found-la-q6-d", text: "The covariance matrix becomes singular" },
                  ],
                  correctOptionId: "found-la-q6-b",
                  explanation:
                    "Without centering, the covariance matrix Xáµ€X includes the outer product of the mean vector, causing the first principal component to point toward the mean rather than the direction of maximum variance. This obscures the true data structure. Centering ensures PCA captures variance around the mean, not absolute position. Always center (and usually standardize) before PCA.",
                },
              ],
            },
            {
              type: "practice",
              title: "Eigendecomposition by Hand",
              description:
                "Compute the eigendecomposition of a 3Ã—3 symmetric covariance matrix by hand: write the characteristic polynomial det(A - Î»I) = 0, solve for the three eigenvalues (use a cubic equation solver or numerical approximation if needed), find the corresponding eigenvectors by solving (A - Î»I)v = 0, verify orthogonality, and check that A = VÎ›Váµ€. Then verify your results with np.linalg.eigh(A).",
            },
            {
              type: "practice",
              title: "PCA Dashboard Visualization",
              description:
                "Navigate to a model's feature importance panel in the dashboard and enable PCA visualization. Examine the scree plot (eigenvalues vs component number) to identify the 'elbow' â€” the point where adding more components yields diminishing returns. Experiment: add or remove technical indicators and observe how the explained variance curve changes. Identify which features load heavily on the first principal component and interpret their trading significance.",
              catalogModelId: "pca-feature-analysis",
            },
          ],
        },
        {
          id: "found-optimization",
          title: "Optimization Methods",
          description:
            "Master the mathematical foundations of gradient descent, Newton's method, and modern optimizers (SGD, Momentum, Adam) â€” the engine that powers all ML training from linear regression to transformers.",
          estimatedMinutes: 90,
          difficulty: "beginner",
          sections: [
            {
              type: "objective",
              content:
                "You will derive the gradient descent update rule from Taylor expansion, prove convergence conditions for convex functions, distinguish first-order (GD, SGD, Momentum, Adam) from second-order methods (Newton, BFGS), and implement all optimizers from scratch to train a forex trading model.",
              keyTakeaways: [
                "Gradient descent update Î¸â‚œâ‚Šâ‚ = Î¸â‚œ âˆ’ Î±âˆ‡L(Î¸â‚œ) derived from first-order Taylor approximation; geometrically moves along steepest descent direction",
                "Convergence requires Lipschitz continuous gradients (â€–âˆ‡L(x) âˆ’ âˆ‡L(y)â€– â‰¤ Lâ€–xâˆ’yâ€–) and learning rate Î± â‰¤ 1/L; rate is O(1/T) for convex, O(1/TÂ²) for strongly convex",
                "Convexity: first-order condition L(y) â‰¥ L(x) + âˆ‡L(x)áµ€(yâˆ’x); second-order âˆ‡Â²L âª° 0; strongly convex âˆ‡Â²L âª° Î¼I implies unique global minimum",
                "SGD approximates gradient with mini-batch âˆ‡L â‰ˆ (1/|B|)âˆ‘áµ¢âˆˆB âˆ‡â„“áµ¢; noise helps escape saddle points; batch size trades off convergence speed vs generalization",
                "Momentum vâ‚œ = Î²vâ‚œâ‚‹â‚ + âˆ‡L is exponential moving average with effective window 1/(1âˆ’Î²); dampens oscillations in high-curvature directions",
                "Newton's method Î¸â‚œâ‚Šâ‚ = Î¸â‚œ âˆ’ Hâ»Â¹âˆ‡L derived from second-order Taylor; quadratic convergence (doubles digits per step) but O(dÂ³) cost",
                "Adam = momentum (first moment) + RMSProp (second moment) with bias correction mÌ‚â‚œ/(1âˆ’Î²â‚áµ—) and vÌ‚â‚œ/(1âˆ’Î²â‚‚áµ—) to counter initialization bias",
                "Learning rate schedules: warmup prevents early instability; cosine annealing Î±â‚œ = Î±â‚€Â·(1 + cos(Ï€t/T))/2 improves final convergence",
              ],
            },
            {
              type: "theory",
              title: "Gradient Descent: Derivation & Convergence Analysis",
              content:
                "**Derivation from Taylor Expansion**: To minimize loss L(Î¸), consider a step Î¸ âˆ’ Î±g where g = âˆ‡L(Î¸). By Taylor expansion: L(Î¸ âˆ’ Î±g) â‰ˆ L(Î¸) âˆ’ Î±â€–gâ€–Â² + (Î±Â²/2)gáµ€Hg where H = âˆ‡Â²L is the Hessian. For descent, we need L(Î¸âˆ’Î±g) < L(Î¸), which requires Î±â€–gâ€–Â² > (Î±Â²/2)gáµ€Hg. Rearranging: Î± < 2â€–gâ€–Â²/(gáµ€Hg). For convex functions with **L-Lipschitz continuous gradients** (â€–âˆ‡L(x) âˆ’ âˆ‡L(y)â€– â‰¤ Lâ€–xâˆ’yâ€–), the Hessian satisfies H âª¯ LI, so gáµ€Hg â‰¤ Lâ€–gâ€–Â². This gives the convergence condition: **Î± â‰¤ 1/L**. Under this condition, gradient descent achieves **O(1/T) convergence**: L(Î¸_T) âˆ’ L(Î¸*) â‰¤ â€–Î¸â‚€âˆ’Î¸*â€–Â²/(2Î±T).\n\n**Optimal Learning Rate for Quadratic Loss**: Consider L(Î¸) = (1/2)Î¸áµ€AÎ¸ âˆ’ báµ€Î¸ where A is positive definite. The gradient is âˆ‡L = AÎ¸ âˆ’ b. At iteration t, the update is Î¸â‚œâ‚Šâ‚ = Î¸â‚œ âˆ’ Î±(AÎ¸â‚œâˆ’b) = (Iâˆ’Î±A)Î¸â‚œ + Î±b. This is a linear recursion; convergence requires all eigenvalues of Iâˆ’Î±A to have magnitude < 1. If A has eigenvalues Î»â‚,...,Î»_d, we need |1âˆ’Î±Î»áµ¢| < 1 for all i, giving 0 < Î± < 2/Î»_max. The optimal Î± minimizing the spectral radius is Î±* = 2/(Î»_min + Î»_max). The convergence rate is governed by the **condition number** Îº = Î»_max/Î»_min.\n\n**Numerical Example**: Let A = [[4, 0], [0, 2]], b = [12, âˆ’4]. Eigenvalues: Î»â‚=4, Î»â‚‚=2. Optimal Î¸* = Aâ»Â¹b = [3, âˆ’2]. Try Î±=0.1, Î±=0.3, Î±=0.6. For Î±=0.1: spectral radius Ï = max(|1âˆ’0.4|, |1âˆ’0.2|) = 0.8 â†’ convergence. For Î±=0.3: Ï = max(|1âˆ’1.2|, |1âˆ’0.6|) = max(0.2, 0.4) = 0.4 â†’ faster convergence. For Î±=0.6: Ï = max(|1âˆ’2.4|, |1âˆ’1.2|) = 1.4 â†’ divergence (overshooting). The convergence speed is determined by Ï; smaller Ï means faster convergence. After k steps, the error â€–Î¸â‚–âˆ’Î¸*â€– â‰ˆ Ïáµâ€–Î¸â‚€âˆ’Î¸*â€–.",
            },
            {
              type: "theory",
              title: "Convexity: First & Second Order Conditions",
              content:
                "**First-Order Condition**: A differentiable function L is **convex** if and only if L(y) â‰¥ L(x) + âˆ‡L(x)áµ€(yâˆ’x) for all x, y. Geometrically, the tangent hyperplane at any point is a global underestimator â€” the function always lies above its linear approximation. This implies that any local minimum is a global minimum. For convex L, gradient descent with Î± â‰¤ 1/L is guaranteed to converge to the global minimum.\n\n**Second-Order Condition**: L is convex if and only if the Hessian is positive semidefinite everywhere: âˆ‡Â²L(x) âª° 0 for all x. **Strongly convex** functions satisfy âˆ‡Â²L(x) âª° Î¼I for some Î¼ > 0, meaning the smallest eigenvalue of the Hessian is bounded below. Strong convexity gives faster O(1/TÂ²) convergence. The **condition number** Îº = L/Î¼ (ratio of largest to smallest curvature) determines how many iterations are needed; ill-conditioned problems (large Îº) converge slowly.\n\n**Non-Convex Landscapes**: Neural networks and most real-world ML problems are non-convex. The loss surface contains **local minima** (points where âˆ‡L=0 and âˆ‡Â²L âª° 0 but not global optimum), **saddle points** (âˆ‡L=0 but âˆ‡Â²L has both positive and negative eigenvalues), and **plateaus** (regions where â€–âˆ‡Lâ€– â‰ˆ 0). Remarkably, **SGD's noise helps escape saddle points**: at a saddle, the Hessian has at least one negative eigenvalue, meaning there's a descent direction. The stochastic gradient has a component along this direction with high probability, allowing the optimizer to escape. In high dimensions, saddle points are far more common than local minima (exponentially so), making this escape mechanism critical for deep learning.",
            },
            {
              type: "theory",
              title: "Newton's Method & Second-Order Optimization",
              content:
                "**Derivation from Second-Order Taylor Expansion**: Approximate the loss around Î¸ by a quadratic: L(Î¸+Î´) â‰ˆ L(Î¸) + âˆ‡L(Î¸)áµ€Î´ + (1/2)Î´áµ€âˆ‡Â²L(Î¸)Î´. To find the optimal step Î´*, minimize this quadratic by setting its gradient to zero: âˆ‡L(Î¸) + âˆ‡Â²L(Î¸)Î´ = 0, giving **Î´* = âˆ’[âˆ‡Â²L(Î¸)]â»Â¹âˆ‡L(Î¸)**. The Newton update is: Î¸â‚œâ‚Šâ‚ = Î¸â‚œ âˆ’ [âˆ‡Â²L(Î¸â‚œ)]â»Â¹âˆ‡L(Î¸â‚œ). For a quadratic loss, this converges in **one step** (the approximation is exact). For general smooth functions, Newton's method has **quadratic convergence**: â€–Î¸â‚œâ‚Šâ‚ âˆ’ Î¸*â€– â‰ˆ Câ€–Î¸â‚œ âˆ’ Î¸*â€–Â², doubling the number of correct digits per iteration once near the optimum.\n\n**Advantages**: (1) No learning rate tuning required â€” the Hessian automatically scales the step. (2) Invariant to affine transformations â€” works well for ill-conditioned problems where gradient descent struggles. (3) Extremely fast convergence near the optimum. **Disadvantages**: (1) Computing and inverting the dÃ—d Hessian costs O(dÂ³), prohibitive for large d (e.g., millions of parameters). (2) The Hessian must be positive definite; for non-convex problems, it may have negative eigenvalues, causing divergence. (3) Requires second derivatives, which are expensive to compute.\n\n**Quasi-Newton Methods (BFGS)**: Instead of computing Hâ»Â¹ exactly, maintain an approximation Bâ‚œ â‰ˆ Hâ»Â¹ and update it iteratively using gradient information. The BFGS update ensures Bâ‚œ remains positive definite and satisfies the secant condition. This reduces cost to O(dÂ²) per iteration. **Financial Application**: Portfolio optimization minimizes variance (1/2)wáµ€Î£w subject to return constraints â€” a quadratic program where Newton's method converges in one step. For a portfolio with covariance matrix Î£ and expected returns Î¼, the optimal weights w* = Î£â»Â¹Î¼ (ignoring constraints) are found directly via Hessian inversion.",
            },
            {
              type: "theory",
              title: "Momentum, RMSProp & the Adam Optimizer",
              content:
                "**SGD with Momentum**: Instead of updating directly with the gradient, maintain a velocity vector vâ‚œ = Î²vâ‚œâ‚‹â‚ + âˆ‡L(Î¸â‚œ), then update Î¸â‚œâ‚Šâ‚ = Î¸â‚œ âˆ’ Î±vâ‚œ. This is an **exponential moving average** of past gradients with decay Î² (typically 0.9). Expanding the recursion: vâ‚œ = âˆ‘áµ¢â‚Œâ‚€^âˆž Î²â±âˆ‡L(Î¸â‚œâ‚‹áµ¢), giving effective window size â‰ˆ 1/(1âˆ’Î²) â‰ˆ 10 for Î²=0.9. Momentum accumulates velocity in directions of consistent gradient, accelerating convergence in ravines (high curvature in one direction, low in others). It dampens oscillations perpendicular to the optimum while speeding progress toward it.\n\n**RMSProp (Root Mean Square Propagation)**: Adapts the learning rate per parameter. Maintain a running average of squared gradients: sâ‚œ = Î²â‚‚sâ‚œâ‚‹â‚ + (1âˆ’Î²â‚‚)(âˆ‡L)Â², then update Î¸â‚œâ‚Šâ‚ = Î¸â‚œ âˆ’ Î±Â·âˆ‡L/âˆš(sâ‚œ+Îµ). Parameters with large typical gradients get smaller effective learning rates (Î±/âˆšsâ‚œ is small), while parameters with small gradients get larger effective rates. This is crucial for neural networks where different layers have vastly different gradient magnitudes.\n\n**Adam (Adaptive Moment Estimation)**: Combines momentum and RMSProp. Compute first moment (mean): mâ‚œ = Î²â‚mâ‚œâ‚‹â‚ + (1âˆ’Î²â‚)gâ‚œ, and second moment (uncentered variance): vâ‚œ = Î²â‚‚vâ‚œâ‚‹â‚ + (1âˆ’Î²â‚‚)gâ‚œÂ². Since mâ‚€=0 and vâ‚€=0, these estimates are biased toward zero in early iterations. **Bias correction**: mÌ‚â‚œ = mâ‚œ/(1âˆ’Î²â‚áµ—) and vÌ‚â‚œ = vâ‚œ/(1âˆ’Î²â‚‚áµ—). Update: Î¸â‚œâ‚Šâ‚ = Î¸â‚œ âˆ’ Î±Â·mÌ‚â‚œ/âˆš(vÌ‚â‚œ+Îµ). Default hyperparameters: Î²â‚=0.9, Î²â‚‚=0.999, Îµ=10â»â¸, Î±=0.001. **Why bias correction is needed**: At t=1, mâ‚ = (1âˆ’Î²â‚)gâ‚ = 0.1gâ‚, which is 10Ã— smaller than gâ‚. Without correction, the first few steps would be tiny. With correction, mÌ‚â‚ = 0.1gâ‚/(1âˆ’0.9) = gâ‚. As tâ†’âˆž, 1âˆ’Î²â‚áµ—â†’1, so the correction vanishes.",
            },
            {
              type: "intuition",
              title: "The Mountain Hiker Analogy",
              analogy:
                "Gradient descent is a blindfolded hiker descending a mountain, feeling the slope underfoot.",
              content:
                "Imagine you're blindfolded on a mountainside, trying to reach the valley. **Gradient descent**: Step downhill in the steepest direction you feel. **Learning rate**: Your step size â€” too large and you overshoot the valley, bouncing from ridge to ridge; too small and you're still hiking at dawn. **Convex landscape**: One valley â€” you're guaranteed to reach it. **Non-convex**: Multiple valleys and ridges â€” you might get stuck in a shallow dip. **Momentum**: You're a rolling ball, not a hiker â€” inertia carries you past small bumps and helps you barrel through shallow valleys toward deeper ones. **Adam**: A smart hiker who adjusts stride based on terrain steepness â€” taking tiny steps on steep cliffs (high curvature) and giant strides across gentle slopes (low curvature), automatically finding the right pace for each direction.",
              emoji: "ðŸ”ï¸",
            },
            {
              type: "intuition",
              title: "The Ball Rolling Down a Bowl Analogy",
              analogy:
                "A ball in a bowl naturally finds the lowest point via gravity â€” analogous to gradient descent.",
              content:
                "Picture a ball placed anywhere inside a bowl. Gravity pulls it toward the lowest point. **Gradient descent** is the ball's motion, always rolling downhill. In a narrow, elongated bowl (ill-conditioned problem), the ball oscillates wildly side-to-side while slowly moving toward the center â€” this is why steep gradients in one direction and gentle in another cause slow convergence. **Momentum** dampens these oscillations: the ball builds velocity in the consistent downward direction and averages out the sideways wobbles. **Newton's method** is like knowing the exact shape of the bowl and calculating the center analytically â€” you jump straight there in one leap. **SGD** is a vibrating bowl: the shaking (noise from mini-batches) randomly nudges the ball, helping it escape shallow dents and settle into the deepest part. **Adam** is a smart ball that rolls faster in flat directions (where it can safely speed up) and slower in steep ones (where overshooting is risky), automatically tuning its speed per direction.",
              emoji: "âš½",
            },
            {
              type: "code",
              title: "Gradient Descent with Convergence Analysis",
              language: "python",
              code: `import numpy as np

# Quadratic loss L(Î¸) = (1/2)Î¸áµ€AÎ¸ - báµ€Î¸
# A = [[4, 0], [0, 2]], b = [12, -4]
# Optimal: Î¸* = Aâ»Â¹b = [3, -2], L(Î¸*) = -22
A = np.array([[4.0, 0.0], [0.0, 2.0]])
b = np.array([12.0, -4.0])
theta_star = np.linalg.solve(A, b)  # [3, -2]

def loss(theta):
    return 0.5 * theta @ A @ theta - b @ theta

def gradient(theta):
    return A @ theta - b

# Eigenvalues: Î»â‚=4, Î»â‚‚=2
# Optimal Î±: 2/(Î»_min+Î»_max) = 2/6 = 0.333
# Convergence bound: Î± < 2/Î»_max = 0.5
learning_rates = [0.1, 0.3, 0.6]  # slow, fast, diverge
n_steps = 20

print(f"Optimal Î¸* = {theta_star}, L(Î¸*) = {loss(theta_star):.2f}")
print(f"Eigenvalues: {np.linalg.eigvalsh(A)}, Îº = {4/2:.1f}\\n")

for alpha in learning_rates:
    theta = np.array([0.0, 0.0])
    spectral_radius = max(abs(1 - alpha * np.linalg.eigvalsh(A)))
    print(f"\\n{'='*60}")
    print(f"Learning rate Î± = {alpha:.1f}, Ï(Iâˆ’Î±A) = {spectral_radius:.2f}")
    print(f"{'Step':>4}  {'Î¸â‚':>8}  {'Î¸â‚‚':>8}  {'L(Î¸)':>10}  {'â€–Î¸âˆ’Î¸*â€–':>10}")
    print("-" * 60)
    
    for step in range(n_steps):
        L = loss(theta)
        error = np.linalg.norm(theta - theta_star)
        if step % 5 == 0 or step == n_steps - 1:
            print(f"{step:4d}  {theta[0]:8.4f}  {theta[1]:8.4f}  {L:10.4f}  {error:10.6f}")
        
        grad = gradient(theta)
        theta = theta - alpha * grad
        
        # Detect divergence
        if np.linalg.norm(theta) > 1e6:
            print("DIVERGED")
            break
    
    if np.linalg.norm(theta) < 1e6:
        print(f"Final: Î¸ = [{theta[0]:.4f}, {theta[1]:.4f}], converged = {error < 0.01}")`,
              explanation:
                "We test three learning rates on a 2D quadratic loss. Î±=0.1 converges slowly (Ï=0.8). Î±=0.3 converges quickly (Ï=0.4, near optimal). Î±=0.6 exceeds 2/Î»_max=0.5, causing divergence as predicted by theory. The spectral radius Ï = max|1âˆ’Î±Î»áµ¢| determines convergence speed â€” smaller Ï means faster convergence. The condition number Îº=2 is well-conditioned, so convergence is fairly uniform in all directions.",
            },
            {
              type: "code",
              title: "Newton's Method vs Gradient Descent",
              language: "python",
              code: `import numpy as np

# Same quadratic loss as before
A = np.array([[4.0, 0.0], [0.0, 2.0]])
b = np.array([12.0, -4.0])
theta_star = np.array([3.0, -2.0])

def loss(theta):
    return 0.5 * theta @ A @ theta - b @ theta

def gradient(theta):
    return A @ theta - b

def hessian(theta):
    return A  # Hessian of quadratic is constant

# Gradient Descent
print("GRADIENT DESCENT (Î±=0.2)")
theta_gd = np.array([0.0, 0.0])
alpha = 0.2
for step in range(10):
    if step % 2 == 0:
        print(f"  Step {step}: Î¸ = {theta_gd}, L = {loss(theta_gd):.4f}")
    theta_gd = theta_gd - alpha * gradient(theta_gd)

print(f"  Final: Î¸ = {theta_gd}, â€–Î¸âˆ’Î¸*â€– = {np.linalg.norm(theta_gd - theta_star):.6f}\\n")

# Newton's Method
print("NEWTON'S METHOD")
theta_newton = np.array([0.0, 0.0])
for step in range(3):
    H = hessian(theta_newton)
    g = gradient(theta_newton)
    delta = np.linalg.solve(H, g)  # Solve HÎ´ = g for Î´
    print(f"  Step {step}: Î¸ = {theta_newton}, L = {loss(theta_newton):.4f}")
    theta_newton = theta_newton - delta
    
print(f"  Final: Î¸ = {theta_newton}, â€–Î¸âˆ’Î¸*â€– = {np.linalg.norm(theta_newton - theta_star):.10f}")
print("  â†’ Converged in 1 step (quadratic loss)\\n")

# Try on Rosenbrock (non-convex): L(x,y) = (1-x)Â² + 100(y-xÂ²)Â²
print("\\nROSENBROCK FUNCTION (non-convex)")
def rosenbrock(theta):
    x, y = theta
    return (1 - x)**2 + 100*(y - x**2)**2

def rosenbrock_grad(theta):
    x, y = theta
    dx = -2*(1-x) - 400*x*(y - x**2)
    dy = 200*(y - x**2)
    return np.array([dx, dy])

def rosenbrock_hess(theta):
    x, y = theta
    h11 = 2 - 400*(y - 3*x**2)
    h12 = -400*x
    h22 = 200
    return np.array([[h11, h12], [h12, h22]])

theta_opt = np.array([1.0, 1.0])  # Global minimum
theta = np.array([0.5, 0.5])

for step in range(5):
    H = rosenbrock_hess(theta)
    g = rosenbrock_grad(theta)
    try:
        delta = np.linalg.solve(H, g)
        theta = theta - delta
        print(f"  Step {step}: Î¸ = [{theta[0]:.4f}, {theta[1]:.4f}], L = {rosenbrock(theta):.6f}")
    except np.linalg.LinAlgError:
        print(f"  Step {step}: Hessian singular, Newton failed")
        break`,
              explanation:
                "For the quadratic loss, Newton's method converges in exactly 1 iteration â€” the second-order approximation is perfect. Gradient descent needs 10+ steps. On the Rosenbrock function (a classic non-convex test), Newton converges rapidly when started near the optimum, demonstrating quadratic convergence. However, Newton can fail if the Hessian is indefinite or singular (common far from the optimum in non-convex problems).",
            },
            {
              type: "code",
              title: "SGD, Momentum & Adam on a Trading Loss",
              language: "python",
              code: `import numpy as np

# Simulate forex returns: y = Xw + noise
# Goal: predict next-bar return using lagged returns
np.random.seed(42)
n, d = 500, 5  # 500 bars, 5 features (lags)
X = np.random.randn(n, d)
w_true = np.array([0.3, -0.2, 0.1, 0.05, -0.1])
y = X @ w_true + 0.1 * np.random.randn(n)

# MSE loss: L(w) = (1/2n)â€–y - Xwâ€–Â²
def loss(w):
    return 0.5 * np.mean((y - X @ w)**2)

def gradient(w):
    return -X.T @ (y - X @ w) / n

def mini_batch_gradient(w, batch_size=32):
    idx = np.random.choice(n, batch_size, replace=False)
    X_batch, y_batch = X[idx], y[idx]
    return -X_batch.T @ (y_batch - X_batch @ w) / batch_size

# Hyperparameters
alpha = 0.01
beta1, beta2 = 0.9, 0.999
eps = 1e-8
n_epochs = 100
batch_size = 32

# Initialize
w_sgd = np.zeros(d)
w_momentum = np.zeros(d)
v_momentum = np.zeros(d)
w_adam = np.zeros(d)
m_adam = np.zeros(d)
v_adam = np.zeros(d)

losses_sgd, losses_momentum, losses_adam = [], [], []

print(f"Training on {n} forex bars, {d} features")
print(f"True weights: {w_true}\\n")
print(f"{'Epoch':>5}  {'SGD Loss':>10}  {'Momentum':>10}  {'Adam Loss':>10}")
print("-" * 50)

for epoch in range(n_epochs):
    # SGD
    g_sgd = mini_batch_gradient(w_sgd, batch_size)
    w_sgd = w_sgd - alpha * g_sgd
    
    # SGD + Momentum
    g_mom = mini_batch_gradient(w_momentum, batch_size)
    v_momentum = beta1 * v_momentum + g_mom
    w_momentum = w_momentum - alpha * v_momentum
    
    # Adam
    g_adam = mini_batch_gradient(w_adam, batch_size)
    m_adam = beta1 * m_adam + (1 - beta1) * g_adam
    v_adam = beta2 * v_adam + (1 - beta2) * (g_adam ** 2)
    m_hat = m_adam / (1 - beta1**(epoch + 1))
    v_hat = v_adam / (1 - beta2**(epoch + 1))
    w_adam = w_adam - alpha * m_hat / (np.sqrt(v_hat) + eps)
    
    # Record losses
    losses_sgd.append(loss(w_sgd))
    losses_momentum.append(loss(w_momentum))
    losses_adam.append(loss(w_adam))
    
    if epoch % 20 == 0 or epoch == n_epochs - 1:
        print(f"{epoch:5d}  {losses_sgd[-1]:10.6f}  {losses_momentum[-1]:10.6f}  {losses_adam[-1]:10.6f}")

print(f"\\nFinal Weights:")
print(f"  True:     {w_true}")
print(f"  SGD:      {w_sgd} (loss={losses_sgd[-1]:.6f})")
print(f"  Momentum: {w_momentum} (loss={losses_momentum[-1]:.6f})")
print(f"  Adam:     {w_adam} (loss={losses_adam[-1]:.6f})")
print(f"\\nConvergence epochs (loss < 0.006):")
print(f"  SGD: {next((i for i,L in enumerate(losses_sgd) if L<0.006), 'N/A')}")
print(f"  Momentum: {next((i for i,L in enumerate(losses_momentum) if L<0.006), 'N/A')}")
print(f"  Adam: {next((i for i,L in enumerate(losses_adam) if L<0.006), 'N/A')}")`,
              explanation:
                "We train a linear model to predict forex returns using SGD, SGD+Momentum, and Adam. All three converge, but at different rates. Momentum typically converges faster than vanilla SGD by accumulating velocity. Adam often converges fastest because it adapts per-parameter learning rates â€” features with small gradients get boosted, features with large gradients get dampened. The bias correction in Adam is critical in early epochs; without it, updates would be tiny initially.",
            },
            {
              type: "quiz",
              questions: [
                {
                  id: "found-opt-q1",
                  question:
                    "What is the first-order condition for a function L(Î¸) to be convex?",
                  options: [
                    { id: "found-opt-q1-a", text: "L(y) â‰¤ L(x) + âˆ‡L(x)áµ€(yâˆ’x) for all x, y" },
                    { id: "found-opt-q1-b", text: "L(y) â‰¥ L(x) + âˆ‡L(x)áµ€(yâˆ’x) for all x, y" },
                    { id: "found-opt-q1-c", text: "âˆ‡L(x) = 0 for all x" },
                    { id: "found-opt-q1-d", text: "L(x+y) = L(x) + L(y)" },
                  ],
                  correctOptionId: "found-opt-q1-b",
                  explanation:
                    "The first-order characterization of convexity states that the function must lie above its tangent hyperplane at every point: L(y) â‰¥ L(x) + âˆ‡L(x)áµ€(yâˆ’x). This is both necessary and sufficient for differentiable functions. Geometrically, it means any linear approximation underestimates the true function value.",
                },
                {
                  id: "found-opt-q2",
                  question:
                    "Why does momentum help gradient descent converge faster in ill-conditioned problems?",
                  options: [
                    { id: "found-opt-q2-a", text: "It computes the exact Hessian" },
                    { id: "found-opt-q2-b", text: "It accumulates velocity in consistent directions and dampens oscillations in high-curvature directions" },
                    { id: "found-opt-q2-c", text: "It sets the learning rate to zero" },
                    { id: "found-opt-q2-d", text: "It guarantees convergence in one step" },
                  ],
                  correctOptionId: "found-opt-q2-b",
                  explanation:
                    "Momentum maintains an exponential moving average of past gradients. In directions where the gradient consistently points the same way (toward the optimum), velocity builds up, accelerating progress. In directions with oscillating gradients (perpendicular to the optimum), positive and negative components cancel, reducing oscillation. This is especially helpful for ill-conditioned problems (high Îº) where gradient descent zigzags.",
                },
                {
                  id: "found-opt-q3",
                  question:
                    "Given A = [[4, 0], [0, 2]], what is the largest learning rate Î± for which gradient descent on L(Î¸) = (1/2)Î¸áµ€AÎ¸ âˆ’ báµ€Î¸ will converge?",
                  options: [
                    { id: "found-opt-q3-a", text: "Î± < 0.25" },
                    { id: "found-opt-q3-b", text: "Î± < 0.5" },
                    { id: "found-opt-q3-c", text: "Î± < 1.0" },
                    { id: "found-opt-q3-d", text: "Î± < 2.0" },
                  ],
                  correctOptionId: "found-opt-q3-b",
                  explanation:
                    "For a quadratic loss with Hessian A, convergence requires Î± < 2/Î»_max where Î»_max is the largest eigenvalue of A. Here, eigenvalues are 4 and 2, so Î»_max=4. Thus Î± < 2/4 = 0.5. The optimal Î± is 2/(Î»_min+Î»_max) = 2/(2+4) = 1/3 â‰ˆ 0.333, but any Î± < 0.5 will converge.",
                },
                {
                  id: "found-opt-q4",
                  question:
                    "Starting from Î¸ = [0, 0], perform one Newton step to minimize L(Î¸) = Î¸â‚Â² + 2Î¸â‚‚Â² âˆ’ 6Î¸â‚ + 4Î¸â‚‚. What is the new Î¸?",
                  options: [
                    { id: "found-opt-q4-a", text: "[3, -1]" },
                    { id: "found-opt-q4-b", text: "[0, 0]" },
                    { id: "found-opt-q4-c", text: "[1.5, -0.5]" },
                    { id: "found-opt-q4-d", text: "[6, -2]" },
                  ],
                  correctOptionId: "found-opt-q4-a",
                  explanation:
                    "âˆ‡L = [2Î¸â‚âˆ’6, 4Î¸â‚‚+4], at Î¸=[0,0]: g = [âˆ’6, 4]. âˆ‡Â²L = [[2, 0], [0, 4]] (constant Hessian). Newton step: Î´ = âˆ’Hâ»Â¹g = âˆ’[[1/2, 0], [0, 1/4]][âˆ’6, 4] = âˆ’[âˆ’3, 1] = [3, âˆ’1]. New Î¸ = [0,0] + [3,âˆ’1] = [3,âˆ’1]. For a quadratic, Newton's method reaches the optimum in one step.",
                },
                {
                  id: "found-opt-q5",
                  question:
                    "When should you prefer Adam over vanilla SGD for training a neural network?",
                  options: [
                    { id: "found-opt-q5-a", text: "When the loss is convex" },
                    { id: "found-opt-q5-b", text: "When different parameters have vastly different gradient scales and you want adaptive per-parameter learning rates" },
                    { id: "found-opt-q5-c", text: "When you have a small dataset" },
                    { id: "found-opt-q5-d", text: "When you want guaranteed global convergence" },
                  ],
                  correctOptionId: "found-opt-q5-b",
                  explanation:
                    "Adam adaptively scales the learning rate for each parameter based on the second moment (RMSProp component). In neural networks, different layers often have gradients that differ by orders of magnitude â€” early layers might have tiny gradients while output layers have large ones. Adam automatically adjusts, giving smaller effective learning rates to parameters with large typical gradients and larger rates to those with small gradients. This often leads to faster convergence and better final performance without manual tuning.",
                },
                {
                  id: "found-opt-q6",
                  question:
                    "Your loss curve oscillates wildly but the average trend is decreasing. What is the most likely cause?",
                  options: [
                    { id: "found-opt-q6-a", text: "The learning rate is too small" },
                    { id: "found-opt-q6-b", text: "The learning rate is too large or the mini-batch size is too small (high gradient variance)" },
                    { id: "found-opt-q6-c", text: "The loss function is convex" },
                    { id: "found-opt-q6-d", text: "The optimizer has converged" },
                  ],
                  correctOptionId: "found-opt-q6-b",
                  explanation:
                    "Wild oscillations with decreasing trend indicate high variance in the gradient estimates. This happens when (1) the learning rate is too large, causing overshooting, or (2) the mini-batch size is very small, making the stochastic gradient a poor approximation of the true gradient. Increasing batch size or decreasing learning rate (or both) will smooth the curve. Some oscillation is normal and even beneficial (helps escape local minima), but excessive oscillation wastes iterations.",
                },
                {
                  id: "found-opt-q7",
                  question:
                    "What would happen to the Adam optimizer if you set Î²â‚‚ = 0 (no second moment)?",
                  options: [
                    { id: "found-opt-q7-a", text: "Adam becomes identical to SGD with momentum" },
                    { id: "found-opt-q7-b", text: "Adam cannot run (division by zero)" },
                    { id: "found-opt-q7-c", text: "Adam becomes Newton's method" },
                    { id: "found-opt-q7-d", text: "Adam becomes full-batch gradient descent" },
                  ],
                  correctOptionId: "found-opt-q7-a",
                  explanation:
                    "If Î²â‚‚=0, then vâ‚œ = 0Â·vâ‚œâ‚‹â‚ + 1Â·gâ‚œÂ² = gâ‚œÂ², so vÌ‚â‚œ â‰ˆ gâ‚œÂ² (ignoring bias correction). The Adam update becomes Î¸ â† Î¸ âˆ’ Î±Â·mÌ‚â‚œ/âˆš(gâ‚œÂ²+Îµ) â‰ˆ Î¸ âˆ’ Î±Â·mÌ‚â‚œ/|gâ‚œ| (approximately). Since mÌ‚â‚œ is the bias-corrected momentum term, this becomes similar to SGD with momentum, though the division by |gâ‚œ| adds some per-parameter scaling. The key point is that with Î²â‚‚=0, Adam loses its RMSProp component (the running average of squared gradients), which is what enables adaptive learning rates across parameters.",
                },
              ],
            },
            {
              type: "practice",
              title: "Implement All Optimizers on Different Loss Landscapes",
              description:
                "Write a Python script that implements GD, SGD, Momentum, RMSProp, Adam, and Newton's method from scratch. Test them on: (1) a simple convex quadratic, (2) the Rosenbrock function (non-convex), and (3) a 10D ill-conditioned quadratic with condition number Îº=100. For each, plot the loss curves and final convergence. Compare the number of iterations to reach L(Î¸) âˆ’ L(Î¸*) < 0.001. Observe which optimizers excel on which landscapes.",
            },
            {
              type: "practice",
              title: "Observe Optimizer Convergence in the Dashboard",
              description:
                "Open the ML dashboard's model training panel. Train a neural network using SGD, then Adam. Observe the real-time loss curves. Notice how Adam typically converges faster and with less oscillation. Experiment with learning rate schedules (constant, step decay, cosine annealing) and observe their effect on final performance. Document which optimizer + schedule combination achieves the lowest validation loss for your forex prediction task.",
            },
          ],
        },
      ],
    };
