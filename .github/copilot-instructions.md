# ML Dashboard – Copilot Instructions

Full-stack Electron + web app for quantitative trading research. See `CLAUDE.md` for exhaustive reference (DB schemas, API map, data volumes, scripts).

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
- **Indicators**: 344 pre-computed columns via pandas-ta (parquets in `data/indicators/`), 13 realtime SQL generators in `server/lib/indicators/sqlGenerator.ts`
- **Continuous contracts**: DuckDB Panama back-adjustment via rollover schedule — `server/routes/instruments.ts` endpoint

## Security

- Rate limiting: API 100/min, ML 50/min, upload 10/min (`server/lib/rateLimiter.ts`)
- PostgreSQL uses trust auth locally (`postgres:postgres@localhost:5432/ml_dashboard`)
- File uploads: 500MB max, validated extensions (CSV, ZST, Parquet, DBN)
- Database routes expose read-only SQL query endpoint — ensure no write operations leak
