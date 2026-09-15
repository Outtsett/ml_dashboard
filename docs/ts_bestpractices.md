# TypeScript & NestJS Best Practices

## SOLID Principles

These 5 principles are **project law**. Every new file, service, and module must follow them.

---

### S — Single Responsibility Principle

> A module should have one, and only one, reason to change.

Think of it as: **Each file is a specialist trader** — one does RSI, one does order execution, one does risk. If your "RSI trader" is also parsing news feeds, something's wrong.

**Checklist:**
- Does this file do exactly ONE thing?
- If I described what this file does, would I use the word "and"? (bad sign)
- Could I name this file after its single purpose?

**Before (violation):**
```typescript
// registry.ts — 487 LOC doing 3 jobs
export const INDICATOR_REGISTRY = { ... };           // metadata
export function calculateRSI(data) { ... }           // computation
export function calculateMACD(data) { ... }          // computation
export function generateIndicatorSQL(config) { ... } // SQL generation
```

**After:**
```typescript
// registry.ts — metadata only
export const INDICATOR_REGISTRY = { ... };
export function listIndicators() { ... }

// calculators.ts — computation only
export function calculateRSI(data) { ... }
export function calculateMACD(data) { ... }
```

---

### O — Open/Closed Principle

> Open for extension, closed for modification.

Think of it as: **A plug-in system** — adding a new indicator shouldn't require editing the indicator engine. You plug in a new module, register it, and the system picks it up.

**Checklist:**
- Can I add a new variant without touching existing code?
- Am I using a registry/map pattern instead of if/else chains?
- Would adding a new model type require editing the runner?

**Before (violation):**
```typescript
// pythonRunner.ts — must modify this file for every new model
function parseOutput(line: string) {
  if (line.startsWith('[HDP-HMM]')) { ... }
  // Adding CNN? Edit this file.
  // Adding Transformer? Edit this file again.
}
```

**After:**
```typescript
// parsers/types.ts — interface
export interface IOutputParser {
  parseLine(session, line, context): boolean;
}

// parsers/hdpHmmParser.ts — one implementation
export class HdpHmmParser implements IOutputParser { ... }

// parsers/index.ts — registry (extend by adding, not modifying)
export const PARSERS: Record<string, IOutputParser> = {
  'hdp-hmm': new HdpHmmParser(),
  'cnn': new CnnParser(),  // ← just add a line
};
```

---

### L — Liskov Substitution Principle

> Subtypes must be substitutable for their base types without breaking behavior.

Think of it as: **Any analyst who follows the "IIndicator" contract should work in the pipeline** — if your BollingerBands indicator claims to be an IIndicator but crashes when given forex data, it violates this principle.

**Checklist:**
- Does my implementation honor every promise the interface makes?
- Does it throw unexpected errors that the base type wouldn't?
- Can every implementation be swapped in without the caller knowing?

**Example:**
```typescript
// Every health indicator must return HealthIndicatorResult — no exceptions
export class MarketDataHealthIndicator extends HealthIndicator {
  async isHealthy(): Promise<HealthIndicatorResult> {
    // Must return { marketData: { status: 'up' } } or throw
    // Never return a different shape or silently fail
  }
}
```

---

### I — Interface Segregation Principle

> No client should be forced to depend on methods it doesn't use.

Think of it as: **Don't hand a chart renderer the entire trading system manual** — it only needs `getOHLCV()`. If the chart component imports an interface with 50 methods just to call 2, that's waste and coupling.

**Checklist:**
- Does this interface have methods that some consumers never call?
- Could I split this into smaller, focused interfaces?
- Am I injecting a 50-method service when I only need 3 methods?

**Before (violation):**
```typescript
// IStorage has 50+ methods — every consumer depends on ALL of them
export interface IStorage {
  getUser(id): Promise<User>;
  createUpload(upload): Promise<Upload>;
  saveNewsArticles(articles): Promise<void>;
  runBacktest(config): Promise<BacktestResult>;
  // ... 46 more methods
}
```

