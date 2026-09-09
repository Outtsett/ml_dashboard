"""
Convert Databento .dbn trade files to parquet format.

Requires: pip install databento
Source: D:\HistoricalTickData\*.trades.dbn
Output: D:\HistoricalTickData\*.trades.parquet

Run: python scripts/convert-dbn-trades.py
"""
from pathlib import Path

import databento as db

# Read vendor bytes from bronze; write the converted product to derived/.
# raw/ is write-once vendor bytes - a format conversion is a derivation and
# must not be written back into it.
hist_dir = Path(r'E:\lake\raw\vendor=databento\dataset=GLBX.MDP3')
out_dir = Path(r'E:\lake\derived\dataset_snapshots\recipe=databento_dbn_to_parquet')
out_dir.mkdir(parents=True, exist_ok=True)

for dbn_file in sorted(hist_dir.glob('*.trades.dbn')):
    out = out_dir / (dbn_file.stem + '.trades.parquet')
    if out.exists():
        print(f'Skip {dbn_file.name} (parquet exists)')
        continue
    print(f'Converting {dbn_file.name}...')
    store = db.DBNStore.from_file(str(dbn_file))
    df = store.to_df()
    df.to_parquet(str(out))
    print(f'  -> {out.name} ({len(df):,} rows)')

print('Done.')
