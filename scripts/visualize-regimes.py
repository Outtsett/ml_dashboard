"""
HDP-HMM regime visualization — comprehensive analysis plots.

Generates multi-panel analysis from training checkpoint data:
  1. Convergence curve (LL, active regimes, stability)
  2. Regime distribution (bar chart + pie)
  3. Regime feature profiles (heatmap)
  4. Transition matrix (heatmap)
  5. Regime timeline (color strip)
  6. Per-regime return/volatility distributions
  7. Walk-forward stability
  8. OOS evaluation
  9. SHAP feature importance per regime
  10. Regime dwell time distributions

Output: data/models/{model_id}/analysis.html (interactive) + .png panels

Usage:
    python scripts/visualize-regimes.py --model MNQZ5_1m_hdp-hmm_20260302T015913
    python scripts/visualize-regimes.py --model latest
    python scripts/visualize-regimes.py --model MNQZ5_1m_hdp-hmm_20260302T015913 --format png
"""

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# Matplotlib setup (non-interactive backend)
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib.colors import LinearSegmentedColormap
import matplotlib.patches as mpatches

ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "data" / "models"

# Regime color palette (matches frontend REGIME_COLORS)
REGIME_COLORS = [
    "#f43f5e",  # rose
    "#f97316",  # orange
    "#f59e0b",  # amber
    "#10b981",  # emerald
    "#06b6d4",  # cyan
    "#3b82f6",  # blue
    "#8b5cf6",  # violet
    "#ec4899",  # pink
    "#ef4444",  # red
    "#14b8a6",  # teal
    "#6366f1",  # indigo
    "#a855f7",  # purple
]


def get_color(idx):
    return REGIME_COLORS[idx % len(REGIME_COLORS)]


