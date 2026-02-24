"""Quick test: loading pipeline speed (combined stats query)."""
import duckdb, numpy as np, time
from ml.hdp_hmm.config import SKIP_COLUMNS, INDICATORS_DIR

fpath = str(INDICATORS_DIR / "1m" / "MNQ" / "normalized.parquet").replace("\\", "/")
conn = duckdb.connect(":memory:")

t0 = time.time()
all_cols = [r[0] for r in conn.execute(f"DESCRIBE SELECT * FROM read_parquet('{fpath}')").fetchall()]
n = conn.execute(f"SELECT count(*) FROM read_parquet('{fpath}')").fetchone()[0]
skip = SKIP_COLUMNS | {"ts"}
feat_cols = sorted(c for c in all_cols if c not in skip)
print(f"Metadata: {time.time()-t0:.2f}s | {n:,} rows, {len(feat_cols)} features")

t1 = time.time()
train_size = n - int(n * 0.15)
stats_sql = ", ".join([f'avg("{c}")::DOUBLE, stddev_samp("{c}")::DOUBLE' for c in feat_cols])
stats_row = conn.execute(f"SELECT {stats_sql} FROM (SELECT * FROM read_parquet('{fpath}') LIMIT {train_size})").fetchone()
mean32 = np.array([stats_row[i*2] if stats_row[i*2] is not None else 0.0 for i in range(len(feat_cols))], dtype=np.float32)
scale32 = np.array([stats_row[i*2+1] if stats_row[i*2+1] and stats_row[i*2+1] > 0 else 1.0 for i in range(len(feat_cols))], dtype=np.float32)
print(f"Stats (1 query): {time.time()-t1:.2f}s")

t2 = time.time()
feat_sql = ", ".join([f'COALESCE("{c}", 0)::FLOAT AS "{c}"' for c in feat_cols])
raw = conn.execute(f"SELECT {feat_sql} FROM read_parquet('{fpath}')").fetchnumpy()
X = np.column_stack([raw[c] for c in feat_cols])
del raw
print(f"Load: {time.time()-t2:.2f}s | shape={X.shape} dtype={X.dtype} {X.nbytes//1024//1024}MB")

t3 = time.time()
X -= mean32
X /= scale32
np.clip(X, -5, 5, out=X)
print(f"Standardize: {time.time()-t3:.2f}s")
print(f"Train mean={X[:train_size].mean():.4f} std={X[:train_size].std():.4f}")
print(f"Total: {time.time()-t0:.2f}s")
conn.close()
