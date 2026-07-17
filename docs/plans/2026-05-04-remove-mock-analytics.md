# Remove Mock Analytics — Implementation Plan

**Date:** 2026-05-04
**Status:** Phase 1 ✅ DONE · Phase 2 ✅ DONE · Phase 3 ✅ DONE · Phase 4 ✅ DONE (SSE compression bug)
**Scope:** wire real system metrics into the dashboard everywhere mock/synthetic/`Math.random()` data is currently served or rendered

## Audit summary (3 parallel Explore agents)

The dashboard is in better shape than the user's framing implied — Trade Lab, Hardware telemetry, Backtest run state, and Training metrics are all wired to real sources end-to-end. The mock surface clusters in two places:

### A. Client display-layer mocks
| File | Lines | What's mocked | Real source |
|---|---|---|---|
| `src/client/src/components/training/analytics/ClassificationPerformance.tsx` | 36–42 | Hardcoded 5-point calibration reliability curve | Real bins live in `diagnostics.calibration` (xaiServiceCore.ts:43 type) when computed by `range_evaluate.py` — currently empty in saved diagnostics |
| same | 122–127 | Hardcoded "Head Contribution" weights (Directional 0.65, Forward 0.25, Auxiliary 0.10) | The active model (`range_transformer`) is single-head — these head categories don't exist. Panel must be hidden, not faked. |
| same | 146 | Bars/sec computed as `100000 / epoch_time_sec` (assumes 100k bars per epoch) | SSE training metrics emit real throughput via `emit_metric()`. Read from `metrics.bars_per_sec` / `metrics.samples_per_sec` when streamed. |
| same | 151 | Hardcoded "Peak Saturation Active" status | Derive from `useGpuMetrics()` GPU utilization (>80% during active training session). |

### B. Server-fabricated "explainability" served as if real
The XAI subsystem at `src/server/lib/xai/` returns `Math.random()` outputs from these methods:

| File | Line(s) | What's fabricated |
|---|---|---|
| `xai/methods/calibration.ts` | 12, 13, 19 | reliability bins + accuracy + bin counts |
| `xai/methods/counterfactuals.ts` | 18, 26 | counterfactual examples |
| `xai/methods/permutation.ts` | 18 | permutation importance |
| `xai/methods/lime.ts` | 18, 26 | LIME perturbations + coefficients |
| `xai/xaiServiceCore.ts` | 176–177 | `generateMockPrediction()` — softmax over three random values |
| `xai/xaiMath.ts` | 20, 65 | importance noise + index sampling |
| `routes/ml/xai.ts` | 67–71 | synthetic OHLC input fallback (5 random fields × 30 bars) |

These reach two UI consumers:
- `src/client/src/components/explainable-ai/index.tsx` — calls `xaiApi.getMethods()` and `xaiApi.explain()`
- `src/client/src/components/sidebar/ml-workflow/XAITab` (mounted via `MLWorkflowSidebar` in Market Data — **but Market Data was deleted on 2026-05-04 in the Trade Lab consolidation, so this consumer is now dead code**)

The one **real** XAI path is `xaiServiceCore.getRegimeModelImportance()` which reads real per-feature SHAP values from the saved `diagnostics.shap_summary` array (`xaiServiceCore.ts:194`). That path stays.

### C. Dead/intentional Math.random hits (not analytics)
- `lib/labels/contrastivePairs.ts` — augmentation noise, intentional
- `lib/ptyServer.ts`, `lib/modelImport/*`, `core/manifest.service.ts` — IDs / non-metric uses
- `pages/fourier-transform/math.ts` — explicit "custom wave" demo input
- `pages/architecture-explorer/HybridDetail.tsx:58` — decorative dot opacity

These are **out of scope** — they don't display fake metrics to the user.

## Phases

### Phase 1 — Fix `ClassificationPerformance.tsx` (4 mocks) ✅ DONE 2026-05-04

For each of the four mocks, the rule is: read real value from data source if available, otherwise hide the panel with an empty-state message — **never fabricate**.

1. **Calibration curve** — read `diagnostics.calibration?.reliabilityDiagram` from props. If absent, render empty state `"Calibration not computed for this model"`. Drop the hardcoded 5-point array.
2. **Head Contribution** — wrap entire panel in `{diagnostics.head_weights ? <panel /> : null}`. The trading_model is single-head; this panel will simply not render. When a future multi-head model emits `head_weights`, the panel comes back automatically.
3. **Training Velocity** — read `metrics.bars_per_sec` || `metrics.samples_per_sec` || `metrics.throughput_bps` from `diagnostics.best_metrics`. If none available, render `"--"`. Remove the synthetic `100000 / epoch_time_sec` fallback.
4. **Peak Saturation status** — replace hardcoded text with derivation from `useGpuMetrics()`: utilization ≥ 80 → "Peak Saturation Active" (emerald), 50–79 → "Active" (amber), <50 → "Idle" (muted). Component must call the hook directly.

