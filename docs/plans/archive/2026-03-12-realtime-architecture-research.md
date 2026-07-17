# Real-Time Architecture Research: GraphQL, WebSocket, SSE, Event Bus, State Machines

**Date:** 2026-03-12
**Context:** Quant AI Dashboard — Electron desktop app (single user, localhost), Express 5 + NestJS hybrid, 11 REST routers, existing WebSocket (PTY terminal), 3-DB architecture (QuestDB, SQLite, PostgreSQL)

---

## 1. GraphQL vs REST for This Use Case

### Verdict: Stay with REST. GraphQL is not worth the migration cost.

**Why GraphQL does NOT fit this project:**

- **Single consumer, single user.** GraphQL's primary value — letting multiple clients request exactly the data shapes they need — is irrelevant when you have one frontend consuming one backend on localhost.
- **11 routers already working.** Migrating `instruments`, `indicators`, `ml`, `news`, `databases`, `charts`, `training`, `training-control`, `training-artifacts`, `upload`, `terminal` to GraphQL resolvers is pure refactoring overhead with no functional gain.
- **N+1 query problem becomes YOUR problem.** With REST you control exactly what SQL runs. With GraphQL, dynamic queries against QuestDB time-series data would require careful DataLoader implementation to avoid performance regressions.
- **23% higher CPU utilization.** GraphQL's query parsing/execution planning overhead is measurable. On localhost this doesn't matter much, but it's cost with zero benefit.
- **HTTP caching breaks.** REST `GET` endpoints work with browser cache, ETags, `Cache-Control`. GraphQL uses `POST` for everything — you'd need Apollo Client's normalized cache or manual cache management.
- **Tooling complexity.** Schema definition, code generation, resolver boilerplate, playground setup — all for a single-user app.

**When GraphQL WOULD be worth it:**
- If you had a mobile app + web app + CLI all consuming the same API with different data needs
- If you needed a self-documenting API for third-party consumers
- If your data model had deep, nested relationships that clients traverse differently

**Concrete recommendation:** Keep your 11 Express routers. Add Swagger/OpenAPI via `@nestjs/swagger` (already installed) for documentation. Use Zod schemas for request/response validation (already in your deps). This gives you type safety and documentation without GraphQL's overhead.

**What the community says:**
- WunderGraph: "We deprecated GraphQL subscriptions over WebSocket in favor of SSE"
- Postman: "If your API is simple, the overhead of GraphQL might not be worth it"
- Multiple sources: "REST is best for simplicity, broad compatibility, and adherence to HTTP standards"

---

## 2. SSE vs WebSocket for Server-Push

### Verdict: SSE for most server-push. WebSocket only for PTY terminal (already done).

| Feature | SSE | WebSocket |
|---------|-----|-----------|
| Direction | Server -> Client only | Bidirectional |
| Protocol | HTTP (standard) | WS (upgrade) |
| Auto-reconnect | Built-in (EventSource API) | Manual implementation |
| HTTP/2 multiplexing | Yes — many SSE streams on 1 TCP connection | No — dedicated TCP per WS |
| Binary data | No (text/JSON only) | Yes (ArrayBuffer, Blob) |
| Connection limit (HTTP/1.1) | 6 per browser+domain | No limit |
| Connection limit (HTTP/2) | ~100 concurrent streams (negotiable) | No limit |
| Per-message overhead | ~5 bytes | ~2 bytes |
| Browser API | EventSource (simple) | WebSocket (more code) |
| Authentication | Automatic (cookies, headers per request) | Manual (token in URL or first message) |
| Firewall compatibility | Perfect (standard HTTP) | Sometimes blocked |
| Memory overhead | Lower (no frame buffer management) | Higher (bidirectional state) |

### SSE Wins for This Project Because:

1. **Auto-reconnect is huge.** EventSource automatically reconnects with `Last-Event-ID`. WebSocket reconnection requires manual retry logic, exponential backoff, and state reconciliation.

2. **HTTP/2 multiplexing.** Multiple SSE channels (training progress, model metrics, health status, cache invalidation) all multiplex over a single TCP connection. Each `new EventSource('/api/sse/training')` reuses the same HTTP/2 connection.

