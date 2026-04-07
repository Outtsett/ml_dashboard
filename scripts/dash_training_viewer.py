"""
Plotly Dash real-time training metrics viewer.

Launches CNN transformer training as a subprocess, captures stdout JSON events,
and renders live-updating charts for all emitted metrics.

Usage:
    python scripts/dash_training_viewer.py [--symbol MNQ] [--timeframe 1m] [--epochs 30]

Opens http://127.0.0.1:8050 in browser.
"""

import argparse
import json
import subprocess
import sys
import threading
import time
from collections import defaultdict
from pathlib import Path

import dash
from dash import dcc, html, Input, Output, State
import plotly.graph_objects as go
from plotly.subplots import make_subplots

# ── State ─────────────────────────────────────────────────────────────────────

# Thread-safe metric storage
_lock = threading.Lock()
_metrics: dict[str, list[tuple[int, float]]] = defaultdict(list)  # name -> [(iter, value)]
_logs: list[str] = []
_status = {"state": "initializing", "epoch": 0, "total": 0, "elapsed": 0.0}
_done_diagnostics: dict | None = None

# ── Metric Groups ─────────────────────────────────────────────────────────────

LOSS_METRICS = {
    "train_loss", "val_loss", "train_barrier_class_loss", "val_barrier_class_loss",
    "train_vol_regime_loss", "val_vol_regime_loss",
    "train_return_bucket_loss", "val_return_bucket_loss",
}

ACCURACY_METRICS = {
    "val_barrier_class_accuracy", "val_vol_regime_accuracy", "val_return_bucket_accuracy",
}

TRADING_METRICS = {
    "profit_factor", "sharpe_ratio", "win_rate", "n_trades", "max_drawdown",
    "cost_impact", "roc_auc",
}

TRAINING_METRICS = {
    "learning_rate", "gradient_norm", "overfit_gap", "epoch_time_sec",
    "param_count", "best_epoch", "codebook_utilization",
}


def classify_metric(name: str) -> str:
    if name in LOSS_METRICS:
        return "loss"
    if name in ACCURACY_METRICS:
        return "accuracy"
    if name in TRADING_METRICS:
        return "trading"
    if name in TRAINING_METRICS:
        return "training"
    # Fallback heuristic
    if "loss" in name:
        return "loss"
    if "accuracy" in name or "acc" in name:
        return "accuracy"
    return "training"


# ── Colors ────────────────────────────────────────────────────────────────────

COLORS = [
    "#06b6d4",  # cyan-500
    "#10b981",  # emerald-500
    "#f59e0b",  # amber-500
    "#ef4444",  # red-500
    "#8b5cf6",  # violet-500
    "#ec4899",  # pink-500
    "#14b8a6",  # teal-500
    "#f97316",  # orange-500
    "#6366f1",  # indigo-500
    "#84cc16",  # lime-500
]


# ── Training Subprocess ───────────────────────────────────────────────────────

def run_training(cmd: list[str]):
    """Spawn training process and parse stdout JSON events."""
    with _lock:
        _status["state"] = "starting"

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        cwd=str(Path(__file__).resolve().parent.parent),
    )

    with _lock:
        _status["state"] = "running"

    t_start = time.time()

    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue

        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            with _lock:
                _logs.append(line)
            continue

        msg_type = msg.get("type", "")

        with _lock:
            if msg_type == "metric":
                name = msg["name"]
                value = msg["value"]
                iteration = msg.get("iteration", 0)
                _metrics[name].append((iteration, value))
                _status["elapsed"] = time.time() - t_start

            elif msg_type == "progress":
                _status["epoch"] = msg.get("iteration", 0)
                _status["total"] = msg.get("total", 0)
                _status["elapsed"] = time.time() - t_start

            elif msg_type == "log":
                _logs.append(msg.get("message", ""))
                if len(_logs) > 200:
                    _logs.pop(0)

            elif msg_type == "done":
                global _done_diagnostics
                _done_diagnostics = msg.get("diagnostics")
                _status["state"] = "completed"
                _status["elapsed"] = time.time() - t_start

            elif msg_type == "error":
                _logs.append(f"ERROR: {msg.get('message', 'unknown')}")
                _status["state"] = "failed"

    # Capture stderr
    stderr_out = proc.stderr.read()
    if stderr_out:
        for err_line in stderr_out.strip().split("\n"):
            # Filter noise
            if any(skip in err_line for skip in ["UserWarning", "FutureWarning", "enable_nested_tensor"]):
                continue
            with _lock:
                _logs.append(f"[stderr] {err_line}")

    proc.wait()

    with _lock:
        if _status["state"] == "running":
            _status["state"] = "completed" if proc.returncode == 0 else "failed"
        _status["elapsed"] = time.time() - t_start


# ── Dash App ──────────────────────────────────────────────────────────────────

app = dash.Dash(
    __name__,
    title="CNN Transformer Training",
    update_title=None,
)

