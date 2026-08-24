# Control Terminal — Integration Map (A1: Integration Architect)

**Status:** design only — no source modified. Every path and symbol below was verified by reading the current code.
**Scope:** exactly how the new `src/server/control/` (backend) + `src/client/src/control/` (frontend) domains wire into what already exists.
**Core primitive:** a **Capability** = one typed function surfaced three ways (cockpit tile / Agent SDK tool / telemetry stream). The write-gate is enforced in ONE place — the Capability registry — so the agent-facing write tool physically cannot reach `execute()`; it files a `proposed_action` instead.

Cross-cutting design decision (the load-bearing one): **the Capability registry is the single injection hub.** It is imported by (a) the agent dispatcher to build SDK tools, (b) `control.router.ts` to auto-mount HTTP endpoints, (c) the telemetry publisher to emit streamed reads, and (d) `@shared/schema` re-exports the metadata DTO so the client renders tiles from the same source. One registry, four consumers. Nothing about a capability is declared twice.

---

## 1. Agent runtime injection — `src/server/infrastructure/lib/agentDispatcher.ts` (834 LOC)

### 1.1 What the file already is (verified)

| Concern | Symbol | Lines |
|---|---|---|
| Concurrency cap | `export const MAX_CONCURRENT = 2` | 67 |
| Job queue state | `const queue: QueueEntry[]`, `const running = new Set<string>()` | 124-125 |
| Ring buffer | `pushBuffered()`, `RING_BUFFER_MAX = 200`, `getReplayBuffer()` | 70, 227-247, 250-252 |
| Monotonic per-run id | `eventCounters` map, id assigned in `pushBuffered` | 127, 233-234 |
| Bus emission | `emitBus(runId, eventType, data)` → channel `agent.${runId}.${eventType}` | 262-275 |
| Boot recovery | `ensureBootRecovery()` — marks stale `queued`/`running` rows `failed` | 145-172 |
| SDK loader | `loadSdk()` — dynamic `import('@anthropic-ai/claude-agent-sdk')`, caches `query` | 192-209 |
| SDK type | `interface SDKQueryFn { (params:{prompt:string; options?:Record<string,unknown>}): AsyncGenerator<...> }` | 176-181 |
| Test override | `_setSdkQueryForTests()`, `getActiveSdk()` | 216-223 |
| Context enrichment | `enrichContextBlob(agentId, blob)` — pure fn, per-agent branches | 364-426 |
| Prompt build | `buildAgentPrompt(agentId, blob)` | 525-551 |
| SDK drive loop | `callSdk(runId, agentId, enrichedBlob)` | 596-706 |
| Scheduler | `scheduleTick()` / `tick()` / `runJob()` | 710-793 |
| Public dispatch | `dispatch(agentId, contextBlob): string` | 805-815 |
| Valid agents / guard | `VALID_AGENT_IDS` (4 ML agents), `isValidAgentId()` | 76-81, 797-799 |

### 1.2 How the current ML agents are dispatched (the contract the general agent must follow)

`dispatch()` (805-815) is the only entry: it calls `ensureBootRecovery()`, mints `randomUUID()`, `insertAgentRunRow()`, primes the buffer with a `queued` event via `emitBus`, pushes `{runId, agentId, contextBlob}` onto `queue`, and calls `scheduleTick()`. The worker `runJob()` (732-793) then: sets status `running` + emits `started`; calls `enrichContextBlob()`; calls `callSdk()`; on success writes `status:'completed'` + `output` (an `AgentReport`) and emits `completed`; on `AgentDispatchError` writes structured `error` JSON and emits `failed`. **The general control agent MUST use this exact path** — it is a new `agentId` value, nothing more.

### 1.3 The SINGLE injection point for registry-derived tools

Today the SDK is called at **line 622** with prompt only:

```ts
const iter = sdkFn({ prompt });            // agentDispatcher.ts:622 — NO tools passed
```

