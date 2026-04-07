# Frontend Development Skill

Build and modify the ML Dashboard UI using established patterns.

## Instructions

When the user wants to add or modify UI components, follow the conventions documented below. Always use existing patterns — don't introduce new libraries or paradigms.

## Component Patterns

### Page Structure
Every page follows this pattern:
```tsx
// Lazy-loaded in App.tsx
const NewPage = lazy(() => import("./pages/NewPage"));

// In the Switch:
<Route path="/new-page">
  <ErrorBoundary>
    <Suspense fallback={<DataGridSkeleton />}>
      <NewPage />
    </Suspense>
  </ErrorBoundary>
</Route>
```

Add navigation entry in `client/src/components/Layout.tsx` sidebar (icon from `lucide-react`).

### Data Fetching
Use React Query hooks with the established query client. **Always pass signal for request cancellation:**
```tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Query — ALWAYS destructure signal in queryFn
const { data, isLoading, error } = useQuery({
  queryKey: ["models"],
  queryFn: async ({ signal }) => {
    const res = await fetch("/api/ml/models", { signal });
    if (!res.ok) throw new Error("Failed");
    return res.json();
  },
});

// Mutation with optimistic update + rollback
const qc = useQueryClient();
const mutation = useMutation({
  mutationFn: (id: string) => apiRequest("DELETE", `/api/models/${id}`),
  onMutate: async (id) => {
    await qc.cancelQueries({ queryKey: ["models"] });
    const previous = qc.getQueryData(["models"]);
    qc.setQueryData(["models"], (old: any[]) => old?.filter(m => m.id !== id) ?? []);
    return { previous };
  },
  onError: (_err, _id, ctx) => { if (ctx?.previous) qc.setQueryData(["models"], ctx.previous); },
  onSettled: () => qc.invalidateQueries({ queryKey: ["models"] }),
});
```

**Query client config:** 5min staleTime, 10min gcTime, 1 retry, exponential backoff. AbortSignal auto-passed.

### Prefetching
Use hover-based prefetching from `client/src/lib/prefetch.ts` for nav links.

### Client-Side Caching (IndexedDB)
Use `idb` library for persistent client-side caching. See pattern in `client/src/lib/ohlcv_cache.ts`:
- `getCachedBars(symbol, timeframe)` — check cache before network
- `storeBars(symbol, timeframe, bars)` — persist after fetch (fire-and-forget)
- 24h TTL, range merging, dedup by timestamp

### MessagePack for Bulk Data
For large array responses (>10KB), request binary MessagePack:
```tsx
import { decode as msgpackDecode } from '@msgpack/msgpack';
const res = await fetch(url, { signal, headers: { 'Accept': 'application/msgpack' } });
const contentType = res.headers.get('content-type') || '';
if (contentType.includes('application/msgpack')) {
  return msgpackDecode(new Uint8Array(await res.arrayBuffer()));
}
return res.json();
```

## Visualization Components

8 specialized visualizations in `client/src/components/visualizations/`:

| Component | Use Case | Library |
|-----------|----------|---------|
| `AnomalyTimeline` | Anomaly detection overlay on time series | Recharts |
| `ComponentLoadings` | PCA/dimensionality reduction loadings | Recharts |
| `ConfusionMatrixHeatmap` | Classification confusion matrix | D3 |
| `EmbeddingScatter` | 2D/3D embedding visualization | Three.js / React Three Fiber |
| `ForceDirectedCluster` | Cluster relationship graphs | D3 force simulation |
| `ForecastRibbon` | Time-series forecast with confidence bands | Recharts |
| `ResidualPlot` | Regression residual analysis | Recharts |
| `SimilarityMatrix` | Model/feature similarity heatmap | D3 |

The `VisualizationOrchestrator` component dynamically selects the appropriate visualization based on the ML category/subcategory.

### Additional Chart Components
- `TradingChart.tsx` — Interactive OHLC + volume (Lightweight Charts)
- `LossSurface3D.tsx` — 3D loss landscape during training (Three.js)
- `CategoryMetrics.tsx` — Metric cards per ML category

## UI Component Library

40+ shadcn/ui components in `client/src/components/ui/`. Key ones:

**Layout:** card, tabs, accordion, separator, scroll-area, sidebar, resizable-panels
**Forms:** input, button, button-group, checkbox, radio-group, select, slider, switch, textarea, field, form
**Feedback:** toast (sonner), progress, skeleton, spinner, empty
**Overlays:** dialog, alert-dialog, drawer, popover, tooltip, hover-card, dropdown-menu, command
**Navigation:** navigation-menu, breadcrumb, pagination, menubar

### Creating New Components
Follow shadcn/ui patterns — compose from Radix primitives with `class-variance-authority` for variants:
```tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const myComponentVariants = cva("base-classes", {
  variants: {
    variant: { default: "...", destructive: "..." },
    size: { sm: "...", md: "...", lg: "..." },
  },
  defaultVariants: { variant: "default", size: "md" },
});
```

## Styling

### Tailwind CSS v4
- Config: `@tailwindcss/vite` plugin (no tailwind.config.js needed)
- Utility-first, dark mode via `next-themes`
- Glass-morphism: `backdrop-blur-md bg-white/10 border border-white/20`
- Gradients: Use existing gradient system from the theme

### Class Merging
Always use `cn()` from `@/lib/utils` (wraps `clsx` + `tailwind-merge`):
```tsx
import { cn } from "@/lib/utils";
<div className={cn("base-class", isActive && "active-class", className)} />
```

## Loading States

Use existing skeleton components from `client/src/components/LoadingSkeletons.tsx`:
- `DashboardSkeleton` — Full dashboard layout placeholder
- `MLHubSkeleton` — ML Hub page placeholder
- `DataGridSkeleton` — Generic data grid placeholder
- `ChartSkeleton` — Chart area placeholder
- `PageLoader` — Minimal spinner

## Error Handling

Wrap pages in `ErrorBoundary` (already done in App.tsx). For component-level errors, use the toast system:
```tsx
import { useToast } from "@/hooks/use-toast";
const { toast } = useToast();
toast({ title: "Error", description: "Something went wrong", variant: "destructive" });
```

## Pages Needing Implementation

### Portfolio (`/portfolio`)
Currently a stub. Needs:
- Trade history table (data: `GET /api/ml/trades`)
- P&L summary cards
- Performance chart (equity curve)
- Position management

### News (`/news`)
Currently a stub. Needs:
- News feed from `GET /api/news/combined/:symbol`
- Sentiment indicators (bullish/bearish/neutral badges)
- SSE streaming: `GET /api/news/stream/:symbol`
- Article detail view

## Path Aliases
```
@/* → client/src/*
@shared/* → shared/*
@assets/* → attached_assets/*
```

## Key Files
- `client/src/App.tsx` — Router, providers, lazy imports
- `client/src/components/Layout.tsx` — Sidebar, nav, system status
- `client/src/components/ErrorBoundary.tsx` — Error wrapper
- `client/src/components/LoadingSkeletons.tsx` — Skeleton components
- `client/src/lib/queryClient.ts` — React Query setup
- `client/src/lib/mlModels.ts` — 50+ ML model definitions (1340 lines)
- `client/src/lib/utils.ts` — cn() and utilities
- `client/src/types.ts` — TypeScript interfaces
- `shared/mlTaxonomy.ts` — ML taxonomy (1604 lines)
