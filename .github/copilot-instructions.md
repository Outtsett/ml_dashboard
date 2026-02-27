# ML Dashboard – Copilot Instructions

Full-stack Electron + web app for quantitative trading research. See `CLAUDE.md` for exhaustive reference (DB schemas, API map, data volumes, scripts).

## User Learning Style

The user is an **extreme visual learner** who cannot process abstract math or theoretical concepts in text form. When explaining technical concepts (ML architectures, algorithms, data flows, etc.):

- **Always use "Think of it as..." analogies** grounded in trading/real-world terms the user already understands (e.g., "a chart pattern scanner sliding a magnifying glass", "a panel of experts voting", "a trader reading bar by bar with a mental notepad")
- **Build visual components** in the dashboard rather than writing text explanations — the user needs to SEE how things work (data flows, layer shapes, attention maps, decision trees)
- **Show data shape transformations** step-by-step (e.g., 60×31 → Conv → 30×64 → Pool → ...) so the user can trace how their data morphs through each layer
- **Use strength/weakness trade-off badges** and side-by-side comparison matrices instead of paragraphs of prose
- **Never assume math literacy** — translate formulas into visual or intuitive equivalents (e.g., "softmax = picks the strongest signal" not "softmax = e^x / Σe^x")
- **Connect every concept back to the user's actual data** — their 31 features, their 60-bar windows, their OHLCV from DuckDB — not abstract examples

## Build and Test

```bash
npm run dev              # Express + Vite HMR on port 5000 (requires .env with DATABASE_URL)
npm run check            # TypeScript type-check (strict mode)
npm test                 # Vitest (node env, 30s timeout, tests/ dir)
npx drizzle-kit push     # Push schema changes to PostgreSQL after editing shared/schema.ts
```

Databases must be running first: `node electron/start-databases.cjs` (PostgreSQL + QuestDB).

## Code Style

- **TypeScript strict**, ESM (`"type": "module"`). Server output is CJS via esbuild bundle.
- Path aliases: `@/*` → `client/src/*`, `@shared/*` → `shared/*`.
- Use `import type` for type-only imports. Drizzle-inferred types live in `shared/schema.ts`.
- Prefer raw SQL strings for DuckDB queries; use Drizzle ORM for PostgreSQL.

## SOLID Principles

All new code **must** follow SOLID. Apply these principles everywhere — routes, components, hooks, services, ML trainers.

### SRP — Single Responsibility
> One module, one job. One reason to change.

- **Route files**: HTTP concern only — parse params, call a service/storage method, return JSON. No business logic inline.
- **`storage.ts` methods**: DB query only — no HTTP, no formatting, no side-effects.
- **React components**: Render only. Extract data-fetching into custom hooks, business logic into utils.
- **Hooks**: One hook per data concern (`useModelList`, `useTrainingSession`). Never a mega-hook that fetches everything.
- **Python scripts**: Each script does one pipeline step (`compute-indicators.py` → indicators only, `normalize-indicators.py` → normalization only).

```ts
// ❌ WRONG — route doing business logic
router.get('/models', async (req, res) => {
  const models = await db.select().from(mlModels);
  const enriched = models.map(m => ({ ...m, accuracy: m.metrics?.accuracy * 100 }));
  res.json(enriched);
});

// ✅ RIGHT — route delegates, storage is pure
router.get('/models', async (req, res) => {
  const models = await storage.getModels(); // storage owns the query
  res.json(models);
});
```

### OCP — Open/Closed
> Add new behavior by adding new code, not by editing existing code.

- **ML models**: Add new models via `config/models.json` registry — never modify `server/training/orchestrator.ts` to add a new runner.
- **Indicators**: Add new SQL indicators by adding an entry to `sqlGenerator.ts`'s registry map — never add `if (name === 'newIndicator')` branches.
- **Label generators**: Add new label types to `server/lib/labels/sqlLabelGenerators.ts` registry — callers iterate the registry, they never know specific types.
- **React pages**: New pages added as new files in `client/src/pages/` + one route entry in `App.tsx` — no other files change.

```ts
// ❌ WRONG — adding new indicator breaks OCP
function buildSQL(name: string) {
  if (name === 'rsi') return rsiSQL;
  if (name === 'macd') return macdSQL;  // ← every new indicator = edit this file
}

// ✅ RIGHT — registry is open for extension
const indicators: Record<string, () => string> = {
  rsi: () => rsiSQL,
  macd: () => macdSQL,
  // add new ones here, nothing else changes
};
```

