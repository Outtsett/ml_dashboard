# Deployment Checklist — Quant AI Dashboard (`ml_dashboard`)

End-to-end checklist for taking `ml_dashboard` from a clean checkout to a verified
running install, plus the release pipeline for distributable Electron installers.

> **What "deployment" means here.** This is a **local-first desktop/dev tool**, not a
> cloud service (`electron/main.cjs` — "this is a local tool, not distributed"). There are
> two deploy targets:
> 1. **Local install/run** — the everyday path (Sections 1–8).
> 2. **Release/distribution** — building signed-able NSIS / AppImage / dmg installers via
>    `release-please` + `.github/workflows/release.yml` (Section 9).
>
> Runtime hard-dependencies: **SQLite** (embedded, Drizzle, `data/ml_dashboard.db`) and
> **QuestDB** (external process on `:9000`, auto-started if `QUESTDB_ROOT` is set, else an
> external instance is expected). PostgreSQL (TypeORM) and DuckDB are optional / embedded in
> the Python ML engine — the startup manager (`src/server/infrastructure/lib/startupManager.ts`)
> and health checks (`.../database/health.ts`) only orchestrate **SQLite + QuestDB**.

Audited against the 12 production lifecycles on 2026-05-28 — see Section 11 for open gaps.

---

## 1. Pre-flight — host prerequisites

- [ ] **Node ≥ 22** (`node -v`). CI pins Node 22; build target is `node22`.
- [ ] **npm** (lockfile-driven installs; this repo uses `--legacy-peer-deps`).
- [ ] **Python 3.13** for the ML engine (`python --version`).
- [ ] **uv** present (`uv --version`) — per-project venv standard (`uv venv --python 3.13`).
- [ ] **QuestDB** reachable on `:9000` **or** installable locally:
  - External instance already serving `http://localhost:9000/exec?query=SELECT%201` → nothing to install, OR
  - Local QuestDB dir set via `QUESTDB_ROOT` (contains `bin/java.exe`) so the backend auto-starts it.
- [ ] **(Optional) Ollama** running on `:11434` if using local LLM features (`OLLAMA_URL`, `OLLAMA_MODEL`).
- [ ] **(Optional) PostgreSQL** only if the TypeORM/`pg` path is exercised — not required for core dashboard.
- [ ] Build toolchain for native modules present (`better-sqlite3`, `node-pty`, `zeromq`, `@tensorflow/tfjs-node` compile on `npm ci`). On Windows: VS 2022 MSVC + Python in PATH.
- [ ] GPU note (training): target **50–60% VRAM**, never 100% (RTX 5060 Ti 16 GB). DataLoader workers ≤ `cpu_count // 3` (max 4).

## 2. Source & configuration

- [ ] Clean checkout on the intended branch (`git status` clean; on `main` for a release).
- [ ] `cp .env.example .env` and fill values:
  - [ ] `PORT` (default `5000`) — backend + UI single port.
  - [ ] `QUESTDB_HOST` / `QUESTDB_HTTP_PORT` (9000) / `QUESTDB_PG_PORT` (8812) / `QUESTDB_USER` / `QUESTDB_PASSWORD`.
  - [ ] `QUESTDB_ROOT` (+ optional `QUESTDB_JAVA`) **only** if you want the backend to auto-start QuestDB.
  - [ ] `SQLITE_PATH` (default `./data/ml_dashboard.db`).
  - [ ] `OLLAMA_URL` / `OLLAMA_MODEL` if using LLM features.
- [ ] **Secrets**: never commit `.env`. Verify `.gitignore` covers it (audit: ✓). API keys come from the canonical Windows env-var store, not the repo.
- [ ] Confirm `data/` directory exists/writable (SQLite DB + `data/object-storage` local blob root).

## 3. Install dependencies

- [ ] **Node deps** (reproducible):
  ```bash
  npm ci --legacy-peer-deps
  ```
  > `prepare` runs husky; set `HUSKY=0` in CI/non-dev contexts.
