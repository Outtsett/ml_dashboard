/**
 * The hover text for a metric: how the engine computes it, with the formula.
 * One definition per quantity (`@shared/runs/metricDefinitions`), shown wherever
 * the number is shown.
 */
import { metricDefinition } from "@shared/runs/metricDefinitions";

export function howComputed(name: string, label?: string): string {
  const definition = metricDefinition(name);
  if (!definition) return label ?? name;
  return `${label ?? name}\n\nHow it is computed: ${definition.how}\n\nFormula: ${definition.formula}`;
}
