import os
import glob
import logging
import hashlib
import numpy as np
import pandas as pd
import polars as pl
import talib

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger("FeaturePipeline")

def process_file(file_path: str, output_path: str):
    logger.info(f"Processing {file_path}...")
    
    # Read via pandas to easily use talib (which requires numpy arrays)
    df = pd.read_parquet(file_path)
    
    if len(df) < 200:
        logger.warning(f"File {file_path} too small, skipping.")
        return
        
    df = df.sort_values('timestamp').reset_index(drop=True)
    
    close = df['close'].values
    high = df['high'].values
    low = df['low'].values
    open_ = df['open'].values
    volume = df['volume'].values
    
    # 1. Trend Labels (1 = Up, 0 = Flat, -1 = Down)
    # Proxy: 20-period SMA slope
    sma20 = talib.SMA(close, timeperiod=20)
    sma20_slope = np.gradient(sma20)
    trend_threshold = np.nanstd(sma20_slope) * 0.2
    
    trend_label = np.zeros(len(df), dtype=int)
    trend_label[sma20_slope > trend_threshold] = 1
    trend_label[sma20_slope < -trend_threshold] = -1
    
    # 2. MACD Crossing & Histogram
    macd, macdsignal, macdhist = talib.MACD(close, fastperiod=12, slowperiod=26, signalperiod=9)
    
    macd_cross = np.zeros(len(df), dtype=int)
    macd_cross[(macd > macdsignal) & (np.roll(macd, 1) <= np.roll(macdsignal, 1))] = 1
    macd_cross[(macd < macdsignal) & (np.roll(macd, 1) >= np.roll(macdsignal, 1))] = -1
    
    hist_rising = (macdhist > np.roll(macdhist, 1)).astype(int)
    hist_falling = (macdhist < np.roll(macdhist, 1)).astype(int)
    hist_below_zero = (macdhist < 0).astype(int)
    
    # 3. Rate of Change of Volume
    vol_roc = talib.ROC(volume, timeperiod=5)
    vol_roc_up = (vol_roc > 0).astype(int)
    vol_roc_down = (vol_roc < 0).astype(int)
    
    # 4. Buy Volume vs Sell Volume Approximation
    buy_vol_dominant = (close > open_).astype(int)
    sell_vol_dominant = (close < open_).astype(int)
    
    # 5. Volatility (ATR)
    atr = talib.ATR(high, low, close, timeperiod=14)
    volatility_increasing = (atr > np.roll(atr, 1)).astype(int)
    volatility_decreasing = (atr < np.roll(atr, 1)).astype(int)
    
    # Assign to DataFrame
    df['trend_label'] = trend_label
    df['macd_cross'] = macd_cross
    df['hist_rising'] = hist_rising
    df['hist_falling'] = hist_falling
    df['hist_below_zero'] = hist_below_zero
    df['vol_roc_up'] = vol_roc_up
    df['vol_roc_down'] = vol_roc_down
    df['buy_vol_dominant'] = buy_vol_dominant
    df['sell_vol_dominant'] = sell_vol_dominant
    df['volatility_increasing'] = volatility_increasing
    df['volatility_decreasing'] = volatility_decreasing
    
    # 6. Composite ID for vector DB
    logger.info("Generating composite IDs...")
    features_df = df[['trend_label', 'macd_cross', 'hist_rising', 'hist_falling', 
                      'hist_below_zero', 'vol_roc_up', 'vol_roc_down', 
                      'buy_vol_dominant', 'sell_vol_dominant', 'volatility_increasing', 
                      'volatility_decreasing']]
                      
    state_strings = (
        "TR:" + features_df['trend_label'].astype(str) + "_" +
        "MACD:" + features_df['macd_cross'].astype(str) + "_" +
        "HIST:" + features_df['hist_rising'].astype(str) + features_df['hist_falling'].astype(str) + features_df['hist_below_zero'].astype(str) + "_" +
        "VOL:" + features_df['vol_roc_up'].astype(str) + features_df['vol_roc_down'].astype(str) + "_" +
        "BS:" + features_df['buy_vol_dominant'].astype(str) + features_df['sell_vol_dominant'].astype(str) + "_" +
        "ATR:" + features_df['volatility_increasing'].astype(str) + features_df['volatility_decreasing'].astype(str)
    )
    
    df['state_id'] = state_strings.apply(lambda x: hashlib.md5(x.encode()).hexdigest()[:12])
    df = df.dropna()
    
    logger.info(f"Saving engineered dataset to {output_path}...")
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    df.to_parquet(output_path, engine='pyarrow', index=False)

def main():
    source_dir = "D:/ml_data"
    output_dir = "D:/ml_data_engineered"
    
    if not os.path.exists(source_dir):
        logger.error(f"Source directory {source_dir} not found.")
        return
        
    parquet_files = glob.glob(os.path.join(source_dir, "**/*.parquet"), recursive=True)
    for file_path in parquet_files:
        rel_path = os.path.relpath(file_path, source_dir)
        process_file(file_path, os.path.join(output_dir, rel_path))

if __name__ == "__main__":
    main()