Tools already flow OUT: the assistant-message loop at **lines 636-649** already parses `b.type === 'tool_use'` and emits `emitBus(runId, 'tool_call', { tool, args, call_id })` (645-647). So the read-side telemetry (`agent.tool_call`) is already wired; only the tool DEFINITIONS are missing on the way in.

**Insertion point:** the `options` field of the `sdkFn(...)` param object (declared at 176-181 but never populated). The control tools are injected here for the general agent only. Concretely, a new private helper — `buildControlToolset(): SdkToolDef[]` — derived from the Capability registry, is passed as `options.tools` (or `options.mcpServers`, whichever the installed SDK version expects; the `options` bag is already typed `Record<string, unknown>` so no signature change is required):

- **Where to build it:** immediately before line 622, gated on `agentId === 'control'`. Keep the 4 ML agents tool-less (they stay pure advisors), so behavior for existing agents is byte-identical.
- **What each tool wraps:** for a `read`/`safe` Capability the tool calls `capability.execute(args)` directly and returns the result. For any `write` Capability the tool does **NOT** call `execute()`; it inserts a `control_proposals` row and emits `control.proposals` (see §3/§4), then returns a "proposal filed, awaiting human approval" acknowledgment. This is the mechanical write-gate — it lives in the tool-builder, which is the registry's own code, so there is exactly one place where an agent could ever touch a write and it is closed by construction.
- **Args validation:** each Capability carries a `ZodSchema<Args>` (`args`), so the tool's input schema is `zodToJsonSchema(capability.args)` and the handler re-parses with `capability.args.parse()` before doing anything.

### 1.4 Registering the new agentId — the 3 mechanical edits (implementer checklist)

1. `VALID_AGENT_IDS` (76-81) gains `'control'`. It is `satisfies readonly AgentId[]`, so `AgentId` in `@shared/schema` (line 1166) must add `'control'` first (§5).
2. The `agent_id` CHECK constraint in **two** places must add `'control'`: `enforce-sqlite-invariants.ts` `AGENT_RUNS.createSql` (line 179) and `migrations/0003_agent_runs.sql:11` (audit trail). See §4 — this is an integration RISK because a stale CHECK will reject the INSERT with a constraint error, surfacing as a 500 on dispatch.
3. `buildAgentPrompt()` (525-551) `role` map + `AgentReport`-shaped instructions gain a `'control'` branch. The control agent's system prompt tells it: observe freely, propose writes, never assume a write executed.

Everything else — queue, ring buffer, SSE replay, boot recovery, rate-limit handling, token accounting — is reused unchanged. `MAX_CONCURRENT = 2` is shared; a long-running interactive control agent will contend with ML-advisory runs for the 2 slots. **Flagged as a risk** (§7): consider a dedicated slot or raising the cap if the control agent is meant to stay resident.

### 1.5 Context-blob enrichment for the control agent

`enrichContextBlob()` (364-426) gets a `if (agentId === 'control')` branch that injects a **capability manifest** (id/title/domain/kind/risk/description for every registered Capability, and the current value of every `read` capability) so the agent's first turn already knows what it can see and propose. Reuse the existing `_unavailable` marker convention (never fabricate).

---

## 2. HTTP routing — `control.router.ts` auto-mounted from the registry

### 2.1 The mount pattern (verified)

Every router is a plain Express `Router()` default-exported and imported into `src/server/infrastructure/core/routes.ts`, then mounted with `app.use("/api", <router>)` (lines 65-93). NestJS runs as a **DI-only `ApplicationContext`** — `NestFactory.createApplicationContext(AppModule)` in `main.ts:208` — so **no `@Controller` HTTP route is ever served**. This is called out explicitly in `telemetry.router.ts:205-225` ("The Nest app runs as a DI-only ApplicationContext (no HTTP), so SystemController.@Get('manifest') is never registered — the dashboard polls /api/system/manifest, so we serve it here"). **Integration rule: all Control Terminal HTTP endpoints are Express, defined in `control.router.ts`, never NestJS `@Controller` routes.** Use Nest DI only if the domain needs a service from the container (fetched via `getNestApp().get(X)` like `telemetry.router.ts:211`).

