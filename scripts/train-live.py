"""
Live HDP-HMM training dashboard — real-time 2D projection + metrics.

Runs Gibbs sampling and streams updates to a bokeh server dashboard:
  - 2D PCA scatter of feature space, colored by regime (updates per iteration)
  - Convergence curve (LL, active regimes)
  - Regime distribution bar chart
  - Live metrics panel with descriptions
  - Regime timeline strip

Usage:
    python scripts/train-live.py --symbol MNQ --timeframe 1m --max-bars 200000
    python scripts/train-live.py --symbol MNQ --timeframe 1m --gibbs-iter 300

Opens browser automatically at http://localhost:5006/train-live
"""

import argparse
import sys
import threading
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "src" / "ml"))

from bokeh.io import curdoc
from bokeh.layouts import column, row, gridplot
from bokeh.models import (
    ColumnDataSource, Div, ColorBar, LinearColorMapper,
    BasicTicker, HoverTool, Label, Legend, LegendItem,
)
from bokeh.palettes import Category10_10, Spectral11
from bokeh.plotting import figure
from bokeh.server.server import Server
from bokeh.application import Application
from bokeh.application.handlers.function import FunctionHandler

# ── Globals (shared between training thread and bokeh callback) ───────────

_state = {
    "X_2d": None,           # (T, 2) PCA projection
    "close": None,          # (T,) close prices
    "timestamps": None,     # (T,) timestamps
    "regimes": None,        # (T,) current regime assignments
    "n_regimes": 0,
    "iteration": 0,
    "total_iter": 0,
    "log_likelihood": 0.0,
    "metrics_history": [],  # list of dicts per iteration
    "training_done": False,
    "status": "Initializing...",
    "regime_stats": {},     # {regime_id: {count, pct, avg_return, avg_vol}}
}

REGIME_COLORS = ["#f43f5e", "#f97316", "#f59e0b", "#10b981", "#06b6d4",
                 "#3b82f6", "#8b5cf6", "#ec4899", "#ef4444", "#14b8a6"]

METRIC_DESCRIPTIONS = {
    "log_likelihood": "Joint probability of data given model parameters. Should increase and plateau. Measures how well the emission distributions explain the observed features.",
    "num_regimes": "Number of active states (>1% of bars). HDP-HMM discovers this automatically. Unused truncation slots collapse to prior.",
    "assignment_stability": "Fraction of bars that kept the same regime as previous iteration. Should converge toward 0.95+. Low stability = sampler still exploring.",
    "mean_self_transition": "Average diagonal of transition matrix. Higher = stickier regimes (longer dwell times). Controlled by kappa parameter.",
    "switch_rate": "Fraction of consecutive bars that change regime. Lower = more stable assignments. Should decrease as sampler converges.",
    "beta_entropy": "Shannon entropy of the global base measure beta. Higher = more uniform regime weights. Lower = few dominant regimes.",
    "avg_dwell": "Mean number of consecutive bars in the same regime. Higher = more meaningful regime structure (not noise).",
}


# ── Training thread ──────────────────────────────────────────────────────