def find_model(model_id):
    """Resolve model directory."""
    if model_id == "latest":
        dirs = sorted(MODELS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
        for d in dirs:
            if (d / "diagnostics.json").exists():
                return d
        raise FileNotFoundError("No model checkpoints found")
    path = MODELS_DIR / model_id
    if not path.exists():
        raise FileNotFoundError(f"Model not found: {path}")
    return path


def load_model_data(model_dir):
    """Load all available data from a model checkpoint."""
    data = {}

    # Diagnostics
    diag_path = model_dir / "diagnostics.json"
    if diag_path.exists():
        with open(diag_path) as f:
            data["diagnostics"] = json.load(f)

    # Convergence
    conv_path = model_dir / "convergence.json"
    if conv_path.exists():
        with open(conv_path) as f:
            data["convergence"] = json.load(f)

    # Assignments
    assign_path = model_dir / "assignments.csv"
    if assign_path.exists():
        data["assignments"] = pd.read_csv(str(assign_path))

    return data


# ── Plot functions ────────────────────────────────────────────────────────


def plot_convergence(conv_data, ax_ll, ax_regimes, ax_stability):
    """Plot convergence metrics over Gibbs iterations."""
    points = conv_data.get("gibbs", [])
    if not points:
        return

    iters = [p["iter"] for p in points]
    ll = [p["log_likelihood"] for p in points]
    n_states = [p["n_active_states"] for p in points]
    self_trans = [p.get("self_transition", 0) for p in points]
    entropy = [p.get("entropy", 0) for p in points]
    switch_rate = [p.get("switch_rate", 0) for p in points]

    # Log-likelihood
    ax_ll.plot(iters, ll, color="#3b82f6", linewidth=1.5)
    ax_ll.set_ylabel("Log-Likelihood", fontsize=9)
    ax_ll.set_title("Convergence", fontsize=11, fontweight="bold")
    ax_ll.grid(True, alpha=0.3)
    ax_ll.ticklabel_format(style="sci", axis="y", scilimits=(0, 0))

    # Active regimes
    ax_regimes.plot(iters, n_states, color="#10b981", linewidth=1.5)
    ax_regimes.set_ylabel("Active Regimes", fontsize=9)
    ax_regimes.grid(True, alpha=0.3)

    # Self-transition + switch rate
    ax_stability.plot(iters, self_trans, color="#f59e0b", linewidth=1, label="Self-transition")
    ax_stability.plot(iters, switch_rate, color="#ef4444", linewidth=1, label="Switch rate")
    ax_stability.set_ylabel("Rate", fontsize=9)
    ax_stability.set_xlabel("Iteration", fontsize=9)
    ax_stability.legend(fontsize=7, loc="right")
    ax_stability.grid(True, alpha=0.3)


def plot_regime_distribution(regime_stats, ax):
    """Bar chart of regime proportions with labels."""
    if not regime_stats:
        return

    ids = [rs["regime_id"] for rs in regime_stats]
    pcts = [rs["pct"] for rs in regime_stats]
    labels = [rs.get("nickname", rs.get("label", f"R{rs['regime_id']}")) for rs in regime_stats]
    colors = [get_color(i) for i in range(len(ids))]

    bars = ax.barh(range(len(ids)), pcts, color=colors, edgecolor="white", linewidth=0.5)
    ax.set_yticks(range(len(ids)))
    ax.set_yticklabels(labels, fontsize=8)
    ax.set_xlabel("% of bars", fontsize=9)
    ax.set_title("Regime Distribution", fontsize=11, fontweight="bold")
    ax.invert_yaxis()
    ax.grid(True, axis="x", alpha=0.3)

    for bar, pct in zip(bars, pcts):
        ax.text(bar.get_width() + 0.3, bar.get_y() + bar.get_height() / 2,
                f"{pct:.1f}%", va="center", fontsize=7)


def plot_regime_profiles(regime_stats, feature_names, ax):
    """Heatmap of per-regime feature characteristics."""
    if not regime_stats or not feature_names:
        return

    n_regimes = len(regime_stats)
    # Use characteristics (top feature z-scores) if available
    feature_subset = feature_names[:15]  # limit to 15 for readability

    matrix = np.zeros((n_regimes, len(feature_subset)))
    for i, rs in enumerate(regime_stats):
        chars = rs.get("characteristics", {})
        for j, feat in enumerate(feature_subset):
            matrix[i, j] = chars.get(feat, 0.0)

    im = ax.imshow(matrix, cmap="RdBu_r", aspect="auto", vmin=-2, vmax=2)
    ax.set_yticks(range(n_regimes))
    labels = [rs.get("nickname", f"R{rs['regime_id']}") for rs in regime_stats]
    ax.set_yticklabels(labels, fontsize=7)
    ax.set_xticks(range(len(feature_subset)))
    ax.set_xticklabels(feature_subset, rotation=45, ha="right", fontsize=6)
    ax.set_title("Regime Feature Profiles (z-score)", fontsize=11, fontweight="bold")
    plt.colorbar(im, ax=ax, shrink=0.8)


def plot_transition_matrix(diag, ax):
    """Heatmap of transition probabilities."""
    matrix = diag.get("transition_matrix")
    if matrix is None:
        return

    matrix = np.array(matrix)
    n = matrix.shape[0]

    im = ax.imshow(matrix, cmap="YlOrRd", vmin=0, vmax=1, aspect="equal")
    ax.set_title("Transition Matrix", fontsize=11, fontweight="bold")
    ax.set_xlabel("To regime", fontsize=9)
    ax.set_ylabel("From regime", fontsize=9)
    ax.set_xticks(range(n))
    ax.set_yticks(range(n))

    # Annotate cells
    for i in range(n):
        for j in range(n):
            val = matrix[i, j]
            if val > 0.01:
                color = "white" if val > 0.5 else "black"
                ax.text(j, i, f"{val:.2f}", ha="center", va="center",
                        fontsize=6, color=color)

    plt.colorbar(im, ax=ax, shrink=0.8)


def plot_regime_timeline(assignments_df, ax, max_points=5000):
    """Color-coded regime strip over time."""
    if assignments_df is None or len(assignments_df) == 0:
        return

    df = assignments_df.copy()
    if "ts" in df.columns:
        df["ts"] = pd.to_datetime(df["ts"])
    elif "timestamp" in df.columns:
        df["ts"] = pd.to_datetime(df["timestamp"])

    # Downsample for rendering
    if len(df) > max_points:
        step = len(df) // max_points
        df = df.iloc[::step].reset_index(drop=True)

    regimes = df["regime"].values
    n = len(regimes)
    unique_regimes = sorted(set(regimes))

    # Create color array
    for i in range(n - 1):
        color = get_color(int(regimes[i]))
        ax.axvspan(i, i + 1, color=color, alpha=0.8)

    ax.set_xlim(0, n)
    ax.set_yticks([])
    ax.set_title("Regime Timeline", fontsize=11, fontweight="bold")

    if "ts" in df.columns:
        # Add date labels
        n_labels = min(8, n)
        label_positions = np.linspace(0, n - 1, n_labels, dtype=int)
        ax.set_xticks(label_positions)
        ax.set_xticklabels(
            [df["ts"].iloc[p].strftime("%Y-%m") for p in label_positions],
            fontsize=7, rotation=30
        )

    # Legend
    patches = [mpatches.Patch(color=get_color(r), label=f"R{r}") for r in unique_regimes[:12]]
    ax.legend(handles=patches, loc="upper right", fontsize=6, ncol=min(6, len(patches)))


def plot_return_distributions(regime_stats, ax):
    """Per-regime return and volatility comparison."""
    if not regime_stats:
        return

    ids = range(len(regime_stats))
    returns = [rs.get("avg_return_pct", 0) for rs in regime_stats]
    vols = [rs.get("avg_volatility", 0) * 100 for rs in regime_stats]
    colors = [get_color(i) for i in ids]
    labels = [rs.get("nickname", f"R{rs['regime_id']}") for rs in regime_stats]

    x = np.arange(len(ids))
    width = 0.35

    bars1 = ax.bar(x - width / 2, returns, width, label="Avg Return (%)", color=colors, alpha=0.7)
    ax2 = ax.twinx()
    bars2 = ax2.bar(x + width / 2, vols, width, label="Volatility (%)", color=colors, alpha=0.3,
                    edgecolor=colors, linewidth=1.5)

    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=7)
    ax.set_ylabel("Avg Return (%)", fontsize=9)
    ax2.set_ylabel("Volatility (%)", fontsize=9)
    ax.axhline(y=0, color="gray", linewidth=0.5)
    ax.set_title("Return vs Volatility by Regime", fontsize=11, fontweight="bold")
    ax.grid(True, axis="y", alpha=0.3)

    lines1, labels1 = ax.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax.legend(lines1 + lines2, labels1 + labels2, fontsize=7, loc="upper left")


