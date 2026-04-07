#!/usr/bin/env python3
"""
Prediction Viewer — Candlestick chart with CNN+Transformer swing predictions.

Loads pre-computed predictions from oos_predictions.npz (no inference at startup).

Usage:
  python scripts/prediction_viewer.py [--model-id MNQ_1m_cnn_transformer] [--port 8051]
"""

import argparse
import os
import sys

import numpy as np
import dash
from dash import dcc, html
from dash.dependencies import Input, Output, State
import plotly.graph_objects as go


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-id", default="MNQ_1m_cnn_transformer")
    parser.add_argument("--port", type=int, default=8051)
    return parser.parse_args()


def run_zigzag(high, low):
    n = len(high)
    pivots = []
    if n < 3:
        return pivots
    last_high, last_high_idx = high[0], 0
    last_low, last_low_idx = low[0], 0
    d = 0
    for i in range(1, n):
        if d == 0:
            if high[i] > last_high:
                d = 1; pivots.append((last_low_idx, float(last_low), "low"))
                last_high, last_high_idx = high[i], i
            elif low[i] < last_low:
                d = -1; pivots.append((last_high_idx, float(last_high), "high"))
                last_low, last_low_idx = low[i], i
            else:
                if high[i] > last_high: last_high, last_high_idx = high[i], i
                if low[i] < last_low: last_low, last_low_idx = low[i], i
        elif d == 1:
            if high[i] >= last_high: last_high, last_high_idx = high[i], i
            elif low[i] < low[i - 1]:
                pivots.append((last_high_idx, float(last_high), "high"))
                d = -1; last_low, last_low_idx = low[i], i
        else:
            if low[i] <= last_low: last_low, last_low_idx = low[i], i
            elif high[i] > high[i - 1]:
                pivots.append((last_low_idx, float(last_low), "low"))
                d = 1; last_high, last_high_idx = high[i], i
    if d == 1: pivots.append((last_high_idx, float(last_high), "high"))
    elif d == -1: pivots.append((last_low_idx, float(last_low), "low"))
    return pivots


# ── Load pre-computed predictions ───────────────────────────────────────────
args = parse_args()
npz_path = os.path.join("data", "models", args.model_id, "oos_predictions.npz")
if not os.path.exists(npz_path):
    print(f"ERROR: {npz_path} not found. Run inference first.")
    sys.exit(1)

print(f"Loading {npz_path}...")
d = np.load(npz_path, allow_pickle=True)
oos_ts = list(d["timestamps"])
oos_open = d["open"]
oos_high = d["high"]
oos_low = d["low"]
oos_close = d["close"]
oos_probs = d["probs"]
oos_labels = d["labels"]
oos_n = len(oos_close)

oos_preds = (oos_probs > 0.5).astype(float)
oos_valid = ~np.isnan(oos_labels) & ~np.isnan(oos_probs)
oos_correct = (oos_preds == oos_labels) & oos_valid
total_valid = int(oos_valid.sum())
total_correct = int(oos_correct.sum())

print(f"Loaded {oos_n:,} OOS bars, {total_correct:,}/{total_valid:,} = {total_correct/total_valid*100:.1f}%")
print("Computing zigzag...")
oos_pivots = run_zigzag(oos_high, oos_low)
print(f"Done: {len(oos_pivots)} pivots")

def _key_row(symbol, color, element, meaning):
    cell = {"padding": "3px 14px", "borderBottom": "1px solid #1a1a2e"}
    return html.Tr([
        html.Td(symbol, style={**cell, "color": color, "fontSize": "16px", "textAlign": "center"}),
        html.Td(color, style={**cell, "color": color, "fontFamily": "monospace"}),
        html.Td(element, style={**cell, "color": "#aaa"}),
        html.Td(meaning, style={**cell, "color": "#ccc"}),
    ])


# ── App ─────────────────────────────────────────────────────────────────────
app = dash.Dash(__name__)