**After:**
```typescript
// Split into focused domain interfaces
export interface IUserStorage {
  getUser(id): Promise<User>;
  getUserByUsername(username): Promise<User>;
  createUser(user): Promise<User>;
}

export interface INewsStorage {
  saveNewsArticles(articles): Promise<void>;
  getNewsArticles(symbol): Promise<NewsArticle[]>;
}

// Compose for backward compat
export interface IStorage extends IUserStorage, INewsStorage, ... {}
```

---

### D — Dependency Inversion Principle

> Depend on abstractions, not concretions.

Think of it as: **Your strategy doesn't care which broker executes the trade** — it depends on an `IBroker` interface. Swap Interactive Brokers for Alpaca without touching the strategy code.

**Checklist:**
- Am I importing a concrete class when I should depend on an interface?
- Does my service depend on a specific database client, or on an abstraction?
- Would swapping the implementation require editing this file?

**Before (violation):**
```typescript
// Route handler directly imports a concrete store module
import { queryMarketData } from '../marketData';

router.get('/ohlcv', async (req, res) => {
  const data = await queryMarketData(`SELECT * FROM ohlcv ...`);
});
```

**After:**
```typescript
// Service depends on injected abstraction
@Injectable()
export class ChartService {
  constructor(
    @Inject(MarketDataService) private db: MarketDataService,
  ) {}

  async getOHLCV(symbol: string, timeframe: string) {
    return this.db.query(`SELECT * FROM ohlcv ...`);
  }
}
```

---

## NestJS Patterns (Our Conventions)

### Module Structure
Every feature domain follows this structure:
```
src/server/{domain}/
  {domain}.module.ts      ← NestJS module declaration
  {domain}.service.ts     ← thin wrapper delegating to lib/ pure functions
  {domain}.controller.ts  ← (future) replaces Express route
```

### Service Layer Rules
- Services are **thin facades** — delegate to pure functions in `lib/`
- Services own DI (inject database services, config)
- Services do NOT contain business logic — that lives in `lib/`
- One service per bounded domain (indicators, labels, xai, training)

### Bridge Pattern (Current)
Until Express routes are migrated to NestJS controllers:
```typescript
import { getNestApp } from '../main';
import { TrainingService } from '../training/training.service';

router.post('/start', async (req, res) => {
  const training = getNestApp().get(TrainingService);
  const result = await training.start(req.body);
  res.json(result);
});
```

### Lib Layer Rules
- `lib/` contains **pure functions** — no DI, no decorators
- Each file has a **single responsibility** (one domain concept)
- Files should be < 300 LOC — if larger, split by sub-concern
- Use barrel `index.ts` files for clean re-exports
- When splitting a file, keep a backward-compat barrel to avoid breaking consumers

---

## TypeScript Conventions

- **Strong typing**: Always type function parameters, return values, and variables
- **DTOs**: Use Zod schemas for runtime validation at API boundaries
- **Interfaces**: Define contracts between modules — never expose implementation details
- **Avoid `any`**: Use `unknown` + type guards instead
- **Prefer `const` assertions**: For registry objects and config maps

---

## Error Handling

- **Centralize**: Use global exception filters, not try/catch in every function
- **Typed errors**: Throw domain-specific error classes, not generic `Error`
- **No silent failures**: Every error path must either throw or log
- **Route handlers**: Let errors propagate to the global Express error handler

---

## Database Layer

- **Repository pattern**: Separate data access from business logic
- **Services never write SQL**: SQL lives in dedicated query files or repositories
- **TypeORM entities**: `synchronize: false` — Drizzle manages schema
- **Market data (DuckDB over the lake)**: read the pre-aggregated timeframe view when one exists; use `arg_min`/`arg_max` over `first`/`last` inside a `GROUP BY`
- **DuckDB**: In-memory only, ephemeral compute — never persistent state

---

## Testing

- **Unit tests**: Pure functions in `lib/` — no mocking needed
- **Integration tests**: Services with mocked database services
- **E2E tests**: Full API endpoints via Supertest
- **Vitest**: Project test framework (not Jest)

---

## Configuration

- **Single source**: `ConfigModule` via `@nestjs/config` + Zod validation
- **No hardcoded values**: Use `ConfigService.get()` or config files
- **Environment-specific**: `.env` for secrets, `config/*.json` for structure
