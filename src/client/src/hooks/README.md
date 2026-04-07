# Hooks — Custom React Hooks

43 custom hooks managing data fetching, SSE subscriptions, UI state, and platform integration.

## Categories

### SSE & Real-Time
| Hook | Purpose |
|---|---|
| `useSSEConnection.ts` | Shared SSE hook with exponential backoff reconnection (1s/2s/4s/8s, max 30s) |
| `useTrainingSSE.ts` | Ring buffer (5000 slots) + 50ms microbatch + `startTransition` flush |
| `useEventStream.ts` | Pipeline/training/system SSE channels with auto-reconnection |
| `useGpuMetrics.ts` | GPU telemetry via `system.gpu` SSE events, 300-point rolling history |
| `useRegimeSSE.ts` | Regime overlay events from training stream |

### Data Fetching (TanStack Query)
| Hook | Purpose |
|---|---|
| `useChartOHLCV.ts` | OHLCV bars with IndexedDB caching and staleTime: Infinity |
| `useMLData.ts` | ML model data queries |
| `useModelCatalog.ts` | Model catalog browsing (300+ specs) |
| `useModelCheckpoints.ts` | Model checkpoint listing |
| `useModelHistory.ts` | Training run history |
| `useTrainedModels.ts` | Multi-instrument model grouping (type -> instrument -> checkpoints) |
| `useEvaluationResults.ts` | Model evaluation results |
| `useRegimeData.ts` | Regime analysis data |
| `useCurriculum.ts` | Learning curriculum progress |
| `useModelComparison.ts` | Side-by-side model comparison |

### Training State
| Hook | Purpose |
|---|---|
| `useTraining.ts` | Training lifecycle (start, stop, status) |
| `useTrainingConfig.ts` | Training configuration state |
| `useTrainingLiveState.ts` | Live training state during active run |
| `useTrainingMetrics.ts` | Training metric history |
| `useTrainingSync.ts` | Training state synchronization |
| `usePersistedMetrics.ts` | Metrics persisted across sessions |

### Indicators
| Hook | Purpose |
|---|---|
| `useActiveIndicators.ts` | Indicator instance management (add/remove/configure) |
| `useIndicatorData.ts` | Computed indicator data |
| `useIndicatorWorker.ts` | Web Worker indicator computation |

### UI State
| Hook | Purpose |
|---|---|
| `useDebounce.ts` | Debounced value |
| `useDeferredFilter.ts` | Deferred search/filter (wraps `useDeferredValue`) |
| `useWebVitals.ts` | Core Web Vitals monitoring (LCP, FID, CLS) |
| `useGlobalShortcuts.ts` | Global keyboard shortcut registration |
| `use-toast.ts` | Toast notification state |
| `use-mobile.tsx` | Mobile viewport detection |

### Platform
| Hook | Purpose |
|---|---|
| `useElectron.ts` | Electron API detection and IPC |
| `useNativeMenu.ts` | Native menu integration |
| `useTerminalSession.ts` | PTY terminal session management |
| `useLocalReplay.ts` | Chart replay from local data |

### System
| Hook | Purpose |
|---|---|
| `useSystemManifest.ts` | Hardware/infrastructure manifest |
| `useSystemMatrix.ts` | System health matrix |
| `useSpeedAudit.ts` | Performance audit |
| `usePipelineState.ts` | Pipeline state machine |
| `useVisualizationRegistry.ts` | Visualization component registry |
| `useMetricDescriptions.ts` | Config-driven metric annotations per model type |
| `useTradeMetrics.ts` | Trade performance metrics |
| `useTimeTracker.ts` | Time tracking for curriculum |
| `useBreadcrumbs.tsx` | Breadcrumb navigation state |
