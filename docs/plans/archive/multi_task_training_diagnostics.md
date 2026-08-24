# Multi-Task Learning: Training Diagnostics & Metrics Reference

Comprehensive, implementable metrics for diagnosing multi-task learning during training.
Covers gradient conflicts, task dominance, overfitting, calibration, Pareto optimality, and more.

---

## 1. Gradient Conflict Detection

### What it measures
Whether gradients from different tasks push shared parameters in opposing directions. When task A wants to increase a weight but task B wants to decrease it, you have **destructive interference** — the summed gradient partially cancels out and training becomes inefficient or oscillatory.

### Why it matters
Gradient conflict is the root cause of **negative transfer** in hard-parameter-sharing MTL. If you don't detect it, you won't know why your model plateaus or why adding a task hurts performance.

### How to compute: Pairwise cosine similarity

```python
import torch
import torch.nn.functional as F

def compute_per_task_gradients(model, shared_params, losses):
    """
    Compute gradient of each task loss w.r.t. shared parameters.
    Returns list of flattened gradient vectors, one per task.
    """
    task_grads = []
    for loss in losses:
        model.zero_grad()
        loss.backward(retain_graph=True)
        grad = torch.cat([p.grad.detach().flatten() for p in shared_params])
        task_grads.append(grad)
    return task_grads

def gradient_conflict_matrix(task_grads):
    """
    Compute NxN cosine similarity matrix between all task gradient pairs.
    """
    n = len(task_grads)
    cos_matrix = torch.zeros(n, n)
    for i in range(n):
        for j in range(n):
            cos_matrix[i, j] = F.cosine_similarity(
                task_grads[i].unsqueeze(0),
                task_grads[j].unsqueeze(0)
            ).item()
    return cos_matrix
```

### Interpretation of values

| Cosine Similarity | Meaning | Action |
|---|---|---|
| **+0.5 to +1.0** | Strong alignment — tasks help each other | No intervention needed |
| **+0.1 to +0.5** | Mild alignment — mostly cooperative | Monitor |
| **-0.1 to +0.1** | Near-orthogonal — tasks are independent | Gradients dilute each other; consider separate learning rates |
| **-0.5 to -0.1** | Moderate conflict — destructive interference | Apply PCGrad or CAGrad |
| **-1.0 to -0.5** | Severe conflict — tasks are antagonistic | Consider splitting shared layers, task grouping, or separate backbones |

### PCGrad projection (when conflict detected)

```python
def pcgrad_project(task_grads):
    """
    PCGrad: Project conflicting gradients onto normal plane of each other.
    Yu et al. 2020 - "Gradient Surgery for Multi-Task Learning"
    """
    import random
    projected = [g.clone() for g in task_grads]
    for i in range(len(projected)):
        order = list(range(len(projected)))
        random.shuffle(order)
        for j in order:
            if i == j:
                continue
            dot = torch.dot(projected[i], task_grads[j])
            if dot < 0:  # Conflict detected
                projected[i] -= (dot / (torch.dot(task_grads[j], task_grads[j]) + 1e-12)) * task_grads[j]
    return projected
```

### CAGrad (Conflict-Averse Gradient Descent)

CAGrad improves on PCGrad by finding a descent direction that maximizes the minimum improvement across all tasks, constrained to stay near the average gradient:

```python
def cagrad(task_grads, c=0.5):
    """
    CAGrad: Liu et al. 2021.
    c: radius constraint (0.5 is typical).
    Finds direction maximizing worst-case per-task improvement.
    """
    g_avg = torch.stack(task_grads).mean(dim=0)
    G = torch.stack(task_grads)  # [T, D]

    # Solve: max_{d: ||d - g_avg|| <= c||g_avg||} min_i <d, g_i>
    # Dual formulation leads to a small T-dimensional QP
    GGT = G @ G.T  # [T, T]
    g0_norm = g_avg.norm()

    # Solve via scipy or cvxpy for the T-dimensional dual
    # Simplified: use Frank-Wolfe or projected gradient on the dual
    # See https://github.com/Cranial-XIX/CAGrad for full solver
    return g_avg  # Placeholder — use full solver in production
```

### Nash-MTL (Bargaining Game)

Nash-MTL formulates gradient aggregation as a Nash bargaining game, producing solutions that are scale-invariant and well-balanced across the Pareto front. It solves for weights alpha such that the product of per-task improvements is maximized. Implementation: https://github.com/AvivNavon/nash-mtl