def plot_dwell_times(regime_stats, ax):
    """Average and max dwell time per regime."""
    if not regime_stats:
        return

    labels = [rs.get("nickname", f"R{rs['regime_id']}") for rs in regime_stats]
    avg_dwell = [rs.get("avg_duration", 0) for rs in regime_stats]
    max_dwell = [rs.get("max_duration", 0) for rs in regime_stats]
    colors = [get_color(i) for i in range(len(regime_stats))]

    x = np.arange(len(labels))
    width = 0.35

    ax.bar(x - width / 2, avg_dwell, width, label="Avg Dwell", color=colors, alpha=0.8)
    ax.bar(x + width / 2, max_dwell, width, label="Max Dwell", color=colors, alpha=0.3,
           edgecolor=colors, linewidth=1)

    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=7)
    ax.set_ylabel("Bars", fontsize=9)
    ax.set_title("Dwell Time by Regime", fontsize=11, fontweight="bold")
    ax.legend(fontsize=7)
    ax.grid(True, axis="y", alpha=0.3)


def plot_walk_forward(wf_data, ax):
    """Walk-forward stability visualization."""
    if not wf_data or "window_results" not in wf_data:
        ax.text(0.5, 0.5, "No walk-forward data", ha="center", va="center", transform=ax.transAxes)
        return

    windows = wf_data["window_results"]
    n = len(windows)
    x = range(1, n + 1)

    switch_rates = [w.get("switch_rate", 0) for w in windows]
    confidences = [w.get("avg_confidence", 0) for w in windows]

    ax.bar(x, switch_rates, color="#f59e0b", alpha=0.7, label="Switch Rate")
    ax2 = ax.twinx()
    ax2.plot(x, confidences, "o-", color="#3b82f6", linewidth=2, label="Confidence")

    ax.set_xlabel("Window", fontsize=9)
    ax.set_ylabel("Switch Rate", fontsize=9)
    ax2.set_ylabel("Confidence", fontsize=9)
    ax.set_title(f"Walk-Forward (stability={wf_data.get('stability_score', 0):.3f})",
                 fontsize=11, fontweight="bold")
    ax.set_xticks(list(x))

    lines1, labels1 = ax.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()
    ax.legend(lines1 + lines2, labels1 + labels2, fontsize=7)
    ax.grid(True, alpha=0.3)


