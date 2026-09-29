import pandas as pd
import numpy as np

class ConfidenceStrategy:
    """
    Overview:
    Executes trades strictly when the Probabilistic Transformer predicts 
    a massive structural impulse with extreme mathematical certainty.

    Principles:
    - Minimum Expected Magnitude: The predicted 'Mean' must exceed friction.
    - Maximum Doubt Threshold: The predicted 'Variance' must be below a strict quantile.
    """
    def __init__(self, min_move_pts: float = 10.0, max_variance_quantile: float = 0.05):
        self.min_move_pts = min_move_pts
        self.max_variance_quantile = max_variance_quantile

    def generate_signals(self, df: pd.DataFrame, static_var_threshold: float = None) -> pd.DataFrame:
        """
        Takes a DataFrame containing 'pred_mean' and 'pred_var' and returns signals.
        """
        # Calculate dynamic threshold for variance based on the provided quantile
        # If running live (1 row), static_var_threshold MUST be provided
        if static_var_threshold is not None:
            var_threshold = static_var_threshold
        elif len(df) > 1:
            var_threshold = df['pred_var'].quantile(self.max_variance_quantile)
        else:
            var_threshold = float('inf') # Fallback, no filter if misused
            
        # Calculate continuous log returns required to hit the minimum point move
        # We approximate the required log return. 
        # If MNQ is at 20,000, 10 points is 10/20000 = 0.0005 log return.
        # We will dynamically calculate this if 'close' price is provided.
        if 'close' in df.columns:
            required_log_return = np.log((df['close'] + self.min_move_pts) / df['close'])
        else:
            # Fallback static approximation if close isn't available
            required_log_return = pd.Series(0.0005, index=df.index)

        # Signal Logic
        # 1. Long: Mean > required_log_return AND Variance < threshold
        # -1. Short: Mean < -required_log_return AND Variance < threshold
        # 0. Neutral: Everything else
        
        conditions = [
            (df['pred_mean'] > required_log_return) & (df['pred_var'] < var_threshold),
            (df['pred_mean'] < -required_log_return) & (df['pred_var'] < var_threshold)
        ]
        choices = [1, -1]
        
        df['signal'] = np.select(conditions, choices, default=0)
        df['var_threshold_active'] = var_threshold
        
        return df
