import pandas as pd

from .data import _connect, emit_log


def load_mbp10_ohlcv(symbol, interval='1m', limit=5000):
    """
    Load OHLCV merged with top-level MBP10 depth data.
    """
    emit_log(f"Loading MBP10 joined OHLCV for {symbol} ({interval})...")
    
    # Generate depth column names for bid/ask size
    depth_cols = []
    for i in range(10):
        pad = str(i).zfill(2)
        depth_cols.append(f"last(bid_sz_{pad}) as bid_sz_{pad}")
        depth_cols.append(f"last(ask_sz_{pad}) as ask_sz_{pad}")
    
    depth_sql = ", ".join(depth_cols)
    
    # Joined query using QuestDB SAMPLE BY for aggregation
    # We join ohlcv with mbp10 by symbol and time bucket
    sql = f"""
    SELECT 
        o.timestamp,
        first(o.open) as open,
        max(o.high) as high,
        min(o.low) as low,
        last(o.close) as close,
        sum(o.volume) as volume,
        {depth_sql}
    FROM ohlcv o
    JOIN mbp10 m ON o.timestamp = m.timestamp
    WHERE o.symbol = '{symbol}' 
      AND o.timestamp > dateadd('d', -30, now())
    SAMPLE BY {interval} ALIGN TO CALENDAR
    ORDER BY timestamp DESC
    LIMIT {limit};
    """
    
    try:
        with _connect() as conn:
            df = pd.read_sql(sql, conn)
            # QuestDB returns descending, reverse to ascending for ML windowing
            df = df.sort_values('timestamp').reset_index(drop=True)
            
            # Convert to dict of numpy arrays for features.py compatibility
            result = {col: df[col].values for col in df.columns if col != 'timestamp'}
            result['timestamp'] = df['timestamp'].values
            
            emit_log(f"Successfully loaded {len(df)} rows of MBP10-OHLCV data.")
            return result
    except Exception as e:
        emit_log(f"Error loading MBP10-OHLCV: {e}")
        raise
