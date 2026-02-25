#!/usr/bin/env python3
import sys
import json
import pyarrow.parquet as pq
import pandas as pd

def read_parquet(file_path):
    try:
        df = pd.read_parquet(file_path)
        
        possible_time_cols = ['timestamp', 'time', 'date', 'datetime', 'Date', 'Time', 'Timestamp']
        time_col = None
        for col in possible_time_cols:
            if col in df.columns:
                time_col = col
                break
        
        if time_col is None:
            time_col = df.columns[0]
        
        col_mapping = {}
        for col in df.columns:
            lower_col = col.lower()
            if lower_col in ['open', 'o']:
                col_mapping['open'] = col
            elif lower_col in ['high', 'h']:
                col_mapping['high'] = col
            elif lower_col in ['low', 'l']:
                col_mapping['low'] = col
            elif lower_col in ['close', 'c']:
                col_mapping['close'] = col
            elif lower_col in ['volume', 'vol', 'v']:
                col_mapping['volume'] = col
        
        records = []
        for _, row in df.iterrows():
            ts = row[time_col]
            if hasattr(ts, 'timestamp'):
                ts = int(ts.timestamp() * 1000)
            elif isinstance(ts, str):
                ts = int(pd.Timestamp(ts).timestamp() * 1000)
            else:
                ts = int(ts)
            
            record = {
                'timestamp': ts,
                'open': float(row.get(col_mapping.get('open', 'open'), 0)),
                'high': float(row.get(col_mapping.get('high', 'high'), 0)),
                'low': float(row.get(col_mapping.get('low', 'low'), 0)),
                'close': float(row.get(col_mapping.get('close', 'close'), 0)),
                'volume': float(row.get(col_mapping.get('volume', 'volume'), 0) if col_mapping.get('volume') else 0),
            }
            records.append(record)
        
        print(json.dumps(records))
        
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'No file path provided'}), file=sys.stderr)
        sys.exit(1)
    read_parquet(sys.argv[1])
