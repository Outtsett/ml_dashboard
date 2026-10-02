# Core — Server Infrastructure

Core server infrastructure: route registration, static file serving, Vite dev integration, NestJS modules, health checks, and Swagger.

## Files

| File | Purpose |
|---|---|
| `routes.ts` | Route registration: mounts 17 Express routers on `/api` |
| `static.ts` | Static file serving for production builds |
| `vite.ts` | Vite dev server middleware integration (HMR in development) |
| `core.module.ts` | NestJS core module: aggregates config, health, and system modules |
| `manifest.service.ts` | Hardware and infrastructure manifest service (CPU, GPU, RAM, disk, DB health) |
| `system.controller.ts` | NestJS system controller endpoint |

### `config/`
| File | Purpose |
|---|---|
| `app.config.ts` | Application configuration (ports, paths, feature flags) |
| `config.module.ts` | NestJS `@nestjs/config` module setup |

### `filters/`
| File | Purpose |
|---|---|
| `http-exception.filter.ts` | Global HTTP exception filter: standardized error envelope `{ error, requestId, status }` |

### `health/`
| File | Purpose |
|---|---|
| `health.module.ts` | NestJS health module |
| `health.service.ts` | Health check orchestrator |
| `lake.health.ts` | Market-data health indicator. Still probes the retired server's HTTP/PG-wire endpoints; pending the `src/server` port to the lake. |
| `sqlite.health.ts` | SQLite health indicator (WAL status, page count) |

### `swagger/`
| File | Purpose |
|---|---|
| `swagger.config.ts` | Static OpenAPI spec generation |

