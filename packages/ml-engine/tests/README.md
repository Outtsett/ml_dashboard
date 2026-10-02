# Tests — Test Suites

Dual-stack test infrastructure: Vitest for TypeScript (client + server), pytest for Python ML code.

## Directory Structure

```
tests/
  client/                  React component tests
    setup.ts               Test setup (jsdom, @testing-library)
  integration/             Cross-module integration tests
    event-architecture.test.ts
  ml/                      Python ML tests (pytest)
    conftest.py            Shared fixtures
    cnn_transformer/       CNN+Transformer tests (11 files)
      test_barrier_labels.py
      test_categorical.py
      test_dataset.py
      test_discrepancy.py
      test_e2e.py
      test_encodings.py
      test_evaluate.py
      test_integration.py
      test_model.py
      test_walk_forward.py
      test_auxiliary_labels.py
    shared/                Shared ML utility tests
      test_shmem.py
    tensionflow/           TensionFlow scorer tests (278 tests across 7 packages)
      features/            Feature computation tests
      signals/             Signal generation tests
      tension/             Tension calculation tests
      state/               State management tests
      risk/                Risk management tests
      trade/               Trade logic tests
      test_scorer.py       End-to-end scorer test
    test_diagnostics_schema.py  Pydantic/TS schema parity test

  (Root-level TypeScript tests)
  deployment-machine.test.ts   XState deployment machine
  event-bus.test.ts            Event bus pub/sub
  event-store.test.ts          Event store persistence
  event-store-schema.test.ts   Event store schema validation
  event-types.test.ts          SSE event type contracts
  training-machine.test.ts     XState training machine
  ingestion-machine.test.ts    XState ingestion machine
  ingestion.test.ts            File ingestion pipeline
  ingestionService.test.ts     Ingestion service
  futures.test.ts              Futures stitching
  query-cache.test.ts          Query cache invalidation
  ringBuffer.test.ts           Ring buffer data structure
  saga-orchestrator.test.ts    Saga orchestrator
  saga-recovery.test.ts        Saga recovery
  schema.test.ts               Drizzle schema validation
  sse-adapter.test.ts          SSE adapter
  errorLogger.test.ts          Error logger
```

## Running Tests

```bash
# TypeScript tests (Vitest)
npm test                    # Run all
npm run test:watch          # Watch mode

# Python tests (pytest)
pytest tests/ml/            # All ML tests
pytest tests/ml/cnn_transformer/  # CNN+Transformer only
pytest tests/ml/tensionflow/      # TensionFlow only (278 tests)
pytest -m "not slow"              # Skip slow tests
```

## Test Configuration

- **Vitest**: `vitest.config.ts` at project root. Uses jsdom environment for client tests.
- **pytest**: `pyproject.toml` `[tool.pytest.ini_options]`. Test paths: `tests/`, Python path: `src/`, `src/ml/`. Import mode: `importlib`. Marker `slow` for long-running tests.
- **MSW**: Mock Service Worker (`msw 2.12`) for API mocking in client tests.
- **Benchmarks**: `pytest-benchmark` for ML performance tests. Results in `.benchmarks/`.
