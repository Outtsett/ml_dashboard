# Control Terminal — Design & Planning Tracker

> **Data-layer premise superseded (2026-09-10).** This spec was written against a local
> QuestDB serving cache reached over HTTP `:9000` / ILP `:9009` / PG wire `:8812`. That store
> was emptied and retired: all 41 objects were dropped after each was copied to parquet in the
> lake and row-count verified (39/39 exact), and nothing may read or write it again. Market
> data now lives in the Iceberg lake at `E:\lake` and is read **in-process by DuckDB**
> (`from lake.serving import connect`). Everything below that names a database host, port,
> Windows service, JVM process, WAL table, `SAMPLE BY`, materialized-view refresh or ILP
> write is stale and must be re-derived against the lake before it is built.

Status legend: ⬜ pending · 🔄 in progress · ✅ done · ⛔ blocked

## Approved decisions (brainstorm, 2026-07-22)
- **Core role:** Both, tightly fused — every observable/control is also agent-callable.
- **Reach:** all four domains — Machine & Processes, All Repos, Data & Trading, Agents & External.
- **Agent mechanism:** extend the EXISTING `@anthropic-ai/claude-agent-sdk` runtime (`agentDispatcher.ts`, 834 LOC) — do not rebuild.
- **Autonomy:** human-in-loop for ALL writes. Agents observe + propose only; every write executes only on Tyler's click. Enforced mechanically at the registry write-gate.
- **Core abstraction:** the Capability contract — one typed fn exposed 3 ways (cockpit tile / agent tool / telemetry).

## Recon facts (verified 2026-07-22)
- TypeScript: **0 tsc errors** (type layer already clean).
- Processes: **152 node.exe + 107 python.exe = 259** — orphan accumulation is the #1 concrete problem.
- Market data: no process at all. The lake is files plus the Iceberg catalog on `:9100`; DuckDB runs inside the calling process. (Was: a shared `nssm` QuestDB Java service, ~2.6 GB, retired 2026-09-10.)
- Repo temp footprint tidy (logs 1 MB, models 98 MB, dist 82 MB, node_modules 2.7 GB).
- Existing agent infra: `agentDispatcher.ts`, `deployment/agents.router.ts`, `deployment/agents.events.ts`, client `useAgentDispatch.ts` + `AgentReport.tsx` + `ml/agents/AgentButton.tsx`; `agent_runs` SQLite table + `AgentReport` contract in `@shared/schema`.

## Parallel design agents (fan-out, zero file overlap)
- ✅ A1 Integration Architect → `integration.md` (hub = the registry, consumed 4 ways; agent hook = populate empty `options` bag at `agentDispatcher.ts:622` w/ registry tools + new `agentId:'control'`; migration 0005 for `control_audit`+`control_proposals`. RISKS: (1) mount SSE under `/api/events/control/...` or gzip-buffers silently; (2) human-session write-token is net-new + load-bearing, must ship before any write cap; (3) 3-place CHECK-constraint sync — schema.ts + migration sql + enforce-sqlite-invariants.ts together)
- ✅ A2 Capability Catalog → `capabilities.md` (49 caps: Machine 15, Repos 8, Data/Trading 20, Agents 6; 3 hard-dangerous: models.promote-live, deploy.start-live, broker.order. ~80% wrap existing routers; `RepoDescriptor` config for heterogeneous launch cmds)
- ✅ A3 Roles & Workflows → `roles-workflows.md` (rec: ONE general Control Agent, not a roster — write-gate makes specialization security-neutral; roster = lazy prompt-preset filters only if needed)
- ✅ A4 Core Pseudocode → `pseudocode.md` (7 modules, compiling-shaped. INVARIANT: `cap.execute()` for writes reachable from exactly ONE fn — `executeAsHuman(id,args,humanToken)`; `executeAsAgent` has no token param + write branch physically cannot call execute() (only inserts pending proposal row). Two fences: registry gate + write-route refuses missing `x-control-human-token`. Injected agent can at most spam proposal inbox, never mutate.)
- ✅ A5 Phase-1 Machine deep-dive → `phase1-machine.md` (CORRECTION: 259 procs are NOT mostly orphans — ~210 are protected MCP servers (Claude/VSCode), the real RAM giant (152 node ≈ 18.1 GB). Reapable set is SMALL: stranded dev backends 38260/25740, stale vite 56096, 3 redundant npm-dev. Protected chain: dashboard PID 39108 owns :5000 w/ hardware_node.py child 17060; (the QuestDB JVM that used to hold :9000/:9009 is retired — no such process exists.) LETHAL heuristic caught: "dead-parent=orphan" kills live dashboard (cross-env launcher exits under tsx --watch, byte-identical to strays). Safe rule: NOT own :5000 AND different live PID owns it AND no hardware_node.py child + self-PID exclude + 10min age gate + reclassify-at-kill. systeminformation 5.31.5 pinned. Temp wins: node_modules/.vite 74MB + dist 82MB; hard-exclude data/models + E:\lake + git-tracked.)
- ✅ A6 Perf / Hygiene / Frameworks → `perf-hygiene.md` (ESLint 14 err/719 warn — mostly no-explicit-any 518 + no-unused 125 + no-console 71; Ruff 46, only 2 real: TRUNCATED `src/ml/shared/primitives/core.py` (import-breaking bug) + 9 dup compute_fold_metrics from one bad .j2. Frameworks: ZERO new deps needed (systeminformation/Zod/SSE/react-window/TanStack all present; BullMQ/ws/tree-kill = YAGNI). TOP PERF WIN: a pre-aggregated `front_month_daily` view in the lake → cold-start 11-18s (504 timeout) → sub-500ms.)

## Synthesis (after fan-out returns)
- ✅ S1 Reconcile the six facet docs (one contradiction found + resolved: systeminformation pin 5.31.5 vs bump 5.33.0 → stay on installed 5.31.5 unless a needed fix is in 5.33.0).
- ✅ S2 Write the consolidated design spec → `2026-07-22-control-terminal-design.md`.
- ✅ S3 Spec self-review (no placeholders; counts consistent 49/32/17/3-dangerous; risk model clean).
- ✅ Committed to branch `feature/control-terminal-design` (37fcc7a), no push.
- 🔄 S4 Tyler reviews the spec (4 open items at spec §9).
- ⬜ S5 Invoke writing-plans → implementation plan (scope: shared foundation + Phase-1 Machine + Phase-1 perf/hygiene items).
