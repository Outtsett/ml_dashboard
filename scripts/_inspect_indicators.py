"""Inspect indicator parquet columns for normalization classification."""

import duckdb

conn = duckdb.connect(":memory:")

es = conn.execute(
    "SELECT * FROM read_parquet('data/indicators/ES_1d.parquet')"
).fetchdf()
eurusd = conn.execute(
    "SELECT * FROM read_parquet('data/indicators/EURUSD_1d.parquet')"
).fetchdf()

print(f"ES shape: {es.shape}, EURUSD shape: {eurusd.shape}")
print(f"ES columns: {len(es.columns)}, EURUSD columns: {len(eurusd.columns)}")
print()

for col in sorted(es.columns):
    if col in ("timestamp",):
        continue
    es_vals = es[col].dropna()
    eu_vals = eurusd[col].dropna() if col in eurusd.columns else None
    if len(es_vals) == 0 and (eu_vals is None or len(eu_vals) == 0):
        continue

    es_min = float(es_vals.min()) if len(es_vals) > 0 else 0
    es_max = float(es_vals.max()) if len(es_vals) > 0 else 0
    eu_min = float(eu_vals.min()) if eu_vals is not None and len(eu_vals) > 0 else 0
    eu_max = float(eu_vals.max()) if eu_vals is not None and len(eu_vals) > 0 else 0
    dtype = str(es[col].dtype)
    nunique = es_vals.nunique() if len(es_vals) > 0 else 0

    unique_str = ""
    if nunique <= 5:
        unique_str = f" unique={sorted(es_vals.unique().tolist())}"

    print(
        f"{col:45s} {dtype:8s} ES=[{es_min:.6f},{es_max:.6f}] EU=[{eu_min:.6f},{eu_max:.6f}] nunique={nunique}{unique_str}"
    )

conn.close()
