import yaml
import logging
import os
import torch
import pandas as pd
from src.infra.Workspace import WorkspaceManager
from src.data.Pipeline import DataPipeline
from src.models.transformer import ProbabilisticTransformer
from src.execution.Strategy import ConfidenceStrategy
from src.execution.Backtest import VectorizedBacktester

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

def evaluate():
    logger = logging.getLogger("Evaluator")
    logger.info("Initializing Execution Evaluation...")
    
    with open(os.path.join("configs", "default.yaml"), 'r') as f:
        config = yaml.safe_load(f)
        
    workspace = WorkspaceManager(config)
    pipeline = DataPipeline(config)
    
    # 1. Load Validation Data
    df = pipeline.load_and_prepare()
    # We only care about the out-of-sample (validation) portion for fair backtesting
    split_idx = int(len(df) * 0.8)
    val_df = df.iloc[split_idx:].copy()
    
    train_loader, val_loader = pipeline.create_loaders(df)
    
    # 2. Load Model
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = ProbabilisticTransformer(
        config=config, 
        input_dim=5,
        d_model=128,
        nhead=4,
        num_layers=2,
        dropout=0.0999
    ).to(device)
    
    model_path = os.path.join("logs", "final_model.pth")
    if os.path.exists(model_path):
        logger.info(f"Loading trained weights from {model_path}...")
        model.load_state_dict(torch.load(model_path, weights_only=True))
    else:
        logger.warning(f"Weights not found at {model_path}. Using untrained weights!")
        
    model.eval()
    
    logger.info("Running Inference on Out-Of-Sample Data...")
    all_means = []
    all_vars = []
    
    with torch.no_grad():
        for x, y in val_loader:
            x = x.to(device)
            mu, var = model(x)
            all_means.extend(mu.squeeze().cpu().numpy())
            all_vars.extend(var.squeeze().cpu().numpy())
            
    # The dataloader drops the last incomplete batch, so we must align the dataframe
    seq_len = config['data']['sequence_length']
    # The first prediction corresponds to index seq_len
    aligned_val_df = val_df.iloc[seq_len - 1 : seq_len - 1 + len(all_means)].copy()
    
    aligned_val_df['pred_mean'] = all_means
    aligned_val_df['pred_var'] = all_vars
    aligned_val_df['actual_target'] = aligned_val_df[config['data']['target_name']]
    
    # 3. Apply Confidence Filter Strategy
    strategy = ConfidenceStrategy(min_move_pts=10.0, max_variance_quantile=0.05)
    signals_df = strategy.generate_signals(aligned_val_df)
    
    # 4. Run Vectorized Backtest
    backtester = VectorizedBacktester(config)
    metrics = backtester.run(signals_df)
    
    logger.info("--- OOS Backtest Results ---")
    for k, v in metrics.items():
        logger.info(f"{k}: {v}")
        
    signals_df.to_csv("logs/oos_backtest_results.csv")
    logger.info("Detailed trade log saved to logs/oos_backtest_results.csv")

if __name__ == "__main__":
    evaluate()
