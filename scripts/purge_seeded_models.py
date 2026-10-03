"""Report on, then delete, the fabricated rows in ml_models.

scripts/seed-models.ts generated 300 rows named `Specialized Expert #001`..`#300`
with `Math.random()` Sharpe and win-rate, and no checkpoint behind any of them.
The script is now broken (it imports `../apps/api/database/db`, which the reorg
moved), so it cannot regenerate them, but the rows it wrote are still in the
database and surface through GET /api/ml/models as 300 models.

Only rows matching the seed's name pattern are touched. Nothing else in the table
is modified.
"""

import sqlite3
import sys

DB = r"data/ml_dashboard.db"
# The seed names rows `Specialized Expert #001`. The literal `#` needs no escape
# in LIKE, but `_` would be a single-character wildcard, so the pattern is
# anchored on the literal prefix and the name is re-checked in Python.
PATTERN = "Specialized Expert #%"

con = sqlite3.connect(DB)
cur = con.cursor()

before = cur.execute("select count(*) from ml_models").fetchone()[0]
doomed = cur.execute(
    "select count(*) from ml_models where name like ?", (PATTERN,)
).fetchone()[0]
print(f"ml_models before: {before:,} rows, {doomed:,} of them fabricated")

if "--apply" not in sys.argv:
    print("dry run; pass --apply to delete")
    raise SystemExit(0)

# Re-check in Python so a LIKE wildcard can never widen the delete.
targets = [
    row[0]
    for row in cur.execute(
        "select name from ml_models where name like ? escape '\\'", (PATTERN,)
    )
]
assert all(n.startswith("Specialized Expert #") for n in targets), "pattern matched something unexpected"
print(f"verified {len(targets):,} names all match the seed prefix")

cur.execute("delete from ml_models where name like ? escape '\\'", (PATTERN,))
con.commit()
after = cur.execute("select count(*) from ml_models").fetchone()[0]
print(f"ml_models after: {after:,} rows ({before - after:,} deleted)")
for row in cur.execute("select name from ml_models limit 10"):
    print("   remaining:", row[0])
con.close()