### Computational cost
- **Per-task backward passes**: O(T) backward passes where T = number of tasks
- **Cosine similarity matrix**: O(T^2 * D) where D = number of shared parameters
- **When to compute**: Every N steps (e.g., every 50-100 steps). Too expensive for every step with many tasks. Log the full matrix every epoch, spot-check every N steps.

---

## 2. Per-Task Gradient Norms

### What it measures
The magnitude of each task's gradient contribution to the shared backbone. Large disparity means one task dominates the gradient update while others barely influence shared weights.

### Why it matters
If task A has gradient norm 100x larger than task B, the shared parameters are essentially being trained only for task A. Task B gets dragged along and may never converge. This is the core problem GradNorm solves.

### How to compute

**Approach A: Separate backward passes (clean, recommended)**

```python
def per_task_gradient_norms(model, shared_params, losses):
    """
    Compute L2 norm of each task's gradient on shared parameters.
    Requires T backward passes.
    """
    norms = []
    for loss in losses:
        model.zero_grad()
        loss.backward(retain_graph=True)
        grad_norm = torch.sqrt(sum(
            p.grad.detach().pow(2).sum() for p in shared_params
        ))
        norms.append(grad_norm.item())
    return norms
```

**Approach B: GradNorm-style on last shared layer only (cheaper)**

```python
def gradnorm_norms(model, last_shared_layer, task_losses, task_weights):
    """
    GradNorm: Compute weighted gradient norms on last shared layer only.
    Chen et al. 2018.
    """
    norms = []
    for i, loss in enumerate(task_losses):
        # Weighted loss
        weighted_loss = task_weights[i] * loss
        # Gradient of weighted loss w.r.t. last shared layer
        grad = torch.autograd.grad(
            weighted_loss, last_shared_layer.parameters(),
            retain_graph=True, create_graph=True  # create_graph=True for GradNorm loss
        )
        norm = torch.cat([g.flatten() for g in grad]).norm(2)
        norms.append(norm)
    return norms
```

### GradNorm weight update algorithm

```python
def gradnorm_step(task_losses, task_losses_initial, task_weights,
                   last_shared_layer, alpha=1.5, lr_weights=0.025):
    """
    Full GradNorm update step.
    alpha: asymmetry parameter (0.12 in paper, 1.5 is common default).
           Higher alpha = more aggressive rebalancing.
    """
    T = len(task_losses)

    # 1. Compute per-task gradient norms (weighted)
    G_W = gradnorm_norms(None, last_shared_layer, task_losses, task_weights)

    # 2. Average gradient norm (target baseline)
    G_avg = sum(g.detach() for g in G_W) / T

    # 3. Inverse training rate per task
    loss_ratios = [task_losses[i].detach() / (task_losses_initial[i] + 1e-12)
                   for i in range(T)]
    avg_ratio = sum(loss_ratios) / T
    r = [lr / (avg_ratio + 1e-12) for lr in loss_ratios]

    # 4. Target gradient norm per task
    targets = [G_avg * (ri ** alpha) for ri in r]

    # 5. GradNorm loss
    grad_norm_loss = sum(torch.abs(G_W[i] - targets[i].detach()) for i in range(T))

    # 6. Update only task_weights
    task_weights.grad = None
    grad_norm_loss.backward()
    with torch.no_grad():
        task_weights -= lr_weights * task_weights.grad
        # Renormalize so weights sum to T
        task_weights.data = task_weights.data * T / task_weights.data.sum()
```

### Interpretation

| Gradient Norm Ratio (max/min) | Meaning | Action |
|---|---|---|
| **< 3x** | Balanced — tasks contribute roughly equally | Healthy |
| **3x - 10x** | Imbalanced — dominant task emerging | Apply GradNorm or manual weight adjustment |
| **10x - 100x** | Severely imbalanced — one task owns the backbone | Urgent: GradNorm, uncertainty weighting, or loss scaling |
| **> 100x** | Pathological — secondary tasks effectively frozen | Architectural intervention needed (task-specific adapters, separate backbones) |

### Computational cost
- O(T) backward passes for separate computation
- GradNorm on last shared layer only: much cheaper (small parameter subset)
- **When to compute**: Every step if using GradNorm for weight updates. As a diagnostic only, every 50-100 steps suffices.

---

## 3. Task Dominance Metrics

### What it measures
Whether one task is monopolizing the shared representation, even when loss weights appear balanced. A task can dominate through larger gradients, faster loss decrease, or by pushing shared features toward its own optimum at the expense of others.

### Three complementary signals

#### 3a. Effective vs. Learned Task Weights

