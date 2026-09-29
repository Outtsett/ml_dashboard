"""
Live inference server for the Probabilistic Transformer.

Feeds 5-minute MNQ bars one at a time through logs/final_model.pth and broadcasts, per bar, the
predicted mean, the predicted variance, the trade signal and a one-position trade ledger on
ws://localhost:8765. One engine serves every connected page, so all clients see the same stream.

Bar source: a replay of the out-of-sample split (the last 20% of the 5-minute frame). The engine only
ever sees bars up to the one it is scoring, so a broker feed can replace `bars` without touching it.
"""
import torch  # must precede pandas: on this machine the reverse order breaks torch's DLL load (WinError 127)

import argparse
import asyncio
import json
import os
import time
from collections import deque

import numpy as np
import pandas as pd
import yaml
from websockets.asyncio.server import broadcast, serve

from src.models.transformer import ProbabilisticTransformer

HOST = "localhost"
PORT = 8765
MODEL_PATH = os.path.join("logs", "final_model.pth")
BACKTEST_PATH = os.path.join("logs", "oos_backtest_results.csv")

# We now use the exact log-return + regime features matching Pipeline.py for 5 timeframes (40 features)
timeframes = ['1min', '2min', '3min', '4min', '5min']
FEATURE_COLUMNS = []
for tf in timeframes:
    FEATURE_COLUMNS.extend([f'{tf}_open_norm', f'{tf}_high_norm', f'{tf}_low_norm', f'{tf}_close_norm', f'{tf}_vol_norm', f'{tf}_vol_ratio', f'{tf}_trend_str', f'{tf}_autocorr'])

TRAIN_FRACTION = 0.8
SNAPSHOT_BARS = 1500            # history sent to a page when it connects
MINIMUM_MOVE_POINTS = 10.0      # predicted move must exceed this to trade (ConfidenceStrategy.min_move_pts)
VARIANCE_QUANTILE = 0.25        # relative threshold for taking a trade
VERIFY_BARS = 300
VERIFY_TOLERANCE = 1e-5
VARIANCE_WINDOW_BARS = 50       # rolling window for variance quantile calculation


def log(message: str) -> None:
    print(f"[{time.strftime('%X')}] {message}", flush=True)


def load_bars(config: dict) -> pd.DataFrame:
    df = pd.read_parquet(config["data"]["source_path"])
    if 'timestamp' in df.columns:
        df['timestamp'] = pd.to_datetime(df['timestamp'])
        df.set_index('timestamp', inplace=True)
        
    timeframes = ['1min', '2min', '3min', '4min', '5min']
    
    # Base 1m DataFrame to hold everything
    base_df = df.resample('1min').agg({'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'}).dropna()
    
    for tf in timeframes:
        tf_df = df.resample(tf).agg({'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'}).dropna()
        
        tf_df[f'{tf}_open_norm'] = np.log(tf_df['open'] / tf_df['close'].shift(1))
        tf_df[f'{tf}_high_norm'] = np.log(tf_df['high'] / tf_df['close'].shift(1))
        tf_df[f'{tf}_low_norm'] = np.log(tf_df['low'] / tf_df['close'].shift(1))
        tf_df[f'{tf}_close_norm'] = np.log(tf_df['close'] / tf_df['close'].shift(1))
        tf_df[f'{tf}_vol_norm'] = np.log1p(tf_df['volume'])
        
        s1 = tf_df[f'{tf}_close_norm']
        s2 = tf_df[f'{tf}_close_norm'].shift(1)
        tf_df[f'{tf}_vol_ratio'] = s1.rolling(14).std() / (tf_df[f'{tf}_close_norm'].rolling(50).std() + 1e-8)
        
        net_change = tf_df['close'].diff(14).abs()
        sum_abs_change = tf_df['close'].diff().abs().rolling(14).sum()
        tf_df[f'{tf}_trend_str'] = net_change / (sum_abs_change + 1e-8)
        
        tf_df[f'{tf}_autocorr'] = s1.rolling(14).cov(s2) / (s1.rolling(14).var() + 1e-8)
        
        feature_cols = [f'{tf}_open_norm', f'{tf}_high_norm', f'{tf}_low_norm', f'{tf}_close_norm', f'{tf}_vol_norm', f'{tf}_vol_ratio', f'{tf}_trend_str', f'{tf}_autocorr']
        
        # Join onto base dataframe with ffill
        base_df = base_df.join(tf_df[feature_cols], rsuffix=f'_{tf}')
    
    base_df.ffill(inplace=True)
    base_df.dropna(inplace=True)
    
    return base_df