def run_training(args):
    """Load data, compute features, run Gibbs sampling, push updates to _state."""
    from ml.shared.data import load_ohlcv_arrays
    from ml.shared.features import compute_features, normalize_features
    from hdp_hmm.model import StickyHDPHMM
    from sklearn.decomposition import PCA

    _state["status"] = "Loading OHLCV data..."
    _state["total_iter"] = args.gibbs_iter

    # Load data
    date_range = None
    data = load_ohlcv_arrays(args.symbol, args.timeframe, args.max_bars, date_range)
    n_bars = len(data["close"])
    _state["status"] = f"Loaded {n_bars:,} bars. Computing features..."

    # Compute features
    X_raw, feature_names, timestamps = compute_features(data)
    _state["status"] = f"Computed {len(feature_names)} features. Normalizing..."

    # Normalize
    lookback = 250
    X = normalize_features(X_raw, lookback=lookback, clip_range=(-5, 5))

    # Drop warmup NaN rows
    valid_mask = np.all(np.isfinite(X), axis=1)
    valid_start = np.argmax(valid_mask)
    X_valid = X[valid_start:]
    ts_valid = timestamps[valid_start:] if timestamps else list(range(len(X_valid)))
    close_valid = data["close"][valid_start:]

    T, D = X_valid.shape
    _state["status"] = f"{T:,} valid bars, {D} features. Computing PCA..."

    # PCA to 2D for visualization (subsample if huge)
    pca_sample = min(T, 50000)
    if T > pca_sample:
        pca_idx = np.linspace(0, T - 1, pca_sample, dtype=int)
        X_pca_fit = X_valid[pca_idx]
    else:
        X_pca_fit = X_valid
        pca_idx = np.arange(T)

    pca = PCA(n_components=2)
    pca.fit(X_pca_fit)
    X_2d_full = pca.transform(X_valid)

    # Subsample for rendering (max 20k points for smooth bokeh updates)
    render_max = 20000
    if T > render_max:
        render_idx = np.linspace(0, T - 1, render_max, dtype=int)
    else:
        render_idx = np.arange(T)

    _state["X_2d"] = X_2d_full[render_idx]
    _state["close"] = close_valid[render_idx]
    _state["render_idx"] = render_idx
    _state["timestamps"] = [ts_valid[i] for i in render_idx]
    _state["regimes"] = np.zeros(len(render_idx), dtype=int)

    var_explained = pca.explained_variance_ratio_
    _state["status"] = (
        f"PCA: {var_explained[0]:.1%} + {var_explained[1]:.1%} = "
        f"{sum(var_explained):.1%} variance. Starting Gibbs sampling..."
    )

    # Train
    model = StickyHDPHMM(
        alpha=args.alpha, gamma=args.gamma,
        kappa=args.kappa, K_max=args.k_max,
    )
    model._init_params(X_valid)

    _state["status"] = "Gibbs sampling..."

    prev_states = None
    t_start = time.time()

    for it in range(1, args.gibbs_iter + 1):
        # Gibbs steps
        log_lik = model._compute_log_likelihood(X_valid)
        states, total_ll = model._sample_states(X_valid, log_lik)
        model.state_sequence = states
        model._sample_emission_params(X_valid, states)
        transition_counts = model._sample_transitions(states)
        model._sample_beta(transition_counts)

        # Metrics
        unique, counts = np.unique(states, return_counts=True)
        active = unique[counts > max(1, T * 0.01)]
        n_active = len(active)

        state_changes = states[1:] != states[:-1]
        switches = int(np.sum(state_changes))
        switch_rate = switches / max(1, T - 1)

        active_self_trans = float(np.mean([
            model.transition_matrix[k, k] for k in active
        ])) if len(active) > 0 else 0.0

        beta_entropy = float(-np.sum(model.beta * np.log(model.beta + 1e-300)))

        change_idx = np.where(state_changes)[0]
        if len(change_idx) > 0:
            boundaries = np.concatenate([[0], change_idx + 1, [T]])
            avg_dwell = float(np.mean(np.diff(boundaries)))
        else:
            avg_dwell = float(T)

        stability = float(np.mean(states == prev_states)) if prev_states is not None else 0.0
        prev_states = states.copy()

        elapsed = time.time() - t_start
        ips = it / elapsed
        eta = (args.gibbs_iter - it) / ips if ips > 0 else 0

        # Regime stats
        regime_stats = {}
        ret1 = np.diff(np.log(close_valid + 1e-10))
        for k in active:
            mask = states == k
            mask_ret = mask[1:]  # align with returns
            if np.sum(mask_ret) > 0:
                regime_stats[int(k)] = {
                    "count": int(np.sum(mask)),
                    "pct": round(float(np.sum(mask)) / T * 100, 1),
                    "avg_return": round(float(np.mean(ret1[mask_ret])) * 100, 4),
                    "avg_vol": round(float(np.std(ret1[mask_ret])) * 100, 4),
                }

        # Update shared state
        _state["regimes"] = states[render_idx]
        _state["iteration"] = it
        _state["n_regimes"] = n_active
        _state["log_likelihood"] = total_ll
        _state["regime_stats"] = regime_stats
        _state["metrics_history"].append({
            "iter": it,
            "log_likelihood": total_ll,
            "num_regimes": n_active,
            "assignment_stability": round(stability, 4),
            "mean_self_transition": round(active_self_trans, 4),
            "switch_rate": round(switch_rate, 6),
            "beta_entropy": round(beta_entropy, 4),
            "avg_dwell": round(avg_dwell, 2),
            "elapsed": round(elapsed, 1),
            "ips": round(ips, 2),
            "eta": round(eta, 0),
        })
        _state["status"] = (
            f"Iter {it}/{args.gibbs_iter} | "
            f"LL={total_ll:.0f} | K={n_active} | "
            f"stability={stability:.3f} | "
            f"{ips:.1f} it/s | ETA {eta:.0f}s"
        )

    _state["training_done"] = True
    _state["status"] = f"Training complete. {args.gibbs_iter} iterations in {elapsed:.0f}s."


