# Control Terminal — Consolidated Design Spec

> **Data-layer premise superseded (2026-09-10).** This spec was written against a local
> QuestDB serving cache reached over HTTP `:9000` / ILP `:9009` / PG wire `:8812`. That store
> was emptied and retired: all 41 objects were dropped after each was copied to parquet in the
> lake and row-count verified (39/39 exact), and nothing may read or write it again. Market
> data now lives in the Iceberg lake at `E:\lake` and is read **in-process by DuckDB**
> (`from lake.serving import connect`). Everything below that names a database host, port,
> Windows service, JVM process, WAL table, `SAMPLE BY`, materialized-view refresh or ILP
> write is stale and must be re-derived against the lake before it is built.

**Date:** 2026-07-22
**Project:** ml_dashboard (`E:\source\repos\ml_dashboard`)
**Status:** DESIGN — awaiting Tyler's review before implementation planning.
**Source facet docs (full detail):** `integration.md` · `capabilities.md` · `roles-workflows.md` · `pseudocode.md` · `phase1-machine.md` · `perf-hygiene.md` (this directory)

Acronyms: SSE (Server-Sent Events), SDK (Software Development Kit), ORM (Object-Relational Mapping), WAL (Write-Ahead Log), OHLCV (Open High Low Close Volume), HPO (Hyperparameter Optimization), VRAM (Video Random-Access Memory), PID (Process Identifier), MCP (Model Context Protocol), IBKR (Interactive Brokers), P&L (Profit and Loss), UX (User Experience), DTO (Data Transfer Object), YAGNI (You Aren't Gonna Need It), RAM (Random-Access Memory).

---

## 1. What we're building

Turn the ml_dashboard into a **fused personal control terminal** — one surface that observes and controls everything on Tyler's machine (processes/services, all repos, the data/trading stack, agents/external tools), where **every observable and control is also agent-callable**. "Total agency" = an embedded Claude agent drives the *exact same* control surface Tyler does.

**Approved decisions (brainstorm, 2026-07-22):**

| Decision | Choice |
|---|---|
| Core role | **Both, tightly fused** — every tile is view + manual control + agent tool |
| Reach | **All four domains** — Machine & Processes, All Repos, Data & Trading, Agents & External |
| Agent mechanism | **Extend the existing `@anthropic-ai/claude-agent-sdk` runtime** (`agentDispatcher.ts`) — do not rebuild |
| Autonomy | **Human-in-loop for ALL writes** — agents observe + propose only; every write executes solely on Tyler's click |

**Takeaway:** the foundation is healthier than the original ask implied — TypeScript is already clean (0 errors), and ~80% of the 49 capabilities *wrap routers that already exist*. This is mostly integration + one new safety spine, not a from-scratch build.

---

## 2. Core abstraction — the Capability contract

One typed function, defined once, exposed three ways.

```ts
interface Capability<Args, Result> {
  id: string;            // "machine.proc.kill", "data.questdb.query", ...
  domain: 'machine' | 'repo' | 'data' | 'agent';
  kind:  'read' | 'write';
  risk:  'safe' | 'caution' | 'dangerous';   // ('forbidden' = refused at validation, never exposed)
  title: string;
  description: string;   // ALSO the agent-tool description
  stream?: boolean;      // read caps that push telemetry
  args:  ZodSchema<Args>;
  execute(a: Args): Promise<Result>;
}
```

| Consumer | `kind:'read'` | `kind:'write'` |
|---|---|---|
| **Cockpit tile** (human click) | live value / stream | button → executes **on Tyler's click** |
| **Agent SDK tool** (agent call) | directly callable | **propose-only** — cannot reach `execute()`; files a `proposed_action` card |
| **Telemetry** | SSE stream when `stream:true` | — |

### 2.1 The write-gate invariant (the safety spine)

`execute()` for a `write` capability is reachable from **exactly one** function:

```
executeAsHuman(id, args, humanToken)   // validates a live human-session token, Zod-parses, execute(), audits
executeAsAgent(id, args, runId)        // read → runs+audits; write → CANNOT execute — inserts a pending
                                        //   control_proposals row, emits control.proposals, returns {status:'proposed'}
```

Two independent fences at one choke-point:
1. `executeAsAgent` has **no token parameter** and its write branch has **no code path to `execute()`**.
2. The write HTTP route **refuses any request lacking `x-control-human-token`** before touching registry logic.

**Net:** a prompt-injected or buggy agent can at most spam the proposal inbox — it can never mutate the machine. `risk` drives the *friction* of the human confirm, not *whether* it confirms: `safe`=no card, `caution`=single Execute click, `dangerous`=typed confirmation (retype target id / `LIVE` / version number) **always, regardless of driver**.

---

## 3. Architecture & integration surface

Domain-driven-flat, matching repo conventions.

**Backend — `src/server/control/`:**
- `registry.ts` — the contract, the in-memory registry, and the write-gate (`executeAsHuman` / `executeAsAgent`).
- `capabilities/{machine,repo,data,agent}.ts` — capability definitions.
- `control.router.ts` — auto-mounts endpoints from the registry (reads `GET /api/control/cap/:id`; writes `POST` guarded on the human token; `POST /api/control/proposals/:id/approve`; `GET /api/control/proposals`).
- `control.events.ts` — two SSE channels: `control.telemetry` (streamed reads) + `control.proposals` (pending agent writes), reusing the existing EventBus + EventStore replay.
- `agentTools.ts` — adapts the registry into Agent SDK tool defs (reads callable, writes propose-only).
- `audit.ts` — append-only SQLite ledger of every execution + proposal.

**Agent runtime hook — one insertion:** populate the currently-empty `options` bag on the `sdkFn({ prompt })` call at **`agentDispatcher.ts:622`** with registry-derived tools, gated on a new `agentId:'control'`. The dispatcher already has the queue (`MAX_CONCURRENT=2`), ring-buffer SSE replay, boot recovery, rate-limit handling, and already emits `tool_call` events — the whole "total agency" wiring is this one bag + a `tool_use → executeAsAgent` route.

**Database — migration `0005`:** `control_audit` + `control_proposals` (state machine: pending → approved→executed | rejected | expired). Declared in **three places together** (see risk #3): `@shared/schema` Drizzle def, `migrations/0005_*.sql`, and `enforce-sqlite-invariants.ts`.

**Shared contracts — `@shared/schema` / `@shared/event-types`:** wire-safe `CapabilityMeta` DTO (so the client renders tiles from the same source of truth), `ProposedAction`, `ControlAuditEntry`, and the two SSE payload shapes.

**Frontend — `src/client/src/control/`:** `ControlTerminalPage.tsx` (tile grid), `tiles/*`, `CommandBar.tsx` (intent → Control Agent, streaming tool-calls + proposals inline), `ProposalDrawer.tsx` (approval queue), `lib/useCapability.ts` + `lib/useControlStream.ts` (mirroring the existing `useAgentDispatch` / `useDeploymentEvents` hooks). New "Control" group in `shared/hooks/navigation.ts` + `/control` route.

### 3.1 Integration risk register (from A1 + A5)

| # | Risk | Mitigation |
|---|---|---|
| R1 | SSE compression exclusion is **path-based** (`main.ts:81-88` skips gzip only for `/events/` + `/stream/`). An off-convention control SSE route gets silently gzip-buffered and never flushes. | Mount both control channels under `/api/events/control/...`. |
| R2 | The **human-session write token is net-new and load-bearing** — the entire "writes only on a human click" invariant reduces to this token + the registry gate. | Build and verify the token first; keep it unreachable from `callSdk`. No `write` capability ships before it. |
| R3 | **Three-place CHECK-constraint sync.** `db:push` can't emit CHECK constraints, and `enforce-sqlite-invariants.ts` runs a hardcoded `TABLES` array every boot. Adding `'control'` / new tables in only `schema.ts` → constraint-violation 500 on first dispatch. | Update `schema.ts`, the migration SQL, and `enforce-sqlite-invariants.ts` in one change. Launch from repo root (cwd-relative SQLite path). |
| R4 | **Lethal orphan heuristic** — "dead-parent = orphan" would kill the live dashboard (PID 39108), whose `cross-env` launcher exits normally under `tsx --watch`, making it byte-identical to stranded stacks. | Port-ownership discriminator + `hardware_node.py`-child check + self-PID exclusion + re-classify-at-kill + 10-min age gate. Ambiguous → **keep, never kill**. (§6) |

---

## 4. Capability catalog (full detail in `capabilities.md`)

**49 capabilities · 32 read / 17 write · 3 hard-dangerous.**

| Domain | Read | Write | Total | Dangerous | Notes |
|---|---|---|---|---|---|
| Machine & Processes | 12 | 3 | 15 | 0 | Phase 1 reference build; `systeminformation` + shell adapters |
| All Repos | 4 | 4 | 8 | 0 | `RepoDescriptor` config abstracts heterogeneous launch (npm/uv/cargo/mvn/dotnet/flutter) |
| Data & Trading | 12 | 8 | 20 | 3 | ~80% thin wrappers over existing routers |
| Agents & External | 4 | 2 | 6 | 0–1* | reuses `agentDispatcher`; `mcp.call` inherits the wrapped tool's tier |

Hard-dangerous (always typed-confirm regardless of driver): `data.models.promote` (→ live), `data.deploy.start` (mode:live), `data.broker.order` (spends real money). *`agent.mcp.call` is dangerous only when the wrapped MCP tool is.

---

## 5. Agent roles & workflows (full detail in `roles-workflows.md`)

**Roster decision: ONE general Control Agent, not a roster.** Because the write-gate turns every agent write into a gated proposal regardless of which agent issued it, splitting agents buys zero safety while adding routing overhead the `MAX_CONCURRENT=2` ceiling already penalizes. The only real benefit of specialization (narrower tool list → sharper proposals) is captured far more cheaply by optional prompt-preset + capability-tag filters (`reaper` / `repo-steward` / `data-ops`), added lazily only if a recurring chore's proposal quality measurably needs it.

The Control Agent: five-block system prompt, ~20-read / ~12-propose tool budget per run, reads the registry-driven capability catalog, decides propose-vs-report. It reuses the exact existing `agent.*` SSE event kinds (`queued/started/token_chunk/tool_call/completed/failed` + `replay`/`heartbeat`) and the `AgentDispatchError` taxonomy (`rate_limit` w/ `retry_after`, `sdk_error`, `timeout`). It is **dashboard-embedded/headless and distinct from the 68 CLI agents**, bridged only via a gated `agent.dispatch` capability.

**Six core workflows** (numbered steps + mermaid sequence diagrams in the facet doc), each marking the human-in-loop gate 🔒 and audit writes 📓:
1. Live telemetry (streamed read → `control.telemetry` → tile).
2. Human direct write (click → token'd endpoint → gate → execute → audit → tile).
3. **Agent-proposed write** (the key flow): CommandBar intent → agent reads `proc.list`+`proc.classify` → agent "calls" `proc.kill` (write → proposal filed, not executed) → card streams to ProposalDrawer → Tyler reviews the categorized kill list → Approve → executes as flow 2 → agent notified.
4. Dangerous capability (extra typed-confirm friction).
5. Multi-step plan (batched proposals, partial approval, fail-closed).
6. Failure / rate-limit (reuse the dispatcher's structured error handling).

---

## 6. Phase 1 — Machine & Processes (reference build; full detail in `phase1-machine.md`)

Built first: highest daily value, smallest external surface, and it exercises every pattern (read tiles + streaming telemetry + the `caution` write→proposal→Execute→audit loop) that every later domain copies verbatim.

**Reality correction (measured, 2026-07-21/22):** the ~260 live processes are **NOT mostly reapable orphans** — ~210 are protected MCP servers spawned by Claude/VS Code (the real RAM giant: 152 node ≈ 18.1 GB), which we do not kill. The genuinely reapable set is small and specific: **≥2 stranded ml_dashboard dev backends (PIDs 38260, 25740), a stale `vite` (56096), 3 redundant `npm run dev` launchers** (~780 MB reclaimable). Protected-hard: live dashboard PID 39108 (owns `:5000`) + its `hardware_node.py` child 17060; QuestDB PID 5996 (nssm/java, `:9000`+`:9009`).

**Capabilities (15):** reads — `proc.list`, `proc.classify`, `proc.tree`, `port.owner`, `cpu/mem/gpu/net/disk.snapshot`, `svc.list`, `svc.status`, `temp.scan`; writes — `proc.kill` (caution), `proc.kill-tree` (dangerous), `svc.restart` (caution; QuestDB = typed echo), `svc.stop` (dangerous; QuestDB = **forbidden**), `temp.clean` (caution; dangerous near `data/`). GPU/CPU/mem **reuse** the existing `system.gpu`/`system.matrix` feed — never re-query `si.graphics()` (grabs the iGPU).

**Orphan classifier — asymmetric & conservative:** default verdict PROTECTED. A process is `ORPHAN_STRANDED` only when it clears **every** gate: cmdline under the ml_dashboard repo root AND matches a dev-role pattern AND does **not** own `:5000` AND has no `hardware_node.py` child AND a *different* live PID owns `:5000` AND age > 10 min. Writes **re-classify at execution time** and hard-refuse any `PROTECTED_INFRA`, the `:5000` owner, or the QuestDB PID — the gate lives in the capability, not the button.

**Temp janitor:** safelist (removable) = `node_modules/.vite` (74 MB) + `dist` (82 MB) + rotated `logs/` + `optuna_studies/*.lock` (never the `*.db`) + age-gated scratch/`E:\tmp`. Hard-excluded (forbidden): `data/models` (98 MB checkpoints), any `data/**`, **anything under `E:\lake`** (the system of record), `node_modules` (except `.vite`), `.git/` and **anything git-tracked** (`git ls-files` membership = instant reject). Path-safety re-validated server-side in `temp.clean`.

**Tiles (colorblind-safe, Okabe-Ito; positive=orange `#E69F00`, alert=blue `#0072B2`, never red/green):** ResourceTile, ProcessTile (the flagship — categorized list + orphan reaper; protected rows greyed & unselectable), ServiceTile (QuestDB lock badge), TempTile.

**Acceptance criteria (10, verifiable):** classifier buckets the live ~260 procs correctly by PID; QuestDB never killable / `svc.stop('QuestDB')` refuses; the `:5000` chain + hardware_node protected despite dead parent; killing a confirmed orphan frees ≈ its working set; kill-tree leaves no reparented survivors; `temp.clean` never touches excluded/git-tracked paths even when passed explicitly; `.vite`+`dist` reclaim regenerates; every write pairs a before/after audit row; **an agent can propose a reap but the process stays alive until a human confirm**; `svc.restart('QuestDB')` runs stop→verify-dead→start→`select 1` with typed echo.

---

## 7. Phase sequencing

1. **Phase 1 — Machine & Processes** (reference). Proves the fused contract + the write-gate + QuestDB guardrails on the highest-blast-radius domain. Directly solves the stated "background services + temp files" pains.
2. **Phase 2 — All Repos.** Introduces `RepoDescriptor` + the tracked child-process launcher (`repo.run`/`repo.stop`) on Phase 1's process model.
3. **Phase 3 — Data & Trading.** ~80% thin adapters over existing routers; first `dangerous` typed-confirm gates (`models.promote` live, `deploy.start` live, `broker.order`).
4. **Phase 4 — Agents & External.** Thinnest, last — composes the prior three; an agent's whole value is proposing writes from domains already built.

---

## 8. Perf / hygiene / frameworks track (full detail in `perf-hygiene.md`)

Runs **alongside** the platform build (not gated behind it). Every finding carries a Takeaway in the facet doc.

**Frameworks: ZERO new runtime dependencies.** `systeminformation`, Zod (3.25.76), the SSE bus, react-window v2, TanStack Query/Table are all installed; BullMQ/Redis, `ws`, `tree-kill`, `pidusage` explicitly ruled out (YAGNI — each duplicates something present). The **only** dependency action is pinning `systeminformation` exact. *(Reconciliation: A5 measured `5.31.5` installed; A6 suggested a `5.33.0` bump. Decision — **pin the installed `5.31.5` exact**; only bump to `5.33.0` if a specific fix we need landed there. Verify at implementation time; do not bump speculatively.)* Extract the existing `taskkill /T /F` helper into a shared `infrastructure/lib/proc/kill.ts` rather than adding `tree-kill`.

**Live bugs found (fix as hygiene, Phase 1):**
- **`src/ml/shared/primitives/core.py` is truncated** (ends mid-`for` at line 300) — import-breaking. Restore it.
- `ptyServer.ts:74` `require()` in ESM → `import`.
- `compute_fold_metrics` double-def in a model `.j2` template (9× F811).

**Lint state (report-only):** ESLint 14 errors / 719 warnings (dominated by 518 `no-explicit-any`, 125 `no-unused-vars`, 71 `no-console` — mostly mechanical/standing debt); Ruff 46 (only the two above are real). Prioritized sweep list in the facet doc (incremental, Phase 2–3).

**Top processing-speed win (Phase 1):** a QuestDB **`front_month_daily` materialized view** (daily volume per root/symbol) so `getFullFrontMonthRanges` reads it instead of scanning 200M+ base rows on every Market cold-start → **~11–18s (often a 504 timeout) → sub-500ms**. Same mat-view pattern the repo already uses. Second: throttle+cache the terminal's `si.processes()`/`si.services()` (WMI is slow — 30s stream cadence).

---

## 9. Open items for Tyler's review

1. **Capability id namespacing:** the catalog uses `machine.proc.kill` style (domain-prefixed). Confirm that over flat `proc.kill`.
2. **`systeminformation` pin:** confirm pinning the installed `5.31.5` vs bumping to `5.33.0` (recommendation: stay on 5.31.5 unless a needed fix is in 5.33.0).
3. **Command-bar default agent scope:** Phase 1 ships the general Control Agent with *machine-domain* tools only (reads + propose-only writes). Confirm that's the right starting blast radius.
4. **`repo.run` reach (Phase 2):** by default the reaper/launcher scopes to ml_dashboard-owned processes only; confirm you want cross-repo launch (adorn, quant, forexmodel, …) wired in Phase 2 rather than later.
