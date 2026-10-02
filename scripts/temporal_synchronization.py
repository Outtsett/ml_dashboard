import os
import pandas as pd
import numpy as np

DATA_DIR = r"E:\source\repos\ml_dashboard\data\models"

def load_data():
    return pd.read_csv(os.path.join(DATA_DIR, "supervised.csv"), parse_dates=['timestamp'])

def apply_volatility_weighted_merge(df, timeframe):
    # Set timestamp as index for resampling
    df.set_index('timestamp', inplace=True)
    
    # Calculate weights: w_i = 1 / volatility_i (using ATR as volatility proxy)
    # Adding a small epsilon to avoid division by zero
    df['weight'] = 1 / (df['ATR'] + 1e-6)
    
    # Weighted price: P_i * w_i
    df['weighted_close'] = df['close'] * df['weight']
    
    # Resample
    resampled = df.resample(timeframe).agg({
        'open': 'first',
        'high': 'max',
        'low': 'min',
        'close': 'last',
        'volume': 'sum',
        'ATR': 'mean',
        'weighted_close': 'sum',
        'weight': 'sum'
    }).dropna()
    
    # Calculate P_merged = sum(P_i * w_i) / sum(w_i)
    resampled['P_merged'] = resampled['weighted_close'] / resampled['weight']
    
    # Normalize volatility regimes using ATR
    atr_mean = resampled['ATR'].mean()
    resampled['regime_label'] = np.where(resampled['ATR'] > atr_mean * 1.5, 'High',
                                np.where(resampled['ATR'] < atr_mean * 0.5, 'Low', 'Medium'))
    
    # Adjust model sampling frequency based on regime intensity
    # E.g. high volatility = sample 100%, medium = 50%, low = 25% (Simulated output metric)
    resampled['sampling_rate'] = np.where(resampled['regime_label'] == 'High', 1.0,
                                 np.where(resampled['regime_label'] == 'Medium', 0.5, 0.25))
    
    resampled.reset_index(inplace=True)
    resampled['granularity'] = timeframe
    return resampled[['timestamp', 'granularity', 'open', 'high', 'low', 'close', 'P_merged', 'volume', 'ATR', 'regime_label', 'sampling_rate']]

def generate_temporal_sync():
    print("Loading base 1m dataset...")
    base_df = load_data()
    
    print("Applying volatility-weighted temporal synchronization...")
    dfs = []
    
    # 1m is base
    base_df['granularity'] = '1m'
    base_df['weight'] = 1 / (base_df['ATR'] + 1e-6)
    base_df['P_merged'] = base_df['close']  # P_merged is just close for base granularity
    atr_mean = base_df['ATR'].mean()
    base_df['regime_label'] = np.where(base_df['ATR'] > atr_mean * 1.5, 'High',
                                np.where(base_df['ATR'] < atr_mean * 0.5, 'Low', 'Medium'))
    base_df['sampling_rate'] = np.where(base_df['regime_label'] == 'High', 1.0,
                                 np.where(base_df['regime_label'] == 'Medium', 0.5, 0.25))
    dfs.append(base_df[['timestamp', 'granularity', 'open', 'high', 'low', 'close', 'P_merged', 'volume', 'ATR', 'regime_label', 'sampling_rate']])
    
    # Compute aggregates
    timeframes = ['5T', '15T', '1H', '1D']
    labels = ['5m', '15m', '1h', 'Daily']
    
    for tf, label in zip(timeframes, labels):
        print(f"Synchronizing {label} interval...")
        resampled_df = apply_volatility_weighted_merge(base_df.copy(), tf)
        resampled_df['granularity'] = label
        dfs.append(resampled_df)
        
    final_df = pd.concat(dfs, ignore_index=True)
    
    output_path = os.path.join(DATA_DIR, "temporal_sync.csv")
    final_df.to_csv(output_path, index=False)
    print(f"\nTemporal synchronization complete. Saved to {output_path}")
    print(f"Total synchronized records: {len(final_df)}")
    
if __name__ == "__main__":
    generate_temporal_sync()
