# CI/CD — ML Dashboard

How this repository is gated, what each gate proves, and what to run locally.

---

## Read this first: GitHub Actions is not running

**Every workflow run on this repository has been `startup_failure` since
2026-08-25.** Runs complete in 0–2 seconds having created zero jobs, including
GitHub's own Dependabot runs. `gh api .../runs/<id>` returns `name: ""`,
`path: "BuildFailed"`, `jobs: 0`.

This is **not** a YAML defect. All eleven workflow files parse, all are
registered `active`, Actions is `enabled: true`, and the repository is not
archived or disabled. A `BuildFailed` run with no jobs on a **private** repo on a
free plan is the signature of exhausted Actions minutes or a spending limit.

**Only Tyler can clear it** — it is on the billing page
(<https://github.com/settings/billing>), not in this repository. Until it is
cleared, every gate described below runs **locally** via `npm run ci`, which
mirrors `ci.yml` stage for stage.

```bash
npm run ci            # the whole pipeline, ~2 minutes
npm run ci:local:fast # skip build, smoke and e2e
node scripts/ci-local.mjs --list
node scripts/ci-local.mjs --only e2e --bail
```

---

## The gates

| stage | `ci.yml` job | proves |
|---|---|---|
| `lint-ts` | static | ESLint errors = 0; warnings below the committed ceiling |
| `typecheck` | static | `tsc --noEmit` over the application |
| `typecheck-e2e` | static | `tsc --noEmit` over the E2E suite |
| `architecture` | static | module import-direction rules |
| `lint-py` | lint-py | `ruff check` over `src/ml`, `scripts`, `mcp_server`, `tests` |
| `format-py` | lint-py | `ruff format --check` |
| `test` | test | Vitest — every assertion, no instrumentation |
| `coverage` | test | Vitest coverage thresholds |
| `test-py` | test-py | pytest, excluding `slow` |
| `schema` | smoke / e2e | `db:push` **and** a table count that proves it landed |
| `build` | build | Vite client + esbuild server produce `dist/` |
| `smoke` | smoke | the built artifact **boots and serves** |
| `e2e` | e2e | the app works in a real browser |

`ci-success` aggregates all of them. It is the single check branch protection
should require — **a job missing from its `needs` list is a job branch
protection cannot see.**

### Why `smoke` and `e2e` are separate

`build` proves files were produced. It cannot tell you whether they run.

`scripts/smoke.mjs` starts `dist/index.cjs` on a free port and probes it: does it
bind, serve the SPA shell, serve the hashed bundle *with an `Origin` header*,
answer `/api/instruments`, 404 an unmounted API path as JSON. No browser, ~2
seconds.

That `Origin` probe is there for a reason. The CORS allow-list in `main.ts` was
written as a literal `http://127.0.0.1:5000` while the port is configurable via
`PORT`, so on **any other port the server rejected its own origin** and answered
every `/assets/*` request with 500. The page rendered blank, `/health` stayed
green, `npm run build` passed, and every unit test passed. Only a request that
carries `Origin` finds it.

`e2e` then drives the app in Chromium. See [`e2e/README.md`](../e2e/README.md).

---

## What runs where

CI runs on `ubuntu-latest` and `windows-latest` for unit tests, `ubuntu-latest`
for the rest. A GitHub runner has **no Iceberg lake**, so:

- specs tagged `@lake` are excluded in CI (`--grep-invert @lake`) and run locally
- `/health` is the readiness gate, never `/api/readiness` — that one requires the
  lake and would be 503 forever on a runner
- `node scripts/db-push-verify.mjs` runs before `smoke` and `e2e`. It does three
  things a bare `npm run db:push` does not: creates `data/` (gitignored, so absent
  on a clean checkout — better-sqlite3 will not create a database in a directory
  that is not there), runs the push, then **counts the tables**. Only 4 of the 44
  in `src/shared/schema.ts` self-create at boot, and drizzle-kit can report
  success without the schema landing, so the count is the only honest check. The
  local `schema` stage runs the same script against a throwaway database, because
  pushing at an already-migrated developer database fails outright

Install is always `npm ci --legacy-peer-deps` with **no** `--ignore-scripts`.
`better-sqlite3`, `zeromq`, `node-pty` and `@duckdb/node-api` resolve native
bindings in postinstall and the server's module graph imports all four at boot.

---

## Release

`release.yml`, on push to `master`:

1. **`ci-gate`** — polls the GitHub API for `ci.yml`'s conclusion on this exact
   SHA and refuses to proceed unless it is `success`. Before this existed, a push
   that failed every gate still cut a tag and published three installers.
2. **`release-please`** — opens/promotes the release PR; merging tags `v<x.y.z>`.
3. **`build-electron`** — NSIS `.exe`, AppImage, `.dmg`. `fail_on_unmatched_files:
   true`, so a build that produced no installer fails rather than silently
   publishing a release missing a platform.
4. **`sbom`** — CycloneDX, pinned to `@cyclonedx/cyclonedx-npm@6.0.1`. It used to
   be `@latest`, which was the one place a release executed whatever the registry
   served at that moment, inside a job holding `contents: write`.

`.release-please-manifest.json` is still `0.1.0` — no release has ever been cut.

---

## Ratchets, not absolutes

Two gates are baselines that may only move down. Both exist because a check that
is red on day one gets ignored within a week, and an ignored check is worse than
no check — it looks like coverage.

- **ESLint warnings** — `.github/lint-baseline.json`, enforced by
  `scripts/lint-budget.mjs`. Errors always fail.
- **Accessibility** — `e2e/a11y-baseline.json`. Gates on the *set of axe rules*
  per route, not node counts: pages render from live data, so the number of
  violating nodes moves with how many rows loaded, and gating on that fails at
  random. A **new rule** on a route fails; a rule disappearing is reported so the
  baseline gets tightened.

Current accessibility backlog: **129 violating nodes across 13 routes** — `color-contrast` 84,
`button-name` 38, `label` 6, `aria-valid-attr-value` 1.

The contrast finding has a single root cause worth naming: `text-neutral-500`
(`#737373`) on `#0a0a0a` measures **4.17:1**, just under the 4.5:1 AA threshold,
across 56 uses in 14 files. Raising that one token clears most of the 84. It is a
visible change to every page, so it is recorded rather than applied.

---

## Known-inert workflows

Three of eleven never run, and it is better to know than to assume coverage:

| workflow | why it never runs |
|---|---|
| `codeql.yml`, `dependency-review.yml`, `scorecard.yml` | all gate on an `ENABLE_CODE_SCANNING` Actions **variable** that does not exist — the repo has zero variables |
| `claude.yml` | three jobs call `anthropics/claude-code-action` with no `anthropic_api_key` and no `claude_code_oauth_token`; the repo has zero Actions secrets |
| `dependency-report.yml` | exists only on `feat/realtime-dashboard-redesign`, so GitHub has not registered it; it registers on merge to `master` |

Branch protection cannot be configured either: the API answers `403 Upgrade to
GitHub Pro or make this repository public`.

---

## Adding a gate

1. add the stage to `scripts/ci-local.mjs` with its `ciJob`
2. add the matching step/job to `.github/workflows/ci.yml`
3. **add the job to `ci-success`'s `needs` list**

Step 3 is the one that gets forgotten, and forgetting it means the required check
goes green while the new job is red.


---

## Defects this infrastructure found

Every one of these was live before the suite existed, and each was found by a
specific gate rather than by reading code.

| defect | found by | status |
|---|---|---|
| CORS allow-list hardcoded to :5000 — server rejected its own bundle with 500 on any other port, blank page, `/health` still green | running E2E on a non-default port | **fixed** |
| `/api/ml/forecasts` mounted under a doubled prefix — answered only at `/api/ml/forecasts/ml/forecasts`, so the Forecast page 404s | route sweep's console guard | **fixed** |
| PTY WebSocket origin allow-list hardcoded to :5000 — the terminal cannot open on any other port (403) | `/terminals` route sweep | **fixed** |
| Hardware telemetry spawned a hardcoded anaconda path with no `error` handler and an unconditional 5s restart — a permanent crash loop off that one machine | reading the boot path for CI | **fixed** |
| CI pinned `ruff==0.7.4` while pyproject requires `>=0.14,<1`; formatter output differs, so `format --check` could never pass | aligning the local runner to CI | **fixed** |
| `port: z.number()` accepted 0 and NaN, so the configured port and the bound port could disagree | adversarial review of the CORS fix | **fixed** |
| Lens RollingPanel draws ReferenceLines at a NaN null-band (`Math.max(1, NaN)` is NaN) | console guard on `/lens` | **recorded** |
| `/api/experiments` answers 500 when the *optional* PostgreSQL is absent | console guard on `/operate` | **unobserved** — still true server-side (`src/server/ml/experiments.router.ts`), but `/operate` was the only page that called it and was removed in the 2026-09-16 nav consolidation, so no spec reaches it any more |
| SQL console runs a query and discards the result — no grid, no rows, just a toast | writing the console journey | **recorded** |
| `tests/client` quarantined in CI for modules that were deleted, not landed — 235 passing tests excluded from the gate | auditing the workflow | **fixed** |

"Recorded" means listed in `KNOWN_DEFECT_PATTERNS` (`e2e/fixtures/app.ts`) or
`e2e/a11y-baseline.json`: reported in every run, not silenced, and meant to reach
zero.
