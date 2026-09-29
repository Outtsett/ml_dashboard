import pandas as pd
import numpy as np

class VectorizedBacktester:
    """
    Overview:
    Simulates the equity curve of the generated signals.
    Applies the $2.78 fixed institutional friction per trade.
    """
    def __init__(self, config: dict):
        self.config = config
        self.contracts = self.config.get('execution', {}).get('contracts', 1)
        self.friction_usd = (self.config['friction']['commission_rt'] + \
                           (self.config['friction']['slippage_ticks'] * 0.25 * self.config['friction']['dollars_per_point'])) * self.contracts
        self.multiplier = self.config['friction']['dollars_per_point'] * self.contracts

    def run(self, df: pd.DataFrame) -> dict:
        """
        Runs the stateful backtest on the DataFrame.
        Assumes df contains 'signal' and 'actual_target' (log return over 75m).
        Enforces Max Open Positions = 1.
        """
        lookback = self.config['data']['lookback_bars'] # Usually 15 bars (75m)
        
        # We must iterate or use a fast stateful trick to enforce the holding period.
        # Since it's a fixed holding period, we can use a mask to block out trades while in position.
        
        in_trade_until = 0
        executed_signals = np.zeros(len(df))
        trade_points = np.zeros(len(df))
        
        close_prices = df['close'].values if 'close' in df.columns else np.full(len(df), 20000.0)
        signals = df['signal'].values
        targets = df['actual_target'].values
        
        for i in range(len(df)):
            if i >= in_trade_until and signals[i] != 0:
                executed_signals[i] = signals[i]
                
                # Fix Math Bug:
                # Long: Points = Close * (exp(Target) - 1)
                # Short: Points = Close * (1 - exp(Target)) = -Close * (exp(Target) - 1)
                # Therefore, Points = Signal * Close * (exp(Target) - 1)
                point_move = close_prices[i] * (np.exp(targets[i]) - 1.0)
                trade_points[i] = signals[i] * point_move
                
                # Lock out new trades for 'lookback' bars
                in_trade_until = i + lookback
                
        df['executed_signal'] = executed_signals
        df['trade_points'] = trade_points
        df['gross_usd'] = df['trade_points'] * self.multiplier
        df['net_usd'] = np.where(df['executed_signal'] != 0, df['gross_usd'] - self.friction_usd, 0)
        
        # Metrics
        trades = df[df['executed_signal'] != 0].copy()
        num_trades = len(trades)
        
        if num_trades == 0:
            return {
                "Total Trades": 0,
                "Win Rate": 0.0,
                "Avg Net per Trade": 0.0,
                "Total Net Profit": 0.0,
                "Expected Daily Profit": 0.0
            }
            
        winning_trades = trades[trades['net_usd'] > 0]
        win_rate = len(winning_trades) / num_trades
        avg_net = trades['net_usd'].mean()
        total_net = trades['net_usd'].sum()
        
        # Assume dataset is chronologic. Calculate days.
        if 'timestamp' in df.columns:
            days = (df['timestamp'].max() - df['timestamp'].min()).days
        else:
            # Fallback based on 5m bars
            days = len(df) / (24 * 12)
            
        days = max(1, days)
        daily_profit = total_net / days
        
        # Advanced Analytics
        # Treat each trade's return as independent for the ratio calculation
        trade_returns = trades['net_usd']
        
        if len(trade_returns) > 1 and trade_returns.std() != 0:
            # Approximate Sharpe: Average Trade Net / Standard Deviation of Trade Net
            # Annualized based on trades per day
            trades_per_day = num_trades / days
            annual_factor = np.sqrt(trades_per_day * 252)
            sharpe = (trade_returns.mean() / trade_returns.std()) * annual_factor
            
            # Sortino: Only consider negative trades for downside deviation
            downside_returns = trade_returns[trade_returns < 0]
            downside_std = downside_returns.std() if len(downside_returns) > 1 else 1e-9
            sortino = (trade_returns.mean() / downside_std) * annual_factor
        else:
            sharpe = 0.0
            sortino = 0.0
            
        # Max Drawdown
        trades['cum_pnl'] = trade_returns.cumsum()
        trades['peak'] = trades['cum_pnl'].cummax()
        trades['drawdown'] = trades['peak'] - trades['cum_pnl']
        max_dd = trades['drawdown'].max()
        
        return {
            "Total Trades": num_trades,
            "Win Rate (%)": round(win_rate * 100, 2),
            "Avg Net per Trade ($)": round(avg_net, 2),
            "Total Net Profit ($)": round(total_net, 2),
            "Expected Daily Profit ($)": round(daily_profit, 2),
            "Sharpe Ratio": round(sharpe, 3),
            "Sortino Ratio": round(sortino, 3),
            "Max Drawdown ($)": round(max_dd, 2)
        }
