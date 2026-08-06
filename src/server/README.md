# Server — Domain-Driven Flat Architecture

The server is organized into functional business domains and a consolidated infrastructure layer. This reduces cognitive load and enforces clear boundaries between business logic and technical implementation.

## Folder Structure

### Domains (`src/server/`)
Each domain folder contains its own routers, sagas, and domain-specific services.
- **`training/`**: Model training orchestration, HPO, and code generation.
- **`market/`**: Market data charts, instrument metadata, and news.
- **`ml/`**: Model registry, evaluation, catalog, and XAI methods.
- **`backtest/`**: Simulation, walk-forward analysis, and trade execution benchmarks.
- **`deployment/`**: Live trading lifecycle, agents, and deployment event publishing.
- **`data/`**: File ingestion, database explorer, and event-sourced pipelines.
- **`system/`**: Server settings, hardware telemetry, and system-wide events.

### Infrastructure (`src/server/infrastructure/`)
Cross-cutting technical concerns and external integrations.
- **`database/`**: QuestDB and SQLite connection management and drivers.
- **`storage/`**: Drizzle-based data access layers.
- **`cache/`**: OHLCV, symbol, and model caching logic.
- **`events/`**: Global event bus and event store implementation.
- **`sagas/`**: Saga pattern orchestrator and recovery logic.
- **`lib/`**: Shared utilities, PTY server, and common middleware.
- **`core/`**: NestJS core modules and global route registration.

## Principles
1. **Vertical Slicing**: Favor grouping by feature over grouping by technical type.
2. **Flat Folders**: Minimize nesting to 3 levels for core logic.
3. **Infrastructure Isolation**: Domains depend on `infrastructure/` for technical capabilities, not the other way around.
4. **Single Responsibility**: Maintain granular modules within domains to avoid monolithic files.