- [ ] **Python deps** (uv-managed venv, `uv.lock` is source-of-truth):
  ```bash
  uv venv --python 3.13      # creates .venv/ (if not already created)
  uv sync --all-extras        # locked deps from uv.lock: torch+cu130, scipy/sklearn/xgboost/lightgbm/optuna/numba/duckdb/polars/pyarrow…
  uv run python -c "import torch; print(torch.cuda.is_available())"   # CUDA smoke
  ```
  > CI uses `pip install -e .` (no lockfile, lightweight) — local/dev installs use `uv sync` for reproducibility.
- [ ] Verify native modules loaded without error (no `node-gyp` failures in install log).

## 4. Database setup

- [ ] **SQLite schema** (Drizzle — embedded, no server):
  ```bash
  npm run db:push          # drizzle-kit push → data/ml_dashboard.db from src/shared/schema.ts
  ```
- [ ] **SQL migrations present** (`migrations/`, 9 files: 5 forward `.sql` + 4 paired `.down.sql`; only the `0000` baseline has no rollback, since "rolling back" the initial migration means dropping the database). Confirm `npm run db:push` was run AND the CHECK-constraint/partial-index enforcement ran (automatic on server boot via `enforce-sqlite-invariants.ts`, or run on demand: `npx tsx scripts/enforce-sqlite-invariants.ts`) — `db:push` alone cannot create the CHECK constraints on `model_versions`/`deployments`/`promotion_gates`/`agent_runs` or the partial unique index on `deployments` (Drizzle SQLite has no API for either; see `migrations/README.md`).
- [ ] **QuestDB schema** — apply the prediction-log table + rollup mat view (idempotent applier):
  - [ ] `prediction_log` + `prediction_log_rollup_1m` exist:
    ```sql
    SELECT table_name FROM tables() WHERE table_name LIKE 'prediction_log%';
    ```
  - [ ] Schema matches the ILP write contract in `docs/prediction-log-schema.md` (DEDUP key `(ts, deployment_id)`).
- [ ] **(Optional) PostgreSQL** — only if TypeORM path used; otherwise skip.

## 5. Build

- [ ] **Quality gates first** (block on failure):
  ```bash
  npm run check          # tsc --noEmit
  npm run lint           # ruff (py) + eslint (ts), --max-warnings 0
  npm run check:architecture   # architecture_validator.ts
  npm test               # vitest run
  uv run pytest -m "not slow"  # python unit tests (set OHLCV_DISABLE_QUESTDB=1 to avoid external hits)
  ```
- [ ] **Build the app**:
  ```bash
  npm run build          # vite client → dist/public ; esbuild server → dist/index.cjs (CJS, node22, minified)
  ```
  - [ ] Build clean (only the known pre-existing `import.meta` warning in `vite.config.ts` is acceptable).
- [ ] **Build Electron installer** (release/distribution only):
  ```bash
  npm run build:electron # build.ts + electron-builder → release/*.{exe,AppImage,dmg}
  ```

## 6. Run — local

Pick the path for the target:

- [ ] **Dev (server + HMR)**: `npm run dev` (backend, tsx watch) and/or `npm run dev:client` (Vite :5000).
- [ ] **Desktop (Electron + backend)**: `npm run electron:dev`
      (concurrently runs `dev`, waits on `http://127.0.0.1:5000/health`, then launches Electron).
- [ ] **Production server**: `npm run build` then `npm run start` (`NODE_ENV=production node dist/index.cjs`).
- [ ] **Production desktop**: `npm run start:desktop` (`electron .`).

> Launch flow (desktop): `app.whenReady()` → spawns backend on `:PORT` → backend's
> `runStartupSequence()` starts QuestDB (if `QUESTDB_ROOT` set) → BrowserWindow points at
> `http://127.0.0.1:PORT`. Close-to-tray + `/health` watchdog auto-restart a wedged backend.

## 7. Verify — smoke test

- [ ] **Health endpoint** returns healthy:
  ```bash
  curl http://127.0.0.1:5000/health
  ```
  Confirms SQLite (`SELECT 1`) + QuestDB (circuit-breaker-guarded) both healthy; `overall: true`.