def plot_oos_evaluation(oos_data, ax):
    """OOS distribution comparison."""
    if not oos_data:
        ax.text(0.5, 0.5, "No OOS data", ha="center", va="center", transform=ax.transAxes)
        return

    train_dist = oos_data.get("train_distribution", [])
    test_dist = oos_data.get("test_distribution", [])

    if not train_dist or not test_dist:
        return

    n = max(len(train_dist), len(test_dist))
    x = np.arange(n)
    width = 0.35

    ax.bar(x - width / 2, train_dist[:n], width, label="Train", color="#3b82f6", alpha=0.7)
    ax.bar(x + width / 2, test_dist[:n], width, label="Test", color="#ef4444", alpha=0.7)

    sim = oos_data.get("distribution_similarity", 0)
    ax.set_title(f"OOS Distribution (similarity={sim:.3f})", fontsize=11, fontweight="bold")
    ax.set_xlabel("Regime", fontsize=9)
    ax.set_ylabel("Proportion", fontsize=9)
    ax.legend(fontsize=8)
    ax.grid(True, axis="y", alpha=0.3)


def plot_shap_summary(shap_summary, ax):
    """Top SHAP features per regime."""
    if not shap_summary:
        ax.text(0.5, 0.5, "No SHAP data", ha="center", va="center", transform=ax.transAxes)
        return

    # Collect all features across regimes, build matrix
    all_features = set()
    for rs in shap_summary:
        for feat in rs.get("top_features", []):
            all_features.add(feat["feature"])

    features_sorted = sorted(all_features)[:20]  # top 20
    n_regimes = len(shap_summary)

    matrix = np.zeros((n_regimes, len(features_sorted)))
    for i, rs in enumerate(shap_summary):
        feat_map = {f["feature"]: f["mean_abs_shap"] for f in rs.get("top_features", [])}
        for j, feat in enumerate(features_sorted):
            matrix[i, j] = feat_map.get(feat, 0.0)

    im = ax.imshow(matrix, cmap="YlOrRd", aspect="auto")
    ax.set_yticks(range(n_regimes))
    ax.set_yticklabels([f"R{rs['regime_id']}" for rs in shap_summary], fontsize=8)
    ax.set_xticks(range(len(features_sorted)))
    ax.set_xticklabels(features_sorted, rotation=45, ha="right", fontsize=6)
    ax.set_title("SHAP Feature Importance by Regime", fontsize=11, fontweight="bold")
    plt.colorbar(im, ax=ax, shrink=0.8)


