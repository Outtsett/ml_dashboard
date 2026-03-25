import requests
import pandas as pd
import numpy as np

QUESTDB_REST = "http://localhost:9000/exec"

def get_data(sql):
    resp = requests.get(QUESTDB_REST, params={"query": sql})
    if resp.status_code != 200: return None
    data = resp.json()
    return pd.DataFrame(data["dataset"], columns=[c["name"] for p, c in enumerate(data["columns"])])

def analyze_z_signatures(symbol="MNQ", limit=50000):
    print(f"Computing Z-SCORE SIGNATURES for {symbol} Transitions...")
    
    # 1. Get a large enough sample to compute Global Mean/Std
    sql = f"SELECT * FROM 'talib_features' WHERE symbol = '{symbol}' LIMIT {limit}"
    df_global = get_data(sql)
    if df_global is None: return
    
    # 2. Get the Arrow Moments
    sql_arrows = f"""
    SELECT s.dir_1m as direction, f.*
    FROM 'swing_labels' s
    JOIN 'talib_features' f ON s.timestamp = f.timestamp
    WHERE s.symbol = '{symbol}' AND s.transition != 0
    LIMIT 10000
    """
    df_arrows = get_data(sql_arrows)
    
    # 3. Features to check
    feats = ["ad", "bop", "obv", "stochf_fastk", "stochrsi_fastk", "willr"]
    
    results = []
    for f in feats:
        g_mean = df_global[f].mean()
        g_std = df_global[f].std()
        
        green_val = df_arrows[df_arrows["direction"] == 1.0][f].mean()
        red_val = df_arrows[df_arrows["direction"] == 0.0][f].mean()
        
        # Calculate Z-Score: (Value - Mean) / Std
        green_z = (green_val - g_mean) / (g_std + 1e-8)
        red_z = (red_val - g_mean) / (g_std + 1e-8)
        
        results.append({
            "Feature": f,
            "Valley_Z (Green)": green_z,
            "Peak_Z (Red)": red_z,
            "Z_Gap": abs(green_z - red_z)
        })

    report = pd.DataFrame(results).sort_values(by="Z_Gap", ascending=False)
    print("\nTHE 'Z-SIGNATURE' (Standard Deviations from Normal):")
    print(report.to_string(index=False))

analyze_z_signatures()