### 2.2 `control.router.ts` — registry-derived endpoints

Instead of hand-writing one handler per capability, the router iterates the registry once at import time:

- `GET  /api/control/capabilities` → returns the metadata DTO array (id/domain/kind/risk/title/description) for the whole registry. Feeds the cockpit tile grid and the command palette.
- `GET  /api/control/capabilities/:id` → runs a `read`/`safe` capability's `execute()` and returns the result (guarded: 404 if unknown id, 400 if the capability's `kind !== 'read'`).
- `POST /api/control/execute` → body `{ id, args }`. **Human-only write path.** Validates `args` with `capability.args`, then requires the human-session token (see §2.3). Only this endpoint may call a `write` capability's `execute()`. It writes a `control_audit` row (§4) around every execution — success or failure — making the audit log append-only and complete.
- `POST /api/control/proposals/:proposalId/approve` → the click that turns an agent proposal into a real write. Loads the pending `control_proposals` row, re-validates against the live registry (the capability could have changed), requires the human-session token, calls `execute()`, writes the `control_audit` row, transitions the proposal to `approved`/`executed`, emits `control.proposals` status change.
- `POST /api/control/proposals/:proposalId/reject` → transitions to `rejected`, no execution.

Follow the existing conventions exactly: Zod `safeParse` + a `formatZodErrors` helper (copy the shape from `agents.router.ts:79-88`), `mlRateLimiter` from `../infrastructure/lib/rateLimiter` on write endpoints (as `agents.router.ts:92` does), the `no such table` → 503 escape hatch (`agents.router.ts:110-116`) so the domain degrades gracefully before its migration runs.

### 2.3 The human-session token (the autonomy invariant)

The approved design says a write executes ONLY on a human UI click carrying a human-session token. **No such token mechanism exists in the codebase yet** — this is net-new. Minimal viable integration: the client mints/holds a per-session token (server issues it on a `GET /api/control/session` bootstrap and stores its hash), and `/api/control/execute` + `/proposals/:id/approve` require it in a header (e.g. `X-Control-Session`). The agent runtime has no access to this token — it runs server-side inside `callSdk`, never sees request headers — which is the second, defense-in-depth layer under the registry write-gate. **Flagged as a risk** (§7): get the token contract nailed down before any `write` capability ships, or the whole human-in-loop guarantee is theater.

### 2.4 Wiring into bootstrap

Add two imports + two `app.use("/api", ...)` lines in `routes.ts`: `controlRouter` (REST) and `controlEventsRouter` (SSE). **Ordering matters** — mirror the agents pattern: the SSE router mounts **before** the generic `eventsRouter` (`routes.ts:89-91` mounts `eventsAgentsRouter` before `eventsRouter`) so `/api/events/control/*` isn't shadowed. Put `controlRouter` next to `agentsRouter` (after line 85).

---

## 3. Events / SSE — two new channels on the existing bus

### 3.1 The bus + contract (verified)

`src/server/infrastructure/events/event-bus.ts` is a singleton `EventBus` over `eventemitter2` with `{ wildcard:true, delimiter:'.', maxListeners:50 }` (lines 11-15). Subscribe with a pattern (`bus.on('control.*', h)`), emit a `DomainEvent` (`{ type, data, metadata }`). `getEventBus()` is the accessor (63-68). All event shapes live in `@shared/event-types.ts`; `EventMetadata.timestamp` is **epoch ms (number), not ISO** (event-types.ts:2-6 — the agent dispatcher notes this explicitly at agentDispatcher.ts:269).

### 3.2 The compression gotcha (CRITICAL — verified)

