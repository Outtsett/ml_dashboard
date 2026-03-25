# Quant AI Dashboard

![CI](https://img.shields.io/badge/build-passing-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-20%2B-green)
![Python](https://img.shields.io/badge/python-3.11%2B-blue)

## Overview

Quant AI Dashboard is a full-stack ML dashboard for quantitative trading research. It combines real-time market data visualization, machine-learning training pipelines, and backtesting analytics in a single desktop application. The system ingests and analyzes 759M+ OHLCV rows of time-series data alongside trades and MBP-10 order-book depth.

## Features

- **Market Data Visualization** — interactive candlestick charts, order-book heatmaps, and multi-timeframe analysis via Lightweight Charts and Recharts
- **ML Training Pipelines** — CNN model training with TensorFlow.js-node, orchestrated by XState v5 state machines
- **Backtesting Engine** — historical strategy evaluation with detailed performance metrics
- **XAI / Explainability** — model interpretability tools for understanding prediction drivers
- **Regime Analytics** — market regime detection and classification
- **3D Visualizations** — immersive data exploration with Three.js and React Three Fiber
- **Real-Time SSE Streaming** — live data updates via Server-Sent Events with a custom event bus, event store, and saga orchestrator

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, Wouter, TanStack Query, Tailwind CSS v4, shadcn/ui (Radix), Recharts, Lightweight Charts, D3, Framer Motion |
| **3D** | Three.js, React Three Fiber |
| **Backend** | NestJS 11, Express 5, TypeScript, Node.js |
| **State Machines** | XState v5 (ingestion, training, deployment pipelines) |
| **Event System** | Custom event bus, event store, SSE, saga orchestrator |
| **ML / Data Science** | Python 3.11+ — pandas, polars, NumPy, PyArrow, pandas-ta; TensorFlow.js-node (CNN models) |
| **Databases** | SQLite (app metadata, 22 tables), QuestDB 9.3.1 (time-series) |
| **Desktop** | Electron 34 |
| **Build** | Vite 7, esbuild, tsx, SWC |
| **Testing** | Vitest (TypeScript), Ruff (Python linting) |

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20+ |
| Python | 3.11+ |
| QuestDB | 9.3+ |

## Getting Started

```bash
# Clone the repository
git clone <repo-url> && cd ml_dashboard

# Configure environment
cp .env.example .env
# Edit .env with your QuestDB connection details and any API keys

# Install Node.js dependencies
npm install

# Install Python dependencies
pip install -r requirements.txt
# or, if using the pyproject.toml:
pip install .

# Start QuestDB
# Ensure QuestDB is running on its default ports (9000 HTTP, 8812 PGWire)

# Start the development server
npm run dev
```

## Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the development server (Vite + NestJS) |
| `npm run build` | Production build |
| `npm run test` | Run Vitest test suite |
| `npm run lint` | Lint TypeScript and Python sources |
| `npm run start` | Start the production server |

## Architecture

```
src/
├── client/       # React 19 frontend — pages, components, hooks, stores
├── server/       # NestJS 11 backend — modules, controllers, services, gateways
├── ml/           # Python ML pipelines — feature engineering, model training, inference
├── shared/       # Shared TypeScript types, schemas, and utilities
└── config/       # Application configuration and environment helpers
```

The frontend communicates with the backend over REST and SSE. The backend coordinates ML workloads by invoking Python processes and manages state transitions through XState v5 machines. A saga orchestrator handles complex multi-step workflows (data ingestion → feature computation → training → deployment).

## Database Architecture

| Database | Role | Details |
|---|---|---|
| **SQLite** | Application metadata | 22 tables covering users, strategies, model configs, audit logs, and system state |
| **QuestDB** | Time-series storage | 759M+ OHLCV rows, tick-level trades, and MBP-10 order-book depth snapshots; optimized for high-throughput ingestion and fast analytical queries via SQL over PGWire |

## License

This project is licensed under the [MIT License](LICENSE).
