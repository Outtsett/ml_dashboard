import os
import numpy as np
import pandas as pd
from datetime import datetime, timedelta

DATA_DIR = r"E:\source\repos\ml_dashboard\data\models"
os.makedirs(DATA_DIR, exist_ok=True)

def generate_ohlcv(num_records=10000):
    np.random.seed(42)
    start_time = datetime.now() - timedelta(minutes=num_records)
    times = [start_time + timedelta(minutes=i) for i in range(num_records)]
    
    # Geometric Brownian Motion simulation
    returns = np.random.normal(0.0001, 0.002, num_records)
    close = 15000 * np.exp(np.cumsum(returns))
    
    high = close * (1 + np.abs(np.random.normal(0, 0.001, num_records)))
    low = close * (1 - np.abs(np.random.normal(0, 0.001, num_records)))
    open_p = close * (1 + np.random.normal(0, 0.0005, num_records))
    
    volume = np.random.lognormal(mean=10, sigma=1, size=num_records)
    
    df = pd.DataFrame({
        "timestamp": times,
        "open": open_p,
        "high": high,
        "low": low,
        "close": close,
        "volume": volume
    })
    return df

def generate_datasets():
    print("Generating base OHLCV data...")
    base_df = generate_ohlcv(20000)
    
    # --- 1. Supervised Learning Dataset ---
    print("Generating Supervised dataset...")
    df_sup = base_df.copy()
    df_sup["label"] = np.where(df_sup["close"].diff() > 0, "up", np.where(df_sup["close"].diff() < 0, "down", "neutral"))
    
    # Simple ATR approximation
    tr = np.maximum(df_sup["high"] - df_sup["low"], 
                    np.maximum(abs(df_sup["high"] - df_sup["close"].shift(1)), 
                               abs(df_sup["low"] - df_sup["close"].shift(1))))
    df_sup["ATR"] = tr.rolling(14).mean()
    
    # Simple RSI approximation
    delta = df_sup["close"].diff()
    gain = (delta.where(delta > 0, 0)).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    rs = gain / loss
    df_sup["RSI"] = 100 - (100 / (1 + rs))
    
    df_sup["EMA"] = df_sup["close"].ewm(span=14, adjust=False).mean()
    df_sup.to_csv(os.path.join(DATA_DIR, "supervised.csv"), index=False)

    # --- 2. Unsupervised Learning Dataset ---
    print("Generating Unsupervised dataset...")
    df_unsup = pd.DataFrame()
    df_unsup["timestamp"] = base_df["timestamp"]
    df_unsup["normalized_price"] = (base_df["close"] - base_df["close"].rolling(100).mean()) / base_df["close"].rolling(100).std()
    
    atr_mean = df_sup["ATR"].mean()
    df_unsup["volatility_regime"] = np.where(df_sup["ATR"] > atr_mean * 1.5, "High",
                                       np.where(df_sup["ATR"] < atr_mean * 0.5, "Low", "Medium"))
    df_unsup["entropy_score"] = np.abs(np.random.normal(1.5, 0.3, len(base_df)))
    df_unsup["liquidity_density"] = base_df["volume"] / df_sup["ATR"]
    df_unsup.to_csv(os.path.join(DATA_DIR, "unsupervised.csv"), index=False)

    # --- 3. Reinforcement Learning Dataset ---
    print("Generating Reinforcement dataset...")
    rl_size = 5000
    df_rl = pd.DataFrame()
    df_rl["state_vector"] = [np.random.normal(0, 1, 10).tolist() for _ in range(rl_size)]
    df_rl["action"] = np.random.choice(["buy", "sell", "hold"], rl_size)
    df_rl["reward"] = np.random.normal(0, 5, rl_size)
    df_rl["next_state"] = [np.random.normal(0, 1, 10).tolist() for _ in range(rl_size)]
    df_rl["done_flag"] = np.random.choice([0, 1], rl_size, p=[0.95, 0.05])
    df_rl.to_csv(os.path.join(DATA_DIR, "reinforcement.csv"), index=False)

    # --- 4. Probabilistic & Symbolic Dataset ---
    print("Generating Probabilistic & Symbolic dataset...")
    df_prob = pd.DataFrame()
    df_prob["timestamp"] = base_df["timestamp"]
    df_prob["probability_distribution"] = [np.random.dirichlet((1, 1, 1)).tolist() for _ in range(len(base_df))]
    df_prob["entropy"] = -np.sum(np.array(df_prob["probability_distribution"].tolist()) * np.log2(df_prob["probability_distribution"].tolist()), axis=1)
    
    symbols = ["P > EMA", "RSI_OB", "VOL_BREAK", "MEAN_REV"]
    df_prob["symbolic_expression"] = np.random.choice(symbols, len(base_df))
    df_prob["confidence_interval"] = [ [mu - 1.96*0.01, mu + 1.96*0.01] for mu in base_df["close"] ]
    df_prob.to_csv(os.path.join(DATA_DIR, "probabilistic.csv"), index=False)

    # --- 5. Hybrid & Composite Dataset ---
    print("Generating Hybrid & Composite dataset...")
    df_hyb = pd.DataFrame()
    df_hyb["timestamp"] = base_df["timestamp"]
    df_hyb["feature_vector"] = [np.random.normal(0, 1, 5).tolist() for _ in range(len(base_df))]
    df_hyb["model_type"] = np.random.choice(["Supervised", "Unsupervised", "RL", "Probabilistic"], len(base_df))
    df_hyb["correlation_score"] = np.random.uniform(-1, 1, len(base_df))
    df_hyb["composite_output"] = np.random.normal(0, 1, len(base_df))
    df_hyb.to_csv(os.path.join(DATA_DIR, "hybrid.csv"), index=False)

    # --- 6. Feature Engineering Dataset ---
    print("Generating Feature Engineering dataset...")
    df_feat = pd.DataFrame()
    df_feat["timestamp"] = base_df["timestamp"].repeat(4).reset_index(drop=True)
    features = ["candle_geometry", "momentum_curvature", "volume_imbalance", "order_flow_skew"]
    df_feat["feature_name"] = np.tile(features, len(base_df))
    df_feat["feature_value"] = np.random.normal(0, 1, len(df_feat))
    df_feat["normalization_factor"] = np.random.uniform(0.1, 2.0, len(df_feat))
    df_feat.to_csv(os.path.join(DATA_DIR, "features.csv"), index=False)

    # --- 7. Cross-Model Comparison Dataset ---
    print("Generating Cross-Model Comparison dataset...")
    df_cross = pd.DataFrame()
    df_cross["model_id"] = np.random.choice(["XGB_1", "Transformer_V2", "RL_PPO", "HMM_Regime"], 2000)
    df_cross["prediction"] = np.random.normal(0, 1, 2000)
    df_cross["confidence"] = np.random.uniform(0.5, 0.99, 2000)
    df_cross["latency"] = np.random.exponential(15, 2000) # milliseconds
    df_cross["accuracy"] = np.random.uniform(0.4, 0.75, 2000)
    df_cross["volatility_context"] = np.random.choice(["Low", "Medium", "High"], 2000)
    df_cross.to_csv(os.path.join(DATA_DIR, "cross_model.csv"), index=False)

    print("Datasets successfully generated and saved to /data/models/")

    # Print summary logging
    print("\n--- DATASET SUMMARIES ---")
    print(f"Supervised: {len(df_sup)} records, {len(df_sup.columns)} features")
    print(f"Unsupervised: {len(df_unsup)} records, {len(df_unsup.columns)} features")
    print(f"Reinforcement: {len(df_rl)} records, {len(df_rl.columns)} features")
    print(f"Probabilistic: {len(df_prob)} records, {len(df_prob.columns)} features")
    print(f"Hybrid: {len(df_hyb)} records, {len(df_hyb.columns)} features")
    print(f"Features: {len(df_feat)} records, {len(df_feat.columns)} features")
    print(f"Cross-Model: {len(df_cross)} records, {len(df_cross.columns)} features")
    print(f"Average Latency: {df_cross['latency'].mean():.2f} ms")
    print(f"Average Accuracy: {df_cross['accuracy'].mean():.4f}")

if __name__ == "__main__":
    generate_datasets()
