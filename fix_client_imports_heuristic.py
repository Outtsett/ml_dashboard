import os
import re

# Mapping of leaf filename to new @/ alias
leaf_map = {
    'useActiveIndicators': '@/market/lib/useActiveIndicators',
    'useChartOHLCV': '@/market/lib/useChartOHLCV',
    'useIndicatorData': '@/market/lib/useIndicatorData',
    'useIndicatorWorker': '@/market/lib/useIndicatorWorker',
    'useLocalReplay': '@/market/lib/useLocalReplay',
    'useCurriculum': '@/training/lib/useCurriculum',
    'useExperiments': '@/training/lib/useExperiments',
    'useHpoTrials': '@/training/lib/useHpoTrials',
    'useTraining': '@/training/lib/useTraining',
    'useTrainingConfig': '@/training/lib/useTrainingConfig',
    'useTrainingLiveState': '@/training/lib/useTrainingLiveState',
    'useTrainingMetrics': '@/training/lib/useTrainingMetrics',
    'useTrainingSSE': '@/training/lib/useTrainingSSE',
    'useTrainingSync': '@/training/lib/useTrainingSync',
    'useEvaluationResults': '@/ml/lib/useEvaluationResults',
    'useMLData': '@/ml/lib/useMLData',
    'useModelCatalog': '@/ml/lib/useModelCatalog',
    'useModelCheckpoints': '@/ml/lib/useModelCheckpoints',
    'useModelComparison': '@/ml/lib/useModelComparison',
    'useModelHistory': '@/ml/lib/useModelHistory',
    'useRegimeData': '@/ml/lib/useRegimeData',
    'useRegimeSSE': '@/ml/lib/useRegimeSSE',
    'useVisualizationRegistry': '@/ml/lib/useVisualizationRegistry',
    'useTrainedModels': '@/ml/lib/useTrainedModels',
    'useAgentDispatch': '@/deployment/lib/useAgentDispatch',
    'useDeploymentEvents': '@/deployment/lib/useDeploymentEvents',
    'useTradeMetrics': '@/portfolio/lib/useTradeMetrics',
    'useGpuMetrics': '@/system/lib/useGpuMetrics',
    'useSystemManifest': '@/system/lib/useSystemManifest',
    'useSystemMatrix': '@/system/lib/useSystemMatrix',
    'useTerminalSession': '@/system/lib/useTerminalSession',
    'useTimeTracker': '@/system/lib/useTimeTracker',
    'useSpeedAudit': '@/system/lib/useSpeedAudit',
    'useElectron': '@/infrastructure/lib/useElectron',
    'useEventStream': '@/infrastructure/lib/useEventStream',
    'useSSEConnection': '@/infrastructure/lib/useSSEConnection',
    'usePersistedMetrics': '@/infrastructure/lib/usePersistedMetrics',
    'useMetricDescriptions': '@/infrastructure/lib/useMetricDescriptions',
    'usePipelineState': '@/infrastructure/lib/usePipelineState',
    'useBreadcrumbs': '@/shared/hooks/useBreadcrumbs',
    'useWebVitals': '@/shared/hooks/useWebVitals',
    'useGlobalShortcuts': '@/shared/hooks/useGlobalShortcuts',
    'useNativeMenu': '@/shared/hooks/useNativeMenu',
    'use-toast': '@/shared/hooks/use-toast',
    'use-mobile': '@/shared/hooks/use-mobile',
    'useDebounce': '@/shared/hooks/useDebounce',
    'useDeferredFilter': '@/shared/hooks/useDeferredFilter',
    'api_service': '@/infrastructure/api/api_service',
    'query_client': '@/infrastructure/api/query_client',
    'fetch_array': '@/infrastructure/api/fetch_array',
    'ohlcv_cache': '@/infrastructure/storage/ohlcv_cache',
    'ring_buffer': '@/infrastructure/storage/ring_buffer',
    'error_logger': '@/infrastructure/lib/error_logger',
    'prefetch': '@/infrastructure/lib/prefetch',
    'utils': '@/shared/utils/utils',
    'format': '@/shared/utils/format',
    'indicator_compute': '@/market/lib/indicator_compute',
    'indicator_display': '@/market/lib/indicator_display',
    'indicator_panels': '@/market/lib/indicator_panels',
    'indicator_registry': '@/market/lib/indicator_registry',
    'overlay_calculators': '@/market/lib/overlay_calculators',
    'subchart_calculators': '@/market/lib/subchart_calculators',
    'timeframes': '@/market/lib/timeframes',
    'candle_patterns': '@/market/lib/candle_patterns',
    'ml_models': '@/ml/lib/ml_models',
    'model_resolver': '@/ml/lib/model_resolver',
    'metric_extractors': '@/ml/lib/metric_extractors',
    'diagnostics-schema': '@/ml/lib/diagnostics-schema',
    'risk': '@/portfolio/lib/risk',
    'upload_utils': '@/data/lib/upload_utils',
    'TrainingContext': '@/training/lib/TrainingContext',
    'TrainingMetricsCtx': '@/training/lib/TrainingMetricsCtx',
    'TrainingLogsCtx': '@/training/lib/TrainingLogsCtx',
    'TrainingOverlaysCtx': '@/training/lib/TrainingOverlaysCtx',
    'TrainingModelStateCtx': '@/training/lib/TrainingModelStateCtx',
}

# Domain specific types fixes
domain_types = {
    'src/client/src/training': '@/training/lib/types',
    'src/client/src/market': '@/market/lib/types',
    'src/client/src/ml': '@/ml/lib/types',
    'src/client/src/backtest': '@/backtest/types',
}

root_dir = 'src/client/src'

import_re = re.compile(r'(from|import\(|import)\s+[\'"]([^\'"]+)[\'"]')

for root, dirs, files in os.walk(root_dir):
    for file in files:
        if file.endswith('.ts') or file.endswith('.tsx'):
            path = os.path.join(root, file).replace('\\', '/')
            try:
                with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                
                def replace_match(match):
                    prefix = match.group(1)
                    import_path = match.group(2)
                    
                    leaf = import_path.split('/')[-1]
                    if leaf in leaf_map:
                        return f'{prefix} "{leaf_map[leaf]}"'
                    
                    if leaf == 'types' or leaf == '../types' or leaf == '../../types':
                        for domain, alias in domain_types.items():
                            if path.startswith(domain):
                                return f'{prefix} "{alias}"'
                        return f'{prefix} "@/shared/utils/types"'

                    return match.group(0)

                new_content = import_re.sub(replace_match, content)
                
                if new_content != content:
                    with open(path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f'Updated {path}')
            except Exception as e:
                print(f'Error processing {path}: {e}')
