/**
 * The metrics panel bound to its two sources: a catalog specification (by spec
 * id) and a runnable model (by registry key or runner key). Each fetches the
 * model's own record and the metric registry, then draws `ModelMetricsPanel`.
 */
import { useMetricRegistry, useModelMetrics, useSpecificationMetrics } from "@/ml/metrics/api";
import { ModelMetricsPanel, ModelMetricsState } from "@/ml/metrics/ModelMetricsPanel";

/** How a catalog specification is judged; opens on the native layer. */
export function SpecificationMetricsPanel({ specificationId, name }: { specificationId: string; name: string }) {
  const registry = useMetricRegistry();
  const metrics = useSpecificationMetrics(specificationId);
  return (
    <ModelMetricsState
      loading={registry.isLoading || metrics.isLoading}
      error={(registry.error as Error | null) ?? (metrics.error as Error | null)}
      absent={metrics.data === null ? `${name} carries no metrics record: it is not one of the catalog's written specifications.` : null}
    >
      {registry.data && metrics.data && <ModelMetricsPanel key={specificationId} record={metrics.data.record} registry={registry.data} modelName={metrics.data.name} />}
    </ModelMetricsState>
  );
}

/** How a runnable model is judged; opens on the as-run layer, the one a run's numbers belong to. */
export function RunnableModelMetricsPanel({ modelKey }: { modelKey: string }) {
  const registry = useMetricRegistry();
  const metrics = useModelMetrics(modelKey);
  return (
    <ModelMetricsState
      loading={registry.isLoading || metrics.isLoading}
      error={(registry.error as Error | null) ?? (metrics.error as Error | null)}
      absent={metrics.data === null ? `The model ${modelKey} carries no metrics record.` : null}
    >
      {registry.data && metrics.data && (
        <ModelMetricsPanel key={modelKey} record={metrics.data.record} registry={registry.data} initialLayer="asRun" modelName={metrics.data.displayName} />
      )}
    </ModelMetricsState>
  );
}