```python
def effective_task_weights(task_grads, combined_grad):
    """
    Measure how much each task actually contributes to the final update.
    Even with equal nominal weights, effective contribution varies.
    """
    effective = []
    combined_norm = combined_grad.norm()
    for g in task_grads:
        # Projection of task gradient onto combined gradient direction
        projection = torch.dot(g, combined_grad) / (combined_norm + 1e-12)
        effective.append(projection.item())
    # Normalize to get fractions
    total = sum(abs(e) for e in effective)
    fractions = [e / (total + 1e-12) for e in effective]
    return fractions  # Should be ~1/T each if balanced
```

**Interpretation**: If task 1 has effective weight 0.85 and task 2 has 0.15, task 1 dominates the update direction regardless of nominal weights.

#### 3b. Loss Ratio Analysis (Relative Training Speed)

```python
def loss_ratio_tracker(current_losses, initial_losses):
    """
    Track how fast each task is learning relative to its starting point.
    GradNorm's "inverse training rate."
    """
    ratios = {}
    for task_name, loss in current_losses.items():
        ratio = loss / (initial_losses[task_name] + 1e-12)
        ratios[task_name] = ratio
    # If one task has ratio 0.1 (90% reduced) and another 0.9 (10% reduced),
    # the fast task is likely dominating.
    return ratios
```

**Interpretation**:
- All tasks at similar ratios (e.g., all ~0.5): Balanced training
- One task at 0.1 while others at 0.8: That task dominated early training
- Stalled task (ratio ~1.0 after many epochs): Being suppressed

#### 3c. Feature Attribution per Task

```python
def shared_feature_utilization(shared_features, task_heads):
    """
    Measure which shared features each task head actually uses.
    High overlap = good sharing. Low overlap = tasks need different features.
    """
    # Compute gradient of each task's output w.r.t. shared features
    utilization = {}
    for name, head in task_heads.items():
        # Use gradient magnitude as proxy for feature importance
        output = head(shared_features)
        grad = torch.autograd.grad(
            output.sum(), shared_features, retain_graph=True
        )[0]
        utilization[name] = grad.abs().mean(dim=0)  # [feature_dim]

    # Compute overlap between task feature utilization patterns
    tasks = list(utilization.keys())
    for i in range(len(tasks)):
        for j in range(i+1, len(tasks)):
            cos_sim = F.cosine_similarity(
                utilization[tasks[i]].unsqueeze(0),
                utilization[tasks[j]].unsqueeze(0)
            )
            print(f"{tasks[i]} vs {tasks[j]} feature overlap: {cos_sim.item():.3f}")
```

### When to compute
- Loss ratios: Every epoch (cheap)
- Effective weights: Every 100 steps (moderate cost)
- Feature attribution: Every 5 epochs (expensive)

---

## 4. Per-Task Overfitting Detection

### What it measures
Whether individual task heads are overfitting even when the aggregate loss looks fine. In MTL, it is common for one head to overfit while another underfits, and aggregate metrics hide this.

### Core metric: Per-task generalization gap

```python
class PerTaskOverfitTracker:
    def __init__(self, task_names, patience=10, threshold=0.05):
        self.task_names = task_names
        self.patience = patience
        self.threshold = threshold  # Relative gap threshold
        self.train_losses = {t: [] for t in task_names}
        self.val_losses = {t: [] for t in task_names}
        self.best_val = {t: float('inf') for t in task_names}
        self.epochs_no_improve = {t: 0 for t in task_names}

    def update(self, epoch, train_losses, val_losses):
        """Call at end of each epoch with per-task losses."""
        diagnostics = {}
        for task in self.task_names:
            tl = train_losses[task]
            vl = val_losses[task]
            self.train_losses[task].append(tl)
            self.val_losses[task].append(vl)

            # Generalization gap (relative)
            gap = (vl - tl) / (tl + 1e-12)

            # Detect divergence: val going up while train going down
            if len(self.val_losses[task]) >= 3:
                val_trend = self.val_losses[task][-1] - self.val_losses[task][-3]
                train_trend = self.train_losses[task][-1] - self.train_losses[task][-3]
                diverging = val_trend > 0 and train_trend < 0
            else:
                diverging = False

            # Per-task early stopping check
            if vl < self.best_val[task]:
                self.best_val[task] = vl
                self.epochs_no_improve[task] = 0
            else:
                self.epochs_no_improve[task] += 1

            diagnostics[task] = {
                'gap': gap,
                'gap_abs': vl - tl,
                'diverging': diverging,
                'stalled_epochs': self.epochs_no_improve[task],
                'overfit_alert': gap > self.threshold and diverging,
                'needs_stopping': self.epochs_no_improve[task] >= self.patience,
            }
        return diagnostics
```

