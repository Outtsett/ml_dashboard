import requests
import pandas as pd
import numpy as np
from datetime import datetime

QUESTDB_REST = "http://localhost:9000/exec"

def get_data(sql):
    resp = requests.get(QUESTDB_REST, params={"query": sql})
    if resp.status_code != 200:
        return None
    data = resp.json()
    return pd.DataFrame(data["dataset"], columns=[c["name"] for p, c in enumerate(data["columns"])])

def analyze_swing_correlations(symbol="MNQ", timeframe="dir_1m", limit=50000):
    print(f"Analyzing correlations for {symbol} {timeframe} swings...")
    
    # 1. Join Swings with Features
    # Note: We take a sample to avoid memory issues if the table is massive
    sql = f"""
    SELECT s.{timeframe}, f.*
    FROM 'swing_labels' s
    JOIN 'talib_features' f ON s.timestamp = f.timestamp
    WHERE s.symbol = '{symbol}'
    LIMIT {limit}
    """
    df = get_data(sql)
    if df is None or df.empty:
        print("No data found.")
        return

    # 2. Cleanup
    # Drop non-numeric or duplicate columns
    cols_to_drop = ["timestamp", "symbol"]
    df = df.drop(columns=[c for c in cols_to_drop if c in df.columns])
    
    # 3. Separate Peaks and Valleys
    # Based on the sample, 1.0 is one direction, 0.0 is another.
    # Let's assume 1.0 = Peak, 0.0 = Valley for now.
    peaks = df[df[timeframe] == 1.0]
    valleys = df[df[timeframe] == 0.0]
    
    # 4. Compute Means
    peak_means = peaks.mean()
    valley_means = valleys.mean()
    global_std = df.std()
    
    # 5. Compute "Separation Score" (Z-Score difference)
    # How many standard deviations apart are the Peak and Valley values?
    separation = (peak_means - valley_means).abs() / (global_std + 1e-8)
    
    results = pd.DataFrame({
        "Feature": separation.index,
        "Peak_Mean": peak_means.values,
        "Valley_Mean": valley_means.values,
        "Separation_Sigma": separation.values
    }).sort_values(by="Separation_Sigma", ascending=False)
    
    # Filter out the target column itself
    results = results[results["Feature"] != timeframe]
    
    print("\nTOP 15 MOST RELEVANT FEATURES FOR SWINGS:")
    print(results.head(15).to_string(index=False))

analyze_swing_correlations()
