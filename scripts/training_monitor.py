#!/usr/bin/env python3
"""
Live training monitor — Plotly Dash app that tails convergence.json
and displays real-time training curves.

Usage:
  python scripts/training_monitor.py [--model-id MNQ_1m_cnn_transformer] [--port 8050]

Opens browser to http://localhost:8050 with auto-refreshing charts.
"""

import argparse
import json
import os
import sys

import dash
from dash import dcc, html
from dash.dependencies import Input, Output
import plotly.graph_objects as go
from plotly.subplots import make_subplots


def parse_args():
    parser = argparse.ArgumentParser(description="Live training monitor")
    parser.add_argument("--model-id", default="MNQ_1m_cnn_transformer")
    parser.add_argument("--port", type=int, default=8050)
    return parser.parse_args()


def load_convergence(model_id):
    path = os.path.join("data", "models", model_id, "convergence.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def load_diagnostics(model_id):
    path = os.path.join("data", "models", model_id, "diagnostics.json")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


args = parse_args()
app = dash.Dash(__name__)

app.layout = html.Div(
    style={"backgroundColor": "#0a0a0f", "minHeight": "100vh", "padding": "20px",
           "fontFamily": "JetBrains Mono, Consolas, monospace", "color": "#e0e0e0"},
    children=[
        html.H1(
            f"CNN+Transformer Training — {args.model_id}",
            style={"color": "#22d3ee", "fontSize": "20px", "marginBottom": "5px",
                   "fontWeight": "500", "letterSpacing": "0.5px"}
        ),
        html.Div(id="status-bar", style={"color": "#888", "fontSize": "12px", "marginBottom": "20px"}),

        # Row 1: Loss + Accuracy
        html.Div(style={"display": "flex", "gap": "20px", "marginBottom": "20px"}, children=[
            dcc.Graph(id="loss-chart", style={"flex": "1", "height": "350px"}),
            dcc.Graph(id="accuracy-chart", style={"flex": "1", "height": "350px"}),
        ]),

        # Row 2: AUC + Learning Rate
        html.Div(style={"display": "flex", "gap": "20px", "marginBottom": "20px"}, children=[
            dcc.Graph(id="auc-chart", style={"flex": "1", "height": "350px"}),
            dcc.Graph(id="lr-chart", style={"flex": "1", "height": "350px"}),
        ]),

        # Row 3: Per-head losses
        html.Div(style={"display": "flex", "gap": "20px"}, children=[
            dcc.Graph(id="head-loss-chart", style={"flex": "1", "height": "350px"}),
            html.Div(id="metrics-table", style={"flex": "1", "padding": "10px"}),
        ]),

        dcc.Interval(id="refresh", interval=5000, n_intervals=0),  # 5s refresh
    ]
)

CHART_TEMPLATE = dict(
    paper_bgcolor="#0a0a0f",
    plot_bgcolor="#111118",
    font=dict(color="#e0e0e0", family="JetBrains Mono, Consolas, monospace", size=11),
    margin=dict(l=50, r=20, t=40, b=40),
    xaxis=dict(gridcolor="#1a1a2e", zerolinecolor="#1a1a2e", title="Epoch"),
    yaxis=dict(gridcolor="#1a1a2e", zerolinecolor="#1a1a2e"),
    legend=dict(bgcolor="rgba(0,0,0,0)", font=dict(size=10)),
)

CYAN = "#22d3ee"
GREEN = "#4ade80"
RED = "#f87171"
YELLOW = "#facc15"
PURPLE = "#a78bfa"
ORANGE = "#fb923c"


@app.callback(
    [Output("loss-chart", "figure"),
     Output("accuracy-chart", "figure"),
     Output("auc-chart", "figure"),
     Output("lr-chart", "figure"),
     Output("head-loss-chart", "figure"),
     Output("metrics-table", "children"),
     Output("status-bar", "children")],
    [Input("refresh", "n_intervals")]
)
def update(n):
    data = load_convergence(args.model_id)
    diag = load_diagnostics(args.model_id)

    if data is None:
        empty = go.Figure()
        empty.update_layout(**CHART_TEMPLATE, title="Waiting for data...")
        return empty, empty, empty, empty, empty, "No convergence data yet", "Waiting..."

    epochs = data["epochs"]

    # ── Loss chart ──────────────────────────────────────────────────────
    fig_loss = go.Figure()
    fig_loss.add_trace(go.Scatter(x=epochs, y=data["train_loss"], name="Train",
                                  line=dict(color=CYAN, width=2)))
    fig_loss.add_trace(go.Scatter(x=epochs, y=data["val_loss"], name="Val",
                                  line=dict(color=YELLOW, width=2, dash="dash")))
    fig_loss.update_layout(**CHART_TEMPLATE, title="Loss", yaxis_title="BCE Loss")

    # ── Accuracy chart ──────────────────────────────────────────────────
    fig_acc = go.Figure()
    fig_acc.add_trace(go.Scatter(x=epochs, y=[a * 100 for a in data["swing_accuracy"]],
                                 name="Swing", line=dict(color=GREEN, width=2)))
    fig_acc.add_trace(go.Scatter(x=epochs, y=[a * 100 for a in data["forward_accuracy"]],
                                 name="Forward", line=dict(color=ORANGE, width=2)))
    fig_acc.add_hline(y=50, line_dash="dot", line_color="#555", annotation_text="Random")
    fig_acc.update_layout(**CHART_TEMPLATE, title="OOS Accuracy (%)", yaxis_title="%")

    # ── AUC chart ───────────────────────────────────────────────────────
    fig_auc = go.Figure()
    fig_auc.add_trace(go.Scatter(x=epochs, y=data["swing_auc"],
                                  name="Swing", line=dict(color=GREEN, width=2)))
    fig_auc.add_trace(go.Scatter(x=epochs, y=data["forward_auc"],
                                  name="Forward", line=dict(color=ORANGE, width=2)))
    fig_auc.add_hline(y=0.5, line_dash="dot", line_color="#555", annotation_text="Random")
    fig_auc.update_layout(**CHART_TEMPLATE, title="OOS AUC-ROC", yaxis_title="AUC")

    # ── Learning rate chart ─────────────────────────────────────────────
    fig_lr = go.Figure()
    fig_lr.add_trace(go.Scatter(x=epochs, y=data["learning_rate"],
                                 name="LR", line=dict(color=PURPLE, width=2)))
    fig_lr.update_layout(**CHART_TEMPLATE, title="Learning Rate", yaxis_title="LR",
                         yaxis_type="log")

    # ── Per-head loss chart ─────────────────────────────────────────────
    fig_head = go.Figure()
    if "swing_accuracy" in data:
        # Compute per-head val losses from convergence if available
        # (they're emitted as metrics but not in convergence.json — use accuracy proxy)
        pass
    fig_head.add_trace(go.Scatter(x=epochs, y=data["train_loss"], name="Train Total",
                                   line=dict(color=CYAN, width=1.5)))
    fig_head.add_trace(go.Scatter(x=epochs, y=data["val_loss"], name="Val Total",
                                   line=dict(color=YELLOW, width=1.5, dash="dash")))
    fig_head.update_layout(**CHART_TEMPLATE, title="Loss Convergence", yaxis_title="Loss")

    # ── Metrics table ───────────────────────────────────────────────────
    best = diag.get("best_metrics", {}) if diag else {}
    n_epochs = len(epochs)
    latest_sw_acc = data["swing_accuracy"][-1] * 100 if data["swing_accuracy"] else 0
    latest_fw_acc = data["forward_accuracy"][-1] * 100 if data["forward_accuracy"] else 0
    latest_sw_auc = data["swing_auc"][-1] if data["swing_auc"] else 0
    latest_fw_auc = data["forward_auc"][-1] if data["forward_auc"] else 0

    table_style = {"color": "#e0e0e0", "fontSize": "13px", "lineHeight": "2"}
    val_style = {"color": CYAN, "fontWeight": "bold", "fontSize": "15px"}
    label_style = {"color": "#888", "fontSize": "11px"}

    table = html.Div(style={"padding": "15px", "backgroundColor": "#111118",
                             "borderRadius": "8px", "border": "1px solid #1a1a2e"}, children=[
        html.H3("Latest Metrics", style={"color": CYAN, "fontSize": "14px", "marginBottom": "15px"}),
        html.Div(style={"display": "grid", "gridTemplateColumns": "1fr 1fr", "gap": "12px"}, children=[
            html.Div([html.Div("Epoch", style=label_style),
                       html.Div(f"{n_epochs} / 30", style=val_style)]),
            html.Div([html.Div("Val Loss", style=label_style),
                       html.Div(f"{data['val_loss'][-1]:.4f}", style=val_style)]),
            html.Div([html.Div("Swing Accuracy", style=label_style),
                       html.Div(f"{latest_sw_acc:.1f}%",
                                style={**val_style, "color": GREEN if latest_sw_acc > 55 else YELLOW})]),
            html.Div([html.Div("Swing AUC", style=label_style),
                       html.Div(f"{latest_sw_auc:.4f}",
                                style={**val_style, "color": GREEN if latest_sw_auc > 0.6 else YELLOW})]),
            html.Div([html.Div("Forward Accuracy", style=label_style),
                       html.Div(f"{latest_fw_acc:.1f}%",
                                style={**val_style, "color": GREEN if latest_fw_acc > 52 else YELLOW})]),
            html.Div([html.Div("Forward AUC", style=label_style),
                       html.Div(f"{latest_fw_auc:.4f}",
                                style={**val_style, "color": GREEN if latest_fw_auc > 0.55 else YELLOW})]),
        ]),
        html.Hr(style={"borderColor": "#1a1a2e", "margin": "15px 0"}),
        html.Div(style={"display": "grid", "gridTemplateColumns": "1fr 1fr", "gap": "12px"}, children=[
            html.Div([html.Div("Best Epoch", style=label_style),
                       html.Div(str(best.get("epoch", "?")), style=val_style)]),
            html.Div([html.Div("Best Val Loss", style=label_style),
                       html.Div(f"{best.get('val_loss', 0):.4f}", style=val_style)]),
            html.Div([html.Div("Best Swing Acc", style=label_style),
                       html.Div(f"{best.get('swing_accuracy', 0)*100:.1f}%",
                                style={**val_style, "color": GREEN})]),
            html.Div([html.Div("Best Swing AUC", style=label_style),
                       html.Div(f"{best.get('swing_auc', 0):.4f}",
                                style={**val_style, "color": GREEN})]),
        ]),
    ])

    # ── Status bar ──────────────────────────────────────────────────────
    status = f"Epoch {n_epochs}/30 | Val Loss: {data['val_loss'][-1]:.4f} | Swing: {latest_sw_acc:.1f}% | Forward: {latest_fw_acc:.1f}%"
    if diag and diag.get("training", {}).get("total_time_sec"):
        status += f" | Time: {diag['training']['total_time_sec']:.0f}s"

    return fig_loss, fig_acc, fig_auc, fig_lr, fig_head, table, status


if __name__ == "__main__":
    print(f"\n  Training Monitor: http://localhost:{args.port}\n")
    app.run(debug=False, port=args.port, host="0.0.0.0")