# ── Bokeh dashboard ──────────────────────────────────────────────────────


def make_dashboard(doc):
    """Create the bokeh document with all plots and periodic callback."""

    # ── Data sources ──────────────────────────────────────────────────
    price_source = ColumnDataSource(data=dict(idx=[], close=[], color=[]))
    pc1_source = ColumnDataSource(data=dict(idx=[], val=[], color=[]))
    pc2_source = ColumnDataSource(data=dict(idx=[], val=[], color=[]))
    regime_strip_source = ColumnDataSource(data=dict(idx=[], top=[], color=[]))
    ll_source = ColumnDataSource(data=dict(iter=[], ll=[]))
    regimes_source = ColumnDataSource(data=dict(iter=[], n=[]))
    stability_source = ColumnDataSource(data=dict(iter=[], val=[]))
    dist_source = ColumnDataSource(data=dict(regime=[], pct=[], color=[]))

    # Shared x_range for linked panning across all time-series panels
    shared_x = None

    # ── Plots ─────────────────────────────────────────────────────────

    # Price chart colored by regime
    price_plot = figure(
        width=1200, height=250,
        title="Price - colored by regime assignment",
        tools="pan,wheel_zoom,box_zoom,reset,crosshair",
        active_scroll="wheel_zoom",
        active_drag="pan",
    )
    price_plot.scatter("idx", "close", source=price_source, size=1.5,
                       alpha=0.6, color="color", line_color=None)
    price_plot.yaxis.axis_label = "Price"
    price_plot.xaxis.axis_label = None
    shared_x = price_plot.x_range

    # PC1 oscillator over time
    pc1_plot = figure(
        width=1200, height=180,
        title="PC1 (primary feature axis) - regime colored",
        tools="pan,wheel_zoom,reset,crosshair",
        active_scroll="wheel_zoom",
        x_range=shared_x,
    )
    pc1_plot.scatter("idx", "val", source=pc1_source, size=1, alpha=0.5,
                     color="color", line_color=None)
    pc1_plot.yaxis.axis_label = "PC1"
    # Zero line
    from bokeh.models import Span
    pc1_plot.add_layout(Span(location=0, dimension="width", line_color="#9ca3af",
                             line_dash="dashed", line_width=1))

    # PC2 oscillator over time
    pc2_plot = figure(
        width=1200, height=180,
        title="PC2 (secondary feature axis) - regime colored",
        tools="pan,wheel_zoom,reset,crosshair",
        active_scroll="wheel_zoom",
        x_range=shared_x,
    )
    pc2_plot.scatter("idx", "val", source=pc2_source, size=1, alpha=0.5,
                     color="color", line_color=None)
    pc2_plot.yaxis.axis_label = "PC2"
    pc2_plot.add_layout(Span(location=0, dimension="width", line_color="#9ca3af",
                             line_dash="dashed", line_width=1))

    # Regime strip (thin color bar over time)
    regime_strip = figure(
        width=1200, height=60,
        title="Regime assignments",
        tools="pan,wheel_zoom,reset",
        active_scroll="wheel_zoom",
        x_range=shared_x,
    )
    regime_strip.vbar(x="idx", top=1, source=regime_strip_source, width=1.0,
                      color="color", line_color=None)
    regime_strip.yaxis.visible = False
    regime_strip.ygrid.visible = False

    # Log-likelihood convergence
    ll_plot = figure(width=500, height=200, title="Log-Likelihood",
                     tools="pan,wheel_zoom,reset")
    ll_plot.line("iter", "ll", source=ll_source, line_width=2, color="#3b82f6")
    ll_plot.xaxis.axis_label = "Iteration"

    # Active regimes over iterations
    reg_plot = figure(width=500, height=200, title="Active Regimes",
                      tools="pan,wheel_zoom,reset")
    reg_plot.line("iter", "n", source=regimes_source, line_width=2, color="#10b981")
    reg_plot.xaxis.axis_label = "Iteration"

    # Stability over iterations
    stab_plot = figure(width=500, height=200, title="Assignment Stability",
                       tools="pan,wheel_zoom,reset")
    stab_plot.line("iter", "val", source=stability_source, line_width=2, color="#f59e0b")
    stab_plot.xaxis.axis_label = "Iteration"

    # Regime distribution bar
    dist_plot = figure(width=500, height=200, title="Regime Distribution",
                       x_range=[], tools="")
    dist_plot.vbar(x="regime", top="pct", source=dist_source, width=0.8,
                   color="color", alpha=0.8)
    dist_plot.yaxis.axis_label = "% of bars"

    # ── Status + metrics panel ────────────────────────────────────────

    status_div = Div(
        text="<h2 style='color:#3b82f6;font-family:monospace'>Initializing...</h2>",
        width=700, height=50,
    )

    metrics_div = Div(
        text="<div style='font-family:monospace;font-size:12px'>Waiting for training...</div>",
        width=700, height=400,
    )

    # ── Periodic callback ─────────────────────────────────────────────

    _last_iter = [0]

    def update():
        current_iter = _state["iteration"]
        if current_iter <= _last_iter[0] and not _state["training_done"]:
            # Update status even before training starts
            status_div.text = (
                f"<h3 style='color:#3b82f6;font-family:monospace;margin:5px 0'>"
                f"{_state['status']}</h3>"
            )
            return

        _last_iter[0] = current_iter

        # Status
        color = "#10b981" if _state["training_done"] else "#3b82f6"
        status_div.text = (
            f"<h3 style='color:{color};font-family:monospace;margin:5px 0'>"
            f"{_state['status']}</h3>"
        )

        # Time-series panels (price + PC1 + PC2 + regime strip)
        if _state["X_2d"] is not None and _state["regimes"] is not None:
            n_pts = len(_state["regimes"])
            idx = list(range(n_pts))
            regimes = _state["regimes"].tolist()
            colors = [REGIME_COLORS[int(r) % len(REGIME_COLORS)] for r in regimes]

            # Price
            close = _state["close"].tolist() if _state["close"] is not None else [0] * n_pts
            price_source.data = dict(idx=idx, close=close, color=colors)
            price_plot.title.text = (
                f"Price - {_state['n_regimes']} regimes, "
                f"iter {current_iter}/{_state['total_iter']}"
            )

            # PC1 / PC2 oscillators
            pc1 = _state["X_2d"][:, 0].tolist()
            pc2 = _state["X_2d"][:, 1].tolist()
            pc1_source.data = dict(idx=idx, val=pc1, color=colors)
            pc2_source.data = dict(idx=idx, val=pc2, color=colors)

            # Regime strip
            regime_strip_source.data = dict(idx=idx, top=[1] * n_pts, color=colors)

        # Convergence curves
        history = _state["metrics_history"]
        if history:
            iters = [h["iter"] for h in history]
            lls = [h["log_likelihood"] for h in history]
            n_regs = [h["num_regimes"] for h in history]
            stabs = [h["assignment_stability"] for h in history]

            ll_source.data = dict(iter=iters, ll=lls)
            regimes_source.data = dict(iter=iters, n=n_regs)
            stability_source.data = dict(iter=iters, val=stabs)

        # Regime distribution
        rs = _state["regime_stats"]
        if rs:
            regime_ids = sorted(rs.keys())
            labels = [f"R{k}" for k in regime_ids]
            pcts = [rs[k]["pct"] for k in regime_ids]
            colors = [REGIME_COLORS[k % len(REGIME_COLORS)] for k in regime_ids]
            dist_plot.x_range.factors = labels
            dist_source.data = dict(regime=labels, pct=pcts, color=colors)

        # Metrics panel with descriptions
        if history:
            latest = history[-1]
            html = "<div style='font-family:monospace;font-size:11px;line-height:1.6'>"
            html += "<table style='border-collapse:collapse;width:100%'>"

            for key, desc in METRIC_DESCRIPTIONS.items():
                val = latest.get(key, "N/A")
                if isinstance(val, float):
                    if abs(val) > 1000:
                        val_str = f"{val:,.0f}"
                    else:
                        val_str = f"{val:.4f}"
                else:
                    val_str = str(val)

                html += (
                    f"<tr style='border-bottom:1px solid #e5e7eb'>"
                    f"<td style='padding:4px 8px;font-weight:bold;color:#1f2937;white-space:nowrap'>"
                    f"{key}</td>"
                    f"<td style='padding:4px 8px;color:#3b82f6;font-weight:bold;white-space:nowrap'>"
                    f"{val_str}</td>"
                    f"<td style='padding:4px 8px;color:#6b7280;font-size:10px'>"
                    f"{desc}</td>"
                    f"</tr>"
                )

            # Add timing
            html += (
                f"<tr style='border-bottom:1px solid #e5e7eb'>"
                f"<td style='padding:4px 8px;font-weight:bold'>speed</td>"
                f"<td style='padding:4px 8px;color:#3b82f6;font-weight:bold'>"
                f"{latest.get('ips', 0):.1f} it/s</td>"
                f"<td style='padding:4px 8px;color:#6b7280;font-size:10px'>"
                f"ETA {latest.get('eta', 0):.0f}s</td>"
                f"</tr>"
            )

            # Regime stats table
            rs = _state["regime_stats"]
            if rs:
                html += "</table><br>"
                html += "<b style='color:#1f2937'>Regime Characteristics:</b>"
                html += "<table style='border-collapse:collapse;width:100%;margin-top:4px'>"
                html += (
                    "<tr style='background:#f3f4f6'>"
                    "<th style='padding:3px 6px;text-align:left'>Regime</th>"
                    "<th style='padding:3px 6px;text-align:right'>Bars</th>"
                    "<th style='padding:3px 6px;text-align:right'>%</th>"
                    "<th style='padding:3px 6px;text-align:right'>Avg Ret%</th>"
                    "<th style='padding:3px 6px;text-align:right'>Vol%</th>"
                    "<th style='padding:3px 6px;text-align:left'>Character</th>"
                    "</tr>"
                )
                for k in sorted(rs.keys()):
                    s = rs[k]
                    ret = s["avg_return"]
                    vol = s["avg_vol"]
                    # Characterize
                    if ret > 0.005:
                        char = "Bullish"
                    elif ret < -0.005:
                        char = "Bearish"
                    else:
                        char = "Neutral"
                    if vol > 0.05:
                        char += " / High Vol"
                    elif vol < 0.02:
                        char += " / Quiet"
                    else:
                        char += " / Normal Vol"

                    color = REGIME_COLORS[k % len(REGIME_COLORS)]
                    html += (
                        f"<tr>"
                        f"<td style='padding:3px 6px'>"
                        f"<span style='color:{color};font-weight:bold'>R{k}</span></td>"
                        f"<td style='padding:3px 6px;text-align:right'>{s['count']:,}</td>"
                        f"<td style='padding:3px 6px;text-align:right'>{s['pct']:.1f}</td>"
                        f"<td style='padding:3px 6px;text-align:right;color:{'#10b981' if ret > 0 else '#ef4444'}'>"
                        f"{ret:+.4f}</td>"
                        f"<td style='padding:3px 6px;text-align:right'>{vol:.4f}</td>"
                        f"<td style='padding:3px 6px;color:#6b7280'>{char}</td>"
                        f"</tr>"
                    )

            html += "</table></div>"
            metrics_div.text = html

    doc.add_periodic_callback(update, 500)  # Update every 500ms

    # ── Layout ────────────────────────────────────────────────────────

    # Time-series stack (linked x-axis pan/zoom)
    charts = column(price_plot, pc1_plot, pc2_plot, regime_strip, sizing_mode="stretch_width")
    # Convergence + metrics sidebar
    convergence = column(ll_plot, reg_plot, stab_plot, dist_plot)
    sidebar = column(status_div, convergence, metrics_div)

    doc.add_root(row(charts, sidebar))
    doc.title = "HDP-HMM Live Training"