### Interpretation thresholds

| Metric | Good | Warning | Critical |
|---|---|---|---|
| **Relative gap** (val-train)/train | < 0.10 | 0.10 - 0.30 | > 0.30 |
| **Val trend** (3-epoch slope) | Decreasing | Flat | Increasing |
| **Divergence** (val up + train down) | False | -- | True for > 3 epochs |
| **Stalled epochs** | 0-5 | 5-10 | > 10 (task has peaked) |

### Per-task actions when overfitting detected
- **Increase dropout** on that task's head only
- **Freeze the task head** and continue training shared backbone + other heads
- **Reduce that task's weight** to prevent it from distorting shared features
- **Add task-specific regularization** (label smoothing, data augmentation for that task)

### When to compute
- Every epoch. This is cheap (just logging losses you already compute).

---

## 5. Multi-Task Loss Landscape (Per-Task Hessian Analysis)

### What it measures
How the curvature of the loss surface differs per task on shared parameters. If task A has high curvature (sharp minimum) and task B has low curvature (flat minimum), they need fundamentally different learning rates on the same parameters.

### Why it matters
- Sharp minima generalize worse. If one task pushes shared params into a sharp minimum, other tasks suffer.
- Different curvatures mean the optimal step size differs per task — a single learning rate is a compromise.
- Large curvature variance across tasks indicates the shared representation is suboptimal for at least some tasks.

### Computing per-task Hessian trace via Hutchinson estimator

```python
def hutchinson_trace_estimate(loss, params, n_samples=30):
    """
    Estimate Tr(H) using Hutchinson's method.
    H = Hessian of loss w.r.t. params.
    Uses Rademacher random vectors for unbiased estimation.

    Cost: n_samples * (1 grad + 1 Hessian-vector product) each.
    """
    trace_estimate = 0.0
    param_list = list(params)

    for _ in range(n_samples):
        # Rademacher random vector (+1 or -1 with equal probability)
        v = [torch.randint_like(p, 0, 2).float() * 2 - 1 for p in param_list]

        # First-order gradient
        grads = torch.autograd.grad(loss, param_list, create_graph=True)

        # Hessian-vector product: H @ v
        Hv = torch.autograd.grad(
            grads, param_list, grad_outputs=v, retain_graph=True
        )

        # v^T H v = Tr(H) in expectation
        trace_estimate += sum(
            (vi * hvi).sum() for vi, hvi in zip(v, Hv)
        ).item()

    return trace_estimate / n_samples


def per_task_curvature(model, shared_params, task_losses):
    """
    Compute Hessian trace for each task's loss on shared parameters.
    Returns dict of task_name -> trace value.
    """
    curvatures = {}
    for task_name, loss in task_losses.items():
        trace = hutchinson_trace_estimate(loss, shared_params, n_samples=30)
        curvatures[task_name] = trace
    return curvatures
```

### Interpretation

| Hessian Trace | Meaning |
|---|---|
| **Large positive** | Sharp minimum — high curvature, sensitive to perturbation |
| **Small positive** | Flat minimum — robust, good generalization |
| **Near zero** | Saddle point region |
| **Negative** | Concave region (loss is at a maximum in some directions) |

**Cross-task comparison**:
- If Task A trace >> Task B trace: Task A has much sharper curvature. Consider per-task learning rates, or use curvature-aware optimizers.
- Trace ratio > 10x across tasks: Strong evidence that shared parameters are in a fundamentally different loss landscape region per task.

### Top-k Hessian eigenvalues (more expensive, more informative)

```python
def top_hessian_eigenvalues(loss, params, k=5, n_iter=100):
    """
    Compute top-k eigenvalues of the Hessian via power iteration.
    Much more expensive than trace but gives spectral information.
    """
    param_list = list(params)
    eigenvalues = []

    # Use Lanczos or power iteration
    # For production, use PyHessian library:
    # pip install pyhessian
    # from pyhessian import hessian
    # hessian_comp = hessian(model, criterion, data, cuda=True)
    # top_eigenvalues, _ = hessian_comp.eigenvalues(top_n=k)

    return eigenvalues  # Use PyHessian in practice
```

### Computational cost
- Hutchinson trace (30 samples): ~60 backward passes per task. Expensive.
- Top eigenvalues via Lanczos: 100+ backward-equivalent operations.
- **When to compute**: Every 5-10 epochs max. Or at checkpoints only. Not during regular training.