`main.ts:81-88` installs `compression()` with a filter that returns `false` for any path containing `/stream/` or `/events/`. The comment: *"Skip SSE streams (incompatible — compression buffers writes and breaks the per-event flush contract)."* **Both new SSE channels MUST live under `/api/events/control/...`** so the existing `/events/` substring exclusion covers them automatically. If a control SSE route is mounted anywhere else, gzip will buffer it and the stream will never flush per-event. This is the #1 integration risk (§7). No change to `main.ts` is needed as long as the path convention is honored.

### 3.3 The two channels

Reuse the two proven SSE patterns already in the repo:

**`control.telemetry`** — streamed reads. Follow the **multiplexed single-channel** model of `deployments.events.ts` (`GET /api/events/deployments`, one connection filters by `deployment_id` in payload; header comment lines 1-22). Route: `GET /api/events/control/telemetry`. A publisher (new, in `control/`) subscribes each `read` capability to a sampling tick and emits `{ type:'control.telemetry', data:{ capabilityId, value, ts }, metadata }`. The client filters by `capabilityId`. This matches the design's "if it's a read, it's also a telemetry stream."

**`control.proposals`** — agent-proposed writes awaiting approval. Follow the **per-subject reconnect-replay** model of `agents.events.ts`: emit `{ type:'control.proposals', data:{ proposalId, capabilityId, status, args, ts }, metadata }` on file/approve/reject. A tile UI badge updates live. Because proposals are durable rows (§4), use the **EventStore** replay path, not just the in-memory ring.

### 3.4 Reusing EventStore replay + Last-Event-ID (verified)

`deployments.events.ts` demonstrates the durable pattern the control channels should copy for proposals: one `EventStore` stream per subject (stream-id convention `deployment-<id>`, comment lines 11-14), replay via `readStream(streamId, fromPosition)` before attaching the live bus tail, and **the stored event id becomes the SSE `id:` field** so browser `EventSource` auto-resumes on reconnect via the `Last-Event-ID` header (which supersedes `?after_id`, lines 16-19). `EventStore.appendToStream` / `readStream` / `readByType` are in `event-store.ts` (48-118); append is optimistic-concurrency-guarded by `UNIQUE(stream_id, stream_position)`.

- **Proposals** → durable: append each proposal-lifecycle event to EventStore stream `control-proposal-<proposalId>`, replay on reconnect. Survives server restart (a pending proposal is still pending after a crash).
- **Telemetry** → ephemeral: telemetry reads are high-frequency and disposable; use the in-memory ring-buffer replay pattern from `agentDispatcher`/`agents.events.ts` (monotonic per-connection id, skip `id <= Last-Event-ID`), do NOT persist every sampled read to the events table (it would bloat the append-only log).

Copy the operational hardening verbatim from both SSE routers: 15s keepalive (`agents.events.ts:174-207`), `res.flushHeaders()` + `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no` (`agents.events.ts:331-335`), and `req.on('close')` cleanup that detaches the bus listener (`agents.events.ts:390-393`).

### 3.5 `@shared/event-types.ts` additions

Add two `BaseEvent` variants and fold them into the `DomainEvent` union (event-types.ts:250-258):

```ts
export type ControlEvent =
  | BaseEvent<'control.telemetry', { capabilityId: string; value: unknown; ts: number }>
  | BaseEvent<'control.proposals', {
      proposalId: string; capabilityId: string;
      status: 'pending'|'approved'|'rejected'|'executed'|'failed';
      args: Record<string, unknown>; ts: number;
    }>;
// … add `| ControlEvent` to the DomainEvent union at line 250-258
```

---

## 4. Database — two new tables, migration `0005`

### 4.1 The DB layer (verified) + gotchas