3. **Simpler server code.** NestJS has built-in `@Sse()` decorator returning `Observable<MessageEvent>`. No gateway classes, no adapter configuration.

4. **Authentication is free.** Each SSE request is a normal HTTP request — cookies and headers work automatically. WebSocket requires token-in-URL or a handshake protocol.

### Binary Data: Not a Problem

ML model outputs (weights, tensors, feature vectors) are NOT streamed to the frontend in real-time. They're stored server-side and accessed via REST endpoints when the UI needs them. What IS streamed is:
- Training progress (JSON: epoch, loss, metrics) -> SSE
- Log lines (text) -> SSE
- System health (JSON: CPU, memory, DB status) -> SSE
- Cache invalidation signals (JSON: query key) -> SSE

None of these need binary transport.

### When to Keep WebSocket:

**PTY terminal only** (already implemented at `/ws/terminal/:sessionId`). This is genuinely bidirectional — user types keystrokes, terminal emits output, resize events flow both ways. This is the correct use of WebSocket.

---

## 3. Bidirectional Communication: When Do You Actually NEED WebSocket?

### Training Control (pause/resume/stop)

**Answer: REST mutations + SSE push. NOT WebSocket.**

Current implementation in `training-control.ts` already does this correctly:
- `POST /api/training/start` -> spawns process
- `POST /api/training/stop` -> kills process
- `GET /api/training/process-status` -> polls status

**Improvement:** Replace polling with SSE. The pattern becomes:
```
Client: POST /api/training/start    (REST mutation)
Server: SSE /api/sse/training       (push progress events)
Client: POST /api/training/stop     (REST mutation)
Server: SSE sends { type: 'stopped' } (push final event)
```

This is NOT bidirectional. It's command (REST) + notification (SSE). WebSocket would add complexity with no benefit.

### Live Model Inference

**Answer: REST request/response for single predictions. SSE for batch/streaming inference.**

- Single inference: `POST /api/inference` with input features, get prediction back. Standard request/response.
- Streaming inference (e.g., running model over 10K bars): SSE stream of predictions as they compute.
- Neither requires WebSocket.

### Interactive Chart Replay

**Answer: SSE + REST handles this.**

Chart replay = sequentially rendering historical data at accelerated speed. The pattern:
- `POST /api/replay/start` with date range and speed (REST mutation)
- `GET /api/sse/replay` SSE stream of OHLCV bars at configured speed
- `POST /api/replay/pause` or `POST /api/replay/speed` (REST mutation)

The client never sends data TO the server mid-stream — it sends commands (start, stop, speed) that are naturally REST mutations.

### The Only True Bidirectional Need: PTY Terminal

Already implemented with `ws` library. No changes needed.

---

## 4. GraphQL Subscriptions vs Raw WebSocket vs SSE

### Overhead Comparison

| Transport | Dependencies | Connection Setup | Per-Message Overhead | Auth Model |
|-----------|-------------|-----------------|---------------------|------------|
| SSE (native) | 0 deps | Standard HTTP request | ~5 bytes + JSON | HTTP headers/cookies |
| `graphql-sse` | 1 dep (zero sub-deps) | Standard HTTP request | ~5 bytes + GraphQL envelope | HTTP headers/cookies |
| `graphql-ws` | 1 dep (zero sub-deps) | WS upgrade + GQL handshake | ~2 bytes + GQL envelope | Manual token exchange |
| Raw `ws` | 1 dep | WS upgrade | ~2 bytes + your framing | Manual |
| Socket.IO | Many deps (~40) | HTTP polling -> WS upgrade | Significant (protocol overhead) | Middleware-based |

### Latency

For localhost communication, the transport layer latency difference is negligible (sub-millisecond). The dominant factor is your application code, not whether you use SSE vs WebSocket.

The `graphql-ws` maintainer has stated: "I haven't really benchmarked graphql-ws." There are no published benchmarks comparing its overhead to raw `ws`. However, GraphQL itself adds measurable overhead: "Benchmarks show a 2-3x latency increase" from promise instantiation in the resolver chain.

### Recommendation