---

## 6. Task Correlation & Redundancy

### 6a. Prediction Correlation Matrix

```python
def prediction_correlation_matrix(model, dataloader, task_heads):
    """
    Compute Pearson correlation between task predictions.
    High correlation = tasks may be redundant (or naturally correlated).
    """
    all_preds = {name: [] for name in task_heads}

    with torch.no_grad():
        for batch in dataloader:
            features = model.backbone(batch['input'])
            for name, head in task_heads.items():
                pred = head(features)
                all_preds[name].append(pred.cpu())

    # Stack predictions
    preds = {name: torch.cat(ps, dim=0).flatten() for name, ps in all_preds.items()}
    task_names = list(preds.keys())
    n = len(task_names)

    corr_matrix = torch.zeros(n, n)
    for i in range(n):
        for j in range(n):
            x = preds[task_names[i]]
            y = preds[task_names[j]]
            corr_matrix[i, j] = torch.corrcoef(torch.stack([x, y]))[0, 1]

    return corr_matrix, task_names
```

**Interpretation**:
- |r| > 0.9: Tasks are near-redundant. Consider dropping one or using a single head with multi-output.
- |r| between 0.3-0.7: Moderate correlation. Healthy for MTL — tasks share useful structure.
- |r| < 0.1: Tasks are unrelated. MTL may not help; consider separate models.

### 6b. Gradient Correlation Matrix

```python
def gradient_correlation_matrix(task_grads):
    """
    Pearson correlation between per-task gradient vectors.
    More informative than cosine similarity for detecting linear relationships.
    """
    G = torch.stack(task_grads)  # [T, D]
    # Center each gradient (subtract mean)
    G_centered = G - G.mean(dim=1, keepdim=True)
    # Correlation matrix
    corr = torch.corrcoef(G)  # [T, T]
    return corr
```

### 6c. Centered Kernel Alignment (CKA)

CKA compares the **representation geometry** between different layers or different models. For MTL diagnostics, compare each task head's input representation to detect whether the shared backbone produces genuinely different features for different tasks.

```python
def linear_cka(X, Y):
    """
    Linear CKA between two representation matrices.
    X: [N, D1] - representations from source A (N samples, D1 features)
    Y: [N, D2] - representations from source B

    Returns CKA similarity in [0, 1].
    Based on Kornblith et al. 2019.
    """
    # Center columns
    X = X - X.mean(dim=0)
    Y = Y - Y.mean(dim=0)

    # HSIC with linear kernel
    # HSIC(X, Y) = ||Y^T X||_F^2 / ((N-1)^2)
    # CKA = HSIC(X, Y) / sqrt(HSIC(X, X) * HSIC(Y, Y))

    hsic_xy = (X.T @ Y).pow(2).sum()
    hsic_xx = (X.T @ X).pow(2).sum()
    hsic_yy = (Y.T @ Y).pow(2).sum()

    cka = hsic_xy / (torch.sqrt(hsic_xx * hsic_yy) + 1e-12)
    return cka.item()


def minibatch_cka(X_batches, Y_batches):
    """
    Unbiased minibatch CKA for large datasets.
    Accumulates HSIC estimates across batches.
    """
    hsic_xy_acc = 0.0
    hsic_xx_acc = 0.0
    hsic_yy_acc = 0.0

    for X, Y in zip(X_batches, Y_batches):
        X = X - X.mean(dim=0)
        Y = Y - Y.mean(dim=0)
        hsic_xy_acc += (X.T @ Y).pow(2).sum().item()
        hsic_xx_acc += (X.T @ X).pow(2).sum().item()
        hsic_yy_acc += (Y.T @ Y).pow(2).sum().item()

    return hsic_xy_acc / (((hsic_xx_acc * hsic_yy_acc) ** 0.5) + 1e-12)
```

**How to use CKA for MTL diagnostics**:
1. Extract shared backbone output for a batch
2. Pass through each task head's first layer to get task-specific representations
3. Compute pairwise CKA between these task-specific representations
4. High CKA (> 0.8) between task representations = tasks use similar features from backbone
5. Low CKA (< 0.3) = tasks need very different features, suggesting shared backbone is insufficient

### Computational cost
- Prediction correlation: O(N * T) forward passes. Cheap. Every epoch.
- Gradient correlation: Already computed if doing gradient conflict detection.
- CKA: O(N * D^2) per pair. Moderate. Every 5 epochs.

---

## 7. Calibration Metrics