app.layout = html.Div(
    style={"backgroundColor": "#0a0a0f", "minHeight": "100vh", "padding": "20px",
           "fontFamily": "JetBrains Mono, Consolas, monospace", "color": "#e0e0e0"},
    children=[
        html.H1("CNN+Transformer Prediction Viewer",
                style={"color": "#22d3ee", "fontSize": "20px", "marginBottom": "5px"}),
        html.Div(id="stats-bar",
                 style={"color": "#888", "fontSize": "13px", "marginBottom": "15px"}),

        dcc.Graph(id="chart", style={"height": "700px"},
                  config={"scrollZoom": True, "displayModeBar": True}),

        html.Div(style={"display": "flex", "gap": "10px", "alignItems": "center",
                         "marginTop": "15px", "flexWrap": "wrap"}, children=[
            html.Button("<<", id="btn-pb", n_clicks=0,
                        style={"padding": "8px 14px", "backgroundColor": "#1a1a2e",
                               "color": "#22d3ee", "border": "1px solid #333",
                               "borderRadius": "4px", "cursor": "pointer", "fontSize": "14px"}),
            html.Button("< Prev", id="btn-p", n_clicks=0,
                        style={"padding": "8px 14px", "backgroundColor": "#1a1a2e",
                               "color": "#22d3ee", "border": "1px solid #333",
                               "borderRadius": "4px", "cursor": "pointer", "fontSize": "14px"}),
            html.Div(id="page-info",
                     style={"color": "#e0e0e0", "fontSize": "13px", "minWidth": "200px",
                            "textAlign": "center"}),
            html.Button("Next >", id="btn-n", n_clicks=0,
                        style={"padding": "8px 14px", "backgroundColor": "#1a1a2e",
                               "color": "#22d3ee", "border": "1px solid #333",
                               "borderRadius": "4px", "cursor": "pointer", "fontSize": "14px"}),
            html.Button(">>", id="btn-nb", n_clicks=0,
                        style={"padding": "8px 14px", "backgroundColor": "#1a1a2e",
                               "color": "#22d3ee", "border": "1px solid #333",
                               "borderRadius": "4px", "cursor": "pointer", "fontSize": "14px"}),
            html.Div(style={"marginLeft": "30px", "display": "flex", "gap": "8px",
                             "alignItems": "center"}, children=[
                html.Label("Bars:", style={"color": "#888", "fontSize": "12px"}),
                dcc.Input(id="nbars", type="number", value=300, min=50, max=3000, step=50,
                          style={"width": "70px", "backgroundColor": "#111118", "color": "#e0e0e0",
                                 "border": "1px solid #333", "borderRadius": "4px", "padding": "4px"}),
            ]),
            html.Div(style={"display": "flex", "gap": "8px", "alignItems": "center"}, children=[
                html.Label("Markers every:", style={"color": "#888", "fontSize": "12px"}),
                dcc.Input(id="stride", type="number", value=3, min=1, max=50, step=1,
                          style={"width": "50px", "backgroundColor": "#111118", "color": "#e0e0e0",
                                 "border": "1px solid #333", "borderRadius": "4px", "padding": "4px"}),
            ]),
        ]),

        dcc.Store(id="pos", data=0),

        # ── Table Key ───────────────────────────────────────────────────────
        html.Table(
            style={"marginTop": "15px", "borderCollapse": "collapse",
                   "fontSize": "12px", "lineHeight": "1.6"},
            children=[
                html.Thead(html.Tr([
                    html.Th(col, style={"padding": "4px 14px", "borderBottom": "1px solid #333",
                                        "color": "#888", "textAlign": "left", "fontWeight": "normal"})
                    for col in ["Symbol", "Color", "Element", "Meaning"]
                ])),
                html.Tbody([
                    _key_row("\u25b2", "#4ade80", "Marker", "Correct UP prediction (model said UP, swing went UP)"),
                    _key_row("\u25bc", "#f87171", "Marker", "Correct DOWN prediction (model said DOWN, swing went DOWN)"),
                    _key_row("\u25b2/\u25bc", "#fb923c", "Marker", "Wrong prediction (model was incorrect)"),
                    _key_row("\u2014", "#22d3ee", "Line", "Swing ZigZag (ground truth pivots)"),
                    _key_row("\u25b2", "#4ade80", "Pivot", "ZigZag swing low (support)"),
                    _key_row("\u25bc", "#f87171", "Pivot", "ZigZag swing high (resistance)"),
                    _key_row("\u2588", "#4ade80", "Candle", "Bullish bar (close > open)"),
                    _key_row("\u2588", "#f87171", "Candle", "Bearish bar (close < open)"),
                ]),
            ],
        ),

        html.Div(f"Overall OOS: {total_correct:,}/{total_valid:,} = "
                 f"{total_correct/total_valid*100:.1f}% | 963K params | Raw OHLCV only | Zero lookahead",
                 style={"color": "#444", "fontSize": "11px", "marginTop": "10px"}),
    ]
)