def plot_quality_summary(diag, ax):
    """Quality score and key metrics text panel."""
    ax.axis("off")

    quality = diag.get("quality_score", 0)
    n_regimes = diag.get("n_regimes", 0)
    n_bars = diag.get("n_bars", 0)
    symbol = diag.get("symbol", "?")
    timeframe = diag.get("timeframe", "?")
    training_time = diag.get("training_time_sec", 0)

    conv = diag.get("convergence_summary", {})
    final_ll = conv.get("final_log_likelihood", 0)

    oos = diag.get("out_of_sample", {})
    dist_sim = oos.get("distribution_similarity", 0)
    avg_profile = oos.get("avg_profile_correlation", 0)

    wf = diag.get("walk_forward", {})
    stability = wf.get("stability_score", 0)

    config = diag.get("training_config", {})

    # Color based on quality
    if quality >= 80:
        qcolor = "#10b981"
    elif quality >= 60:
        qcolor = "#f59e0b"
    else:
        qcolor = "#ef4444"

    text = (
        f"Quality Score: {quality}/100\n\n"
        f"Symbol: {symbol} {timeframe}\n"
        f"Bars: {n_bars:,}\n"
        f"Regimes: {n_regimes}\n"
        f"Training: {training_time:.0f}s\n\n"
        f"Final LL: {final_ll:.1f}\n"
        f"OOS Similarity: {dist_sim:.3f}\n"
        f"Profile Correlation: {avg_profile:.3f}\n"
        f"WF Stability: {stability:.3f}\n\n"
        f"Config:\n"
        f"  Gibbs: {config.get('gibbs_iter', '?')} iter\n"
        f"  alpha={config.get('alpha', '?')}\n"
        f"  gamma={config.get('gamma', '?')}\n"
        f"  kappa={config.get('kappa', '?')}"
    )

    ax.text(0.05, 0.95, text, transform=ax.transAxes, fontsize=9,
            verticalalignment="top", fontfamily="monospace",
            bbox=dict(boxstyle="round,pad=0.5", facecolor="white", edgecolor=qcolor, linewidth=2))


# ── Main ──────────────────────────────────────────────────────────────────