**Use native SSE (no library needed).** NestJS's `@Sse()` decorator + `Observable<MessageEvent>` is zero-dependency server push. On the client, `EventSource` is a browser native. No GraphQL subscription overhead, no WebSocket management, no library to maintain.

**Library: `graphql-sse` v2.6.0** — Only consider if you later adopt GraphQL. It's from The Guild (same maintainer as `graphql-ws`), zero dependencies, implements the GraphQL-over-SSE protocol spec. But you don't need GraphQL, so you don't need this.

---

## 5. NestJS Integration Assessment

### Current Architecture (Hybrid Express + NestJS DI)

Your `main.ts` runs NestJS as a DI container only (`createApplicationContext`), with Express handling HTTP. This is a valid pattern but means NestJS's HTTP decorators (`@Controller`, `@Get`, `@Sse`, `@WebSocketGateway`) don't work — they need a full NestJS HTTP app.

### What NestJS Supports Natively

| Feature | Support | Library | Notes |
|---------|---------|---------|-------|
| GraphQL (Apollo) | First-class | `@nestjs/graphql` + `@apollo/server` | Code-first or schema-first |
| GraphQL (Mercurius) | First-class | `@nestjs/graphql` + `mercurius` | Fastify only, 60% faster than Apollo |
| GraphQL (Yoga) | Community | `@graphql-yoga/nestjs` | Best SSE subscription support |
| WebSocket (Socket.IO) | First-class | `@nestjs/websockets` + `@nestjs/platform-socket.io` | Heavy, not recommended for this app |
| WebSocket (raw ws) | First-class | `@nestjs/websockets` + `@nestjs/platform-ws` | Lightweight, what you want |
| SSE | Built-in | None needed | `@Sse()` decorator returns `Observable<MessageEvent>` |
| All three coexisting | Yes | — | Same Express/Fastify server, different paths |

### Can All Three Coexist?

**Yes.** On the same Express server:
- REST: `@Controller()` with `@Get()`, `@Post()`, etc.
- SSE: `@Controller()` with `@Sse()` returning `Observable<MessageEvent>`
- WebSocket: `@WebSocketGateway()` using `@nestjs/platform-ws` (raw ws)

They bind to different path patterns and protocol handlers on the same `httpServer`.

### Migration Path for SSE

To use NestJS's `@Sse()` decorator, you'd need to transition from `createApplicationContext` to a full NestJS HTTP app (`NestFactory.create()`). This is a bigger architectural shift. **Alternative:** implement SSE directly in your Express routers using native `res.writeHead()` + `res.write()` — no NestJS HTTP app needed.

### Express-Native SSE Pattern (No NestJS HTTP Migration)

```typescript
// In any Express router
router.get('/sse/training', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const onProgress = (data: TrainingProgress) => {
    res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
  };

  eventBus.on('training.progress', onProgress);
  req.on('close', () => eventBus.off('training.progress', onProgress));
});
```

This works TODAY with your existing architecture. No migration needed.

---

## 6. Event Bus Patterns for In-Process Communication

### Verdict: EventEmitter2 with TypeScript wrapper. No message broker needed.

### Why NOT a Message Broker (Redis/NATS)

