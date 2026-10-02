import os
import re

# Mapping of old absolute paths (relative to apps/web/src) to new absolute paths
path_map = {
    'components/ui': 'shared/ui',
    'components/layout': 'shared/layout',
    'contexts': 'shared/contexts',
    'lib/utils': 'shared/utils/utils',
    'lib/format': 'shared/utils/format',
    'lib/types': 'shared/utils/types',
    'lib/api_service': 'infrastructure/api/api_service',
    'lib/query_client': 'infrastructure/api/query_client',
    'lib/fetch_array': 'infrastructure/api/fetch_array',
    'lib/ohlcv_cache': 'infrastructure/storage/ohlcv_cache',
    'lib/ring_buffer': 'infrastructure/storage/ring_buffer',
    'lib/error_logger': 'infrastructure/lib/error_logger',
    'lib/prefetch': 'infrastructure/lib/prefetch',
    'hooks/useBreadcrumbs': 'shared/hooks/useBreadcrumbs',
    'hooks/useWebVitals': 'shared/hooks/useWebVitals',
    'hooks/useGlobalShortcuts': 'shared/hooks/useGlobalShortcuts',
    'hooks/useNativeMenu': 'shared/hooks/useNativeMenu',
    'hooks/use-toast': 'shared/hooks/use-toast',
    'hooks/use-mobile': 'shared/hooks/use-mobile',
    'hooks/useDebounce': 'shared/hooks/useDebounce',
    'hooks/useDeferredFilter': 'shared/hooks/useDeferredFilter'
}

domain_hooks = {
    'useActiveIndicators': 'market/lib/useActiveIndicators',
    'useChartOHLCV': 'market/lib/useChartOHLCV',
    'useIndicatorData': 'market/lib/useIndicatorData',
    'useIndicatorWorker': 'market/lib/useIndicatorWorker',
    'useLocalReplay': 'market/lib/useLocalReplay',
    'useCurriculum': 'training/lib/useCurriculum',
    'useExperiments': 'training/lib/useExperiments',
    'useHpoTrials': 'training/lib/useHpoTrials',
    'useTraining': 'training/lib/useTraining',
    'useTrainingConfig': 'training/lib/useTrainingConfig',
    'useTrainingLiveState': 'training/lib/useTrainingLiveState',
    'useTrainingMetrics': 'training/lib/useTrainingMetrics',
    'useTrainingSSE': 'training/lib/useTrainingSSE',
    'useTrainingSync': 'training/lib/useTrainingSync',
    'useEvaluationResults': 'ml/lib/useEvaluationResults',
    'useMLData': 'ml/lib/useMLData',
    'useModelCatalog': 'ml/lib/useModelCatalog',
    'useModelCheckpoints': 'ml/lib/useModelCheckpoints',
    'useModelComparison': 'ml/lib/useModelComparison',
    'useModelHistory': 'ml/lib/useModelHistory',
    'useRegimeData': 'ml/lib/useRegimeData',
    'useRegimeSSE': 'ml/lib/useRegimeSSE',
    'useVisualizationRegistry': 'ml/lib/useVisualizationRegistry',
    'useTrainedModels': 'ml/lib/useTrainedModels',
    'useAgentDispatch': 'deployment/lib/useAgentDispatch',
    'useDeploymentEvents': 'deployment/lib/useDeploymentEvents',
    'useTradeMetrics': 'portfolio/lib/useTradeMetrics',
    'useGpuMetrics': 'system/lib/useGpuMetrics',
    'useSystemManifest': 'system/lib/useSystemManifest',
    'useSystemMatrix': 'system/lib/useSystemMatrix',
    'useTerminalSession': 'system/lib/useTerminalSession',
    'useTimeTracker': 'system/lib/useTimeTracker',
    'useSpeedAudit': 'system/lib/useSpeedAudit',
    'useElectron': 'infrastructure/lib/useElectron',
    'useEventStream': 'infrastructure/lib/useEventStream',
    'useSSEConnection': 'infrastructure/lib/useSSEConnection',
    'usePersistedMetrics': 'infrastructure/lib/usePersistedMetrics',
    'useMetricDescriptions': 'infrastructure/lib/useMetricDescriptions',
    'usePipelineState': 'infrastructure/lib/usePipelineState'
}

for k, v in domain_hooks.items():
    path_map[f'hooks/{k}'] = v

domain_libs = {
    'indicator_compute': 'market/lib/indicator_compute',
    'indicator_display': 'market/lib/indicator_display',
    'indicator_panels': 'market/lib/indicator_panels',
    'indicator_registry': 'market/lib/indicator_registry',
    'overlay_calculators': 'market/lib/overlay_calculators',
    'subchart_calculators': 'market/lib/subchart_calculators',
    'timeframes': 'market/lib/timeframes',
    'candle_patterns': 'market/lib/candle_patterns',
    'ml_models': 'ml/lib/ml_models',
    'model_resolver': 'ml/lib/model_resolver',
    'metric_extractors': 'ml/lib/metric_extractors',
    'diagnostics-schema': 'ml/lib/diagnostics-schema',
    'risk': 'portfolio/lib/risk',
    'upload_utils': 'data/lib/upload_utils'
}

for k, v in domain_libs.items():
    path_map[f'lib/{k}'] = v

root_dir = os.path.abspath('apps/web/src')

import_re = re.compile(r'(from|import\(|import)\s+[\'"](@/[^\'"]+|(\.\.?/[^\'"]+))[\'"]')

for root, dirs, files in os.walk(root_dir):
    for file in files:
        if file.endswith('.ts') or file.endswith('.tsx'):
            path = os.path.join(root, file)
            abs_current_file = os.path.abspath(path)
            
            try:
                with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                
                def replace_match(match):
                    prefix = match.group(1)
                    import_path = match.group(2)
                    
                    target_rel_to_src = None
                    if import_path.startswith('@/'):
                        target_rel_to_src = import_path[2:]
                    elif import_path.startswith('.'):
                        abs_import = os.path.normpath(os.path.join(os.path.dirname(abs_current_file), import_path))
                        if abs_import.startswith(root_dir):
                            target_rel_to_src = os.path.relpath(abs_import, root_dir).replace('\\', '/')
                    
                    if target_rel_to_src:
                        sorted_keys = sorted(path_map.keys(), key=len, reverse=True)
                        for old in sorted_keys:
                            if target_rel_to_src == old or target_rel_to_src.startswith(old + '/'):
                                new = path_map[old]
                                new_path = f'@/{new}' + target_rel_to_src[len(old):]
                                return f'{prefix} "{new_path}"'
                    
                    return match.group(0)

                new_content = import_re.sub(replace_match, content)
                
                if new_content != content:
                    with open(path, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    print(f'Updated {path}')
            except Exception as e:
                print(f'Error processing {path}: {e}')
