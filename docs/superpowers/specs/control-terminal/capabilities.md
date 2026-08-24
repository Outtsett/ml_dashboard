# Control Terminal — Capability Catalog (A2)

Status: DESIGN. This document enumerates every Capability the fused "control terminal"
should expose, across all four reach domains. It is grounded in the existing ml_dashboard
server code (real router paths cited) and the known state of Tyler's machine.

## What a Capability is

```ts
interface Capability<Args, Result> {
  id: string;
  domain: 'machine' | 'repo' | 'data' | 'agent';
  kind: 'read' | 'write';
  risk: 'safe' | 'caution' | 'dangerous';
  title: string;
  description: string;
  args: ZodSchema<Args>;
  execute(a: Args): Promise<Result>;
}
```

Every Capability is exposed three ways from one definition: a **cockpit tile** (the dashboard
surface), an **Agent SDK (Software Development Kit) tool** (an agent can call it), and a
**telemetry stream** (if `stream?` is true, it pushes over the existing Server-Sent Events
bus). Acronyms used below: SSE (Server-Sent Events), ORM (Object-Relational Mapping),
WAL (Write-Ahead Log), OHLCV (Open High Low Close Volume), HPO (Hyperparameter
Optimization), VRAM (Video Random-Access Memory), PID (Process Identifier), MCP (Model
Context Protocol), IBKR (Interactive Brokers), OOS (Out-Of-Sample), OCO (One-Cancels-Other),
P&L (Profit and Loss), UX (User Experience).

## Autonomy model (applies to every table below)

- **Reads (`kind:'read'`)** execute immediately from either driver (tile click or agent call).
  No confirmation. They are the telemetry substrate.
- **Writes (`kind:'write'`)** are ALWAYS human-in-loop. An agent (or a tile) can only *propose*
  a write; execution requires Tyler clicking **Execute** on the proposal card. The card shows
  the resolved `args`, the target it will touch, the predicted effect, and the reversibility.
- **`risk` drives the card's friction, not whether it confirms:**
  - `safe` — read tier (no card).
  - `caution` — single Execute click; card shows args + target + effect.
  - `dangerous` — Execute is gated behind a typed confirmation (retype the target id /
    the word `LIVE` / the version number). **A `dangerous` write ALWAYS requires the explicit
    typed confirm regardless of driver** — an agent proposing it cannot lower the gate, and a
    tile click cannot skip it. These are the money/registry/live-trading actions.

The "Confirm UX" column states exactly what the proposal card renders before Tyler can click.

---

## Domain 1 — Machine & Processes  (Phase 1, the reference build)

Ground truth: 259 live processes (152 node, 107 python) with orphan accumulation; QuestDB
runs as an externally-managed **nssm** Windows service (Java) — the dashboard never owns that
process, confirmed in `src/server/infrastructure/database/questdb/lifecycle.ts:13`; repo temp
dirs (`logs/`, `data/models/`, `dist/`, `optuna_studies/`); GPU is an RTX 5060 Ti 16GB (target
50-60% VRAM). Recommended engine: the **`systeminformation`** npm library (already a dependency
— imported as `si` in `src/server/system/telemetry.router.ts:1`) for process / service / GPU /
disk / port introspection. The live GPU/CPU/mem/net feed already exists on the `system.matrix`
and `system.gpu` SSE channels via `scripts/hardware_node.py` → `telemetry.router.ts`.

### Reads

