# Frontend Refactoring TODO List

## Phase 1: Naming Convention Fixes (snake_case)
*Goal: Align with the "Operational Interface" naming philosophy (Level 2/3 snake_case).*

- [ ] Rename `src/client/src/lib/apiService.ts` -> `api_service.ts`
- [ ] Rename `src/client/src/lib/calculators/cyclePerformance.ts` -> `cycle_performance.ts`
- [ ] Rename `src/client/src/lib/calculators/mathPrimitives.ts` -> `math_primitives.ts`
- [ ] Rename `src/client/src/lib/calculators/momentumExtra.ts` -> `momentum_extra.ts`
- [ ] Rename `src/client/src/lib/calculators/overlayExtra.ts` -> `overlay_extra.ts`
- [ ] Rename `src/client/src/lib/calculators/statisticsExtra.ts` -> `statistics_extra.ts`
- [ ] Rename `src/client/src/lib/calculators/trendExtra.ts` -> `trend_extra.ts`
- [ ] Rename `src/client/src/lib/calculators/volatilityExtra.ts` -> `volatility_extra.ts`
- [ ] Rename `src/client/src/lib/calculators/volumeExtra.ts` -> `volume_extra.ts`
- [ ] Rename `src/client/src/lib/candlePatterns.ts` -> `candle_patterns.ts`
- [ ] Rename `src/client/src/lib/catalogTypes.ts` -> `catalog_types.ts`
- [ ] Rename `src/client/src/lib/chartOverlays.ts` -> `chart_overlays.ts`
- [ ] Rename `src/client/src/lib/errorLogger.ts` -> `error_logger.ts`
- [ ] Rename `src/client/src/lib/fetchArray.ts` -> `fetch_array.ts`
- [ ] Rename `src/client/src/lib/indicatorColors.ts` -> `indicator_colors.ts`
- [ ] Rename `src/client/src/lib/indicatorCompute.ts` -> `indicator_compute.ts`
- [ ] Rename `src/client/src/lib/indicatorDisplay.ts` -> `indicator_display.ts`
- [ ] Rename `src/client/src/lib/indicatorPanels.ts` -> `indicator_panels.ts`
- [ ] Rename `src/client/src/lib/indicatorRegistry.ts` -> `indicator_registry.ts`
- [ ] Rename `src/client/src/lib/metricExtractors.ts` -> `metric_extractors.ts`
- [ ] Rename `src/client/src/lib/mlModels.ts` -> `ml_models.ts`
- [ ] Rename `src/client/src/lib/modelResolver.ts` -> `model_resolver.ts`
- [ ] Rename `src/client/src/lib/overlayCalculators.ts` -> `overlay_calculators.ts`
- [ ] Rename `src/client/src/lib/queryClient.ts` -> `query_client.ts`
- [ ] Rename `src/client/src/lib/ringBuffer.ts` -> `ring_buffer.ts`
- [ ] Rename `src/client/src/lib/subchartCalculators.ts` -> `subchart_calculators.ts`
- [ ] Rename `src/client/src/lib/training/sseHandlers.ts` -> `sse_handlers.ts`
- [ ] Rename `src/client/src/lib/uploadUtils.ts` -> `upload_utils.ts`

## Phase 2: Modularize "God Files" (> 500 lines)
*Goal: Adhere to Single Responsibility Principle and maintainability.*

- [ ] **HPO Config Panel:** Split `src/client/src/components/training/HPOConfigPanel.tsx` (1155 lines) into sub-panels (Search Space, Objectives, Resources).
- [ ] **Candle Patterns:** Split `src/client/src/lib/candlePatterns.ts` (1404 lines) by pattern category.
- [ ] **ML Models:** Split `src/client/src/lib/mlModels.ts` (1458 lines) by model architecture type.
- [ ] **Subchart Calculators:** Split `src/client/src/lib/subchartCalculators.ts` (1436 lines) similarly to the indicator compute modularization.
- [ ] **Curriculum Content:** Refactor the 1800+ line files in `src/client/src/lib/curriculum/content/` into smaller, lesson-based modules.
- [ ] **Sidebar Component:** Clean up and split `src/client/src/components/ui/sidebar.tsx` (728 lines).
- [ ] **Indicator Selector:** Modularize the search/filtering logic in `src/client/src/components/IndicatorSelector.tsx` (548 lines).

## Phase 3: Page-Level Refactoring
- [ ] **Fourier Transform:** Modularize `src/client/src/pages/fourier-transform/FourierTransform.tsx` (894 lines).
- [ ] **Settings:** Extract sub-sections from `src/client/src/pages/Settings.tsx` (734 lines) into separate components.
- [ ] **Model Catalog:** Modularize the grid/list views in `src/client/src/pages/ModelCatalog.tsx` (608 lines).