### LSP — Liskov Substitution
> Any implementation of an interface must be a drop-in replacement.

- **`ITrainerRunner`** (`server/training/runners/types.ts`): `PythonRunner` and `TfjsRunner` must be fully interchangeable — the orchestrator must never check `instanceof` to decide behavior.
- **DB query helpers**: `marketQuery<T>()` must always return `T[]` — never `T[] | undefined | BigInt[]`. Callers trust the contract.
- **React components**: If a component accepts `{ data: Trade[] }`, every caller can pass any valid `Trade[]` — no hidden shape assumptions.

```ts
// ❌ WRONG — caller must know the concrete type
if (runner instanceof PythonRunner) {
  await runner.parseGibbsOutput(); // TfjsRunner doesn't have this
}

// ✅ RIGHT — interface defines the full contract
interface ITrainerRunner {
  start(session: TrainingSession): Promise<void>;
  stop(): Promise<void>;
  onProgress(cb: (event: SSEEvent) => void): void;
}
```

### ISP — Interface Segregation
> Don't force a module to depend on methods it doesn't use.

- **Route handlers**: Import only the specific `storage.*` methods needed — never import the entire `storage` object if only `getModels()` is needed.
- **React hooks**: Expose only the data a component needs — `useChartCandles()` should not also return model list.
- **Types**: Split large interfaces. If a component only needs `{ id, name }` from a model, define and accept `ModelSummary`, not the full `MLModel` type.
- **`shared/schema.ts`**: Export focused `Insert*` + select types per table — callers import only the type(s) they need.

```ts
// ❌ WRONG — component forced to take a bloated type
function ModelBadge({ model }: { model: MLModel }) { // MLModel has 30 fields
  return <span>{model.name}</span>; // only uses 1
}

// ✅ RIGHT — minimal interface
interface ModelSummary { id: number; name: string; }
function ModelBadge({ model }: { model: ModelSummary }) { ... }
```

### DIP — Dependency Inversion
> Depend on abstractions (interfaces/functions), not on concrete implementations.

- **Routes → Storage**: Route handlers call `storage.*` methods (abstraction) — never call `db.select().from(mlModels)` directly inside a route.
- **Orchestrator → Runner**: `TrainingOrchestrator` depends on `ITrainerRunner` interface — it never `import`s `PythonRunner` or `TfjsRunner` directly; it receives the runner via factory/injection.
- **DuckDB access**: All code calls `marketQuery()` abstraction — never references `marketConn` directly. The mutex + connection lifecycle is hidden behind the abstraction.
- **React → API**: Components depend on TanStack Query hooks (`useQuery`) — never call `fetch('/api/...')` directly in a component.

```ts
// ❌ WRONG — route imports concrete DB driver
import { marketConn } from '../duckdb/market.ts';
router.get('/ohlcv', async (req, res) => {
  const rows = await marketConn.query('SELECT ...');
});

// ✅ RIGHT — depends on abstraction
import { marketQuery } from '../duckdb/market.ts';
router.get('/ohlcv', async (req, res) => {
  const rows = await marketQuery<OHLCVRow>('SELECT ...');
});
```

## Architecture

### Three Databases
| DB | Access Pattern | When to Use |
|----|---------------|-------------|
| **PostgreSQL** (Drizzle) | `storage.*` methods from `server/storage.ts` | CRUD, metadata, schema-driven data |
| **DuckDB** (raw SQL) | `marketQuery<T>(sql)` from `server/duckdb/market.ts` | Market data, analytics, indicators |
| **QuestDB** | HTTP/ILP via `server/questdb.ts` | Chart candle aggregation (`SAMPLE BY`) |

### DuckDB Mutex Pattern
File-backed DuckDB (`data/market.duckdb`) requires serialized access. Always use `marketQuery()` — never access `marketConn` directly. Cast `COUNT(*)` / `epoch_ms()` to `DOUBLE` in SQL or wrap with `Number()` in JS (BigInt breaks JSON serialization).

### Server Routes
Each route file: `const router = Router()` → async handlers with try/catch → `export default router`. Mounted in `server/routes.ts` under `/api`. Validate params inline, return errors as `res.status(N).json({ error: string })`.

