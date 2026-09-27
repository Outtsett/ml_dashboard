# Migrations — Drizzle SQLite Migrations

Drizzle Kit migration files for the SQLite database schema.

**The project's real, wired workflow is push-only** (`npm run db:push` — see
`package.json`; there are no `db:generate`/`db:migrate` scripts). `drizzle-kit
push` introspects `src/shared/schema.ts` directly against the live database —
it never reads this folder. Everything below `0000_fantastic_hawkeye.sql` is a
**hand-maintained SQL audit trail + supplemental-DDL mechanism**, not a
drizzle-kit-generate/migrate chain — see "Why these files aren't drizzle-kit
managed" below before running `drizzle-kit generate` or `drizzle-kit migrate`
against this project.

## Files

| File | Purpose |
|---|---|
| `0000_fantastic_hawkeye.sql` | Initial migration: creates all 37 SQLite tables |
| `0001_xgb_hpo_nested.sql` (+ `.down.sql`) | Adds `hpo_trials.intermediate_values` / `.fold_index` (per-fold + pruning-curve persistence for nested HPO). Plain columns — fully expressible via `db:push`; this file exists as a historical record. |
| `0002_model_registry.sql` (+ `.down.sql`) | Creates `model_versions`, `deployments`, `promotion_gates` (+ 6 seed gate rows). Contains CHECK constraints on `status`/`mode`/`comparator` and the partial unique index `idx_deployments_one_live_per_sym_tf` — **Drizzle SQLite cannot emit either of these**, so `db:push` alone creates these 3 tables WITHOUT them. |
| `0003_agent_runs.sql` (+ `.down.sql`) | Creates `agent_runs` (Claude Agent SDK dispatch queue/history). Contains CHECK constraints on `agent_id`/`status` — same `db:push` limitation as above. |
| `0004_untracked_ml_tables.sql` (+ `.down.sql`) | Backfilled 2026-07-13 (AUD-008 remediation): `model_checkpoints`, `model_state_snapshots`, `prediction_log` are declared in `schema.ts` and exist live (created directly by `db:push`, bypassing this folder) but had NO migration file at all before this — a rebuild that replayed `migrations/*.sql` instead of running `db:push` would have silently omitted them. |
| `0005_run_provenance.sql` (+ `.down.sql`) | Added 2026-07-28 (provenance stage 1): creates `experiments`, `runs`, `run_manifests`, `run_metrics`. Purely additive — no existing table altered, no row touched, no `data/models/*` directory affected. Fully expressible via `db:push` (no CHECK constraints, no partial indexes), so `enforce-sqlite-invariants.ts` has nothing to retrofit here. |
| `0006_generated_labels_lifecycle.sql` (+ `.down.sql`) | Added 2026-09-26 (label lifecycle): additive columns on `generated_labels` (`recipe` unique, `parameters_hash`, `timeframe_minutes`, `stage`, `validation`, `validated_at`, `source_fingerprint`, `max_horizon_bars`, `purge_bars`, `embargo_bars`, `landed_at`, `retired_at`, `stale_detected_at`, `stale_reason`) and `training_sessions.label_set_id`. The CHECK on `stage` is retrofitted by `enforce-sqlite-invariants.ts`'s `GENERATED_LABELS` entry, the same gap as 0002/0003. |
| `meta/0000_snapshot.json` | Schema snapshot for migration diffing — **only covers migration 0000**. No snapshot exists for 0001-0005 (see below). |
| `meta/_journal.json` | Migration journal — now lists all 6 entries (0000-0005) for documentation accuracy. `drizzle-kit migrate` would apply them in order via `__drizzle_migrations` bookkeeping; `drizzle-kit generate` diffing is NOT reliable past 0000 (no snapshot chain — see below). |

## Why the CHECK constraints / partial index aren't a documentation footnote

`src/server/infrastructure/database/enforce-sqlite-invariants.ts` is the
actual enforcement mechanism, wired into `src/server/infrastructure/database/db.ts`
and run on every server boot. It idempotently:

1. Creates `model_versions` / `deployments` / `promotion_gates` / `agent_runs`
   with their full CHECK constraints if the table doesn't exist yet (e.g.
   right after a fresh `db:push` created the CHECK-less columns-only version,
   or on a from-scratch database that never ran `db:push` at all).
2. Retrofits the CHECK constraint onto an existing CHECK-less table using
   SQLite's documented 12-step table-rebuild procedure
   (https://www.sqlite.org/lang_altertable.html#otheralter), preserving every
   row, if `db:push` already created the table without it.
3. Ensures the partial unique index `idx_deployments_one_live_per_sym_tf`
   exists unconditionally (`CREATE UNIQUE INDEX IF NOT EXISTS ... WHERE ...`
   — SQLite supports partial indexes natively at the raw-SQL level; only
   Drizzle's own schema-builder API lacks a way to declare one).

This runs on **every** boot, not just once, because `db:push` does not track
or preserve hand-added CHECK constraints — a future `schema.ts` change to one
of these 4 tables could trigger `db:push` to recreate the table from its own
(CHECK-less) DDL, silently dropping the constraint again. The self-healing
hook is what actually closes the AUD-008 gap; the migration files below are
its documented, human-readable source of truth.

## Why these files aren't drizzle-kit-generate/migrate managed

Hand-fabricating `meta/0001-0005_snapshot.json` was deliberately NOT done as
part of the 2026-07-13 fix: drizzle-kit's snapshot format is a complex,
versioned structure, and an incorrect hand-written snapshot risks corrupting
the diff base for anyone who runs `drizzle-kit generate` in the future
(worse than the current, honestly-documented gap). If this project ever
adopts a generate+migrate workflow (see the "To add migration discipline"
note in the global CLAUDE.md), regenerate the snapshot chain properly by
running `drizzle-kit generate` against `schema.ts` as it exists right now, so
drizzle-kit builds its own consistent 0001-baseline snapshot — do not try to
hand-write JSON snapshots to backfill 0001-0004.

## Usage

```bash
# Push schema changes directly (development) — the project's real workflow.
npx drizzle-kit push

# CHECK constraints + partial index are applied automatically the next time
# the server boots (enforce-sqlite-invariants.ts via db.ts), or immediately
# on demand:
npx tsx scripts/db/enforce-invariants.ts

# NOT currently part of this project's workflow — see "Why these files
# aren't drizzle-kit-generate/migrate managed" above before using either:
npx drizzle-kit generate
npx drizzle-kit migrate
```

The schema source of truth is `src/shared/schema.ts` (Drizzle ORM definitions). Configuration in `drizzle.config.ts` points to `data/ml_dashboard.db`.
