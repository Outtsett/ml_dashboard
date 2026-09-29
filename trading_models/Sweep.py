import torch
import optuna
import yaml
import os
import logging
from src.infra.Workspace import WorkspaceManager
from src.data.Pipeline import DataPipeline
from src.models.transformer import ProbabilisticTransformer
from src.training.Loop import Trainer

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(message)s')

def objective(trial):
    logger = logging.getLogger("Sweep")
    logger.info(f"--- Starting Trial {trial.number} ---")
    
    # 1. Load Base Config
    with open(os.path.join("configs", "default.yaml"), 'r') as f:
        config = yaml.safe_load(f)
        
    # 2. Define Hyperparameter Search Space
    config['training']['learning_rate'] = trial.suggest_float('lr', 1e-5, 1e-3, log=True)
    d_model = trial.suggest_categorical('d_model', [32, 64, 128])
    num_layers = trial.suggest_int('num_layers', 1, 4)
    dropout = trial.suggest_float('dropout', 0.05, 0.3)
    
    # Fast proxy training (fewer epochs to find architecture direction quickly)
    config['training']['epochs'] = 5 
    
    workspace = WorkspaceManager(config)
    pipeline = DataPipeline(config)
    df = pipeline.load_and_prepare()
    train_loader, val_loader = pipeline.create_loaders(df)
    
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = ProbabilisticTransformer(
        config=config, 
        input_dim=5, 
        d_model=d_model, 
        nhead=4, 
        num_layers=num_layers, 
        dropout=dropout
    ).to(device)
    
    trainer = Trainer(model, train_loader, val_loader, config, workspace)
    
    try:
        # Run proxy training
        for epoch in range(1, config['training']['epochs'] + 1):
            trainer.train_epoch(epoch)
            val_loss, val_rmse, val_unc = trainer.validate(epoch)
            workspace.cleanup()
            
            # Report to Optuna for Hyperband early stopping
            trial.report(val_rmse, epoch)
            if trial.should_prune():
                raise optuna.TrialPruned()
                
    except optuna.TrialPruned:
        logger.info(f"Trial {trial.number} pruned.")
        raise
    except Exception as e:
        logger.error(f"Trial {trial.number} failed: {e}")
        return float('inf')
        
    # Objective: Minimize Validation RMSE (Expertise)
    return val_rmse

if __name__ == "__main__":
    study = optuna.create_study(direction='minimize', pruner=optuna.pruners.HyperbandPruner())
    # You can scale n_trials based on the hardware capacity (e.g. 50 trials)
    study.optimize(objective, n_trials=10)
    
    print("\n--- Sweep Complete ---")
    print("Best Trial:")
    print(f"  Value (RMSE): {study.best_value}")
    print("  Params: ")
    for key, value in study.best_trial.params.items():
        print(f"    {key}: {value}")