### Phase 2 — Decommission fake XAI subsystem ✅ DONE 2026-05-04

User direction: "get rid of it." Full cut taken. Verified that both consumers (`components/explainable-ai/index.tsx` and `components/sidebar/ml-workflow/MLWorkflowSidebar`) were already orphaned — neither is mounted in any page route after the Trade Lab consolidation, so removing them was pure dead-code cleanup.

**Server deleted:**
- `src/server/lib/xai/methods/{calibration,counterfactuals,permutation,lime,saliency,gradcam,integratedGradients,featureInteractions,shap,index}.ts`
- `src/server/lib/xai/{xaiMath,xaiMethods,xaiService,xaiServiceCore,xaiTypes}.ts`
- `src/server/lib/xai/` directory
- `src/server/xai/{xai.module,xai.service}.ts` (Nest module wrapping the fake service)
- `src/server/xai/` directory

**Server slimmed:**
- `src/server/routes/ml/xai.ts` rewritten to keep only `/xai/regime-importance/:modelId` and `/xai/shap/:modelId` (both backed by real saved SHAP data — `diag.shap_summary` aggregated per regime + `oos_shap.npz` per-bar). `getRegimeModelImportance()` inlined into the route file. Deleted: `/xai/methods`, `/xai/explain`, `/xai/explain-batch`, the synthetic OHLC fallback (`Math.random()` price walk).
- `src/server/app.module.ts` — removed `XaiModule` import and registration.

**Client deleted:**
- `src/client/src/components/ExplainableAI.tsx` (re-export shim)
- `src/client/src/components/explainable-ai/{index,types,visualizations}.tsx` + directory
- `src/client/src/components/sidebar/MLWorkflowSidebar.tsx` (re-export shim)
- `src/client/src/components/sidebar/ml-workflow/{index,LabelsTab,XAITab,TrainTab,BacktestTab,types}.tsx` + directory

**Client slimmed:**
- `src/client/src/lib/api_service.ts` — removed `mlApi.getXAI()`, removed `xaiApi.getMethods()` and `xaiApi.explain()`. Kept `xaiApi.getRegimeImportance()` and `xaiApi.getShap()` (real paths).
- `src/client/src/lib/types.ts` — removed `QUERY_KEYS.xaiMethods`.

**Verification:**
- `npx tsc --noEmit` — zero new errors.
- `npm run build` — clean (29.76s frontend, 662ms server).
- `GET /api/xai/methods` → 404 ✓
- `POST /api/xai/explain` → 404 ✓
- `GET /api/ml/xai/foo` → 404 ✓
- `GET /api/xai/regime-importance/MNQ_1m_cnn_transformer` → `{"success":true,"importance":[]}` ✓ (empty because that deprecated model has no `shap_summary` in its diagnostics — correct behavior)

### Phase 3 — System Manifest endpoint live ✅ DONE 2026-05-04

User report after Phase 1: "i still dont see my actual systemmetrics still." Investigation found the real bug — completely separate from the mock surface:

**Root cause:** `src/server/main.ts:205` bootstraps NestJS via `NestFactory.createApplicationContext`, which is a DI-only container with NO HTTP routing. `SystemController.@Get('manifest')` (decorated route in `src/server/core/system.controller.ts`) was never registered. `/api/system/manifest` returned 404, which broke `useSystemManifest()` hook, which made the sidebar `SystemStats` widget show '--' for CPU / RAM / storage (only the GPU block worked because it uses the SSE channel, not the manifest).

**Fix:** Added an Express bridge route in `src/server/routes/system.ts` that calls `getNestApp().get(ManifestService).generateManifest()` directly — same Nest DI pattern used by `routes/training.ts`. Also patched `load_avg` from the live `hardware_node.py` snapshot's real `cpu.load` percentage (Windows `os.loadavg()` always returns `[0,0,0]`, which would have made the CPU gauge always read 0%). Patched `manifest.hardware.gpu` from the live snapshot too so the manifest matches what the SSE channel emits.

**Verification (executed 2026-05-04):** `GET /api/system/manifest` returns:
- `cores: 12, threads: 24` (Ryzen 9 7900X)
- `total_ram_gb: 127, free_ram_gb: 84` (128GB DDR5)
- `load_avg: [2.352, 2.352, 2.352]` (back-solved from real cpu.load)
- `gpu: { utilization: 16, memory_used_mb: 3792.9, memory_total_mb: 16311, temperature: 46 }` (RTX 5060 Ti)
- `infrastructure.storage.free_gb: 363.4`
- `inventory.total_models: 4`
- `infrastructure.questdb.connected: false` — real, since QuestDB isn't running right now

Sidebar `SystemStats` widget now shows real values for all blocks (CPU / RAM / storage / GPU).

### Phase 4 — SSE Brotli buffering bug ✅ DONE 2026-05-04

User report after Phase 3: Hardware page showed `"SSE live · 0 pts · no data"` despite the connection opening successfully. Sidebar SystemStats also showed all zeros (no live block updates).