### What it measures
Whether a model's predicted probabilities match actual frequencies. A model that says "80% confidence" should be correct 80% of the time. Miscalibrated models are overconfident or underconfident.

### Why it matters for MTL
Each classification head can be differently calibrated. One head may be well-calibrated while another is severely overconfident. Aggregate calibration hides per-head issues.

### 7a. Expected Calibration Error (ECE)

```python
def expected_calibration_error(probs, labels, n_bins=15):
    """
    Compute ECE for a single classification head.

    probs: [N] predicted probabilities for the positive class (or max class prob)
    labels: [N] binary/integer ground truth
    n_bins: number of confidence bins

    Returns ECE value in [0, 1]. Lower is better.
    """
    bin_boundaries = torch.linspace(0, 1, n_bins + 1)
    ece = 0.0
    total = len(probs)

    for i in range(n_bins):
        lo = bin_boundaries[i]
        hi = bin_boundaries[i + 1]
        mask = (probs > lo) & (probs <= hi)

        if mask.sum() == 0:
            continue

        bin_conf = probs[mask].mean().item()    # Average confidence in bin
        bin_acc = labels[mask].float().mean().item()  # Actual accuracy in bin
        bin_size = mask.sum().item()

        ece += (bin_size / total) * abs(bin_acc - bin_conf)

    return ece


def per_task_calibration(model, dataloader, task_heads, n_bins=15):
    """
    Compute ECE for each classification head independently.
    """
    all_probs = {name: [] for name in task_heads}
    all_labels = {name: [] for name in task_heads}

    with torch.no_grad():
        for batch in dataloader:
            features = model.backbone(batch['input'])
            for name, head in task_heads.items():
                logits = head(features)
                probs = torch.softmax(logits, dim=-1)
                max_probs, _ = probs.max(dim=-1)
                preds_correct = (probs.argmax(dim=-1) == batch[f'label_{name}'])
                all_probs[name].append(max_probs.cpu())
                all_labels[name].append(preds_correct.cpu())

    ece_per_task = {}
    for name in task_heads:
        probs = torch.cat(all_probs[name])
        labels = torch.cat(all_labels[name])
        ece_per_task[name] = expected_calibration_error(probs, labels, n_bins)

    return ece_per_task
```

### 7b. Reliability Diagram Data

```python
def reliability_diagram_data(probs, labels, n_bins=15):
    """
    Returns data for plotting a reliability diagram.
    Perfect calibration = diagonal line.
    """
    bin_boundaries = torch.linspace(0, 1, n_bins + 1)
    bins = []

    for i in range(n_bins):
        lo = bin_boundaries[i]
        hi = bin_boundaries[i + 1]
        mask = (probs > lo) & (probs <= hi)

        if mask.sum() == 0:
            bins.append({'confidence': (lo + hi).item() / 2, 'accuracy': None, 'count': 0})
            continue

        bins.append({
            'confidence': probs[mask].mean().item(),
            'accuracy': labels[mask].float().mean().item(),
            'count': mask.sum().item(),
        })

    return bins
```

### 7c. Prediction Distribution Analysis

```python
def prediction_distribution_stats(probs):
    """
    Analyze the distribution of predicted probabilities.
    Overconfident models cluster near 0 and 1.
    Underconfident models cluster near 0.5.
    """
    return {
        'mean_confidence': probs.mean().item(),
        'std_confidence': probs.std().item(),
        'pct_above_0.9': (probs > 0.9).float().mean().item(),
        'pct_below_0.1': (probs < 0.1).float().mean().item(),
        'entropy': -(probs * probs.log() + (1-probs) * (1-probs).log()).mean().item(),
    }
```

### Interpretation

| ECE | Quality |
|---|---|
| **< 0.02** | Excellent calibration |
| **0.02 - 0.05** | Good — acceptable for most applications |
| **0.05 - 0.10** | Mediocre — consider temperature scaling |
| **0.10 - 0.20** | Poor — definitely needs post-hoc calibration |
| **> 0.20** | Severely miscalibrated |

**Common MTL calibration patterns**:
- Task with highest loss weight often best calibrated
- Tasks with less data or higher noise tend to be overconfident
- Fix: Per-head temperature scaling (learn a scalar T per head, divide logits by T)

### Computational cost
- ECE: O(N) per task. Very cheap.
- **When to compute**: Every epoch on validation set.

---

## 8. Pareto Optimality

### What it measures
Whether you are on the **Pareto frontier** — the set of solutions where you cannot improve any task without hurting another. If you are below the frontier, you are leaving performance on the table.

