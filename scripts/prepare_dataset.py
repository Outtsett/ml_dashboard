import argparse
import os

import duckdb


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--instrument", required=True)
    parser.add_argument("--timeframe", required=True)
    parser.add_argument("--data-size", required=True, type=int)
    parser.add_argument("--job-id", required=True)
    args = parser.parse_args()

    # The auto-activation mandate: "Always aim for institutional-grade processing speed... zero-copy"
    con = duckdb.connect()
    con.execute("INSTALL postgres; LOAD postgres;")
    con.execute("ATTACH 'host=127.0.0.1 port=8812 user=admin password=quest dbname=qdb' AS qdb (TYPE POSTGRES);")

    out_dir = f"D:/ml_data/runs/{args.job_id}"
    os.makedirs(out_dir, exist_ok=True)

    train_path = f"{out_dir}/train.parquet"
    test_path = f"{out_dir}/test.parquet"

    table_name = f"{args.instrument}_ohlcv_{args.timeframe}"
    limit_clause = f"LIMIT {args.data_size}" if args.data_size > 0 else ""

    # First, dump all to a temporary parquet to avoid multiple heavy queries to QuestDB
    temp_path = f"{out_dir}/temp_full.parquet"
    print(f"Exporting data from QuestDB to {temp_path}...")
    con.execute(f"COPY (SELECT * FROM qdb.{table_name} ORDER BY timestamp ASC {limit_clause}) TO '{temp_path}' (FORMAT PARQUET);")

    # Get count from parquet
    count = con.execute(f"SELECT COUNT(*) FROM '{temp_path}'").fetchone()[0]
    split_idx = int(count * 0.8)

    print(f"Total rows: {count}. Splitting at {split_idx}...")
    
    con.execute(f"COPY (SELECT * FROM '{temp_path}' ORDER BY timestamp ASC LIMIT {split_idx}) TO '{train_path}' (FORMAT PARQUET);")
    con.execute(f"COPY (SELECT * FROM '{temp_path}' ORDER BY timestamp ASC OFFSET {split_idx}) TO '{test_path}' (FORMAT PARQUET);")

    # Cleanup temp
    os.remove(temp_path)

    print(f"DATASET_READY:{train_path},{test_path}")

if __name__ == "__main__":
    main()
