import re
import sys
import argparse
import psycopg2
import pandas as pd
import dtale

def main():
    parser = argparse.ArgumentParser(description="Launch D-Tale on a QuestDB table")
    parser.add_argument("--table", required=True, help="QuestDB table name")
    parser.add_argument("--sample_by", default="raw", help="QuestDB sample by clause (e.g., 1h, 5m, 1d) or 'raw'")
    parser.add_argument("--port", type=int, default=40000, help="D-Tale port")
    # Loopback, not 0.0.0.0. D-Tale exposes the whole dataframe and an editing
    # UI with no authentication; binding it to every interface publishes that to
    # the network. The Node caller already passes 127.0.0.1 — this makes running
    # the script by hand safe too, rather than relying on the caller.
    parser.add_argument("--host", default="127.0.0.1", help="D-Tale host")

    args = parser.parse_args()

    # The table name is interpolated into SQL below, and SAMPLE BY takes no
    # bind parameter, so the shape is enforced here as well as in the router.
    # Defence in depth: a second caller must not be able to reintroduce
    # injection by skipping the router's check.
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", args.table):
        print(f"[dtale_questdb] Invalid table name: {args.table!r}")
        sys.exit(2)
    if args.sample_by.lower() != "raw" and not re.fullmatch(r"\d{1,3}[smhdMy]", args.sample_by):
        print(f"[dtale_questdb] Invalid sample_by: {args.sample_by!r}")
        sys.exit(2)
    
    print(f"[dtale_questdb] Connecting to QuestDB on localhost:8812...")
    
    try:
        conn = psycopg2.connect(
            host="127.0.0.1",
            port=8812,
            user="admin",
            password="quest",
            dbname="qdb"
        )
        
        # Build query
        if args.sample_by.lower() != "raw":
            # For OHLCV standard time-series compression
            # Attempt to group by timestamp if available
            query = f"""
            SELECT 
                timestamp,
                first(open) as open,
                max(high) as high,
                min(low) as low,
                last(close) as close,
                sum(volume) as volume
            FROM {args.table}
            SAMPLE BY {args.sample_by} ALIGN TO CALENDAR
            LIMIT 1000000
            """
        else:
            query = f"SELECT * FROM {args.table} LIMIT 1000000"
            
        print(f"[dtale_questdb] Executing query:\n{query}")
        
        df = pd.read_sql(query, conn)
        
        print(f"[dtale_questdb] Query complete. Loaded {len(df)} rows into pandas.")
        print(f"[dtale_questdb] Starting D-Tale server on {args.host}:{args.port}...")
        
        d = dtale.show(df, host=args.host, port=args.port)
        
        import threading
        # Block forever to keep the process alive
        threading.Event().wait()
            
    except Exception as e:
        print(f"[dtale_questdb] Error: {str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()
