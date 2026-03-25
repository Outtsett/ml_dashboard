import requests
import pandas as pd
import numpy as np
from questdb.ingress import Sender, TimestampNanos

import os

QUESTDB_HOST = os.environ.get("QUESTDB_HOST", "localhost")
QUESTDB_PG_PORT = os.environ.get("QUESTDB_PG_PORT", "8812")
QUESTDB_REST = f"http://{QUESTDB_HOST}:{os.environ.get('QUESTDB_HTTP_PORT', '9000')}/exec"
QUESTDB_PG = f"redshift://{os.environ.get('QUESTDB_USER', 'admin')}:{os.environ.get('QUESTDB_PASSWORD', 'quest')}@{QUESTDB_HOST}:{QUESTDB_PG_PORT}/qdb"

def get_bars(symbol, limit=100000):
    sql = f"SELECT timestamp, high, low FROM ohlcv_1m WHERE symbol = '{symbol}' ORDER BY timestamp LIMIT {limit}"
    import polars as pl
    return pl.read_database_uri(sql, uri=QUESTDB_PG).to_pandas()

def compute_swings(df, window=5):
    df['peak'] = df['high'].rolling(window=window*2+1, center=True).max() == df['high']
    df['valley'] = df['low'].rolling(window=window*2+1, center=True).min() == df['low']
    df['dir_1m'] = 0.5
    df.loc[df['peak'], 'dir_1m'] = 0.0
    df.loc[df['valley'], 'dir_1m'] = 1.0
    df['transition'] = 0.0
    df.loc[df['peak'] | df['valley'], 'transition'] = 1.0
    return df

def upload_swings(df, symbol):
    with Sender.from_conf("http::addr=localhost:9000;") as sender:
        for i, row in df.iterrows():
            if row['transition'] == 0: continue
            ts_ns = int(row['timestamp'].timestamp() * 1e9)
            sender.row("swing_labels", 
                       symbols={"symbol": symbol}, 
                       columns={"dir_1m": float(row['dir_1m']), "transition": 1.0, "dir_5m": 0.5, "dir_15m": 0.5},
                       at=TimestampNanos(ts_ns))
        sender.flush()

for sym in ["EURUSD", "NQZ4"]:
    print(f"Computing swings for {sym}...")
    try:
        bars = get_bars(sym)
        if not bars.empty:
            swings = compute_swings(bars)
            upload_swings(swings, sym)
            print(f"  Uploaded swing points for {sym}")
    except Exception as e:
        print(f"  Error for {sym}: {e}")
