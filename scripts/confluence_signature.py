import requests
import pandas as pd
import numpy as np

QUESTDB_REST = "http://localhost:9000/exec"

def get_data(sql):
    resp = requests.get(QUESTDB_REST, params={"query": sql})
    if resp.status_code != 200: return None
    data = resp.json()
    return pd.DataFrame(data["dataset"], columns=[c["name"] for p, c in enumerate(data["columns"])])

def analyze_confluence(symbol="MNQ"):
    print(f"Checking Timeframe CONFLUENCE Signatures for {symbol}...")
    
    results = []
    for tf in ["dir_1m", "dir_5m", "dir_15m"]:
        sql = f"""
        SELECT s.{tf} as direction, f.ad, f.bop, f.obv, f.stochf_fastk
        FROM 'swing_labels' s
        JOIN 'talib_features' f ON s.timestamp = f.timestamp
        WHERE s.symbol = '{symbol}' AND s.transition != 0
        LIMIT 50000
        """
        df = get_data(sql)
        if df is None or df.empty: continue
        
        green = df[df["direction"] == 1.0].drop(columns=["direction"]).mean()
        red = df[df["direction"] == 0.0].drop(columns=["direction"]).mean()
        std = df.drop(columns=["direction"]).std()
        sep = (green - red).abs() / (std + 1e-8)
        
        for feat in ["ad", "bop", "obv", "stochf_fastk"]:
            results.append({"Timeframe": tf, "Feature": feat, "Sigma": sep[feat]})

    report = pd.DataFrame(results).pivot(index="Feature", columns="Timeframe", values="Sigma")
    print("\nSIGNATURE STRENGTH (SIGMA) ACROSS TIMEFRAMES:")
    print(report.to_string())

analyze_confluence()