### Why it matters
A model that gets 90% on task A and 85% on task B might seem good, but if a Pareto-optimal model achieves 92% on A and 87% on B, you are wasting capacity. Pareto analysis tells you whether your gradient balancing method is actually finding good trade-offs.

### 8a. Dominance Detection

```python
def is_dominated(losses_a, losses_b):
    """
    Check if solution A is dominated by solution B.
    A is dominated if B is <= A on all tasks and < A on at least one.
    (Assuming lower loss is better.)
    """
    all_leq = all(b <= a for a, b in zip(losses_a, losses_b))
    any_lt = any(b < a for a, b in zip(losses_a, losses_b))
    return all_leq and any_lt


def find_pareto_front(solutions):
    """
    Given a list of (config, losses) tuples, find non-dominated solutions.
    solutions: list of (config_dict, [loss_task1, loss_task2, ...])
    """
    pareto = []
    for i, (config_i, losses_i) in enumerate(solutions):
        dominated = False
        for j, (config_j, losses_j) in enumerate(solutions):
            if i != j and is_dominated(losses_i, losses_j):
                dominated = True
                break
        if not dominated:
            pareto.append((config_i, losses_i))
    return pareto
```

### 8b. Hypervolume Indicator

The hypervolume measures the volume of objective space dominated by your Pareto front. Higher hypervolume = better Pareto front.

```python
def hypervolume_2d(pareto_losses, reference_point):
    """
    Compute hypervolume for 2-objective case.
    pareto_losses: list of [loss1, loss2] for each Pareto point
    reference_point: [ref1, ref2] — worst acceptable losses (upper bound)

    For >2 objectives, use BoTorch:
        from botorch.utils.multi_objective.hypervolume import Hypervolume
        hv = Hypervolume(ref_point=torch.tensor(reference_point))
        volume = hv.compute(torch.tensor(pareto_losses))
    """
    # Sort by first objective
    sorted_pts = sorted(pareto_losses, key=lambda x: x[0])

    hv = 0.0
    prev_y = reference_point[1]

    for pt in sorted_pts:
        if pt[0] < reference_point[0] and pt[1] < reference_point[1]:
            width = reference_point[0] - pt[0]  # Simplified for incremental
            height = prev_y - pt[1]
            if height > 0:
                hv += (reference_point[0] - pt[0]) * (prev_y - pt[1])
                prev_y = pt[1]

    return hv  # Use BoTorch for correct general implementation


# Production approach for any number of objectives:
def hypervolume_botorch(pareto_losses, reference_point):
    """
    Uses BoTorch's exact hypervolume computation.
    pip install botorch
    """
    from botorch.utils.multi_objective.hypervolume import Hypervolume
    hv = Hypervolume(ref_point=torch.tensor(reference_point))
    volume = hv.compute(torch.tensor(pareto_losses))
    return volume.item()
```

### 8c. Pareto Stationarity Check (Gradient-Based)

You don't need to enumerate the entire front. You can check if your current model is at a Pareto-stationary point by checking the MGDA condition:

```python
def check_pareto_stationarity(task_grads, tol=1e-4):
    """
    Check if current point is Pareto stationary.
    A point is Pareto stationary if no convex combination of task gradients
    yields a common descent direction.

    Equivalently: the minimum-norm point in the convex hull of task gradients
    has norm < tol.

    Uses the min-norm solver from MGDA (Sener & Koltun 2018).
    """
    G = torch.stack(task_grads)  # [T, D]
    T = G.shape[0]

    # Solve: min_{alpha in simplex} ||sum(alpha_i * g_i)||^2
    # = min_{alpha} alpha^T (G @ G^T) alpha
    GGT = G @ G.T  # [T, T]

    # Simple Frank-Wolfe solver
    alpha = torch.ones(T) / T  # Start uniform

    for _ in range(200):
        # Gradient of quadratic w.r.t. alpha
        grad_alpha = 2 * GGT @ alpha

        # Find vertex of simplex minimizing linear approximation
        min_idx = grad_alpha.argmin()
        e = torch.zeros(T)
        e[min_idx] = 1.0

        # Line search: step toward vertex
        gamma = 2.0 / (_ + 2.0)
        alpha = (1 - gamma) * alpha + gamma * e

    # Minimum-norm element
    min_norm_grad = (alpha.unsqueeze(0) @ G).squeeze(0)
    min_norm = min_norm_grad.norm().item()

    return {
        'pareto_stationary': min_norm < tol,
        'min_norm': min_norm,
        'task_weights_at_optimum': alpha.tolist(),
    }
```

