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
> Runtime hard-dependencies: **SQLite** (embedded, Drizzle, `data/ml_dashboard.db`) and the
> **Iceberg lake** at `E:\lake` (files plus the AIStor catalog on `:9100`), read in-process by
> **DuckDB**. Neither is a database server — there is no process to install, start or supervise.
> PostgreSQL (TypeORM) is optional. The startup manager
> (`src/server/infrastructure/lib/startupManager.ts`) and health checks
> (`.../database/health.ts`) orchestrate **SQLite + lake reachability** only.

Audited against the 12 production lifecycles on 2026-05-28 — see Section 11 for open gaps.

---

## 1. Pre-flight — host prerequisites

- [ ] **Node ≥ 22** (`node -v`). CI pins Node 22; build target is `node22`.
- [ ] **npm** (lockfile-driven installs; this repo uses `--legacy-peer-deps`).
- [ ] **Python 3.13** for the ML engine (`python --version`).
- [ ] **uv** present (`uv --version`) — per-project venv standard (`uv venv --python 3.13`).
- [ ] **Lake** present and readable at `E:\lake`, with the AIStor Iceberg catalog answering on
      `http://127.0.0.1:9100/_iceberg` (warehouse `lakehouse`). Verify from Python:
      `from lake.serving import connect; connect().execute("SELECT count(*) FROM bars").fetchone()`.
- [ ] **(Optional) PostgreSQL** only if the TypeORM/`pg` path is exercised — not required for core dashboard.
- [ ] Build toolchain for native modules present (`better-sqlite3`, `node-pty`, `zeromq`, `@tensorflow/tfjs-node` compile on `npm ci`). On Windows: VS 2022 MSVC + Python in PATH.
- [ ] GPU note (training): target **50–60% VRAM**, never 100% (RTX 5060 Ti 16 GB). DataLoader workers ≤ `cpu_count // 3` (max 4).

## 2. Source & configuration

- [ ] Clean checkout on the intended branch (`git status` clean; on `main` for a release).
- [ ] `cp .env.example .env` and fill values:
  - [ ] `PORT` (default `5000`) — backend + UI single port.
  - [ ] `SQLITE_PATH` (default `./data/ml_dashboard.db`).
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
- [ ] **Prediction log** — `prediction_log` lives in SQLite. Confirm the table exists and its
      shape matches `docs/prediction-log-schema.md` (dedup key `(timestamp, deployment_id)`).
- [ ] **(Optional) PostgreSQL** — only if TypeORM path used; otherwise skip.

## 5. Build

- [ ] **Quality gates first** (block on failure). One command runs all twelve
      stages and prints a pass/fail table; it mirrors `.github/workflows/ci.yml`
      stage for stage, so a green run here predicts a green run there:
  ```bash
  npm run ci             # lint · typecheck · architecture · ruff · vitest · pytest · build · smoke · e2e
  npm run ci:local:fast  # same, minus build/smoke/e2e
  node scripts/ci-local.mjs --list
  ```
  > **GitHub Actions has not run since 2026-08-25** — every run is
  > `startup_failure` with zero jobs, an account/billing condition rather than a
  > YAML defect. Until it is cleared, `npm run ci` **is** the gate. See
  > `docs/CI-CD.md`.
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
> `runStartupSequence()` → BrowserWindow points at `http://127.0.0.1:PORT`. No database
> process is spawned. Close-to-tray + `/health` watchdog auto-restart a wedged backend.

## 7. Verify — smoke test

- [ ] **Automated smoke** — builds (or reuses `dist/`), starts the server on a
      free port, probes it, tears it down. Exits non-zero on any required probe:
  ```bash
  npm run smoke                     # build + boot + probe
  node scripts/smoke.mjs --no-build # reuse the dist/ you have
  node scripts/smoke.mjs --keep-alive --port 5099
  ```
  It checks: the artifact boots and binds · `/health` is 200 · `/` serves the SPA
  shell with a `#root` mount point and a hashed bundle · **the bundle loads when
  the request carries an `Origin` header** · `/api/instruments` returns the
  catalog · `/api/docs/json` has paths · an unmounted `/api` path 404s as JSON ·
  SQLite is up.

  > The `Origin` probe exists because the CORS allow-list was hardcoded to port
  > 5000 while `PORT` is configurable, so on any other port the server rejected
  > its own bundle with a 500 and rendered a blank page — while `/health` stayed
  > green and every unit test passed.

- [ ] **End-to-end** — the app in a real browser (`e2e/README.md`):
  ```bash
  npm run test:e2e        # 91 tests, ~1.6 min
  npm run test:e2e:smoke  # the @smoke subset
  ```

- [ ] **Health endpoint** returns healthy:
  ```bash
  curl http://127.0.0.1:5000/health
  ```
  Confirms SQLite (`SELECT 1`) + lake reachability (circuit-breaker-guarded) both healthy; `overall: true`.
- [ ] **Startup report** in logs shows `--- Overall: HEALTHY ---` (SQLite `+`, lake `+`).
- [ ] **UI loads** at `http://127.0.0.1:5000` (or in the Electron window).
- [ ] **Swagger** reachable (NestJS `@nestjs/swagger`) for API surface check.
- [ ] **Training metrics bridge** (if running a training job): trainer connects to the live
      dashboard handshake at `127.0.0.1:8055`; verify `emit_metric`/`emit_progress` JSON-line
      events appear in the dashboard SSE stream before computation starts (per
      `training-stdout-protocol`).
- [ ] **SSE channels** (deployments/agents) stream without leaking listeners (`/api/events/...`).

## 8. Post-run hygiene

- [ ] No orphan processes: backend, Vite, training subprocesses all accounted for. (No database
      process exists to leak.)
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
- [ ] **Prediction log**: writes are dedup-idempotent; no destructive rollback needed for replays.
- [ ] **Process**: kill a wedged backend, free `:PORT`, relaunch.

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
| G10 | backup | ✗ missing | **add `docs/runbooks/restore.md`** (SQLite `data/ml_dashboard.db` + off-drive replication of `E:\lake` + restore drill; see `docs/runbooks/questdb-backup-restore.md`) |
| G12 | retention | ✗ missing | **add `docs/data-retention.md`** (prediction_log retention window — currently TBD in schema doc) |
| G5/G6/G7/G11 | webhooks/auth/billing/flags | n/a | local single-user tool |

> Closing G9/G10/G12 is the remaining work to call this "production-ready" for a distributed
> build. For a single-user local install they are low-severity. Run
> `node "C:\Users\tyler\.claude\scripts\audit_lifecycles.mjs" --project "E:\source\repos\ml_dashboard"`
> to re-audit.
