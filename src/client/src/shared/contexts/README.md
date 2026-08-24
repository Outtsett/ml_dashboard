# Contexts — React Context Providers

11 React contexts managing global state for training, symbols, chat, overlays, and dashboard configuration.

## Training Contexts (Split for Performance)

Training state is split into 4 granular contexts to minimize re-renders. Components subscribe only to the data they need.

| Context | Data | Update Frequency |
|---|---|---|
| `TrainingContext.tsx` | Training lifecycle: status, config, session ID | Low (start/stop events) |
| `TrainingMetricsCtx.tsx` | Streaming numeric metrics | High (~20/sec during training) |
| `TrainingLogsCtx.tsx` | Training log lines | Medium (~5/sec) |
| `TrainingOverlaysCtx.tsx` | Chart overlay data (regime zones) | Low (per-phase) |
| `TrainingModelStateCtx.tsx` | Full model state snapshots | Low (every 25-50 iterations) |

## Other Contexts

| Context | Purpose |
|---|---|
| `SymbolContext.tsx` | Active symbol + timeframe selection (shared across pages) |
| `ActiveModelContext.tsx` | Currently selected ML model |
| `ChartOverlayContext.tsx` | Chart overlay configuration (regime colors, predictions) |
| `ChatContext.tsx` | Ollama LLM chat state (messages, streaming) |
| `DashboardLogContext.tsx` | Dashboard-wide event log |
| `UnifiedDashboardContext.tsx` | Combined dashboard state provider |
| `dashboardTypes.ts` | Shared dashboard type definitions |

## Provider Tree

```
QueryClientProvider
  UnifiedDashboardProvider
    TrainingProvider
      TrainingMetricsProvider
        TrainingLogsProvider
          TrainingOverlaysProvider
            TrainingModelStateProvider
              ChatProvider
                BreadcrumbProvider
                  Layout + Router
```