| id | kind | risk | description | args | result | stream? | wraps |
|---|---|---|---|---|---|---|---|
| `proc.list` | read | safe | Enumerate all running processes with pid, name, cpu%, mem, parent pid, start time, cwd. | `{ filter?: string, sortBy?: 'cpu'\|'mem'\|'age', limit?: number }` | `{ processes: Array<{ pid, ppid, name, command, cpu, memMB, started, user }>, total: number, byRuntime: { node: number, python: number, other: number } }` | yes | `si.processes()` (systeminformation); mirrors the `processes` slot already on `SystemSnapshot` in `telemetry.router.ts:35` |
| `proc.classify` | read | safe | Classify processes and flag orphans (detached node/python whose parent died, or whose cwd is a repo temp dir, older than N minutes). | `{ orphanAgeMinutes?: number, roots?: string[] }` | `{ live: number, orphans: Array<{ pid, name, reason: 'dead-parent'\|'stale-cwd'\|'zombie', ageMin, memMB, cwd }>, reclaimableMB: number }` | no | `si.processes()` + parent-pid graph walk; new classifier logic layered on `proc.list` |
| `proc.tree` | read | safe | Return the parent/child process tree rooted at a pid (or full forest). | `{ rootPid?: number, maxDepth?: number }` | `{ nodes: Array<{ pid, ppid, name, children: number[] }> }` | no | `si.processes()` ppid graph |
| `port.owner` | read | safe | Resolve which process owns a TCP/UDP port (e.g. 8055/8056 dashboard, 9000 QuestDB, 3000-range apps). | `{ port: number }` | `{ port, pid?: number, name?: string, state?: string, protocol: 'tcp'\|'udp' }` | no | `si.networkConnections()` |
| `cpu.snapshot` | read | safe | Current CPU load, per-core loads, temperature, clock speed. | `{}` | `SystemSnapshot['cpu']` = `{ load, cores: number[], temp, speed }` | yes | live `system.matrix` SSE channel + `lastSnapshot.cpu` in `telemetry.router.ts:158` (`GET /api/system/matrix`) |
| `mem.snapshot` | read | safe | Physical + swap memory usage. | `{}` | `SystemSnapshot['mem']` = `{ total, active, used, swaptotal, swapused }` | yes | `lastSnapshot.mem`, `system.matrix` channel |
| `gpu.snapshot` | read | safe | Live NVIDIA GPU utilization, VRAM used/total, temperature, name. | `{}` | `GpuSnapshot` (`{ name, utilization, memoryUsedMB, memoryTotalMB, temperature, ... }`) | yes | `GET /api/system/gpu` + `system.gpu` SSE channel, `telemetry.router.ts:162`; source is `scripts/hardware_node.py` (pynvml) |
| `net.snapshot` | read | safe | Network throughput (tx/rx bytes per second). | `{}` | `SystemSnapshot['network']` = `{ tx_sec, rx_sec }` | yes | `lastSnapshot.network` (delta-computed in `telemetry.router.ts:97-104`) |
| `disk.snapshot` | read | safe | Free/used bytes per filesystem/drive; flags drives over a fullness threshold. | `{ warnPct?: number }` | `{ drives: Array<{ fs, mount, sizeGB, usedGB, usePct }>, warnings: string[] }` | no | `si.fsSize()` |
| `svc.list` | read | safe | List Windows services relevant to the stack (QuestDB/nssm, plus optional name filter) with running/stopped state. | `{ filter?: string }` | `{ services: Array<{ name, displayName, running: boolean, startType, pid?: number }> }` | no | `si.services('*')`; the nssm-wrapped QuestDB Java service surfaces here |
| `svc.status` | read | safe | Status of one named service + a live connectivity probe when it maps to QuestDB. | `{ name: string }` | `{ name, running, startType, pid?, probe?: { reachable: boolean, url } }` | no | `si.services(name)`; for QuestDB reuse `GET /api/questdb/status` (`database-infra.router.ts:149`) |
| `temp.scan` | read | safe | Measure size of repo temp/artifact dirs (`logs/`, `data/models/`, `dist/`, `optuna_studies/`, `__pycache__/`, `node_modules/` on request) per repo. | `{ roots?: string[], globs?: string[] }` | `{ dirs: Array<{ path, sizeMB, fileCount, oldestFileAge }>, totalReclaimableMB: number }` | no | `fs` recursive stat; new scanner (no existing wrapper) |

### Writes

