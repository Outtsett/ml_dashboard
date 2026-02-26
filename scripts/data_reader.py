#!/usr/bin/env python3
"""
High-performance data file reader supporting:
- Parquet (pandas, polars)
- DBN (Databento)
- CSV

Optimized for speed with vectorized operations and fast JSON serialization.
"""
import sys
import os

try:
    import orjson
    def dumps(obj):
        return orjson.dumps(obj).decode('utf-8')
except ImportError:
    import json
    def dumps(obj):
        return json.dumps(obj)

def read_parquet_file(file_path):
    """Read parquet file using pandas with vectorized operations"""
    import pandas as pd
    import numpy as np

    df = pd.read_parquet(file_path)

    possible_time_cols = ['timestamp', 'time', 'date', 'datetime', 'Date', 'Time',
                          'Timestamp', 'ts_event', 'ts_recv', 'ts']
    time_col = None
    for col in possible_time_cols:
        if col in df.columns:
            time_col = col
            break

    if time_col is None:
        time_col = df.columns[0]

    col_mapping = {'open': None, 'high': None, 'low': None, 'close': None, 'volume': None}
    for col in df.columns:
        lower_col = col.lower()
        if lower_col in ['open', 'o']:
            col_mapping['open'] = col
        elif lower_col in ['high', 'h']:
            col_mapping['high'] = col
        elif lower_col in ['low', 'l']:
            col_mapping['low'] = col
        elif lower_col in ['close', 'c', 'price']:
            col_mapping['close'] = col
        elif lower_col in ['volume', 'vol', 'v', 'size']:
            col_mapping['volume'] = col

    ts_series = df[time_col]
    if pd.api.types.is_datetime64_any_dtype(ts_series):
        timestamps = (ts_series.astype('int64') // 1_000_000).values
    elif ts_series.dtype == 'int64' or ts_series.dtype == 'uint64':
        first_val = ts_series.iloc[0]
        if first_val > 1e18:
            timestamps = (ts_series // 1_000_000).values
        elif first_val > 1e15:
            timestamps = (ts_series // 1_000).values
        else:
            timestamps = ts_series.values
    else:
        # Handle string timestamps (e.g. '2020-01-05T22:02:00.000000000Z')
        dt_series = pd.to_datetime(ts_series, utc=True, format='mixed')
        # Convert to epoch milliseconds
        timestamps = (dt_series.astype('int64') // 1_000_000).values

    def get_col_values(name):
        col = col_mapping.get(name)
        if col and col in df.columns:
            return df[col].fillna(0).astype('float64').values
        return np.zeros(len(df), dtype='float64')

    opens = get_col_values('open')
    highs = get_col_values('high')
    lows = get_col_values('low')
    closes = get_col_values('close')
    volumes = get_col_values('volume')

    result = {
        'timestamps': timestamps.tolist(),
        'opens': opens.tolist(),
        'highs': highs.tolist(),
        'lows': lows.tolist(),
        'closes': closes.tolist(),
        'volumes': volumes.tolist(),
        'count': len(df)
    }

    return result

def read_dbn_file(file_path):
    """Read Databento DBN file with vectorized operations"""
    try:
        import databento as db
        import numpy as np

        store = db.DBNStore.from_file(file_path)
        df = store.to_df()

        if df.index.name and 'ts' in df.index.name.lower():
            timestamps = df.index.astype('int64') // 1_000_000
        elif 'ts_event' in df.columns:
            ts = df['ts_event']
            if ts.dtype == 'int64' and ts.iloc[0] > 1e18:
                timestamps = ts // 1_000_000
            else:
                timestamps = ts
        else:
            timestamps = np.arange(len(df))

        def get_col(names, default=0.0):
            for name in names:
                if name in df.columns:
                    return df[name].fillna(default).astype('float64').values
            return np.full(len(df), default, dtype='float64')

        result = {
            'timestamps': timestamps.tolist(),
            'opens': get_col(['open', 'price']).tolist(),
            'highs': get_col(['high', 'price']).tolist(),
            'lows': get_col(['low', 'price']).tolist(),
            'closes': get_col(['close', 'price']).tolist(),
            'volumes': get_col(['volume', 'size']).tolist(),
            'count': len(df)
        }

        return result
    except ImportError:
        raise Exception("databento package not installed")

def read_csv_file(file_path):
    """Read CSV file with vectorized operations"""
    import pandas as pd
    import numpy as np

    df = pd.read_csv(file_path)

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

    ts_series = df[time_col]
    if ts_series.dtype == 'object':
        timestamps = (pd.to_datetime(ts_series).astype('int64') // 1_000_000).values
    else:
        timestamps = ts_series.values

    def get_col_values(name):
        col = col_mapping.get(name)
        if col and col in df.columns:
            return df[col].fillna(0).astype('float64').values
        return np.zeros(len(df), dtype='float64')

    result = {
        'timestamps': timestamps.tolist(),
        'opens': get_col_values('open').tolist(),
        'highs': get_col_values('high').tolist(),
        'lows': get_col_values('low').tolist(),
        'closes': get_col_values('close').tolist(),
        'volumes': get_col_values('volume').tolist(),
        'count': len(df)
    }

    return result

def main():
    if len(sys.argv) < 2:
        print(dumps({'error': 'No file path provided'}), file=sys.stderr)
        sys.exit(1)

    file_path = sys.argv[1]
    ext = os.path.splitext(file_path)[1].lower()

    try:
        if ext == '.dbn':
            result = read_dbn_file(file_path)
        elif ext == '.parquet':
            result = read_parquet_file(file_path)
        elif ext == '.csv':
            result = read_csv_file(file_path)
        else:
            result = read_parquet_file(file_path)

        print(dumps(result))

    except Exception as e:
        print(dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
