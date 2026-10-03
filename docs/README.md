> [!IMPORTANT]
> **PIPELINE MANDATE**: This project operates strictly as a non-distributed, vertical architecture.
> **DO NOT** use MinIO, Apache Iceberg, or QuestDB.
> **DO USE** Local Parquet (D:\ml_data), Polars, Standalone PostgreSQL+TimescaleDB, and Zero-Copy PyTorch Dataloaders.
# Docs â€” Documentation and Specs

Architecture documents, design specs, implementation plans, and reference material.

## Structure

```
docs/
  design/                       Design principle documents
    tensionflow_design_principles.md
  research/                     First-principles research synthesis (2026-05-09)
    intraday_model_arsenal.md       9-layer intraday MNQ architecture (CORE/SUPPORTING picks from 300-spec audit)
    catalog_per_model_notes.md      Per-spec evidence base â€” 300 verdicts in 7 bucket tables
  plans/                        Implementation plans (active only â€” archived on 2026-05-09)
    2026-05-08-ml-studio-end-to-end.md
    archive/                    19 superseded plans (2026-02-18 through 2026-03-12)
  superpowers/                  Claude Code superpowers-generated docs
    specs/                      Design specifications
      2026-03-20-rendering-infrastructure-design.md
      2026-03-26-triple-barrier-cnn-transformer-design.md
      2026-03-27-training-page-redesign.md
      2026-03-30-adaptive-training-tab-design.md
      2026-03-30-cnn-transformer-metrics-design.md
    plans/                      Implementation plans
      2026-03-20-rendering-infrastructure.md
      2026-03-26-triple-barrier-training.md
      2026-03-27-dashboard-training-integration.md
      2026-03-27-training-page-redesign.md
```

## Key Documents

| Document | Topic |
|---|---|
| `DATA_ARCHITECTURE.md` | **Absolute Source of Truth for Data Architecture.** Details how the dashboard retrieves historical (DuckDB/Iceberg) and live (OANDA/Yahoo) candlestick data. |
| `live-data.md` | Detailed breakdown of the Live Data Hub (Port 17192), OANDA/Yahoo integrations, and real-time frontend streaming. |
| `research/intraday_model_arsenal.md` | **9-layer intraday MNQ architecture** â€” 12 CORE + 22 SUPPORTING models, MTF training protocol, T/R/D/V/R decomposition, integration roadmap (week-1 + quarter-1) |
| `research/catalog_per_model_notes.md` | Per-spec evidence base â€” 300 verdicts (CORE/SUPPORTING/RESEARCH/BASELINE/REJECT) across 7 bucket tables |
| `UNIVERSAL-TRAINING-ARCHITECTURE.md` | Universal training architecture overview |
| `SIMULATOR-ARCHITECTURE.md` | Trade simulator design |
| `contract-specifications.md` | Stock-index futures contract specifications (tick, exchange, contract size, months) from AMP Futures, cross-checked against CME Group; the data is `src/config/contract_specifications.json`, the interactive view `notebooks/contract_specifications.py` |
| `UI_SPEC.md` | UI specification and layout |
| `SOLID-FIX-PLAN.md` | SOLID principles refactoring plan |
| `oanda-v20-api-reference.md` | Oanda forex API reference |
| `ts_bestpractices.md` | TypeScript best practices |
| `Developer Terms.md` | Developer terminology glossary |

## Document Naming Convention

Plans and specs use ISO 8601 date prefix: `YYYY-MM-DD-<topic>.md`. Paired documents use `-design.md` (spec) and `-impl.md` (implementation plan) suffixes. Research docs in `research/` use intent-first names (no date prefix) since they describe the current canonical view.

## Plan Lifecycle

- `plans/<date>-<topic>.md` â€” active in-flight plan
- `plans/archive/<date>-<topic>.md` â€” superseded or completed; kept for traceability
- Plans graduate to `archive/` via `git mv` when their work is fully landed or replaced by a newer plan. The 2026-05-09 archive purge moved 19 plans (see `CLAUDE.md` Recent Changes for the list).

