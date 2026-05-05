"""
Convert Databento .dbn trade files to parquet format.

Requires: pip install databento
Source: D:\HistoricalTickData\*.trades.dbn
Output: D:\HistoricalTickData\*.trades.parquet

Run: python scripts/convert-dbn-trades.py
"""
from pathlib import Path

import databento as db

hist_dir = Path(r'D:\HistoricalTickData')

for dbn_file in sorted(hist_dir.glob('*.trades.dbn')):
    out = dbn_file.with_suffix('.parquet')
    if out.exists():
        print(f'Skip {dbn_file.name} (parquet exists)')
        continue
    print(f'Converting {dbn_file.name}...')
    store = db.DBNStore.from_file(str(dbn_file))
    df = store.to_df()
    df.to_parquet(str(out))
    print(f'  -> {out.name} ({len(df):,} rows)')

print('Done.')
