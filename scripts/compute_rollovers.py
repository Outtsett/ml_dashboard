import requests
import json
from datetime import datetime, timedelta

QUESTDB_REST = "http://localhost:9000/exec"

def query(sql):
    resp = requests.get(QUESTDB_REST, params={"query": sql})
    if resp.status_code != 200:
        print(f"Error: {resp.text}")
        return []
    return resp.json().get("dataset", [])

def update_rollovers(root="MNQ"):
    print(f"Updating rollovers for {root}...")
    
    # 1. Get current latest rollover
    latest = query(f"SELECT * FROM rollovers WHERE root='{root}' ORDER BY rollover_date DESC LIMIT 1")
    if not latest:
        print("No existing rollovers found.")
        return
    
    latest_roll = latest[0]
    last_date = latest_roll[1]
    last_to_contract = latest_roll[3]
    last_cum_adj = latest_roll[7]
    
    print(f"Latest rollover: {last_date} to {last_to_contract} (CumAdj: {last_cum_adj})")
    
    # 2. Find volume leaders after the last rollover
    # Use root column (SYMBOL INDEX) instead of regex scan
    sql = f"""
    SELECT timestamp, symbol, volume
    FROM ohlcv_1d
    WHERE root = '{root}' AND asset_class = 'futures'
    AND symbol != '{root}'
    AND timestamp > '{last_date}'
    ORDER BY timestamp ASC, volume DESC
    """
    rows = query(sql)
    
    daily_leaders = {}
    for r in rows:
        ts = r[0][:10] # YYYY-MM-DD
        sym = r[1]
        vol = r[2]
        if ts not in daily_leaders or vol > daily_leaders[ts]["vol"]:
            daily_leaders[ts] = {"sym": sym, "vol": vol}
            
    # 3. Detect changes in leader
    current_leader = last_to_contract
    new_rolls = []
    
    dates = sorted(daily_leaders.keys())
    for d in dates:
        leader = daily_leaders[d]["sym"]
        if leader != current_leader:
            print(f"New rollover detected on {d}: {current_leader} -> {leader}")
            
            # 4. Get prices for the gap calculation
            # We need the close price of both contracts on that day
            p_sql = f"SELECT symbol, close FROM ohlcv_1d WHERE timestamp = '{d}T00:00:00.000000Z' AND (symbol='{current_leader}' OR symbol='{leader}')"
            prices = query(p_sql)
            
            p_map = {p[0]: p[1] for p in prices}
            if current_leader in p_map and leader in p_map:
                from_close = p_map[current_leader]
                to_close = p_map[leader]
                gap = to_close - from_close
                
                new_rolls.append({
                    "date": d,
                    "from": current_leader,
                    "to": leader,
                    "from_close": from_close,
                    "to_close": to_close,
                    "gap": gap
                })
                current_leader = leader
            else:
                print(f"  Missing price data for rollover on {d}")

    if not new_rolls:
        print("No new rollovers detected.")
        return

    # 5. Insert into QuestDB
    # Note: QuestDB ILP is better but for a few rows we can use SQL or REST
    # We also need to update cumulative_adjustment for the NEW rows if we were being fancy,
    # but the dashboard logic calculates it based on the table contents usually or expects them pre-calc.
    # In our table, the latest contract has 0.0 cumulative_adjustment.
    
    # Actually, the convention in the table we saw:
    # 2025-12-15 | MNQZ5 | MNQH6 | ... | 0.0
    # If we add a new one (e.g. MNQH6 -> MNQM6), the NEWEST row will be 0.0, 
    # and we would need to SHIFT all older cumulative_adjustments.
    # BUT, the dashboard code I saw just reads the table.
    
    print(f"Found {len(new_rolls)} new rollovers. Manual intervention recommended for cumulative_adjustment updates.")
    for nr in new_rolls:
        print(f"INSERT INTO rollovers (root, rollover_date, from_contract, to_contract, from_close, to_close, price_gap, cumulative_adjustment) VALUES ('{root}', '{nr['date']}T00:00:00.000000Z', '{nr['from']}', '{nr['to']}', {nr['from_close']}, {nr['to_close']}, {nr['gap']}, 0.0);")

update_rollovers("MNQ")