| id | kind | risk | description | args | result | stream? | wraps | Confirm UX (proposal card) |
|---|---|---|---|---|---|---|---|---|
| `proc.kill` | write | caution | Terminate a process (and optionally its child subtree) by pid. | `{ pid: number, tree?: boolean, signal?: 'SIGTERM'\|'SIGKILL' }` | `{ killed: number[], failed: Array<{ pid, error }> }` | no | `process.kill()` / `taskkill /PID <pid> /T`; targets resolved from `proc.classify` | Shows pid, process name, command line, cwd, memory it will free, and whether `tree:true` will also kill N children (lists them). Single **Execute**. |
| `svc.restart` | write | caution | Restart a Windows service (primary target: the nssm QuestDB service). | `{ name: string, action?: 'restart'\|'start'\|'stop' }` | `{ name, action, ok: boolean, newState: string }` | no | `nssm restart <name>` / `sc.exe`; for QuestDB the softer path is `POST /api/questdb/restart` → `QuestDBAutomationService.restartQuestDB()` (`database-infra.router.ts:197`) | Shows service name, current state → target state, and (for QuestDB) a warning that in-flight ingestion/queries will drop for the restart window. Single **Execute**. |
| `temp.clean` | write | caution | Delete selected temp/artifact dirs or files surfaced by `temp.scan`. | `{ paths: string[], dryRun?: boolean }` | `{ deleted: string[], freedMB: number, skipped: Array<{ path, reason }> }` | no | `fs.rm` recursive, guarded to an allowlist of temp roots; pairs with `temp.scan` | Lists every path to delete with its size, the total MB freed, and an explicit "these are build/log/artifact dirs, not source" assertion. Defaults to `dryRun` preview; **Execute** flips to real delete. |

**Domain 1 total: 15 capabilities (12 read, 3 write).**

---

## Domain 2 — All Repos