### Interpretation

| Signal | Meaning | Action |
|---|---|---|
| **Min-norm ~0** | At or near Pareto stationary point | You are on the frontier. Changing weights trades off tasks. |
| **Min-norm >> 0** | Common descent direction exists | There is room to improve ALL tasks. Likely a gradient balancing problem. |
| **Hypervolume increasing** | Pareto front improving | Training is making progress on the multi-objective problem. |
| **Hypervolume stagnant** | Front has converged | Consider stopping, or trying different architecture. |
| **Current model is dominated** | Another config is better on ALL tasks | Your weight/gradient strategy is suboptimal. |

### Practical Pareto workflow
1. Train several models with different weight configs or gradient methods
2. Collect final (val_loss_task1, val_loss_task2, ...) for each
3. Compute Pareto front and hypervolume
4. Check if your production model is on the front
5. If not: adopt the dominating configuration

### Computational cost
- Dominance check: O(N^2 * T) where N = number of solutions. Cheap if N is small.
- Hypervolume: Exponential in T (number of tasks) in general, but fast for T <= 5 via BoTorch.
- Pareto stationarity: O(200 * T * D) for Frank-Wolfe. Run every epoch or at checkpoints.
- **When to compute**: Pareto stationarity every epoch. Full Pareto front comparison after training runs.

---

## Summary: What to Log and When

### Every Training Step (or every N=50 steps)
| Metric | Cost | Purpose |
|---|---|---|
| Per-task loss values | Free | Basic monitoring |
| Per-task gradient norms (last shared layer) | 1 extra backward per task | Detect imbalance |
| GradNorm weight updates | Part of training | Automatic balancing |

### Every Epoch
| Metric | Cost | Purpose |
|---|---|---|
| Per-task train/val losses | Free | Overfitting detection |
| Per-task generalization gap | Free | Per-head overfitting |
| Loss ratios vs initial | Free | Training speed balance |
| Per-task ECE on val set | Cheap | Calibration monitoring |
| Pareto stationarity check | Moderate | Are we on the frontier? |
| Pairwise gradient cosine similarity | T backward passes | Conflict detection |

### Every 5 Epochs
| Metric | Cost | Purpose |
|---|---|---|
| CKA between task representations | Moderate | Feature sharing analysis |
| Prediction correlation matrix | Moderate | Task redundancy |
| Effective task weights | Moderate | True influence measurement |

### At Checkpoints / End of Training
| Metric | Cost | Purpose |
|---|---|---|
| Per-task Hessian trace | Expensive | Curvature analysis |
| Full Pareto front + hypervolume | Requires multiple runs | Optimality assessment |
| Reliability diagrams per head | Cheap | Visual calibration check |

---

## Key Libraries

| Library | Purpose | Install |
|---|---|---|
| **LibMOON** | 20+ gradient methods (PCGrad, CAGrad, Nash-MTL, MGDA, etc.) | `pip install libmoon` |
| **BoTorch** | Hypervolume, Pareto front utilities | `pip install botorch` |
| **PyHessian** | Hessian eigenvalues, trace, spectral density | `pip install pyhessian` |
| **TorchMetrics** | ECE and calibration metrics | `pip install torchmetrics` |
| **BackPACK** | Efficient Hessian-vector products | `pip install backpack-for-pytorch` |

---

## References

- **PCGrad**: Yu et al. 2020 — "Gradient Surgery for Multi-Task Learning" (NeurIPS 2020)
- **GradNorm**: Chen et al. 2018 — "Gradient Normalization for Adaptive Loss Balancing" (ICML 2018)
- **CAGrad**: Liu et al. 2021 — "Conflict-Averse Gradient Descent for Multi-task Learning" (NeurIPS 2021)
- **Nash-MTL**: Navon et al. 2022 — "Multi-Task Learning as a Bargaining Game" (ICML 2022)
- **MGDA**: Sener & Koltun 2018 — "Multi-Task Learning as Multi-Objective Optimization" (NeurIPS 2018)
- **Uncertainty Weighting**: Kendall et al. 2018 — "Multi-Task Learning Using Uncertainty to Weigh Losses" (CVPR 2018)
- **CKA**: Kornblith et al. 2019 — "Similarity of Neural Network Representations Revisited" (ICML 2019)
- **Curvature-Informed MTL**: 2022 — "Curvature-informed multi-task learning for graph networks"
- **Hutchinson Trace**: Hutchinson 1990 — "A stochastic estimator of the trace of the influence matrix"
