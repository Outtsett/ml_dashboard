import pandas as pd
import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader
import logging

class MNQDataset(Dataset):
    def __init__(self, df, seq_length, feature_cols, target_col):
        self.seq_length = seq_length
        self.features = df[feature_cols].values
        self.targets = df[target_col].values

    def __len__(self):
        return len(self.features) - self.seq_length

    def __getitem__(self, idx):
        x = self.features[idx : idx + self.seq_length]
        y = self.targets[idx + self.seq_length - 1]
        return torch.tensor(x, dtype=torch.float32), torch.tensor(y, dtype=torch.float32)

class DataPipeline:
    def __init__(self, config: dict):
        self.config = config
        self.logger = logging.getLogger("DataPipeline")

    def load_and_prepare(self) -> pd.DataFrame:
        self.logger.info(f"Loading data from {self.config['data']['source_path']}")
        df = pd.read_parquet(self.config['data']['source_path'])
        
        if 'timestamp' in df.columns:
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            df.set_index('timestamp', inplace=True)
            
        self.logger.info("Resampling multi-timeframes (1m, 2m, 3m, 4m, 5m)")
        
        timeframes = ['1min', '2min', '3min', '4min', '5min']
        all_features = []
        
        # Base 1m DataFrame to hold everything
        base_df = df.resample('1min').agg({'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'}).dropna()
        
        # Target is calculated on the 1m base dataframe (e.g., predict 75 mins ahead)
        lb = self.config['data']['lookback_bars'] * 5 # e.g. 15 5m bars = 75 1m bars
        base_df['RET_LOG_75M'] = np.log(base_df['close'].shift(-lb) / base_df['close'])
        
        for tf in timeframes:
            tf_df = df.resample(tf).agg({'open': 'first', 'high': 'max', 'low': 'min', 'close': 'last', 'volume': 'sum'}).dropna()
            
            tf_df[f'{tf}_open_norm'] = np.log(tf_df['open'] / tf_df['close'].shift(1))
            tf_df[f'{tf}_high_norm'] = np.log(tf_df['high'] / tf_df['close'].shift(1))
            tf_df[f'{tf}_low_norm'] = np.log(tf_df['low'] / tf_df['close'].shift(1))
            tf_df[f'{tf}_close_norm'] = np.log(tf_df['close'] / tf_df['close'].shift(1))
            tf_df[f'{tf}_vol_norm'] = np.log1p(tf_df['volume'])
            
            s1 = tf_df[f'{tf}_close_norm']
            s2 = tf_df[f'{tf}_close_norm'].shift(1)
            tf_df[f'{tf}_vol_ratio'] = s1.rolling(14).std() / (tf_df[f'{tf}_close_norm'].rolling(50).std() + 1e-8)
            
            net_change = tf_df['close'].diff(14).abs()
            sum_abs_change = tf_df['close'].diff().abs().rolling(14).sum()
            tf_df[f'{tf}_trend_str'] = net_change / (sum_abs_change + 1e-8)
            
            tf_df[f'{tf}_autocorr'] = s1.rolling(14).cov(s2) / (s1.rolling(14).var() + 1e-8)
            
            feature_cols = [f'{tf}_open_norm', f'{tf}_high_norm', f'{tf}_low_norm', f'{tf}_close_norm', f'{tf}_vol_norm', f'{tf}_vol_ratio', f'{tf}_trend_str', f'{tf}_autocorr']
            
            # Join onto base dataframe with ffill
            base_df = base_df.join(tf_df[feature_cols], rsuffix=f'_{tf}')
        
        base_df.ffill(inplace=True)
        base_df.dropna(inplace=True)
        
        self.logger.info(f"Multi-Timeframe Dataset ready. Total rows: {len(base_df)}")
        return base_df

    def create_loaders(self, df: pd.DataFrame):
        timeframes = ['1min', '2min', '3min', '4min', '5min']
        feature_cols = []
        for tf in timeframes:
            feature_cols.extend([f'{tf}_open_norm', f'{tf}_high_norm', f'{tf}_low_norm', f'{tf}_close_norm', f'{tf}_vol_norm', f'{tf}_vol_ratio', f'{tf}_trend_str', f'{tf}_autocorr'])

        target_col = self.config['data']['target_name']
        
        # Simple chronologic split for WFV 80/20
        split_idx = int(len(df) * 0.8)
        train_df = df.iloc[:split_idx]
        val_df = df.iloc[split_idx:]
        
        seq_len = self.config['data']['sequence_length']
        batch_size = self.config['training']['batch_size']
        
        train_ds = MNQDataset(train_df, seq_len, feature_cols, target_col)
        val_ds = MNQDataset(val_df, seq_len, feature_cols, target_col)
        
        # Pin memory for VRAM optimization
        train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, pin_memory=True, drop_last=True)
        val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False, pin_memory=True, drop_last=True)
        
        return train_loader, val_loader