Ground truth: ~30 git repos under `E:\source\repos` (from the global `C:\Users\tyler\.claude\CLAUDE.md`
"Active Project Locations" and this repo's `CLAUDE.md`). Launch commands are heterogeneous —
`ml_dashboard` uses `npm run dev` (Electron + Vite), the `Trading\quant` workspace uses
`uv run`, `QuestDBPlugin` uses `mvn`/`--release 17`, `Trading\quantower_strategies` builds C# via
`dotnet`/msbuild, Flutter apps use `flutter run`, Rust repos use `cargo`. This mandates a
**per-repo launch descriptor** rather than a hardcoded command.

### Per-repo launch descriptor (config, not a capability)

```ts
interface RepoDescriptor {
  id: string;                    // 'ml_dashboard', 'trading-quant', 'questdb-plugin', ...
  path: string;                  // absolute repo root
  runtime: 'node' | 'uv' | 'cargo' | 'maven' | 'dotnet' | 'flutter' | 'python';
  commands: {
    run?:   { cmd: string; args: string[]; port?: number; cwd?: string };
    build?: { cmd: string; args: string[] };
    test?:  { cmd: string; args: string[] };
  };
  logGlobs?: string[];           // where this repo writes logs
  envFile?: string;              // optional .env to source
}
```

The descriptor set is seeded from the CLAUDE.md project list and stored alongside the terminal
config. `repo.run` / `repo.build` / `repo.test` all resolve their concrete command through this
descriptor, so a new repo is onboarded by adding one descriptor, never by touching capability code.

### Reads

| id | kind | risk | description | args | result | stream? | wraps |
|---|---|---|---|---|---|---|---|
| `repo.list` | read | safe | Enumerate registered repos with runtime, path, and whether a launch descriptor exists. | `{ runtime?: string }` | `{ repos: Array<{ id, path, runtime, hasRun: boolean, hasBuild: boolean, hasTest: boolean, running?: { pid, port } }> }` | no | reads the `RepoDescriptor` registry; cross-checks `proc.classify` for a live pid |
| `repo.git-status` | read | safe | Working-tree status for a repo: dirty file count, ahead/behind vs upstream, current branch. | `{ repoId: string }` | `{ branch, dirty: number, staged: number, ahead: number, behind: number, upstream?: string, files: Array<{ path, status }> }` | no | `git status --porcelain=v2 --branch` in the descriptor `path` |
| `repo.git-log` | read | safe | Recent commit history for a repo. | `{ repoId: string, limit?: number }` | `{ commits: Array<{ sha, author, date, subject }> }` | no | `git log --oneline -n <limit>` |
| `repo.logs` | read | safe | Tail a repo's log files (resolved via `logGlobs`). | `{ repoId: string, lines?: number, grep?: string }` | `{ files: Array<{ path, tail: string[] }> }` | yes | `fs` tail of `descriptor.logGlobs`; streams new lines while a `repo.run` process is live |

### Writes

| id | kind | risk | description | args | result | stream? | wraps | Confirm UX (proposal card) |
|---|---|---|---|---|---|---|---|---|
| `repo.run` | write | caution | Launch a repo's app via its descriptor `run` command as a tracked child process. | `{ repoId: string, extraArgs?: string[] }` | `{ pid, port?, startedAt, logStream: string }` | yes | spawns `descriptor.commands.run`; process tracked the same way `hardware_node.py` / pty children are in `telemetry.router.ts` + `infrastructure/lib/ptyServer.ts` | Shows repoId, the exact resolved command + cwd, the port it will bind (with a `port.owner` collision check), and whether an instance is already running. Single **Execute**. |
| `repo.stop` | write | caution | Stop a repo's tracked run process (and children). | `{ repoId: string }` | `{ stopped: number[], repoId }` | no | delegates to `proc.kill({ tree:true })` on the tracked pid | Shows repoId, the pid, port, and uptime being terminated. Single **Execute**. |
| `repo.build` | write | caution | Run the descriptor `build` command; stream output. | `{ repoId: string }` | `{ exitCode, durationSec, tail: string[] }` | yes | spawns `descriptor.commands.build` (`npm run build` / `cargo build` / `mvn --release 17` / `flutter build` / `dotnet build`) | Shows repoId + resolved build command + estimated duration; warns it may overwrite `dist/`/`target/`. Single **Execute**. |
| `repo.test` | write | caution | Run the descriptor `test` command; stream output + parse pass/fail. | `{ repoId: string, filter?: string }` | `{ exitCode, passed: number, failed: number, durationSec, tail: string[] }` | yes | spawns `descriptor.commands.test` (`npm test`/`vitest`, `pytest`/`uv run pytest`, `cargo test`, `mvn test`) | Shows repoId + resolved test command; low-blast (read-adjacent) but still a spawned process, so single **Execute**. |

**Domain 2 total: 8 capabilities (4 read, 4 write).**

---

## Domain 3 — Data & Trading

Ground truth: **most of this already has backend routers in ml_dashboard** — the design here is
overwhelmingly *wrapping* existing endpoints as Capabilities, not building new logic. Sources:
QuestDB (`src/server/infrastructure/database/questdb/*` + `database-infra.router.ts`), model
registry/checkpoints (`ml/models.router.ts`, `ml/registry.router.ts`), HPO (`training/hpo.router.ts`),
backtests (`backtest/backtest.router.ts`), deployments/paper/live (`deployment/deployments.router.ts`),
brokers (`backtest.router.ts` broker endpoints). The `questdb` MCP server is also available for raw
introspection. OHLCV/parquet data root is external at `ml_dashboard\data\parquet`.

### Reads

| id | kind | risk | description | args | result | stream? | wraps |
|---|---|---|---|---|---|---|---|
| `questdb.tables` | read | safe | List QuestDB tables/views with row + partition counts. | `{}` | `{ connected, tables, tableDetails: Array<{ name, type, rowCount, partitionCount }> }` | no | `getQuestDBStats()` / `getQuestDBTables()` in `questdb/introspection.ts:46,88`; or `questdb_list_tables` MCP |
| `questdb.query` | read | safe | Run a read-only SQL query against QuestDB (SELECT only, guarded). | `{ sql: string, limit?: number }` | `{ rows: unknown[], count: number, columns: string[] }` | no | `queryQuestDB()` (`questdb/connection.ts`); or `/exp` REST; or `questdb_query` MCP. SELECT-only guard added at the capability layer |
| `questdb.wal-status` | read | safe | WAL (Write-Ahead Log) apply lag / sequencer status per WAL table. | `{ table?: string }` | `{ tables: Array<{ name, sequencerTxn, writerTxn, lag }> }` | no | `questdb_wal_status` MCP; or `SELECT * FROM wal_tables()` via `queryQuestDB` |
| `questdb.backup-status` | read | safe | Report presence/age/size of QuestDB backups (snapshot dir) + last checkpoint. | `{}` | `{ lastBackupAt?, ageHours?, sizeMB?, path?, present: boolean }` | no | `fs` stat of the QuestDB snapshot/backup dir + `SELECT * FROM checkpoint_status()` where available |
| `questdb.health` | read | safe | Combined QuestDB integration + process status + live probe. | `{}` | `{ connected, process, integration }` | no | `GET /api/questdb/status` (`database-infra.router.ts:149`) |
| `models.list` | read | safe | List model checkpoints (filterable by type/symbol/timeframe/active). | `{ modelType?, symbol?, timeframe?, active?: boolean }` | `Array<Checkpoint>` (id, modelId, primaryMetric, isActive, createdAt, ...) | no | `GET /api/models` (`ml/models.router.ts:68`) |
| `registry.versions` | read | safe | List promotable model *versions* (candidate/shadow/paper/live/retired) with lineage. | `{ status?, catalog_id?, symbol?, timeframe?, limit?, cursor? }` | `{ items: ModelVersion[], nextCursor, hasMore }` | no | `GET /api/model-versions` (`ml/registry.router.ts:189`) |
| `hpo.studies` | read | safe | List HPO sessions (active + past) with best score, trial count, status. | `{ modelType?, symbol?, limit?, activeOnly?: boolean }` | `{ sessions: Array<{ sessionId, status, modelType, optimizer, completedTrials, bestScore, elapsedSec }> }` | yes | `GET /api/hpo/status` + `GET /api/hpo/sessions` (`training/hpo.router.ts:137,160`); live trials on the `/api/hpo/stream/:id` SSE channel |
| `hpo.trials` | read | safe | Full trial results + fANOVA param importance for one HPO session. | `{ sessionId: string }` | `{ session, trials: Trial[], importance?: Record<string, number> }` | no | `GET /api/hpo/sessions/:id` + `GET /api/hpo/sessions/:id/importance` (`hpo.router.ts:179,284`) |
| `backtest.list` | read | safe | List backtest runs with headline metrics. | `{ symbol?, modelId?, status?, limit? }` | `Array<BacktestRun>` (id, symbol, sharpe, profitFactor, maxDD, status) | no | `GET /api/backtest/runs` (`backtest/backtest.router.ts:75`) |
| `paper.status` | read | safe | State of paper/shadow deployments (running/paused/stopped, predictions emitted). | `{ symbol?, timeframe?, mode?: 'shadow'\|'paper' }` | `{ items: Deployment[] }` | yes | `GET /api/deployments?mode=paper` (`deployment/deployments.router.ts:98`); live P&L on the deployment SSE feed |
| `broker.status` | read | safe | Broker connection/config health (OANDA / IBKR / configured backtest brokers). | `{ brokerId?: number }` | `{ brokers: Array<{ id, name, assetType, connected?, balance?, openPositions? }> }` | no | `GET /api/brokers` (`backtest.router.ts:32`); live balance/positions via `get_account_balances`/`get_account_positions` (IBKR MCP) or OANDA REST |

### Writes

| id | kind | risk | description | args | result | stream? | wraps | Confirm UX (proposal card) |
|---|---|---|---|---|---|---|---|---|
| `questdb.maintenance` | write | caution | Trigger manual DB maintenance (materialized-view refresh, dedup compaction). | `{}` | `{ success: boolean, message }` | no | `POST /api/questdb/maintenance` → `QuestDBAutomationService.runDailyMaintenance()` (`database-infra.router.ts:212`) | States it refreshes materialized views and may briefly raise load. Single **Execute**. |
| `hpo.start` | write | caution | Launch a new HPO study (spawns Optuna subprocess fleet). | `hpoRequestSchema` (modelType, symbol, timeframe, optimizer, search space, nTrials) | `{ sessionId }` | yes | `POST /api/hpo/start` (`hpo.router.ts:33`) | Shows model type, symbol/timeframe, optimizer, trial budget, and the GPU/CPU load it will add (cross-links `gpu.snapshot`). Single **Execute**. |
| `hpo.stop` | write | caution | Stop a running HPO session (or kill one trial). | `{ sessionId: string, trialId?: number }` | `{ stopped: boolean }` | no | `POST /api/hpo/stop/:id` / `POST /api/hpo/sessions/:id/trials/:trialId/kill` (`hpo.router.ts:197,241`) | Shows sessionId, trials completed so far (which are preserved), and that the study can be resumed. Single **Execute**. |
| `backtest.run` | write | caution | Launch a backtest / walk-forward run for a symbol+config. | `{ symbol, timeframe?, modelId?, config, walkForward?: {...} }` | `{ runId, status }` | yes | `POST /api/backtest/run` + `/api/backtest/walk-forward` (`backtest.router.ts:55,180`) | Shows symbol, date range, model, cost model in play, est. duration. Single **Execute**. |
| `models.activate` | write | caution | Set a checkpoint active for its symbol+timeframe (deactivates siblings). | `{ id: number }` | `{ message }` | no | `PATCH /api/models/:id/activate` (`models.router.ts:235`) | Shows which checkpoint becomes active and which currently-active one it displaces (same symbol+timeframe). Single **Execute**. |
| `deploy.stop` | write | caution | Pause or stop a deployment. | `{ deploymentId: number, action: 'pause'\|'stop' }` | `Deployment` (updated) | no | `POST /api/deployments/:id/pause`\|`/stop` (`deployments.router.ts:276,280`) | Shows deployment id, mode, symbol, current state → target, predictions emitted. Single **Execute** (stopping is the *safe* direction). |
| `models.promote` | write | **dangerous** | Promote a model version along candidate→shadow→paper→**live**→retired, through promotion gates. | `{ id: number, to_status: 'candidate'\|'shadow'\|'paper'\|'live'\|'retired', dryRun?: boolean, override?: boolean, reason?: string }` | `{ allowed, results: GateResult[], version }` | no | `POST /api/model-versions/:id/promote` → `evaluateGates()` (`registry.router.ts:269`) | Card first runs `dryRun` and renders the gate evaluation (each gate pass/fail + metric). Promoting **to `live`**, or using `override:true`, requires typing the version number AND a non-empty `reason` (the route audit-logs `[OVERRIDE ...]`). **Always typed-confirm regardless of driver.** |
| `deploy.start` | write | **dangerous** | Start a deployment; `mode:'live'` puts a model on the real MLBridge scoring engine. | `{ version_id: number, mode: 'shadow'\|'paper'\|'live', symbol: string, timeframe: string }` | `Deployment` (created) | yes | `POST /api/deployments` (`deployments.router.ts:124`); `live` is env-gated on `ENABLE_LIVE_DEPLOY=1` and unique per (symbol,timeframe) | `shadow`/`paper` are caution-tier (single Execute). `mode:'live'` is dangerous: card shows the version, symbol/timeframe, the existing live deployment it would conflict with (409 pre-check), and requires typing `LIVE`. **Always typed-confirm.** |
| `broker.order` | write | **dangerous** | Place / modify / cancel a real broker order (IBKR or OANDA). | `{ broker: 'ibkr'\|'oanda', symbol, side: 'buy'\|'sell', qty, orderType: 'market'\|'limit'\|'stop', price?, bracket?: { tp?, sl? }, action?: 'place'\|'cancel', orderId? }` | `{ orderId, status, filled? }` | yes | IBKR MCP `create_order_instruction` (+ `get_account_orders`); OANDA REST via `OANDA_API_KEY`/`OANDA_ACCOUNT_ID` | Card shows broker, account id (last 4), symbol, side, quantity, order type, price, bracket (TP/SL / OCO), and estimated notional + margin. Requires retyping the symbol AND quantity. **Always typed-confirm regardless of driver — this spends real money.** |

**Domain 3 total: 20 capabilities (12 read, 8 write).**  Dangerous: `models.promote`, `deploy.start` (live), `broker.order`.

---

## Domain 4 — Agents & External

Ground truth: Tyler's 68-agent custom system + the ML Studio Workshop's 4 dispatchable agents
(`feature-curator`, `arch-designer`, `hpo-strategist`, `eval-reviewer` — the ones the in-repo
dispatcher actually knows, `agentDispatcher.ts:76`), plus MCP connectors (Shopify, FMP, GitHub,
ClickUp, IBKR, QuestDB, etc.) and Claude Code itself. These stay **thin** — most are
proposal-generating: an agent produces a plan/report, Tyler decides. The in-repo Agent SDK
dispatcher (`src/server/infrastructure/lib/agentDispatcher.ts`, `MAX_CONCURRENT=2`, ring-buffer
SSE replay) is the reuse target, not a new orchestrator.

### Reads

| id | kind | risk | description | args | result | stream? | wraps |
|---|---|---|---|---|---|---|---|
| `agent.list` | read | safe | List dispatchable agents (the 4 in-repo workshop agents; extensible to the 68-agent registry). | `{}` | `{ agents: Array<{ id, title, description, domain }> }` | no | the `VALID_AGENT_IDS` set in `agentDispatcher.ts:76` (+ optional read of `~/.claude/agents/`) |
| `agent.list-runs` | read | safe | List recent agent runs with status. | `{ agentId?: string, status?: string, limit?: number }` | `{ runs: Array<{ runId, agentId, status, requestedAt, completedAt }> }` | no | `agent_runs` table via the dispatcher (`getAgentRun` + a list query) |
| `agent.run-status` | read | safe | Full status + output of one agent run (with SSE replay for in-flight runs). | `{ runId: string }` | `{ runId, agentId, status, startedAt, completedAt, output, error }` | yes | `GET /api/agents/runs/:runId` (`deployment/agents.router.ts:123`); live via `/api/events/agents/:runId` replay buffer |
| `mcp.list` | read | safe | Enumerate available MCP connectors + their tools, tagged read vs write. | `{ server?: string }` | `{ servers: Array<{ name, connected, tools: Array<{ name, kind: 'read'\|'write' }> }> }` | no | ToolSearch over the deferred MCP tool registry; static classification map |

### Writes / actions

| id | kind | risk | description | args | result | stream? | wraps | Confirm UX (proposal card) |
|---|---|---|---|---|---|---|---|---|
| `agent.dispatch` | write | caution | Dispatch a subagent with an enriched context blob; returns a runId (async). | `{ agentId: 'feature-curator'\|'arch-designer'\|'hpo-strategist'\|'eval-reviewer', contextBlob: object }` | `{ runId }` (202) | yes | `POST /api/agents/dispatch` → `dispatch()` in `agentDispatcher.ts` (`agents.router.ts:92`) | Shows the agent, a summary of the context blob (symbol/timeframe/catalogId), and that it consumes 1 of `MAX_CONCURRENT=2` SDK slots. The agent's *output is itself a proposal* — it can't execute writes, only recommend. Single **Execute**. |
| `mcp.call` | write | caution/dangerous | Call a specific MCP tool. `risk` is inherited from the tool's own classification (a read tool is safe; a write tool — Shopify product update, GitHub push, broker order — is caution or dangerous). | `{ server: string, tool: string, params: object }` | `{ result: unknown }` | no | ToolSearch-loaded MCP tool invocation; classification from `mcp.list` | For read-classified tools: no card (executes like a read). For write-classified tools: card renders server, tool, resolved params, and the tool's own risk tier — a `dangerous` write tool (e.g. a live-store mutation or an order placement) escalates to typed-confirm. **Risk is never lower than the wrapped tool's own tier.** |

**Domain 4 total: 6 capabilities (4 read, 2 write).**

---

## Phase sequencing

1. **Phase 1 — Machine & Processes (the reference build).** Smallest external surface, highest
   daily value (259 processes with orphan accumulation is a live pain), and it exercises every
   pattern the terminal needs: read tiles, streaming telemetry (already wired via
   `telemetry.router.ts`), and the `caution` write→proposal-card→Execute loop (`proc.kill`,
   `svc.restart`, `temp.clean`). Build all three exposure surfaces (tile / Agent SDK tool /
   stream) here first; every later domain reuses this scaffolding verbatim.
2. **Phase 2 — All Repos.** Introduces the `RepoDescriptor` config abstraction and the tracked
   child-process launcher (`repo.run`/`repo.stop`), building directly on Phase 1's process model.
3. **Phase 3 — Data & Trading (mostly wrapping).** ~80% of these Capabilities are thin adapters
   over existing routers (`models.router.ts`, `registry.router.ts`, `hpo.router.ts`,
   `backtest.router.ts`, `deployments.router.ts`, `database-infra.router.ts`). Work here is
   registration + arg-schema mirroring, plus the first **`dangerous`** typed-confirm gates
   (`models.promote` to live, `deploy.start` live, `broker.order`).
4. **Phase 4 — Agents & External.** Thinnest layer, and deliberately last: it composes the prior
   three (an agent's whole value is proposing writes from the domains already built). Reuses the
   in-repo `agentDispatcher` and routes proposals through the same card the other domains use.

## Catalog totals

| Domain | Read | Write | Total | Dangerous |
|---|---|---|---|---|
| Machine & Processes | 12 | 3 | 15 | 0 |
| All Repos | 4 | 4 | 8 | 0 |
| Data & Trading | 12 | 8 | 20 | 3 |
| Agents & External | 4 | 2 | 6 | 0–1* |
| **Total** | **32** | **17** | **49** | **3+** |

\* `mcp.call` is dangerous only when the wrapped MCP tool is (e.g. a live-store mutation or order
placement); its tier is inherited, not fixed.