**Reproduction:**
- `curl -sN http://localhost:5000/api/events/system` → events fire at ~1Hz with full real telemetry.
- Browser EventSource → connects successfully (`onopen` fires, `connected: true`) but **zero events arrive on any listener**, including the immediate `connected` channel-open event.
- Headers diff: curl-without-Accept-Encoding gets uncompressed stream (works); browser sends `Accept-Encoding: gzip, br` and gets `Content-Encoding: br` applied to the SSE response (broken — Brotli buffers chunks until full block, never flushing the event boundaries to the EventSource parser).

**Root cause:** `src/server/main.ts:78` registers `compression()` middleware with a filter that only skipped paths containing `/stream/`. The SSE event channel is `/api/events/system` — doesn't contain `/stream/` — so compression was applied. With Brotli enabled (default in modern browsers), the response body is buffered indefinitely, and the EventSource never receives a single event.

**Fix:** Extended the filter in `src/server/main.ts` to also skip paths containing `/events/` and any response with `Content-Type: text/event-stream` already set on the response (defense-in-depth — catches future SSE endpoints under any path).

```ts
filter: (req: Request, res: Response) => {
  if (req.path.includes('/stream/')) return false;
  if (req.path.includes('/events/')) return false;
  if (res.getHeader('Content-Type') === 'text/event-stream') return false;
  if (process.env.NODE_ENV === 'production' && req.path.startsWith('/assets/')) return false;
  return true;
},
```

**Verification (executed 2026-05-04 in real browser via Playwright at host.docker.internal:5000/hardware):**
- Headers: `Vary: Origin` only (no `Accept-Encoding`), no `Content-Encoding` header — confirms compression bypassed.
- Browser EventSource immediately receives `connected`, then `system.matrix` and `system.gpu` at ~1Hz with full payloads.
- Hardware page: `"SSE live · 11 pts · cpu 19%"` — counter incrementing.
- All cards live: CPU LOAD 18.8%, MEM ACTIVE 37.8% (48.1 / 127 GB), FREQ 4.70 GHz, 24 CORES ACTIVE with per-core values, I/O 23.06 KB/s down · 95.83 KB/s up, GPU 14% / 47°C / 23.6% VRAM.
- GPU page: 5 radial gauges + VRAM bar + 6 time-series charts all populated, device specs Fan 36% / Power Limit 180W / Memory Clock 14001 MHz.
- Sidebar SystemStats: 47°C GPU, Load 14, VRAM 24, CPU 19, RAM 38, Storage 363.3G — all live.

**Why curl worked but browser didn't:** curl by default does NOT send `Accept-Encoding`, so Express compression middleware skipped compression even when its filter let the path through. Earlier "verification" via curl was a false positive — the bug only manifests when the client (browser) negotiates compression.

### Phase 3 — Final mock sweep — ✅ verified clean

Confirmed via grep that no `Math.random()` remains in any client analytics component or server response path. Remaining `Math.random()` hits are:
- `lib/labels/contrastivePairs.ts` — augmentation noise (intentional, ML training augmentation)
- `pages/fourier-transform/math.ts` — explicit "custom wave" demo input
- `pages/architecture-explorer/HybridDetail.tsx:58` — decorative dot opacity
- `lib/ptyServer.ts`, `lib/modelImport/*` — terminal session IDs / non-metric uses

## Verification

Per phase:

| Phase | Test |
|---|---|
| 1 | `npx tsc --noEmit` clean for the touched file. Manual: open `/training` Performance tab against a real trained model — calibration panel either shows real bins or empty state; Head Contribution hidden for single-head model; bars/sec shows real number from SSE; saturation status reflects live GPU. |
| 2 | After Cut A: `xaiApi.explain({ method: 'calibration' \| 'lime' \| 'permutation' \| 'counterfactuals' })` returns 501. SHAP path still works. `npm run build` clean. |
| 3 | Audit grep returns only documented intentional Math.random hits. |

## Files touched (Phase 1)

- `E:\source\repos\ml_dashboard\src\client\src\components\training\analytics\ClassificationPerformance.tsx` — replaced 4 fabricated values with real data sources or empty states; added `useGpuMetrics()` for live saturation status; introduced typed interfaces for `CalibrationBin` and `HeadWeight`; calibration panel and head contribution panel now render conditionally on real data presence; throughput shows real `samples/sec` from streamed metrics or computed from `n_train / epoch_time_sec`.

## Phase 1 verification (2026-05-04)

- `npx tsc --noEmit` — only the 7 pre-existing errors in `metric_extractors.ts` and `pages/fourier-transform/`. Zero from this work.
- `npm run build` — clean. 30.13s frontend, 709ms server.
- Visual: not yet validated against a live training session — empty-state paths cover the case where no `head_weights` / `calibration` is emitted.

## Phase 2/3 will be added as separate commits after user signs off on the XAI cut decision.