Example pattern (see `server/routes/charts.ts`, `server/routes/instruments.ts`):
```ts
router.get('/endpoint', async (req: Request, res: Response) => {
  try {
    const symbol = getString(req.query.symbol); // helper from server/routes/helpers.ts
    if (!symbol) return res.status(400).json({ error: 'symbol required' });
    const data = await marketQuery<Row>(`SELECT ... FROM ohlcv WHERE symbol = '${symbol}'`);
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});
```

### React Frontend
- **Router**: Wouter (NOT React Router) — `Switch`/`Route` in `client/src/App.tsx`
- **Pages**: Default-exported, lazy-loaded, wrapped in `ErrorBoundary` + `Suspense`
- **Data fetching**: TanStack Query — query keys mirror API paths (e.g., `["/api/ml/models"]`). Use `QUERY_KEYS` from `client/src/lib/types.ts`.
- **Components**: shadcn/ui (new-york style) in `components/ui/`, domain components alongside, visualizations in `components/visualizations/`
- **Icons**: Lucide React. **Styling**: Tailwind v4 with CSS variable semantic tokens (`bg-background`, `text-foreground`).

## Project Conventions

- **Drizzle schema** (`shared/schema.ts`): `pgTable()` → `createInsertSchema().omit({ id: true })` → export `Insert*` type + select type. Always run `npx drizzle-kit push` after changes.
- **Server logging**: `log(message, 'source-tag')` function from `server/index.ts`.
- **Error boundary**: Every page route has `<ErrorBoundary>` wrapping. Non-fatal DB errors are caught and logged, not thrown — DBs can fail independently.
- **Circuit breaker**: Auto-disables failing DB connections. Reset via `POST /api/circuit-breaker/reset/:name`.
- **File dedup**: SHA-256 hash tracking in DuckDB `ingested_files` table prevents re-ingestion.
- **Python scripts**: Use `read_only=True` when opening DuckDB from Python to avoid lock conflicts with the running Node server.
- **Windows paths**: Use forward slashes in Node.js/DuckDB SQL. Use `npx tsx` (not bare `tsx`) for scripts.

## Integration Points

- **DuckDB ↔ QuestDB sync**: Bulk CSV export → QuestDB `/imp` endpoint (see `scripts/fast-questdb-sync.ts`)
- **ML training**: `MLTrainer extends EventEmitter` in `server/ml/trainer.ts` — emits progress via SSE at `GET /api/ml/train/stream`
- **Indicators**: 344 pre-computed columns via pandas-ta (parquets in `data/{futures,forex}/{symbol}/{tf}/`), 13 realtime SQL generators in `server/lib/indicators/sqlGenerator.ts`
- **Continuous contracts**: DuckDB Panama back-adjustment via rollover schedule — `server/routes/instruments.ts` endpoint

## Git Worktrees (Parallel Agent Work)

This repo uses **git worktrees** so multiple agents can work on different branches simultaneously without conflicts. Each worktree is a full working directory with its own branch, sharing the same `.git` history.

```
E:\source\repos\ml_dashboard\                        ← main (feat/data-architecture-reorg)
E:\source\repos\ml_dashboard_worktrees\frontend\     ← agent/frontend branch
E:\source\repos\ml_dashboard_worktrees\backend\      ← agent/backend branch
```

**Workflow for parallel agents:**
1. Each agent opens its own worktree folder as the workspace
2. Each commits to its own branch independently — no merge conflicts during work
3. When done, merge agent branches back into the main branch:
   ```bash
   git checkout feat/data-architecture-reorg
   git merge agent/frontend
   git merge agent/backend
   ```

**Useful commands:**
```bash
git worktree list                                    # Show all worktrees
git worktree add ../ml_dashboard_worktrees/NAME BRANCH  # Add a new worktree
git worktree remove ../ml_dashboard_worktrees/NAME      # Remove when done
```

**Rules:** Each worktree must be on a unique branch — two worktrees cannot checkout the same branch. The worktrees share `node_modules` via the main repo; run `npm install` from the main worktree only.

## Security

- Rate limiting: API 100/min, ML 50/min, upload 10/min (`server/lib/rateLimiter.ts`)
- PostgreSQL uses trust auth locally (`postgres:postgres@localhost:5432/ml_dashboard`)
- File uploads: 500MB max, validated extensions (CSV, ZST, Parquet, DBN)
- Database routes expose read-only SQL query endpoint — ensure no write operations leak