# ── Main ──────────────────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Live HDP-HMM training dashboard")
    parser.add_argument("--symbol", type=str, default="MNQ")
    parser.add_argument("--timeframe", type=str, default="1m")
    parser.add_argument("--max-bars", type=int, default=200000)
    parser.add_argument("--gibbs-iter", type=int, default=300)
    parser.add_argument("--alpha", type=float, default=1.0)
    parser.add_argument("--gamma", type=float, default=1.0)
    parser.add_argument("--kappa", type=float, default=50.0)
    parser.add_argument("--k-max", type=int, default=4)
    parser.add_argument("--port", type=int, default=5006)
    args = parser.parse_args()

    print(f"HDP-HMM Live Training Dashboard")
    print(f"  Symbol:    {args.symbol}")
    print(f"  Timeframe: {args.timeframe}")
    print(f"  Max bars:  {args.max_bars:,}")
    print(f"  Gibbs:     {args.gibbs_iter} iterations")
    print(f"  K_max:     {args.k_max}")
    print(f"  Dashboard: http://localhost:{args.port}/train-live")
    print()

    # Start training in background thread
    train_thread = threading.Thread(target=run_training, args=(args,), daemon=True)
    train_thread.start()

    # Start bokeh server
    apps = {"/train-live": Application(FunctionHandler(make_dashboard))}
    server = Server(apps, port=args.port, allow_websocket_origin=[f"localhost:{args.port}"])
    server.start()

    print(f"Dashboard running at http://localhost:{args.port}/train-live")
    print("Opening browser...")

    import webbrowser
    webbrowser.open(f"http://localhost:{args.port}/train-live")

    try:
        server.io_loop.start()
    except KeyboardInterrupt:
        print("\nShutting down...")


if __name__ == "__main__":
    main()
