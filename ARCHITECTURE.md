# Architecture Overview: QuantAI Dashboard

Institutional-grade, modular trading and analysis platform adhering to SOLID principles.

## 1. Triple-Engine Data Architecture (Lambda)

| Layer | Technology | Role |
| :--- | :--- | :--- |
| **System of record** | **Iceberg lake** (`E:\lake`) | Every byte of market data. Namespace `market`; `bars` is the base table. |
| **Serving + batch** | **DuckDB** | Reads the lake in-process — OHLCV serving, data wrangling, .parquet loading for training. No server, no port. |
| **Serving** | **PostgreSQL** | Relational metadata, Model Catalog state, strategy querying. |

## 2. Module Boundaries

```mermaid
graph TD
    UI[Client - React/Vite] --> API[Server - NestJS]
    UI --> Shared[Shared Logic]
    API --> Shared
    API --> Lake[(Iceberg lake via DuckDB)]
    API --> PG[(PostgreSQL)]
    API --> ML[ML Engine - Python]
```

- **Client (`src/client`)**: React 19 + Radix UI. Standardized `Layout` and `AppRoute` logic.
- **Server (`src/server`)**: NestJS backend refactored into vertical domain slices (e.g., `training/`, `market/`, `ml/`, `deployment/`).
- **Infrastructure (`src/server/infrastructure`)**: Consolidated technical concerns including `database/`, `storage/`, `cache/`, `lib/`, `events/`, and `sagas/`.
- **ML Engine (`src/ml`)**: PyTorch-based training and inference engine.
- **Shared (`src/shared`)**: Type definitions and utility functions used by both Client and Server.

## 3. Enforcement Tools

- **Architecture Validator**: Run `npm run check:architecture` to verify module boundaries.
- **Type Checking**: Strict TypeScript configurations in `tsconfig.json`.
- **Linting**: Dual-stack linting via `eslint` (TS) and `ruff` (Python).

## 4. Key Workflows

1. **Ingest**: Vendor data lands write-once in `E:\lakeawendor=<name>\` and is promoted into the Iceberg tables -> read by the Server through DuckDB -> served via API.
2. **Training**: User triggers via UI -> SAGA in Server orchestrates Python process -> Progress streamed via SSE.
3. **Audit**: Indicators and TA calculations are audited via `audit_and_calculate_ta.py` for precision.

## 5. Connectivity & Speed

- **Bulk Access**: High-speed HTTP REST path for Node.js and Python, bypassing standard PG wire overhead for 1.5x throughput gains.