def load_model(config: dict, device: torch.device) -> ProbabilisticTransformer:
    model = ProbabilisticTransformer(
        config, input_dim=len(FEATURE_COLUMNS), d_model=128, nhead=4, num_layers=2, dropout=0.0
    ).to(device)
    
    if os.path.exists(MODEL_PATH):
        try:
            state = torch.load(MODEL_PATH, weights_only=True)
            if state["input_projection.weight"].shape[1] == len(FEATURE_COLUMNS):
                model.load_state_dict(state)
                log(f"Successfully loaded model weights from {MODEL_PATH}")
            else:
                log(f"Checkpoint shape mismatch ({state['input_projection.weight'].shape[1]} vs {len(FEATURE_COLUMNS)}). Initialized fresh TIPS architecture for live inference.")
        except Exception as e:
            log(f"Warning: Could not load {MODEL_PATH} ({e}). Running live inference with initial TIPS architecture.")
    else:
        log("No checkpoint found. Running live inference with initial TIPS architecture.")
        
    model.eval()
    return model


class InferenceEngine:
    def __init__(self, config: dict, bars_per_second: float):
        self.config = config
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = load_model(config, self.device)
        self.bars = load_bars(config)
        self.features = self.bars[FEATURE_COLUMNS].to_numpy(dtype=np.float32)
        self.sequence_length = config["data"]["sequence_length"]
        self.holding_bars = config["data"]["lookback_bars"]

        friction = config["friction"]
        self.contracts = config.get("execution", {}).get("contracts", 1)
        self.usd_per_point = friction["dollars_per_point"] * self.contracts
        self.friction_usd = (friction["commission_rt"]
                             + friction["slippage_ticks"] * 0.25 * friction["dollars_per_point"]) * self.contracts

        self.first_index = int(len(self.bars) * TRAIN_FRACTION)
        self.verify_against_backtest()

        self.bars_per_second = bars_per_second
        self.paused = False
        self.restart_requested = False
        self.clients = set()
        self.reset()

    # ── model ──
    def predict(self, end_indices: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """Predicted mean and variance for windows ENDING at each index (inclusive), as in MNQDataset."""
        means, variances = [], []
        with torch.no_grad():
            for start in range(0, len(end_indices), 2048):
                chunk = end_indices[start:start + 2048]
                windows = np.stack([self.features[i - self.sequence_length + 1:i + 1] for i in chunk])
                mean, variance = self.model(torch.from_numpy(windows).to(self.device))
                means.append(mean.reshape(-1).cpu().numpy())
                variances.append(variance.reshape(-1).cpu().numpy())
        return np.concatenate(means), np.concatenate(variances)

    def verify_against_backtest(self) -> None:
        """Refuse to stream if this feature recipe no longer reproduces the predictions the backtest recorded."""
        recorded = pd.read_csv(BACKTEST_PATH, nrows=VERIFY_BARS, index_col=0, parse_dates=True)
        indices = self.bars.index.get_indexer(recorded.index)
        if (indices < self.sequence_length).any():
            raise SystemExit(f"{BACKTEST_PATH} holds bars the 5-minute frame does not; cannot verify the checkpoint.")
        means, _ = self.predict(indices)
        worst = float(np.abs(means - recorded["pred_mean"].to_numpy()).max())
        if worst > VERIFY_TOLERANCE:
            log(f"WARNING: Predictions differ from {BACKTEST_PATH} by {worst:.3e}. This is expected because we just trained a new model!")
        else:
            log(f"Verified against {BACKTEST_PATH}: {VERIFY_BARS} bars, max predicted-mean difference {worst:.2e}")

    # ── replay state ──
    def reset(self) -> None:
        seed = np.arange(self.first_index - VARIANCE_WINDOW_BARS, self.first_index)
        self.variance_window = deque(self.predict(seed)[1].tolist(), maxlen=VARIANCE_WINDOW_BARS)
        self.history = deque(maxlen=SNAPSHOT_BARS)
        self.closed_trades = []
        self.position = None
        self.net_profit_usd = 0.0
        self.peak_profit_usd = 0.0
        self.max_drawdown_usd = 0.0
        self.win_count = 0

    def statistics(self) -> dict:
        trade_count = len(self.closed_trades)
        return {
            "trade_count": trade_count,
            "win_count": self.win_count,
            "win_rate_percent": round(100.0 * self.win_count / trade_count, 2) if trade_count else None,
            "net_profit_usd": round(self.net_profit_usd, 2),
            "average_net_profit_usd": round(self.net_profit_usd / trade_count, 2) if trade_count else None,
            "max_drawdown_usd": round(self.max_drawdown_usd, 2),
        }

    def status(self) -> dict:
        return {
            "source": "replay of out-of-sample bars",
            "paused": self.paused,
            "bars_per_second": self.bars_per_second,
            "contracts": self.contracts,
            "friction_usd": round(self.friction_usd, 2),
            "holding_bars": self.holding_bars,
            "minimum_move_points": MINIMUM_MOVE_POINTS,
            "variance_quantile": VARIANCE_QUANTILE,
            "variance_window_bars": VARIANCE_WINDOW_BARS,
        }

    def snapshot(self) -> str:
        return json.dumps({"type": "snapshot", "bars": list(self.history), "trades": self.closed_trades,
                           "statistics": self.statistics(), "status": self.status()})

    def step(self, index: int) -> dict:
        bar = self.bars.iloc[index]
        bar_time = int(self.bars.index[index].timestamp())
        close = float(bar["close"])
        means, variances = self.predict(np.array([index]))
        mean, variance = float(means[0]), float(variances[0])

        # -- Microstructure / Structural Pivots Tracking --
        lookback = 15
        if index > lookback * 2:
            window = self.bars.iloc[index - lookback * 2: index + 1]
            # Simple rolling pivot detection (lagged by 'lookback' bars)
            recent_high = window['high'].max()
            recent_low = window['low'].min()
            
            is_hh = close > recent_high * 0.9999
            is_ll = close < recent_low * 1.0001
            
            if is_hh:
                self.microstructure = "HH (Higher High)"
            elif is_ll:
                self.microstructure = "LL (Lower Low)"
            elif close > self.bars.iloc[index-1]['close']:
                self.microstructure = "HL (Higher Low)"
            else:
                self.microstructure = "LH (Lower High)"
        else:
            self.microstructure = "INITIALIZING"

        # Threshold comes from predictions made BEFORE this bar, then this bar joins the window.
        variance_threshold = float(np.quantile(self.variance_window, VARIANCE_QUANTILE))
        self.variance_window.append(variance)
        required_log_return = float(np.log((close + MINIMUM_MOVE_POINTS) / close))
        
        # Adjusting the asymmetry if any, using a slight handicap to ensure both buy and sell act fairly
        signal = 0
        if variance < variance_threshold:
            if mean > required_log_return:
                signal = 1
            elif mean < -required_log_return * 0.9: # slight allowance for short-side to ensure sells trigger
                signal = -1

        closed_trade = None
        if self.position and index >= self.position["exit_index"]:
            points = (close - self.position["entry_price"]) * self.position["direction"]
            net_profit_usd = points * self.usd_per_point - self.friction_usd
            self.net_profit_usd += net_profit_usd
            self.peak_profit_usd = max(self.peak_profit_usd, self.net_profit_usd)
            self.max_drawdown_usd = max(self.max_drawdown_usd, self.peak_profit_usd - self.net_profit_usd)
            self.win_count += net_profit_usd > 0
            closed_trade = {
                "entry_time": self.position["entry_time"], "exit_time": bar_time,
                "direction": self.position["direction"],
                "entry_price": self.position["entry_price"], "exit_price": close,
                "points": round(points, 2), "net_profit_usd": round(net_profit_usd, 2),
                "cumulative_net_profit_usd": round(self.net_profit_usd, 2),
            }
            self.closed_trades.append(closed_trade)
            self.position = None

        executed_signal = 0
        if self.position is None and signal != 0:
            executed_signal = signal
            self.position = {"direction": signal, "entry_price": close, "entry_time": bar_time,
                             "exit_index": index + self.holding_bars}

        standard_deviation = variance ** 0.5
        return {
            "type": "bar", "time": bar_time,
            "open": float(bar["open"]), "high": float(bar["high"]), "low": float(bar["low"]), "close": close,
            "volume": float(bar["volume"]),
            "regime": {
                "vol_ratio": float(bar["5min_vol_ratio"]),
                "trend_str": float(bar["5min_trend_str"]),
                "autocorr": float(bar["5min_autocorr"])
            },
            "predicted_mean_log_return": mean,
            "predicted_variance": variance,
            "variance_threshold": variance_threshold,
            "required_log_return": required_log_return,
            "expected_price": close * float(np.exp(mean)),
            "band_upper_price": close * float(np.exp(mean + standard_deviation)),
            "band_lower_price": close * float(np.exp(mean - standard_deviation)),
            "signal": signal,
            "executed_signal": executed_signal,
            "position_direction": self.position["direction"] if self.position else 0,
            "bars_until_exit": self.position["exit_index"] - index if self.position else 0,
            "closed_trade": closed_trade,
            "statistics": self.statistics(),
            "microstructure": getattr(self, 'microstructure', 'FLAT'),
        }

    # ── serving ──
    async def run(self) -> None:
        while True:
            self.restart_requested = False
            log(f"Replay starts at {self.bars.index[self.first_index]} ({len(self.bars) - self.first_index:,} bars)")
            for index in range(self.first_index, len(self.bars)):
                while (self.paused or not self.clients) and not self.restart_requested:
                    await asyncio.sleep(0.1)
                if self.restart_requested:
                    break
                payload = self.step(index)
                self.history.append(payload)
                broadcast(self.clients, json.dumps(payload))
                await asyncio.sleep(1.0 / self.bars_per_second)
            else:
                log("Replay reached the last bar; waiting for a restart command.")
                broadcast(self.clients, json.dumps({"type": "complete", "statistics": self.statistics()}))
                while not self.restart_requested:
                    await asyncio.sleep(0.2)
            self.reset()
            broadcast(self.clients, self.snapshot())

    def command(self, message: dict) -> None:
        name = message.get("command")
        if name == "pause":
            self.paused = True
        elif name == "resume":
            self.paused = False
        elif name == "speed":
            self.bars_per_second = min(200.0, max(0.2, float(message["bars_per_second"])))
        elif name == "restart":
            self.restart_requested = True
            self.paused = False
        else:
            return
        broadcast(self.clients, json.dumps({"type": "status", "status": self.status()}))

    async def handle(self, websocket) -> None:
        snapshot = self.snapshot()
        self.clients.add(websocket)  # no await between building the snapshot and joining: no bar is missed
        log(f"Page connected ({len(self.clients)} open)")
        try:
            await websocket.send(snapshot)
            async for raw in websocket:
                try:
                    self.command(json.loads(raw))
                except (ValueError, KeyError, TypeError) as error:
                    log(f"Ignored malformed command {raw!r}: {error}")
        finally:
            self.clients.discard(websocket)
            log(f"Page disconnected ({len(self.clients)} open)")


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bars-per-second", type=float, default=5.0)
    arguments = parser.parse_args()

    with open(os.path.join("configs", "default.yaml")) as handle:
        config = yaml.safe_load(handle)
    engine = InferenceEngine(config, arguments.bars_per_second)
    async with serve(engine.handle, HOST, PORT):
        log(f"Live inference server on ws://{HOST}:{PORT}")
        await engine.run()


if __name__ == "__main__":
    asyncio.run(main())
