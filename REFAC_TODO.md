# Frontend Refactoring TODO List

## Phase 1: Naming Convention Fixes (snake_case)
*Goal: Align with the "Operational Interface" naming philosophy (Level 2/3 snake_case).*

- [x] Rename `src/client/src/lib/apiService.ts` -> `api_service.ts`
- [x] Rename `src/client/src/lib/calculators/cyclePerformance.ts` -> `cycle_performance.ts`
- [x] Rename `src/client/src/lib/calculators/mathPrimitives.ts` -> `math_primitives.ts`
- [x] Rename `src/client/src/lib/calculators/momentumExtra.ts` -> `momentum_extra.ts`
- [x] Rename `src/client/src/lib/calculators/overlayExtra.ts` -> `overlay_extra.ts`
- [x] Rename `src/client/src/lib/calculators/statisticsExtra.ts` -> `statistics_extra.ts`
- [x] Rename `src/client/src/lib/calculators/trendExtra.ts` -> `trend_extra.ts`
- [x] Rename `src/client/src/lib/calculators/volatilityExtra.ts` -> `volatility_extra.ts`
- [x] Rename `src/client/src/lib/calculators/volumeExtra.ts` -> `volume_extra.ts`
- [x] Rename `src/client/src/lib/candlePatterns.ts` -> `candle_patterns.ts`
- [x] Rename `src/client/src/lib/catalogTypes.ts` -> `catalog_types.ts`
- [x] Rename `src/client/src/lib/chartOverlays.ts` -> `chart_overlays.ts`
- [x] Rename `src/client/src/lib/errorLogger.ts` -> `error_logger.ts`
- [x] Rename `src/client/src/lib/fetchArray.ts` -> `fetch_array.ts`
- [x] Rename `src/client/src/lib/indicatorColors.ts` -> `indicator_colors.ts`
- [x] Rename `src/client/src/lib/indicatorCompute.ts` -> `indicator_compute.ts`
- [x] Rename `src/client/src/lib/indicatorDisplay.ts` -> `indicator_display.ts`
- [x] Rename `src/client/src/lib/indicatorPanels.ts` -> `indicator_panels.ts`
- [x] Rename `src/client/src/lib/indicatorRegistry.ts` -> `indicator_registry.ts`
- [x] Rename `src/client/src/lib/metricExtractors.ts` -> `metric_extractors.ts`
- [x] Rename `src/client/src/lib/mlModels.ts` -> `ml_models.ts`
- [x] Rename `src/client/src/lib/modelResolver.ts` -> `model_resolver.ts`
- [x] Rename `src/client/src/lib/overlayCalculators.ts` -> `overlay_calculators.ts`
- [x] Rename `src/client/src/lib/queryClient.ts` -> `query_client.ts`
- [x] Rename `src/client/src/lib/ringBuffer.ts` -> `ring_buffer.ts`
- [x] Rename `src/client/src/lib/subchartCalculators.ts` -> `subchart_calculators.ts`
- [x] Rename `src/client/src/lib/training/sseHandlers.ts` -> `sse_handlers.ts`
- [x] Rename `src/client/src/lib/uploadUtils.ts` -> `upload_utils.ts`

## Phase 2: Modularize "God Files" (> 500 lines)
*Goal: Adhere to Single Responsibility Principle and maintainability.*

- [x] **HPO Config Panel:** Split `src/client/src/components/training/HPOConfigPanel.tsx` (1155 lines) into sub-panels (Search Space, Objectives, Resources).
- [x] **Candle Patterns:** Split `src/client/src/lib/candlePatterns.ts` (1404 lines) by pattern category.
- [x] **ML Models:** Split `src/client/src/lib/mlModels.ts` (1458 lines) by model architecture type.
- [x] **Subchart Calculators:** Split `src/client/src/lib/subchartCalculators.ts` (1436 lines) similarly to the indicator compute modularization.
- [x] **Curriculum Content:** Refactor the 1800+ line files in `src/client/src/lib/curriculum/content/` into smaller, lesson-based modules.
- [x] **Sidebar Component:** Clean up and split `src/client/src/components/ui/sidebar.tsx` (728 lines).
- [x] **Indicator Selector:** Modularize the search/filtering logic in `src/client/src/components/IndicatorSelector.tsx` (548 lines).

## Phase 3: Page-Level Refactoring
- [x] **Fourier Transform:** Modularize `src/client/src/pages/fourier-transform/FourierTransform.tsx` (894 lines).
- [x] **Settings:** Extract sub-sections from `src/client/src/pages/Settings.tsx` (734 lines) into separate components.
- [x] **Model Catalog:** Modularize the grid/list views in `src/client/src/pages/ModelCatalog.tsx` (608 lines).



