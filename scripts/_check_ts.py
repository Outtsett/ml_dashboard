"""Check timestamp alignment between OHLCV and indicator parquets."""

import duckdb

conn = duckdb.connect(":memory:")

# Check indicator parquet timestamp
ind = conn.execute(
    "SELECT timestamp, open, close FROM read_parquet('data/indicators/ES_1d.parquet') ORDER BY timestamp LIMIT 5"
).fetchdf()
print("=== Indicator parquet (ES_1d) ===")
print(ind)
print(f"timestamp dtype: {ind['timestamp'].dtype}")
print(f"First ts: {ind['timestamp'].iloc[0]}")
print()

# Check what our OHLCV data looks like
ohlcv = conn.execute(
    "SELECT ts, open, close FROM read_parquet('data/indicators/ES_1d.parquet') LIMIT 1"
).fetchdf()
print(f"Has 'ts' column: {'ts' in ohlcv.columns}")

# Check EURUSD too
eu = conn.execute(
    "SELECT timestamp FROM read_parquet('data/indicators/EURUSD_1d.parquet') ORDER BY timestamp LIMIT 3"
).fetchdf()
print(f"\n=== EURUSD indicator timestamps ===")
print(eu)

conn.close()