- [ ] **Startup report** in logs shows `--- Overall: HEALTHY ---` (SQLite `+`, QuestDB `+`).
- [ ] **UI loads** at `http://127.0.0.1:5000` (or in the Electron window).
- [ ] **Swagger** reachable (NestJS `@nestjs/swagger`) for API surface check.
- [ ] **Training metrics bridge** (if running a training job): trainer connects to the live
      dashboard handshake at `127.0.0.1:8055`; verify `emit_metric`/`emit_progress` JSON-line
      events appear in the dashboard SSE stream before computation starts (per
      `training-stdout-protocol`).
- [ ] **SSE channels** (deployments/agents) stream without leaking listeners (`/api/events/...`).

## 8. Post-run hygiene

- [ ] No orphan processes: backend, QuestDB `java.exe` (PID in `.questdb.pid`), Vite, training subprocesses all accounted for.
- [ ] On quit, `stopDatabases()` stops the adopted QuestDB PID (no leaked `java.exe`).
- [ ] Background training/HPO runs from the session stopped before launching new ones (GPU/port contention).

---

## 9. Release / distribution pipeline

Driven by `.github/workflows/release.yml` (push to `main`):

- [ ] **Conventional commits** on `main` (commitlint enforces — `.github/workflows/commitlint.yml`).
- [ ] **release-please** opens/promotes the release PR (`release-type: node`); merging it tags `v<x.y.z>` and generates `CHANGELOG.md`.
- [ ] On release creation, **build-electron** matrix produces installers:
  - [ ] Windows → `release/*.exe` (NSIS, `com.ml-dashboard.app`, "Quant AI Dashboard").
  - [ ] Linux → `release/*.AppImage`.
  - [ ] macOS → `release/*.dmg` (currently **unsigned** — `CSC_IDENTITY_AUTO_DISCOVERY=false`; wire signing before public distribution).
- [ ] **SBOM** (CycloneDX) generated and attached to the release (`sbom-npm.cyclonedx.json`).
- [ ] Installers attached to the GitHub Release; download + smoke-install on a clean machine.
- [ ] **Security gates green** before release: CodeQL, dependency-review, OSV-scanner, secret-scan, scorecard (`.github/workflows/`).

## 10. Rollback

- [ ] **App**: re-install the previous GitHub Release installer, or `git revert` the offending commit and let release-please cut a patch.
- [ ] **SQLite schema**: apply the paired `migrations/<n>_*.down.sql` to roll back the last migration.
- [ ] **QuestDB**: prediction-log writes are DEDUP-idempotent; no destructive rollback needed for replays.
- [ ] **Process**: kill wedged backend/QuestDB, free `:PORT` and `:9000`, remove stale `.questdb.pid`, relaunch.

---

## 11. Production-readiness gaps (lifecycle audit 2026-05-28)

| ID | Lifecycle | Status | Action |
|---|---|---|---|
| G1 | deployment | ✓ present | `release.yml` + `.env.example` |
| G2 | release | ✗ missing | `CHANGELOG.md` not yet at root — **generated on first release-please merge**; no action if release pipeline runs |
| G3 | migration | ✓ present | `migrations/` (5 forward + 4 paired `.down.sql`); CHECK constraints + partial index self-heal on every server boot via `enforce-sqlite-invariants.ts` (AUD-008 fix, 2026-07-13) |
| G4 | secrets | ✓ present | `.gitignore` + `.env.example` + secret-scan workflow |
| G8 | observability | ✓ present | structured logger, trace IDs, `/health`, circuit breakers |
| G9 | incident | ⚠ partial | error tracking exists — **add `docs/runbooks/` + `docs/postmortems/TEMPLATE.md`** |
| G10 | backup | ✗ missing | **add `docs/runbooks/restore.md`** (SQLite `data/ml_dashboard.db` + QuestDB volume backup + restore drill) |
| G12 | retention | ✗ missing | **add `docs/data-retention.md`** (prediction_log retention window — currently TBD in schema doc) |
| G5/G6/G7/G11 | webhooks/auth/billing/flags | n/a | local single-user tool |

> Closing G9/G10/G12 is the remaining work to call this "production-ready" for a distributed
> build. For a single-user local install they are low-severity. Run
> `node "C:\Users\tyler\.claude\scripts\audit_lifecycles.mjs" --project "E:\source\repos\ml_dashboard"`
> to re-audit.
