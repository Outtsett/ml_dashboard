"""Check MNQ data availability in QuestDB."""
import psycopg2

conn = psycopg2.connect(host='localhost', port=8812, user='admin', password='quest', database='qdb')
cur = conn.cursor()

# Check MNQ symbols in ohlcv
cur.execute("SELECT DISTINCT symbol FROM ohlcv WHERE symbol LIKE 'MNQ%' ORDER BY symbol")
symbols = cur.fetchall()
print("MNQ symbols:", [s[0] for s in symbols])

# Check date range per symbol
cur.execute("SELECT symbol, min(timestamp), max(timestamp), count(*) FROM ohlcv WHERE symbol LIKE 'MNQ%' GROUP BY symbol ORDER BY symbol")
for row in cur.fetchall():
    print(f"  {row[0]}: {row[1]} to {row[2]} ({row[3]:,} rows)")

print()

# Check indicator tables
for table in ['indicators_5m', 'indicators_1m']:
    try:
        cur.execute(f"SELECT count(*) FROM {table} WHERE symbol LIKE 'MNQ%'")
        count = cur.fetchone()[0]
        if count > 0:
            cur.execute(f"SELECT min(timestamp), max(timestamp) FROM {table} WHERE symbol LIKE 'MNQ%'")
            r = cur.fetchone()
            print(f"{table}: {count:,} rows, {r[0]} to {r[1]}")
        else:
            print(f"{table}: 0 rows for MNQ")
    except Exception as e:
        print(f"{table}: ERROR - {e}")
        conn.rollback()

print()

# Check talib_features
try:
    cur.execute("SELECT count(*) FROM talib_features WHERE symbol LIKE 'MNQ%'")
    count = cur.fetchone()[0]
    print(f"talib_features: {count:,} rows for MNQ")
except Exception as e:
    print(f"talib_features: ERROR - {e}")
    conn.rollback()

# Check what columns indicators_5m has
try:
    cur.execute("SHOW COLUMNS FROM indicators_5m")
    cols = cur.fetchall()
    print(f"\nindicators_5m has {len(cols)} columns")
    targets = ['atr', 'adx', 'rsi', 'macd', 'cci', 'willr', 'roc', 'bbands', 'dx', 'plus_di', 'minus_di', 'obv']
    print("Relevant indicator columns:")
    for c in cols:
        col_name = c[0]
        for t in targets:
            if t in col_name.lower():
                print(f"  {col_name} ({c[1]})")
                break
except Exception as e:
    print(f"indicators_5m columns: ERROR - {e}")
    conn.rollback()

conn.close()
