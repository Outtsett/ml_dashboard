"""Land a round's review as ``derived_ta_strategy_600_ticks_reviews`` beside the round it judged.

    .venv/Scripts/python.exe packages/ml-engine/src/ta_strategy/reviews.py --recipe round_1_<stamp> --round 1 --review review.json

``review.json`` is the review workflow's result: ``{"synthesis": {"summary", "recommendations": [...]},
"verdict": {"verdicts": [...]}}``. One row per ranked recommendation, with the skeptic's verdict on it
(``survived_verification``, ``verifier_reason``, ``corrected_expected_ticks_per_day_high``) and the
round-level summary repeated on every row.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "src" / "ml"))
sys.path.insert(0, str(ROOT / "src"))


def review_rows(review: dict, round_number: int, recipe: str) -> pd.DataFrame:
    verdicts = {v["rank"]: v for v in review.get("verdict", {}).get("verdicts", [])}
    summary = review["synthesis"]["summary"]
    stamp = datetime.now(timezone.utc).isoformat()
    rows = []
    for rec in review["synthesis"]["recommendations"]:
        verdict = verdicts.get(rec["rank"])
        rows.append({
            "round": round_number, "reviewed_recipe": recipe, "reviewed_at": stamp, "rank": rec["rank"],
            "title": rec["title"], "category": rec["category"], "evidence": rec["evidence"],
            "expected_ticks_per_day_low": rec["expected_ticks_per_day_low"],
            "expected_ticks_per_day_high": rec["expected_ticks_per_day_high"],
            "confidence": rec["confidence"], "change": rec["change"], "config_only": rec["config_only"],
            "verified": verdict is not None,
            "survived_verification": None if verdict is None else bool(verdict["survives"]),
            "corrected_expected_ticks_per_day_high": None if verdict is None else verdict.get("corrected_expected_ticks_per_day_high"),
            "verifier_reason": None if verdict is None else verdict["reason"],
            "round_summary": summary,
        })
    return pd.DataFrame(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", required=True)
    parser.add_argument("--round", dest="round_number", type=int, required=True)
    parser.add_argument("--review", required=True)
    parser.add_argument("--output-dir", default=str(ROOT / "data" / "models"))
    parser.add_argument("--dataset", default="ta_strategy_600_ticks",
                        help="ta_strategy_600_ticks (model rounds) or ta_rule_strategies_600_ticks (rule rounds)")
    args = parser.parse_args()
    from ta_strategy import store

    review = json.loads(Path(args.review).read_text(encoding="utf-8"))
    table = review_rows(review, args.round_number, args.recipe)
    paths = store.write_local({"reviews": table}, os.path.join(args.output_dir, f"ta_strategy_review_{args.recipe}"))
    result = store.land(paths, args.recipe, f"review of TA strategy round {args.round_number} ({args.recipe})",
                        dataset=args.dataset)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