A message broker is designed for:
- Multi-process communication (you have ONE Node process)
- Multi-machine communication (you run on localhost)
- Message durability across restarts (you don't need this — SQLite/QuestDB are your durable stores)
- Fan-out to multiple consumers across network (your consumers are in-process)

Redis Pub/Sub or NATS would add an external process dependency, network overhead, and operational complexity for zero benefit in a single-user Electron app.

### Library Comparison

| Library | Version | Weekly Downloads | Size | TypeScript | Features |
|---------|---------|-----------------|------|-----------|----------|
| `eventemitter2` | 6.4.9 | ~10M | 22 KB | Built-in types | Wildcards, namespaces, TTL, async listeners |
| `rxjs` | 7.8.x | ~45M | 53 KB (tree-shakeable) | Native TS | Operators, backpressure, composability |
| `EventEmitter` (Node built-in) | N/A | N/A | 0 KB | Via `@types/node` | Basic, no wildcards |
| `mitt` | 3.0.1 | ~4M | 200 bytes | Built-in types | Minimal, typed events |
| `typed-emitter` | 2.1.0 | ~2M | 1 KB | Purpose-built | Type-safe wrapper for Node EventEmitter |

### Recommended: EventEmitter2 + Typed Wrapper

EventEmitter2 gives you wildcards (`training.*` matches `training.progress`, `training.complete`, `training.error`) and namespace support. Wrap it with TypeScript for type safety:

```typescript
// src/server/lib/eventBus.ts
import { EventEmitter2 } from 'eventemitter2';

// Define all events and their payloads
interface AppEvents {
  'training.progress': { runId: string; epoch: number; loss: number; metrics: Record<string, number> };
  'training.complete': { runId: string; duration: number; finalMetrics: Record<string, number> };
  'training.error':    { runId: string; error: string };
  'training.stopped':  { runId: string; reason: 'user' | 'error' | 'timeout' };
  'cache.invalidate':  { queryKeys: string[] };
  'model.updated':     { modelId: string; version: number };
  'health.status':     { service: string; healthy: boolean; latency?: number };
}

class TypedEventBus {
  private emitter = new EventEmitter2({ wildcard: true, delimiter: '.' });

  emit<K extends keyof AppEvents>(event: K, data: AppEvents[K]): void {
    this.emitter.emit(event, data);
  }

  on<K extends keyof AppEvents>(event: K, handler: (data: AppEvents[K]) => void): void {
    this.emitter.on(event, handler);
  }

  off<K extends keyof AppEvents>(event: K, handler: (data: AppEvents[K]) => void): void {
    this.emitter.off(event, handler);
  }

  // Wildcard support
  onAny(handler: (event: string, data: unknown) => void): void {
    this.emitter.onAny(handler);
  }
}

// Singleton — single process, single instance
export const eventBus = new TypedEventBus();
```

### Why NOT RxJS as the Event Bus

RxJS is already in your project (NestJS depends on it), but using it as an event bus means:
- `Subject` instances for each event type (verbose)
- Subscription management (`.unsubscribe()` everywhere or memory leaks)
- Operator chains are powerful but overkill for simple pub/sub
- No wildcard pattern matching

**Use RxJS where it excels:** inside NestJS's `@Sse()` handlers to transform event bus emissions into SSE `Observable<MessageEvent>` streams. Use EventEmitter2 as the event bus itself.

---

## 7. Saga / Orchestrator Patterns

### NestJS CQRS Module (`@nestjs/cqrs`)

**What it provides:**
- `CommandBus` — dispatch commands to handlers
- `QueryBus` — dispatch queries to handlers
- `EventBus` — publish domain events
- `@Saga()` decorator — RxJS pipe that maps events to commands

**Example saga:**
```typescript
@Saga()
trainingWorkflow = (events$: Observable<IEvent>) =>
  events$.pipe(
    ofType(TrainingStartedEvent),
    mergeMap(event =>
      this.runTrainingSteps(event).pipe(
        catchError(err => of(new CompensateTrainingCommand(event.runId)))
      )
    )
  );
```

**Assessment for this project:** Useful but heavyweight for a single-user app. The CQRS pattern shines when you have multiple bounded contexts with complex domain events. Your training pipeline is more of a linear workflow than a saga.

### XState for Training Workflows

**Better fit than CQRS sagas.** XState models the training lifecycle as an explicit state machine:

```
idle -> configuring -> validating -> training -> evaluating -> complete
                                        |            |
                                        v            v
                                     paused       failed
                                        |
                                        v
                                    training (resume)
```

This is more natural than saga event chains because:
- States are explicit and visualizable (Stately.ai visual editor)
- Transitions are guarded (can't "pause" from "idle")
- Side effects are tied to state entries/exits
- The machine definition is shareable between frontend (show state in UI) and backend (enforce transitions)

### Recommendation

Skip `@nestjs/cqrs` for now. Use **XState** for complex workflows (training pipeline) and **EventEmitter2** for simple event dispatch (cache invalidation, health updates).

---

## 8. State Machine Libraries

### XState v5

| Attribute | Value |
|-----------|-------|
| Version | 5.19.x (latest) |
| Bundle size | ~48 KB min, ~14 KB gzipped |
| Dependencies | 0 |
| TypeScript | Native (written in TS) |
| Weekly downloads | ~3M |
| GitHub stars | 27K+ |
| Maintenance | Active (Stately.ai company) |
| License | MIT |

**Key v5 changes:**
- Actor model is the core primitive (machines are a type of actor)
- `createActor()` replaces `interpret()`
- `actor.getSnapshot()` for reading state
- Built-in persistence: `actor.getPersistedSnapshot()` and `createActor(machine, { snapshot })` for rehydration
- Event sourcing: replay events via inspect API to restore state
- `@xstate/store` — lightweight event-sourced store (alternative to full machines)

**Server-side usage:**
XState works identically in Node.js and browser. No DOM dependencies. The machine definition is pure logic — create it once, share between frontend (for UI state display) and backend (for workflow enforcement).

**Persistence pattern:**
```typescript
// Save state to SQLite
const snapshot = actor.getPersistedSnapshot();
await db.run('UPDATE training_runs SET state = ? WHERE id = ?',
  JSON.stringify(snapshot), runId);

// Restore on restart
const saved = await db.get('SELECT state FROM training_runs WHERE id = ?', runId);
const actor = createActor(trainingMachine, {
  snapshot: JSON.parse(saved.state)
}).start();
```

### Alternatives

| Library | Size (gzipped) | TypeScript | Stars | Notes |
|---------|---------------|-----------|-------|-------|
| **XState v5** | ~14 KB | Native | 27K | Industry standard, visual editor, actor model |
| **Robot3** | ~1.2 KB | Yes | 1.8K | Minimal, functional API, no visual tooling |
| **@xstate/store** | ~2 KB | Native | (part of XState) | Event-sourced store, no state machine formalism |

**Recommendation: XState v5.** The visual editor at stately.ai/editor is a genuine productivity advantage — you can design training workflow state machines visually, export TypeScript, and share the visualization with yourself when debugging. Robot3 is smaller but has no ecosystem or tooling.

---

## 9. Cache Invalidation via Events

### In-Memory Cache Library

**Recommendation: `lru-cache` v11.x**

| Attribute | Value |
|-----------|-------|
| Version | 11.2.6 |
| Weekly downloads | ~300M+ |
| Size | ~20 KB |
| Dependencies | 0 |
| TypeScript | Built-in types |
| Maintainer | Isaac Z. Schlueter (npm creator) |

**Why lru-cache:**
- Zero dependencies
- LRU eviction (bounded memory — critical for long-running Electron app)
- TTL support (optional, per-entry or global)
- `allowStale` option (serve stale while revalidating)
- Async `fetch()` method (cache-aside pattern built in)
- TypeScript generics for key/value types

**Configuration for this project:**
```typescript
import { LRUCache } from 'lru-cache';

// Per-route caches with appropriate TTLs
const indicatorCache = new LRUCache<string, IndicatorResult[]>({
  max: 500,                    // max entries
  ttl: 1000 * 60 * 5,         // 5 min TTL
  allowStale: true,            // serve stale while fetching
  ttlAutopurge: false,         // don't waste CPU on background cleanup
});

const instrumentCache = new LRUCache<string, Instrument[]>({
  max: 100,
  ttl: 1000 * 60 * 60,        // 1 hour (instruments change rarely)
});
```

### Event-Driven Cache Invalidation Pattern

Connect the event bus to cache invalidation:

```typescript
// When training completes, invalidate related caches
eventBus.on('training.complete', ({ runId }) => {
  modelCache.delete(runId);
  metricsCache.clear();  // training changes all metrics
});

// When data is uploaded, invalidate instrument/indicator caches
eventBus.on('data.uploaded', ({ symbol }) => {
  indicatorCache.delete(`${symbol}:*`);  // pattern delete
  instrumentCache.clear();
});

// Generic invalidation event
eventBus.on('cache.invalidate', ({ queryKeys }) => {
  queryKeys.forEach(key => {
    indicatorCache.delete(key);
    modelCache.delete(key);
  });
});
```

### TanStack Query External Cache Sync

**Pattern from TkDodo (TanStack Query maintainer):**

The recommended approach is "push invalidation commands, not data":

```typescript
// Client-side: listen to SSE and invalidate TanStack Query cache
const eventSource = new EventSource('/api/sse/cache');

eventSource.addEventListener('invalidate', (event) => {
  const { queryKeys } = JSON.parse(event.data);
  queryKeys.forEach(key => {
    queryClient.invalidateQueries({ queryKey: [key] });
  });
});

// For partial updates (high-frequency data like live metrics):
eventSource.addEventListener('update', (event) => {
  const { queryKey, data } = JSON.parse(event.data);
  queryClient.setQueryData([queryKey], data);  // direct cache update
});
```

**Key insight from TkDodo:** If you receive an invalidation for an entity you're not currently viewing, `invalidateQueries` simply marks it stale — it won't refetch until the user navigates to that page. This prevents wasted network calls.

**StaleTime configuration:** Since the server pushes invalidations, set a high `staleTime` (e.g., `Infinity`) so TanStack Query never refetches on its own — all refetches are triggered by SSE invalidation events:

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,          // Never auto-stale
      refetchOnWindowFocus: false,  // Electron: no tab switching
      refetchOnReconnect: false,    // SSE handles reconnection
    },
  },
});
```

---

## Summary: Recommended Architecture

```
[React Frontend]
    |
    |-- REST (fetch/TanStack Query) --> Express Routers (11 existing)
    |-- SSE  (EventSource)          --> Express SSE endpoints (new)
    |-- WS   (WebSocket)            --> PTY Terminal only (existing)
    |