app.layout = html.Div(
    style={
        "backgroundColor": "#0a0a0f",
        "color": "#e5e5e5",
        "fontFamily": "'JetBrains Mono', 'Fira Code', monospace",
        "minHeight": "100vh",
        "padding": "20px",
    },
    children=[
        # Header
        html.Div(
            style={"display": "flex", "justifyContent": "space-between", "alignItems": "center", "marginBottom": "20px"},
            children=[
                html.H1(
                    "CNN Transformer — Live Training",
                    style={"fontSize": "22px", "fontWeight": "600", "color": "#06b6d4", "margin": "0"},
                ),
                html.Div(id="status-badge", style={"fontSize": "13px"}),
            ],
        ),

        # Quick stats row
        html.Div(id="quick-stats", style={
            "display": "grid", "gridTemplateColumns": "repeat(6, 1fr)", "gap": "12px", "marginBottom": "20px",
        }),

        # Charts
        html.Div(
            style={"display": "grid", "gridTemplateColumns": "1fr 1fr", "gap": "16px", "marginBottom": "20px"},
            children=[
                dcc.Graph(id="loss-chart", config={"displayModeBar": False},
                          style={"height": "380px", "backgroundColor": "#111118", "borderRadius": "12px"}),
                dcc.Graph(id="accuracy-chart", config={"displayModeBar": False},
                          style={"height": "380px", "backgroundColor": "#111118", "borderRadius": "12px"}),
            ],
        ),
        html.Div(
            style={"display": "grid", "gridTemplateColumns": "1fr 1fr", "gap": "16px", "marginBottom": "20px"},
            children=[
                dcc.Graph(id="trading-chart", config={"displayModeBar": False},
                          style={"height": "380px", "backgroundColor": "#111118", "borderRadius": "12px"}),
                dcc.Graph(id="training-chart", config={"displayModeBar": False},
                          style={"height": "380px", "backgroundColor": "#111118", "borderRadius": "12px"}),
            ],
        ),

        # Log output
        html.Div(
            style={"backgroundColor": "#111118", "borderRadius": "12px", "padding": "16px", "maxHeight": "250px", "overflow": "auto"},
            children=[
                html.H3("Training Log", style={"fontSize": "13px", "color": "#6b7280", "marginBottom": "8px"}),
                html.Pre(id="log-output", style={
                    "fontSize": "11px", "color": "#9ca3af", "whiteSpace": "pre-wrap", "margin": "0",
                    "fontFamily": "'JetBrains Mono', monospace",
                }),
            ],
        ),

        # Auto-refresh
        dcc.Interval(id="refresh", interval=1500, n_intervals=0),
    ],
)


def _make_stat_card(label: str, value: str, color: str = "#06b6d4"):
    return html.Div(
        style={
            "backgroundColor": "#111118", "borderRadius": "10px", "padding": "14px 16px",
            "border": f"1px solid {color}22",
        },
        children=[
            html.Div(label, style={"fontSize": "10px", "color": "#6b7280", "textTransform": "uppercase", "letterSpacing": "0.05em"}),
            html.Div(value, style={"fontSize": "20px", "fontWeight": "700", "color": color, "marginTop": "4px"}),
        ],
    )


def _build_chart(title: str, metric_group: str) -> go.Figure:
    """Build a Plotly figure for a metric group."""
    with _lock:
        group_metrics = {
            name: list(points) for name, points in _metrics.items()
            if classify_metric(name) == metric_group and len(points) > 0
        }

    if not group_metrics:
        fig = go.Figure()
        fig.add_annotation(text="Waiting for data...", x=0.5, y=0.5, xref="paper", yref="paper",
                           showarrow=False, font=dict(size=14, color="#4b5563"))
    else:
        fig = go.Figure()
        for i, (name, points) in enumerate(sorted(group_metrics.items())):
            iters = [p[0] for p in points]
            vals = [p[1] for p in points]
            fig.add_trace(go.Scatter(
                x=iters, y=vals, name=name, mode="lines+markers",
                line=dict(color=COLORS[i % len(COLORS)], width=2),
                marker=dict(size=4),
            ))

    fig.update_layout(
        title=dict(text=title, font=dict(size=14, color="#9ca3af"), x=0.02),
        paper_bgcolor="#111118",
        plot_bgcolor="#111118",
        font=dict(family="JetBrains Mono, monospace", color="#9ca3af", size=11),
        margin=dict(l=50, r=20, t=40, b=40),
        legend=dict(
            bgcolor="rgba(0,0,0,0)", font=dict(size=10),
            orientation="h", yanchor="bottom", y=1.02, xanchor="left", x=0,
        ),
        xaxis=dict(
            gridcolor="#1e1e2e", zerolinecolor="#1e1e2e",
            title="Epoch", title_font=dict(size=10),
        ),
        yaxis=dict(gridcolor="#1e1e2e", zerolinecolor="#1e1e2e"),
        hovermode="x unified",
    )
    return fig


