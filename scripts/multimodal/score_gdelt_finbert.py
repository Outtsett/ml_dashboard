"""Score the GDELT finance headlines with FinBERT, one UTC day at a time.

For every day the GKG backfill has landed, the CORE headlines — market, rates,
inflation, central-bank or earnings themes, or a market institution / Nasdaq-100
heavyweight named — are deduplicated (a syndicated headline counts once, at the
first time it was known, with its copy count kept) and scored by
ProsusAI/finbert (fp16 on the GPU, 64 tokens: headlines are short).

    s3://derived/multimodal_news_scores/recipe=finbert_core_v1/table=titles/day=<YYYY-MM-DD>/part-0.parquet

Columns: known_ts (UTC, the GDELT file stamp + 15 minutes), title, copies,
p_positive, p_negative, p_neutral, finbert_score (positive - negative),
is_stockmarket, is_central_bank, is_megacap. Resumable: a day already scored is skipped.

    .venv/Scripts/python.exe scripts/multimodal/score_gdelt_finbert.py
"""

from __future__ import annotations

import io
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src" / "ml"))

from lake.layout import INGEST_MANIFESTS, RAW, arrow_fs, arrow_key, derived_root  # noqa: E402
from lake.writer import COMPRESSION, COMPRESSION_LEVEL  # noqa: E402

from multimodal.sources import CENTRAL_BANK_ORGANISATIONS, MEGACAP_ORGANISATIONS  # noqa: E402

DATASET = "multimodal_news_scores"
RECIPE = "finbert_core_v1"
SOURCE = RAW / "vendor=gdelt_gkg" / "dataset=gkg-finance-filtered" / "filter=finance_v1"
CORE_THEMES = ("ECON_STOCKMARKET", "ECON_INTEREST_RATE", "ECON_INFLATION", "ECON_CENTRALBANK", "ECON_MONETARY", "ECON_EARNINGSREPORT")
CORE_ORGANISATIONS = ("nasdaq", "standard & poor", "s&p", "dow jones", "new york stock exchange") + CENTRAL_BANK_ORGANISATIONS + MEGACAP_ORGANISATIONS
BATCH = 1024


def core_titles(frame: pd.DataFrame) -> pd.DataFrame:
    themes = frame["themes"].fillna("")
    organisations = frame["organisations"].fillna("")
    core = themes.str.contains("|".join(CORE_THEMES)) | organisations.str.contains("|".join(__import__("re").escape(o) for o in CORE_ORGANISATIONS))
    kept = frame[core & frame["page_title"].notna()].copy()
    kept["key"] = kept["page_title"].str.lower().str.strip()
    kept = kept[kept["key"].str.len() > 8].sort_values("known_ts")
    grouped = kept.groupby("key", sort=False)
    out = grouped.first().reset_index()
    out["copies"] = grouped.size().to_numpy()
    out["is_stockmarket"] = out["themes"].fillna("").str.contains("ECON_STOCKMARKET")
    out["is_central_bank"] = out["organisations"].fillna("").str.contains("|".join(CENTRAL_BANK_ORGANISATIONS))
    out["is_megacap"] = out["organisations"].fillna("").str.contains("|".join(MEGACAP_ORGANISATIONS))
    return out[["known_ts", "page_title", "copies", "is_stockmarket", "is_central_bank", "is_megacap"]].rename(columns={"page_title": "title"})


def main() -> int:
    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained("ProsusAI/finbert")
    model = AutoModelForSequenceClassification.from_pretrained("ProsusAI/finbert").half().cuda().eval()
    index = {v.lower(): int(k) for k, v in model.config.id2label.items()}   # never assume the class order
    fs = arrow_fs()
    out_root = derived_root(DATASET, RECIPE) / "table=titles"
    days = sorted(p.name.split("=", 1)[1] for p in SOURCE.iterdir() if p.name.startswith("day="))
    began, scored_days, scored_titles = time.time(), 0, 0
    for day in days:
        target = out_root / f"day={day}" / "part-0.parquet"
        source = SOURCE / f"day={day}" / "part.parquet"
        if target.exists() or not source.exists():
            continue
        with source.open("rb") as handle:
            frame = pd.read_parquet(io.BytesIO(handle.read()), columns=["known_ts", "page_title", "themes", "organisations"])
        titles = core_titles(frame)
        probabilities = []
        texts = titles["title"].tolist()
        for start in range(0, len(texts), BATCH):
            encoded = tokenizer(texts[start:start + BATCH], padding=True, truncation=True, max_length=64, return_tensors="pt").to("cuda")
            with torch.inference_mode():
                probabilities.append(torch.softmax(model(**encoded).logits.float(), dim=-1).cpu().numpy())
        p = np.concatenate(probabilities) if probabilities else np.zeros((0, 3))
        titles["p_positive"] = p[:, index["positive"]] if len(p) else []
        titles["p_negative"] = p[:, index["negative"]] if len(p) else []
        titles["p_neutral"] = p[:, index["neutral"]] if len(p) else []
        titles["finbert_score"] = titles["p_positive"] - titles["p_negative"]
        with fs.open_output_stream(arrow_key(target)) as sink:
            pq.write_table(pa.Table.from_pandas(titles, preserve_index=False), sink, compression=COMPRESSION, compression_level=COMPRESSION_LEVEL)
        scored_days += 1
        scored_titles += len(titles)
        if scored_days % 10 == 0:
            print(f"{day}: {scored_days} days, {scored_titles:,} titles, {scored_titles / (time.time() - began):,.0f}/s", flush=True)
    entry = {"written_at": datetime.now(timezone.utc).isoformat(), "dataset": DATASET, "table": "titles", "zone": "derived",
             "recipe": RECIPE, "source": "scripts/multimodal/score_gdelt_finbert.py", "rows": scored_titles,
             "duplicates_removed": 0, "file_count": scored_days, "bytes": None, "ts_min": None, "ts_max": None}
    if scored_days:
        with (INGEST_MANIFESTS / f"{DATASET}.jsonl").open("a", encoding="utf-8") as manifest:
            manifest.write(json.dumps(entry) + "\n")
    print(f"scored {scored_days} new days, {scored_titles:,} titles in {time.time() - began:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