[Express 5 + NestJS DI]
    |
    |-- EventEmitter2 (typed event bus) -- in-process pub/sub
    |-- lru-cache (server-side cache)   -- invalidated via event bus
    |-- XState (training workflow)      -- state machine + persistence
    |
[Databases]
    |-- QuestDB (time-series)
    |-- SQLite  (app state, training runs, XState snapshots)
    |-- PostgreSQL (relational)
```

### What to Add

| Component | Library | Version | Size | Purpose |
|-----------|---------|---------|------|---------|
| Event bus | `eventemitter2` | 6.4.9 | 22 KB | In-process typed pub/sub |
| Server cache | `lru-cache` | 11.2.6 | 20 KB | Bounded in-memory cache with TTL |
| State machine | `xstate` | 5.19.x | 48 KB (14 KB gz) | Training workflow orchestration |
| SSE | Native (Express) | N/A | 0 KB | Server-push for progress/invalidation |

**Total new dependency weight: ~90 KB uncompressed. Zero external services.**

### What NOT to Add

| Component | Why Not |
|-----------|---------|
| GraphQL | 11 REST routers work fine. Single consumer. No benefit. |
| Socket.IO | Heavy (~40 deps), rooms/namespaces not needed. Raw `ws` already used for PTY. |
| Redis/NATS | External process for in-process communication. Overkill. |
| `@nestjs/cqrs` | Full CQRS is heavyweight. XState handles workflows better for this scale. |
| GraphQL subscriptions | No GraphQL = no GraphQL subscriptions. SSE is simpler. |
| Mercurius | Fastify-only. You're on Express. |

---

## Sources

### GraphQL vs REST
- [GraphQL vs REST: Key Differences — Strapi](https://strapi.io/blog/graphql-vs-rest)
- [GraphQL vs REST API Comparison 2025 — API7](https://api7.ai/blog/graphql-vs-rest-api-comparison-2025)
- [GraphQL vs REST Statistics 2025 — JSONConsole](https://jsonconsole.com/blog/rest-api-vs-graphql-statistics-trends-performance-comparison-2025)
- [Electron GraphQL Boilerplate — GitHub](https://github.com/yoDon/electron-graphql)

### SSE vs WebSocket
- [SSE Beat WebSockets for 95% of Apps — DEV](https://dev.to/polliog/server-sent-events-beat-websockets-for-95-of-real-time-apps-heres-why-a4l)
- [WebSockets vs SSE Practical Guide — Medium](https://medium.com/@sulmanahmed135/websockets-vs-server-sent-events-sse-a-practical-guide-for-real-time-data-streaming-in-modern-c57037a5a589)
- [SSE vs WebSocket Comparison — WebSocket.org](https://websocket.org/comparisons/sse/)
- [SSE vs WebSocket Performance 2025 — Bedda.tech](https://www.metatech.dev/blog/2025-05-18-websocket-apis-vs-server-sent-events-performance-battle-2025)
- [Understanding SSE and HTTP/2 — DEV](https://dev.to/abhivyaktii/understanding-server-sent-events-sse-and-why-http2-matters-1cj7)
- [SSE Instead of WebSockets over HTTP/2 — Smashing Magazine](https://www.smashingmagazine.com/2018/02/sse-websockets-data-flow-http2/)

### GraphQL Subscriptions & SSE
- [Deprecate GraphQL Subscriptions over WebSocket — WunderGraph](https://wundergraph.com/blog/deprecate_graphql_subscriptions_over_websockets)
- [GraphQL over SSE — The Guild](https://the-guild.dev/blog/graphql-over-sse)
- [graphql-sse Library — npm](https://www.npmjs.com/package/graphql-sse)
- [GraphQL Yoga Comparison — The Guild](https://the-guild.dev/graphql/yoga-server/docs/comparison)

### NestJS Integration
- [NestJS WebSocket Gateways — Docs](https://docs.nestjs.com/websockets/gateways)
- [NestJS WebSocket Adapter — Docs](https://docs.nestjs.com/websockets/adapter)
- [NestJS SSE Implementation — Sling Academy](https://www.slingacademy.com/article/how-to-push-server-sent-events-sse-in-nestjs/)
- [NestJS GraphQL Quick Start — Docs](https://docs.nestjs.com/graphql/quick-start)
- [GraphQL Subscription over SSE with NestJS — GistShare](https://www.gistshare.com/notes/313/graphql-subscription-over-sse-nestjs-using-graphql-sseexpress)
- [NestJS CQRS Recipes — Docs](https://docs.nestjs.com/recipes/cqrs)

### Event Bus & State Machines
- [EventEmitter2 — npm](https://www.npmjs.com/package/eventemitter2)
- [EventEmitter2 — GitHub](https://github.com/EventEmitter2/EventEmitter2)
- [ts-bus Typed Event Bus — GitHub](https://github.com/ryardley/ts-bus)
- [XState v5 Announcement — Stately](https://stately.ai/blog/2023-12-01-xstate-v5)
- [XState Persistence Docs — Stately](https://stately.ai/docs/persistence)
- [XState Event Sourcing Interpreter — GitHub](https://github.com/x-aaron-moore/xstate-event-sourcing-interpreter)
- [XState Backend State Machines — Blog](https://blogs.musadiqpeerzada.com/building-back-end-state-machines-with-xstate)

### Cache & TanStack Query
- [lru-cache — npm](https://www.npmjs.com/package/lru-cache)
- [lru-cache — GitHub](https://github.com/isaacs/node-lru-cache)
- [Cache Comparison — npm-compare](https://npm-compare.com/lru-cache,memory-cache,node-cache,quick-lru)
- [Using WebSockets with React Query — TkDodo](https://tkdodo.eu/blog/using-web-sockets-with-react-query)
- [SSE with TanStack Start & Query — ollioddi.dev](https://ollioddi.dev/blog/tanstack-sse-guide)
- [Query Invalidation — TanStack Docs](https://tanstack.com/query/v5/docs/framework/react/guides/query-invalidation)

### NestJS Saga Patterns
- [Saga Pattern in NestJS — JavaScript in Plain English](https://javascript.plainenglish.io/using-the-saga-pattern-in-nestjs-a-beginners-guide-9271d894ff7e)
- [NestJS CQRS Saga Event Sourcing — GitHub](https://github.com/amehat/nestjs-cqrs-saga-event-sourcing-domain-driven)
- [NestJS Saga Pattern — GitHub](https://github.com/iamolegga/nestjs-saga)
