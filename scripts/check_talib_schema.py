"""Check talib_features schema and sample data for MNQ."""
import psycopg2

conn = psycopg2.connect(host='localhost', port=8812, user='admin', password='quest', database='qdb')
cur = conn.cursor()

# Get all columns
cur.execute("SHOW COLUMNS FROM talib_features")
cols = cur.fetchall()
print(f"talib_features: {len(cols)} columns")

# Print relevant indicator columns
targets = ['atr', 'adx', 'rsi', 'macd', 'cci', 'willr', 'roc', 'bbands', 'bband',
           'dx', 'plus_di', 'minus_di', 'obv', 'natr', 'stoch', 'aroon', 'mfi',
           'mom', 'trix', 'ultosc', 'ppo', 'apo']
print("\nRelevant columns:")
for c in cols:
    col_name = c[0].lower()
    for t in targets:
        if t in col_name:
            print(f"  {c[0]} ({c[1]})")
            break

# Check date range and timeframe
cur.execute("""
    SELECT min(timestamp), max(timestamp), count(*)
    FROM talib_features
    WHERE symbol = 'MNQ'
""")
r = cur.fetchone()
print(f"\nMNQ range: {r[0]} to {r[1]} ({r[2]:,} rows)")

# Sample a few rows to see the timeframe
cur.execute("""
    SELECT timestamp
    FROM talib_features
    WHERE symbol = 'MNQ' AND timestamp > '2024-01-02'
    ORDER BY timestamp
    LIMIT 10
""")
print("\nSample timestamps:")
for row in cur.fetchall():
    print(f"  {row[0]}")

# Check what timeframe this is (diff between consecutive timestamps)
cur.execute("""
    SELECT timestamp
    FROM talib_features
    WHERE symbol = 'MNQ' AND timestamp >= '2024-06-03' AND timestamp < '2024-06-04'
    ORDER BY timestamp
    LIMIT 20
""")
print("\nSingle day timestamps (2024-06-03):")
for row in cur.fetchall():
    print(f"  {row[0]}")

conn.close()
