/**
 * k-nearest neighbors arithmetic for the Inside view: the neighbors sorted
 * closest first, and the (weighted) vote of the first k of them — the share
 * that went up for a direction model, the weighted mean move for a price
 * model. With the model's own k this is the model's output.
 */
import type { CycleExplainBar } from "@shared/cycle/explain";

export interface Neighbor {
  timestamp: number;
  distance: number;
  target: number;
  weight: number;
}

export function sortedNeighbors(block: NonNullable<CycleExplainBar["neighbors"]>): Neighbor[] {
  return block.timestamps
    .map((timestamp, index) => ({
      timestamp,
      distance: block.distances[index] ?? Number.NaN,
      target: block.targets[index] ?? Number.NaN,
      weight: block.weights[index] ?? 0,
    }))
    .sort((a, b) => a.distance - b.distance);
}

/** Σ weight × target ÷ Σ weight over the first `count` neighbors; null when their weights sum to zero. */
export function neighborVote(neighbors: Neighbor[], count: number): number | null {
  let weighted = 0;
  let weightSum = 0;
  for (const neighbor of neighbors.slice(0, Math.max(0, count))) {
    weighted += neighbor.weight * neighbor.target;
    weightSum += neighbor.weight;
  }
  return weightSum > 0 ? weighted / weightSum : null;
}
