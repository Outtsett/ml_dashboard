"""Count actual RTH trading days per year for MNQ."""
import psycopg2

conn = psycopg2.connect(host='localhost', port=8812, user='admin', password='quest', database='qdb')
cur = conn.cursor()

for year in range(2020, 2025):
    # Use SAMPLE BY 1d to get one row per day, then count
    cur.execute(f"""
        SELECT count() FROM (
            SELECT timestamp, first(open) as o
            FROM ohlcv
            WHERE symbol = 'MNQ'
              AND timestamp >= '{year}-01-01T14:00:00.000000Z'
              AND timestamp <= '{year}-12-31T20:30:00.000000Z'
            SAMPLE BY 1d
        )
    """)
    count = cur.fetchone()[0]
    print(f"{year}: {count} trading days")

conn.close()