@app.callback(
    [
        Output("status-badge", "children"),
        Output("quick-stats", "children"),
        Output("loss-chart", "figure"),
        Output("accuracy-chart", "figure"),
        Output("trading-chart", "figure"),
        Output("training-chart", "figure"),
        Output("log-output", "children"),
    ],
    Input("refresh", "n_intervals"),
)
def update_all(_n):
    with _lock:
        state = _status["state"]
        epoch = _status["epoch"]
        total = _status["total"]
        elapsed = _status["elapsed"]
        log_text = "\n".join(_logs[-50:])

        # Latest values for quick stats
        latest = {}
        for name, points in _metrics.items():
            if points:
                latest[name] = points[-1][1]

    # Status badge
    state_colors = {
        "initializing": "#6b7280",
        "starting": "#f59e0b",
        "running": "#10b981",
        "completed": "#06b6d4",
        "failed": "#ef4444",
    }
    badge_color = state_colors.get(state, "#6b7280")
    elapsed_str = f"{elapsed:.0f}s" if elapsed < 60 else f"{elapsed / 60:.1f}m"
    status_badge = html.Span(
        f"{state.upper()}  |  Epoch {epoch}/{total}  |  {elapsed_str}",
        style={"color": badge_color, "fontWeight": "600"},
    )

    # Quick stats
    pf = latest.get("profit_factor")
    sr = latest.get("sharpe_ratio")
    wr = latest.get("win_rate")
    tl = latest.get("train_loss")
    vl = latest.get("val_loss")
    og = latest.get("overfit_gap")

    stats = [
        _make_stat_card("Train Loss", f"{tl:.4f}" if tl is not None else "--", "#06b6d4"),
        _make_stat_card("Val Loss", f"{vl:.4f}" if vl is not None else "--",
                        "#10b981" if vl is not None and (tl is None or vl < tl * 1.2) else "#ef4444"),
        _make_stat_card("Overfit Gap", f"{og:.4f}" if og is not None else "--",
                        "#10b981" if og is not None and og < 0.1 else "#f59e0b"),
        _make_stat_card("Profit Factor", f"{pf:.2f}" if pf is not None else "--",
                        "#10b981" if pf is not None and pf >= 1.5 else "#f59e0b" if pf is not None and pf >= 1.0 else "#ef4444"),
        _make_stat_card("Sharpe Ratio", f"{sr:.2f}" if sr is not None else "--",
                        "#10b981" if sr is not None and sr >= 1.0 else "#f59e0b"),
        _make_stat_card("Win Rate", f"{wr * 100:.1f}%" if wr is not None else "--",
                        "#10b981" if wr is not None and wr >= 0.55 else "#f59e0b"),
    ]

    # Charts
    loss_fig = _build_chart("Loss Curves", "loss")
    acc_fig = _build_chart("Accuracy Metrics", "accuracy")
    trading_fig = _build_chart("Trading Performance", "trading")
    training_fig = _build_chart("Training Diagnostics", "training")

    return status_badge, stats, loss_fig, acc_fig, trading_fig, training_fig, log_text


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Dash viewer for CNN Transformer training")
    parser.add_argument("--symbol", default="MNQ", help="Trading symbol (default: MNQ)")
    parser.add_argument("--timeframe", default="1m", help="Timeframe (default: 1m)")
    parser.add_argument("--epochs", type=int, default=30, help="Training epochs (default: 30)")
    parser.add_argument("--batch-size", type=int, default=4096, help="Batch size (default: 4096)")
    parser.add_argument("--window-size", type=int, default=128, help="Window size (default: 128)")
    parser.add_argument("--max-bars", type=int, default=0, help="Max OHLCV bars, 0=all (default: 0)")
    parser.add_argument("--port", type=int, default=8050, help="Dash server port (default: 8050)")
    args = parser.parse_args()

    # Build training command
    project_root = Path(__file__).resolve().parent.parent
    python_exe = sys.executable
    script = str(project_root / "src" / "ml" / "cnn_transformer" / "main.py")

    cmd = [
        python_exe, script,
        "--symbol", args.symbol,
        "--timeframe", args.timeframe,
        "--epochs", str(args.epochs),
        "--batch-size", str(args.batch_size),
        "--window-size", str(args.window_size),
        "--json",
    ]
    if args.max_bars > 0:
        cmd.extend(["--max-bars", str(args.max_bars)])

    print(f"Training command: {' '.join(cmd)}")
    print(f"Dashboard: http://127.0.0.1:{args.port}")

    # Launch training in background thread
    training_thread = threading.Thread(target=run_training, args=(cmd,), daemon=True)
    training_thread.start()

    # Start Dash server (blocks)
    app.run(host="127.0.0.1", port=args.port, debug=False)


if __name__ == "__main__":
    main()
