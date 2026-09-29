import yaml
import logging
import os
import sys
import torch

# Configure root logger for console
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

from src.infra.Workspace import WorkspaceManager
from src.data.Pipeline import DataPipeline
from src.models.transformer import ProbabilisticTransformer
from src.training.Loop import Trainer

def main():
    logger = logging.getLogger("Main")
    logger.info("Initializing Futures Trading Model (DDFA)")
    
    # Load Config
    config_path = os.path.join("configs", "default.yaml")
    with open(config_path, 'r') as f:
        config = yaml.safe_load(f)
        
    # 1. Setup Workspace (GPU throttling, seeds)
    workspace = WorkspaceManager(config)
    
    # 2. Data Engineering
    pipeline = DataPipeline(config)
    df = pipeline.load_and_prepare()
    train_loader, val_loader = pipeline.create_loaders(df)
    
    # 3. Model Initialization
    model = ProbabilisticTransformer(
        config=config,
        input_dim=40, # 8 features * 5 timeframes (1m, 2m, 3m, 4m, 5m)
        d_model=128,
        nhead=4,
        num_layers=2,
        dropout=config['training'].get('dropout', 0.1)
    )
    
    # 4. Training Engine
    trainer = Trainer(model, train_loader, val_loader, config, workspace)
    
    logger.info("Starting orchestrated run.")
    trainer.run()
    
if __name__ == '__main__':
    main()
