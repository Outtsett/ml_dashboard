import requests
import pandas as pd
import numpy as np

QUESTDB_REST = "http://localhost:9000/exec"

def get_data(sql):
    resp = requests.get(QUESTDB_REST, params={"query": sql})
    if resp.status_code != 200: return None
    data = resp.json()
    return pd.DataFrame(data["dataset"], columns=[c["name"] for p, c in enumerate(data["columns"])])

def analyze_cross_symbol_signatures():
    symbols = ["MNQ", "EURUSD", "NQZ4"]
    feats = ["ad", "bop", "obv", "stochf_fastk"]
    
    results = []
    
    for symbol in symbols:
        print(f"Analyzing {symbol}...")
        # 1. Global Stats for Z-Score
        sql_global = f"SELECT * FROM 'talib_features' WHERE symbol = '{symbol}' LIMIT 10000"
        df_global = get_data(sql_global)
        if df_global is None or df_global.empty: continue
        
        # 2. Arrow Moments
        sql_arrows = f"""
        SELECT s.dir_1m as direction, f.*
        FROM 'swing_labels' s
        JOIN 'talib_features' f ON s.timestamp = f.timestamp
        WHERE s.symbol = '{symbol}' AND s.transition != 0
        """
        df_arrows = get_data(sql_arrows)
        if df_arrows is None or df_arrows.empty: continue
        
        for f in feats:
            g_mean, g_std = df_global[f].mean(), df_global[f].std()
            green_z = (df_arrows[df_arrows["direction"] == 1.0][f].mean() - g_mean) / (g_std + 1e-8)
            red_z = (df_arrows[df_arrows["direction"] == 0.0][f].mean() - g_mean) / (g_std + 1e-8)
            results.append({"Symbol": symbol, "Feature": f, "Valley_Z": green_z, "Peak_Z": red_z, "Gap": abs(green_z - red_z)})

    report = pd.DataFrame(results)
    print("\nCROSS-SYMBOL SIGNATURE COMPARISON (Z-GAP):")
    print(report.pivot(index="Feature", columns="Symbol", values="Gap").to_string())

analyze_cross_symbol_signatures()
