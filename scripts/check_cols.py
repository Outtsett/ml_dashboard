import duckdb

conn = duckdb.connect(":memory:")
df = conn.execute("SELECT * FROM read_parquet('E:/source/repos/ml_dashboard/data/indicators/ES_1d.parquet') LIMIT 1").fetchdf()
conn.close()
print(f"Total columns: {len(df.columns)}")
cols = df.columns.tolist()
for i, c in enumerate(cols):
    print(f"  {i:3d}: {c}")
