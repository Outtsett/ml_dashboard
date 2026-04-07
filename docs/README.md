# Docs — Documentation and Specs

Architecture documents, design specs, implementation plans, and reference material.

## Structure

```
docs/
  design/                       Design principle documents
    tensionflow_design_principles.md
  plans/                        Implementation plans (dated)
    2026-02-18-data-architecture-*.md
    2026-02-23-questdb-centric-*.md
    2026-02-25-hdp-hmm-training-pipeline-*.md
    2026-02-28-training-analytics-*.md
    2026-03-04-questdb-audit-fixes.md
    2026-03-05-benchmark-targets.md
    2026-03-12-event-architecture-*.md
    multi_task_training_diagnostics.md
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
| `UNIVERSAL-TRAINING-ARCHITECTURE.md` | Universal training architecture overview |
| `SIMULATOR-ARCHITECTURE.md` | Trade simulator design |
| `UI_SPEC.md` | UI specification and layout |
| `SOLID-FIX-PLAN.md` | SOLID principles refactoring plan |
| `motivewave-architecture.md` | MotiveWave plugin architecture |
| `oanda-v20-api-reference.md` | Oanda forex API reference |
| `ts_bestpractices.md` | TypeScript best practices |
| `Developer Terms.md` | Developer terminology glossary |

## Document Naming Convention

Plans and specs use ISO 8601 date prefix: `YYYY-MM-DD-<topic>.md`. Paired documents use `-design.md` (spec) and `-impl.md` (implementation plan) suffixes.
