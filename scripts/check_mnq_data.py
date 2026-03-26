"""Check MNQ data availability in QuestDB.

Only the `ohlcv` and `symbols` tables exist. All other tables
(indicators, talib_features, swing_labels, etc.) have been dropped.
"""
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

# Check daily aggregation via SAMPLE BY
print("Daily bar counts (via SAMPLE BY 1d):")
try:
    cur.execute("""
        SELECT symbol, count() as bars
        FROM ohlcv
        WHERE symbol LIKE 'MNQ%'
        GROUP BY symbol
        ORDER BY symbol
    """)
    for row in cur.fetchall():
        print(f"  {row[0]}: {row[1]:,} total bars")
except Exception as e:
    print(f"  ERROR: {e}")
    conn.rollback()

conn.close()