`db.ts` opens `better-sqlite3` at **`path.join(process.cwd(), "data", "ml_dashboard.db")`** (lines 11-16) — a **cwd-relative path** (RISK §7: the process must launch from the repo root or it opens/creates a different DB; the agent dispatcher's enrichment loaders are cwd-relative for the same reason, agentDispatcher.ts:279). WAL + `foreign_keys=ON` + `busy_timeout=5000` (20-22). `export const db = drizzle(sqlite, { schema })` (41). A separate read-only connection `dbReadOnly` (45-47) exists for the explorer — **the control read endpoints could reuse `dbReadOnly` for any DB-backed read capability**, keeping writes physically impossible on that path (defense-in-depth mirroring the registry gate).

**The migration reality (verified, `migrations/README.md`):** the ONLY wired DB-build script is `npm run db:push` (drizzle-kit push), which introspects `schema.ts` and emits its own DDL — **it never reads the `migrations/` folder**, and **it cannot express CHECK constraints or partial unique indexes**. The `migrations/*.sql` files are a hand-maintained audit trail. The real enforcement of CHECK constraints is `enforce-sqlite-invariants.ts`, run on **every server boot** from `db.ts:30-39`. So a new table with a CHECK constraint must be declared in **three** places to be correct and self-healing:

1. **`src/shared/schema.ts`** — the Drizzle table (source of truth for `db:push`, columns only).
2. **`migrations/0005_control_terminal.sql`** (+ `.down.sql`) — the human-readable audit trail with full CHECK DDL (next number after `0004_untracked_ml_tables.sql`).
3. **`enforce-sqlite-invariants.ts`** — a new `RebuildableTable` entry per table, added to the `TABLES` array (line 204), so the CHECK constraints are created/retrofitted idempotently on boot. Follow the `AGENT_RUNS` entry (174-202) as the exact template: `name`, `createSql` (with `CHECK`), `columns` (DDL order, for the INSERT…SELECT rebuild), `auxSql` (indexes with `IF NOT EXISTS`).

### 4.2 `control_audit` (append-only execution + proposal log)

```sql
CREATE TABLE IF NOT EXISTS control_audit (
  audit_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  capability_id  TEXT NOT NULL,
  domain         TEXT NOT NULL CHECK (domain IN ('machine','repo','data','agent')),
  kind           TEXT NOT NULL CHECK (kind IN ('read','write')),
  risk           TEXT NOT NULL CHECK (risk IN ('safe','caution','dangerous')),
  actor          TEXT NOT NULL CHECK (actor IN ('human','agent')),
  source         TEXT NOT NULL CHECK (source IN ('tile','proposal','api')),
  proposal_id    TEXT,                 -- FK-ish to control_proposals when source='proposal'
  args           TEXT NOT NULL,        -- JSON
  result         TEXT,                 -- JSON, nullable on failure
  status         TEXT NOT NULL CHECK (status IN ('ok','error')),
  error          TEXT,
  session_hash   TEXT,                 -- hash of the human-session token that authorized a write
  executed_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_control_audit_capability ON control_audit(capability_id);
CREATE INDEX IF NOT EXISTS idx_control_audit_executed_at ON control_audit(executed_at DESC);
```

Append-only by convention (never UPDATE/DELETE) — the write endpoint (§2.2) inserts one row around every `execute()`. `actor='agent'` is only ever paired with `kind='read'` (agents can't write) — an invariant the endpoint enforces, not the schema.

### 4.3 `control_proposals` (pending agent proposals, status lifecycle)

```sql
CREATE TABLE IF NOT EXISTS control_proposals (
  proposal_id    TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL,        -- the agent_runs.run_id that filed it
  capability_id  TEXT NOT NULL,
  args           TEXT NOT NULL,        -- JSON, already validated against capability.args
  rationale      TEXT,
  status         TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','executed','failed','expired')),
  created_at     TEXT NOT NULL,
  decided_at     TEXT,
  decided_by     TEXT,                 -- session hash of the human who approved/rejected
  audit_id       INTEGER               -- set to the control_audit row once executed
);
CREATE INDEX IF NOT EXISTS idx_control_proposals_status ON control_proposals(status);
CREATE INDEX IF NOT EXISTS idx_control_proposals_run ON control_proposals(run_id);
```

Lifecycle: `pending` (filed by the agent tool in §1.3) → `approved` → `executed` (or `failed`) on the UI-click path (§2.2), or → `rejected`. Each transition emits `control.proposals` (§3.3) and appends to EventStore stream `control-proposal-<proposalId>` (§3.4).

Drizzle mirrors in `schema.ts` (place near `agentRuns`, ~line 1234) using `text(..., { enum: [...] })` for the enum columns (narrows TS types; the CHECK DDL comes from `enforce-sqlite-invariants.ts` as documented at schema.ts:1158-1160). Export `InferSelectModel` / `InferInsertModel` types (`ControlAuditRow`, `ControlProposalRow`) and `createInsertSchema(...)` Zod inserts, exactly as `agentRuns` does at 1254-1256.

---

## 5. Shared contracts — `src/shared/schema.ts` + `@shared/event-types.ts`

`src/shared/` is the ONE source of truth imported by both server (`@shared/schema`, `@shared/event-types`) and client. It must stay **client-free** (no client imports — schema.ts:1183-1184 notes this constraint). Everything the Control Terminal needs on both sides goes here:

1. **`Capability` metadata DTO** — the wire-safe subset (NO `execute`, NO Zod object — those are server-only). The interface from the brainstorm minus the function:
   ```ts
   export type ControlDomain = 'machine'|'repo'|'data'|'agent';
   export type ControlKind = 'read'|'write';
   export type ControlRisk = 'safe'|'caution'|'dangerous';
   export interface CapabilityMeta {
     id: string; domain: ControlDomain; kind: ControlKind; risk: ControlRisk;
     title: string; description: string;
     argsSchema?: unknown;   // JSON-schema form of the Zod args, for client form-gen
   }
   ```
   The full `Capability<Args,Result>` (with `execute` + live `ZodSchema`) is defined ONLY in `src/server/control/` — it never crosses to the client. `GET /api/control/capabilities` (§2.2) serializes registry entries down to `CapabilityMeta`.
2. **`ProposedAction` contract** — `{ proposalId, capabilityId, args, rationale, status }` (mirrors the `control_proposals` row, minus internal columns). Note this is a NEW, general contract; the ML agents' existing `AgentProposedAction` (schema.ts:1205-1209) is a different, stage-specific shape — do **not** conflate them.
3. **`ControlAuditEntry`** — the `InferSelectModel<typeof controlAudit>` export (§4.2).
4. **SSE payload shapes** — the `ControlEvent` union in `@shared/event-types.ts` (§3.5).
5. **`AgentId` extension** — add `'control'` to the union at schema.ts:1166 (required by §1.4). Then the CHECK constraint updates in §4/§1.4 keep DB and type in sync.

---

## 6. Frontend wiring — `src/client/src/control/`

### 6.1 Nav + route (verified)

`src/client/src/shared/hooks/navigation.ts` exports `NAVIGATION_CONFIG: NavGroup[]` (65-192); each `NavGroup` has `{ title, items: NavItem[] }`; `NavItem` is `{ icon: LucideIcon; label; href; description?; pending? }` (48-58). `ROUTE_META` (230) and `ALL_NAV_ITEMS` (234) are derived from it — adding a group updates the command palette and breadcrumbs for free. Add a **"Control"** group (a new top-level entry, natural fit next to "System") with items like `{ icon: <lucide icon>, label: "Control", href: "/control", description: "…" }`. Import the icon from `lucide-react` (the existing import block, 25-46).

`App.tsx` routing (verified): pages are `lazyRetry(factory, name)` + `registerComponentFactory(path, factory)` (27-45, 50-142), rendered through the `AppRoute` helper (149-161) inside a `wouter` `<Switch>` (163-209). Add:
```ts
const ControlFactory = () => import("@/control/ControlPage");
const Control = lazyRetry(ControlFactory, "Control");
registerComponentFactory("/control", ControlFactory);
// … inside <Switch>: <AppRoute path="/control" component={Control} />
```
Vite alias `@/` → `src/client/src/`, so the new domain lives at `src/client/src/control/` (domain-driven-flat, its own `README.md`).

### 6.2 Client → capabilities: `useCapability` (typed client over the auto-mounted endpoints)

A new hook family in `src/control/lib/`, mirroring the existing `fetch` conventions in `useAgentDispatch.ts:202-213`:
- `useCapabilities()` → `GET /api/control/capabilities`, TanStack Query cached (the app already provides `QueryClientProvider`, App.tsx:258) — drives the tile grid from `CapabilityMeta[]`.
- `useCapability(id)` → for a `read` capability, `GET /api/control/capabilities/:id`; polls or subscribes to `control.telemetry` for live value.
- `runCapability(id, args)` → `POST /api/control/execute` with the `X-Control-Session` header (§2.3). This is the human-click write path; a tile's button calls it. It surfaces the `control_audit` result.
- `approveProposal(id)` / `rejectProposal(id)` → the proposal-decision endpoints (§2.2).

### 6.3 `useControlStream` (SSE, mirrors the existing hooks)

New hook mirroring **`useDeploymentEvents.ts`** for the multiplexed telemetry channel and **`useAgentDispatch.ts`** for per-run/proposal handling:
- Own the `EventSource` in a `useRef` (never state — `useDeploymentEvents.ts:191`), close on unmount (the W7 leak rule, lines 436-443), exponential backoff 1s→30s on error (118-125, 410-431), wrap state writes in `startTransition` (215-221) so high-frequency telemetry never blocks input.
- Subscribe to `/api/events/control/telemetry` and `/api/events/control/proposals`; unwrap the `{ type, data, metadata }` envelope exactly like `wireEnveloped` (useDeploymentEvents.ts:382-398) and the replay-unwrap helper (`unwrapReplay`, useAgentDispatch.ts:85-91). For proposals, honor the `Last-Event-ID` reconnect-replay (the browser sends it automatically; the server replays from EventStore per §3.4).

The general control agent's own run (an `agent_runs` row with `agentId:'control'`) is observed with the **existing** `useAgentDispatch()` unchanged — it already streams `agent.token_chunk` / `agent.tool_call` / `agent.completed` (useAgentDispatch.ts:176-179). The control agent's `tool_call` events (proposals + reads) already ride that stream; `useControlStream` is only for the domain-level telemetry + proposal-inbox channels that outlive a single agent run.

---

## 7. Top integration risks (implementer must-reads)

1. **SSE compression exclusion is path-based, not route-based.** `main.ts:81-88` skips gzip only for paths containing `/events/` (or `/stream/`). Any control SSE endpoint mounted off that convention will be silently gzip-buffered and never flush per-event — the stream will appear "hung." Mount BOTH channels under `/api/events/control/...`. No `main.ts` edit needed if honored; a broken path is invisible until a browser tab hangs.
2. **The human-session token is net-new and load-bearing.** Nothing in the repo issues or checks a per-session write token today. The entire "writes execute only on a human click" guarantee reduces to this token plus the registry write-gate (§1.3). If the token contract isn't finished before the first `write` capability ships, the autonomy invariant is unenforced. Enforce it in `/api/control/execute` and `/proposals/:id/approve`; keep it unreachable from `callSdk` (server-side, no request headers).
3. **Three-place CHECK-constraint + AgentId sync.** `db:push` cannot emit CHECK constraints, and `enforce-sqlite-invariants.ts` runs on every boot from a hardcoded `TABLES` array. Adding `agentId:'control'` or the two new tables in only `schema.ts` will pass `db:push` but the boot-time invariant hook (and the `0003` CHECK) will still reject the new agent_id / lack the new CHECK — surfacing as a constraint-violation 500 on the very first control dispatch or write. Update all three: `schema.ts`, `migrations/000{3,5}_*.sql`, and `enforce-sqlite-invariants.ts` (`AGENT_RUNS.createSql` CHECK + a new `RebuildableTable` per table). Secondary: the DB path is cwd-relative (`process.cwd()`), so launch from the repo root.