@app.callback(
    [Output("chart", "figure"), Output("stats-bar", "children"),
     Output("page-info", "children"), Output("pos", "data")],
    [Input("btn-p", "n_clicks"), Input("btn-n", "n_clicks"),
     Input("btn-pb", "n_clicks"), Input("btn-nb", "n_clicks"),
     Input("nbars", "value"), Input("stride", "value")],
    [State("pos", "data")]
)
def render(_p, _n, _pb, _nb, nbars, stride, pos):
    nbars = int(nbars or 300)
    stride = max(1, int(stride or 3))
    pos = int(pos or 0)

    # Navigation
    tid = dash.ctx.triggered_id
    if tid == "btn-n": pos += nbars
    elif tid == "btn-p": pos -= nbars
    elif tid == "btn-nb": pos += nbars * 10
    elif tid == "btn-pb": pos -= nbars * 10
    pos = max(0, min(pos, oos_n - nbars))
    end = min(pos + nbars, oos_n)
    s = slice(pos, end)
    ln = end - pos

    ts = oos_ts[pos:end]
    op = oos_open[s].tolist()
    hi = oos_high[s].tolist()
    lo = oos_low[s].tolist()
    cl = oos_close[s].tolist()
    pr = oos_probs[s]
    lb = oos_labels[s]
    pd_ = oos_preds[s]
    cr = oos_correct[s]
    vl = oos_valid[s]

    fig = go.Figure()

    # Candlesticks
    fig.add_trace(go.Candlestick(
        x=list(range(ln)), open=op, high=hi, low=lo, close=cl,
        increasing_line_color="#4ade80", decreasing_line_color="#f87171",
        increasing_fillcolor="rgba(74,222,128,0.2)",
        decreasing_fillcolor="rgba(248,113,113,0.2)",
        name="OHLC", whiskerwidth=0.2,
    ))

    # Zigzag
    vp = [(idx - pos, price, ptype)
          for idx, price, ptype in oos_pivots if pos <= idx < end]
    if vp:
        fig.add_trace(go.Scatter(
            x=[p[0] for p in vp], y=[p[1] for p in vp],
            mode="lines+markers",
            line=dict(color="#22d3ee", width=1.5),
            marker=dict(size=7,
                        color=["#f87171" if p[2] == "high" else "#4ade80" for p in vp],
                        symbol=["triangle-down" if p[2] == "high" else "triangle-up" for p in vp]),
            name="ZigZag", opacity=0.8,
        ))

    # Predictions
    bar_range = np.array(hi) - np.array(lo)
    offset = bar_range * 0.5

    # Correct UP
    cup = [i for i in range(0, ln, stride) if vl[i] and cr[i] and pd_[i] == 1.0]
    if cup:
        fig.add_trace(go.Scatter(
            x=cup, y=[lo[i] - offset[i] for i in cup],
            mode="markers", name="Correct UP",
            marker=dict(symbol="triangle-up", size=8, color="#4ade80",
                        opacity=[max(0.4, float(pr[i])) for i in cup]),
            customdata=[f"{ts[i]} P(up)={pr[i]:.0%}" for i in cup],
            hovertemplate="%{customdata}<extra></extra>",
        ))

    # Correct DOWN
    cdn = [i for i in range(0, ln, stride) if vl[i] and cr[i] and pd_[i] == 0.0]
    if cdn:
        fig.add_trace(go.Scatter(
            x=cdn, y=[hi[i] + offset[i] for i in cdn],
            mode="markers", name="Correct DOWN",
            marker=dict(symbol="triangle-down", size=8, color="#f87171",
                        opacity=[max(0.4, float(1 - pr[i])) for i in cdn]),
            customdata=[f"{ts[i]} P(down)={1-pr[i]:.0%}" for i in cdn],
            hovertemplate="%{customdata}<extra></extra>",
        ))

    # Wrong
    wrg = [i for i in range(0, ln, stride) if vl[i] and not cr[i]]
    if wrg:
        fig.add_trace(go.Scatter(
            x=wrg,
            y=[lo[i] - offset[i] if pd_[i] == 1.0 else hi[i] + offset[i] for i in wrg],
            mode="markers", name="Wrong",
            marker=dict(
                symbol=["triangle-up" if pd_[i] == 1.0 else "triangle-down" for i in wrg],
                size=8, color="#fb923c", opacity=0.5),
            customdata=[f"{ts[i]} WRONG: {'UP' if pd_[i]==1 else 'DOWN'} @ {pr[i]:.0%}" for i in wrg],
            hovertemplate="%{customdata}<extra></extra>",
        ))

    # X-axis tick labels (show timestamp every ~50 bars)
    tick_step = max(1, ln // 10)
    tickvals = list(range(0, ln, tick_step))
    ticktext = [ts[i][5:16] for i in tickvals]  # "MM-DD HH:MM"

    fig.update_layout(
        paper_bgcolor="#0a0a0f", plot_bgcolor="#111118",
        font=dict(color="#e0e0e0", family="JetBrains Mono, Consolas, monospace", size=11),
        margin=dict(l=60, r=20, t=10, b=50),
        xaxis=dict(gridcolor="#1a1a2e", zerolinecolor="#1a1a2e",
                   rangeslider=dict(visible=False),
                   tickvals=tickvals, ticktext=ticktext, tickangle=-45),
        yaxis=dict(gridcolor="#1a1a2e", zerolinecolor="#1a1a2e", title="Price"),
        legend=dict(bgcolor="rgba(0,0,0,0)", font=dict(size=10), orientation="h", y=1.02),
        dragmode="pan",
    )

    wv = int(vl.sum())
    wc = int(cr.sum())
    wacc = wc / wv * 100 if wv > 0 else 0
    stats = (f"{ts[0]} to {ts[-1]}   |   "
             f"Window accuracy: {wacc:.1f}% ({wc}/{wv})   |   "
             f"Avg confidence: {np.nanmean(pr):.0%}")
    page = f"Bar {pos:,} - {end:,} / {oos_n:,}"

    return fig, stats, page, pos


if __name__ == "__main__":
    print(f"\n  Prediction Viewer: http://localhost:{args.port}\n")
    app.run(debug=True, port=args.port, host="0.0.0.0")