def generate_report(model_dir, output_format="png"):
    """Generate comprehensive regime analysis report."""
    print(f"Loading model from {model_dir.name}...")
    data = load_model_data(model_dir)

    if "diagnostics" not in data:
        print("ERROR: No diagnostics.json found")
        return

    diag = data["diagnostics"]
    conv = data.get("convergence", {})
    assignments = data.get("assignments")

    regime_stats = diag.get("regime_stats", [])
    feature_names = diag.get("feature_names", [])
    shap_summary = diag.get("shap_summary", [])
    wf_data = diag.get("walk_forward", {})
    oos_data = diag.get("out_of_sample", {})

    symbol = diag.get("symbol", "?")
    timeframe = diag.get("timeframe", "?")
    n_regimes = diag.get("n_regimes", 0)

    print(f"  {symbol} {timeframe}: {n_regimes} regimes, {diag.get('n_bars', 0):,} bars")
    print(f"  Quality: {diag.get('quality_score', 0)}/100")

    # ── Create figure ─────────────────────────────────────────────────────

    fig = plt.figure(figsize=(24, 20), facecolor="white")
    fig.suptitle(
        f"HDP-HMM Regime Analysis: {symbol} {timeframe} ({n_regimes} regimes)",
        fontsize=16, fontweight="bold", y=0.98
    )

    gs = gridspec.GridSpec(4, 4, figure=fig, hspace=0.35, wspace=0.35,
                           top=0.95, bottom=0.05, left=0.05, right=0.95)

    # Row 1: Quality + Convergence (3 panels) + Distribution
    ax_quality = fig.add_subplot(gs[0, 0])
    ax_conv_ll = fig.add_subplot(gs[0, 1])
    ax_conv_reg = fig.add_subplot(gs[0, 2])
    ax_dist = fig.add_subplot(gs[0, 3])

    # Row 2: Timeline (full width)
    ax_timeline = fig.add_subplot(gs[1, :])

    # Row 3: Return/Vol + Dwell + Transition + OOS
    ax_returns = fig.add_subplot(gs[2, 0])
    ax_dwell = fig.add_subplot(gs[2, 1])
    ax_trans = fig.add_subplot(gs[2, 2])
    ax_oos = fig.add_subplot(gs[2, 3])

    # Row 4: Feature profiles (2 wide) + SHAP (2 wide)
    ax_profiles = fig.add_subplot(gs[3, :2])
    ax_shap = fig.add_subplot(gs[3, 2:])

    # ── Render plots ──────────────────────────────────────────────────────

    plot_quality_summary(diag, ax_quality)

    # Convergence needs 3 stacked axes — use the middle column
    ax_conv_stab = ax_conv_reg.twinx() if False else fig.add_subplot(gs[0, 2])
    # Simpler: use conv_ll for LL and conv_reg for regimes + stability
    if conv:
        points = conv.get("gibbs", [])
        if points:
            iters = [p["iter"] for p in points]
            ll = [p["log_likelihood"] for p in points]
            n_states = [p["n_active_states"] for p in points]
            switch = [p.get("switch_rate", 0) for p in points]

            ax_conv_ll.plot(iters, ll, color="#3b82f6", linewidth=1)
            ax_conv_ll.set_title("Log-Likelihood", fontsize=10, fontweight="bold")
            ax_conv_ll.ticklabel_format(style="sci", axis="y", scilimits=(0, 0))
            ax_conv_ll.grid(True, alpha=0.3)
            ax_conv_ll.set_xlabel("Iteration", fontsize=8)

            ax_conv_reg.plot(iters, n_states, color="#10b981", linewidth=1, label="Regimes")
            ax_conv_reg2 = ax_conv_reg.twinx()
            ax_conv_reg2.plot(iters, switch, color="#ef4444", linewidth=0.8, alpha=0.7, label="Switch rate")
            ax_conv_reg.set_title("Regimes & Switch Rate", fontsize=10, fontweight="bold")
            ax_conv_reg.grid(True, alpha=0.3)
            ax_conv_reg.set_xlabel("Iteration", fontsize=8)
            ax_conv_reg.set_ylabel("Active Regimes", fontsize=8, color="#10b981")
            ax_conv_reg2.set_ylabel("Switch Rate", fontsize=8, color="#ef4444")

    plot_regime_distribution(regime_stats, ax_dist)
    plot_regime_timeline(assignments, ax_timeline)
    plot_return_distributions(regime_stats, ax_returns)
    plot_dwell_times(regime_stats, ax_dwell)
    plot_transition_matrix(diag, ax_trans)
    plot_oos_evaluation(oos_data, ax_oos)
    plot_regime_profiles(regime_stats, feature_names, ax_profiles)
    plot_shap_summary(shap_summary, ax_shap)

    # ── Save ──────────────────────────────────────────────────────────────

    output_path = model_dir / f"analysis.{output_format}"
    fig.savefig(str(output_path), dpi=150, bbox_inches="tight", facecolor="white")
    plt.close(fig)

    file_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"\nSaved: {output_path} ({file_mb:.1f} MB)")

    # Also generate individual high-res panels
    panels_dir = model_dir / "panels"
    panels_dir.mkdir(exist_ok=True)

    panel_fns = [
        ("convergence", lambda f, a: plot_convergence(conv, *[f.add_subplot(3, 1, i) for i in range(1, 4)]) if conv else None),
        ("distribution", lambda f, a: plot_regime_distribution(regime_stats, a)),
        ("timeline", lambda f, a: plot_regime_timeline(assignments, a)),
        ("returns_vol", lambda f, a: plot_return_distributions(regime_stats, a)),
        ("dwell_times", lambda f, a: plot_dwell_times(regime_stats, a)),
        ("transitions", lambda f, a: plot_transition_matrix(diag, a)),
        ("oos", lambda f, a: plot_oos_evaluation(oos_data, a)),
        ("profiles", lambda f, a: plot_regime_profiles(regime_stats, feature_names, a)),
        ("shap", lambda f, a: plot_shap_summary(shap_summary, a)),
    ]

    for name, plot_fn in panel_fns:
        try:
            fig_p, ax_p = plt.subplots(figsize=(10, 6))
            plot_fn(fig_p, ax_p)
            fig_p.savefig(str(panels_dir / f"{name}.png"), dpi=150, bbox_inches="tight", facecolor="white")
            plt.close(fig_p)
        except Exception as e:
            print(f"  Panel {name}: {e}")

    print(f"Individual panels: {panels_dir}")


def main():
    parser = argparse.ArgumentParser(description="HDP-HMM regime visualization")
    parser.add_argument("--model", type=str, default="latest",
                        help="Model ID or 'latest' (default: latest)")
    parser.add_argument("--format", type=str, default="png", choices=["png", "pdf", "svg"],
                        help="Output format (default: png)")
    args = parser.parse_args()

    model_dir = find_model(args.model)
    print(f"Model: {model_dir.name}")
    generate_report(model_dir, args.format)


if __name__ == "__main__":
    main()
