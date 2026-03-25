import requests
import pandas as pd
import numpy as np

QUESTDB_REST = "http://localhost:9000/exec"

def get_data(sql):
    resp = requests.get(QUESTDB_REST, params={"query": sql})
    if resp.status_code != 200: return None
    data = resp.json()
    return pd.DataFrame(data["dataset"], columns=[c["name"] for p, c in enumerate(data["columns"])])

def analyze_arrow_moments(symbol="MNQ", limit=100000):
    print(f"Analyzing EXACT ARROW MOMENTS (Transitions) for {symbol}...")
    
    # 1. Join where transition is non-zero (The Arrow Bar)
    sql = f"""
    SELECT s.dir_1m as direction, f.*
    FROM 'swing_labels' s
    JOIN 'talib_features' f ON s.timestamp = f.timestamp
    WHERE s.symbol = '{symbol}' AND s.transition != 0
    LIMIT {limit}
    """
    df = get_data(sql)
    if df is None or df.empty:
        print("No transition data found.")
        return

    # 2. Separate Bullish Arrows (Green) and Bearish Arrows (Red)
    # If dir_1m changed to 1.0, it's a Bullish Transition (Valley)
    # If dir_1m changed to 0.0, it's a Bearish Transition (Peak)
    green_arrows = df[df["direction"] == 1.0] # Transition TO Bullish
    red_arrows = df[df["direction"] == 0.0]   # Transition TO Bearish
    
    # 3. Compute Stats
    green_means = green_arrows.drop(columns=["timestamp", "symbol", "direction"]).mean()
    red_means = red_arrows.drop(columns=["timestamp", "symbol", "direction"]).mean()
    global_std = df.drop(columns=["timestamp", "symbol", "direction"]).std()
    
    separation = (green_means - red_means).abs() / (global_std + 1e-8)
    
    results = pd.DataFrame({
        "Feature": separation.index,
        "Valley_Moment (Green)": green_means.values,
        "Peak_Moment (Red)": red_means.values,
        "Arrow_Separation_Sigma": separation.values
    }).sort_values(by="Arrow_Separation_Sigma", ascending=False)
    
    print("\nTHE 'ARROW SIGNATURE' - TOP 15 FEATURES AT THE MOMENT OF REVERSAL:")
    print(results.head(15).to_string(index=False))

analyze_arrow_moments()
