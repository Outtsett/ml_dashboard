import polars as pl
import numpy as np
import torch
from torch.utils.data import Dataset, DataLoader
import logging
import os

class ZeroCopyMNQDataset(Dataset):
    """
    Consumes a pre-materialized NumPy array directly to avoid
    Polars/Pandas overhead inside the PyTorch worker loops.
    """
    def __init__(self, features: np.ndarray, targets: np.ndarray, seq_length: int):
        self.seq_length = seq_length
        # Ensure contiguous memory for fast C-level Tensor creation
        self.features = np.ascontiguousarray(features, dtype=np.float32)
        self.targets = np.ascontiguousarray(targets, dtype=np.float32)

    def __len__(self):
        return len(self.features) - self.seq_length

    def __getitem__(self, idx):
        # Zero-copy tensor creation from numpy array slice
        x = torch.from_numpy(self.features[idx : idx + self.seq_length])
        y = torch.from_numpy(self.targets[idx + self.seq_length - 1: idx + self.seq_length])
        return x, y[0]

class DataPipeline:
    def __init__(self, config: dict):
        self.config = config
        self.logger = logging.getLogger("DataPipeline")

    def load_and_prepare(self) -> pl.DataFrame:
        """
        Bypasses DuckDB and Pandas.
        Uses Polars LazyFrames (Rust-backed) to scan the Parquet Lake and 
        execute multi-threaded vectorized transformations before materializing.
        """
        source_path = self.config['data']['source_path']
        self.logger.info(f"Scanning Parquet Lake (Zero-Copy LazyFrame) at {source_path}")
        
        # 1. Scan Parquet (Lazy)
        lf = pl.scan_parquet(source_path)
        
        # 2. Vectorized Feature Engineering
        self.logger.info("Executing Vectorized Multi-Timeframe Feature Graph")
        
        # For demonstration of speed, we compute standard OHLCV log returns in Rust
        # Instead of slow Pandas df.resample(), we use Polars group_by_dynamic
        lf = lf.sort("timestamp")
        
        # Compute base 1m bars
        base_1m = lf.group_by_dynamic("timestamp", every="1m").agg([
            pl.col("open").first(),
            pl.col("high").max(),
            pl.col("low").min(),
            pl.col("close").last(),
            pl.col("volume").sum()
        ])
        
        # Add Normalized Returns (Log Returns)
        base_1m = base_1m.with_columns([
            (pl.col("close") / pl.col("close").shift(1)).log().alias("1m_ret_log"),
            (pl.col("high") / pl.col("close").shift(1)).log().alias("1m_high_log"),
            (pl.col("volume") + 1).log().alias("1m_vol_log")
        ]).drop_nulls()

        # Compute Forward Target (e.g. 75 minutes ahead)
        lb = self.config['data'].get('lookback_bars', 15) * 5
        base_1m = base_1m.with_columns(
            (pl.col("close").shift(-lb) / pl.col("close")).log().alias("RET_LOG_FORWARD")
        ).drop_nulls()

        # 3. Materialize to Memory (Multi-threaded Rust Execution)
        self.logger.info("Materializing LazyFrame to Memory")
        df = base_1m.collect()
        
        self.logger.info(f"Dataset ready. Total rows: {len(df):,}")
        return df

    def create_loaders(self, df: pl.DataFrame, n_splits=5):
        feature_cols = ['1m_ret_log', '1m_high_log', '1m_vol_log']
        target_col = 'RET_LOG_FORWARD'
        
        seq_len = self.config['data']['sequence_length']
        batch_size = self.config['training']['batch_size']
        
        nw = os.cpu_count() or 24

        folds = []
        total_len = len(df)
        fold_size = total_len // (n_splits + 1)
        
        # Extract raw numpy buffers exactly ONCE outside the worker loops
        # This prevents Polars from doing IPC overhead on every __getitem__
        features_np = df.select(feature_cols).to_numpy()
        targets_np = df.select(target_col).to_numpy()
        
        for i in range(n_splits):
            train_end = (i + 1) * fold_size
            val_end = (i + 2) * fold_size
            
            # Array slicing (Views, not copies)
            train_feat = features_np[:train_end]
            train_targ = targets_np[:train_end]
            
            val_feat = features_np[train_end:val_end]
            val_targ = targets_np[train_end:val_end]
            
            train_ds = ZeroCopyMNQDataset(train_feat, train_targ, seq_len)
            val_ds = ZeroCopyMNQDataset(val_feat, val_targ, seq_len)
            
            # Pin memory for VRAM optimization
            train_loader = DataLoader(
                train_ds, batch_size=batch_size, shuffle=True, 
                pin_memory=True, drop_last=True, num_workers=nw, 
                persistent_workers=True if nw > 0 else False
            )
            val_loader = DataLoader(
                val_ds, batch_size=batch_size, shuffle=False, 
                pin_memory=True, drop_last=True, num_workers=nw,
                persistent_workers=True if nw > 0 else False
            )
            
            folds.append((train_loader, val_loader))
            
        return folds
