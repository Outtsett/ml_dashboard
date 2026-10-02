import { useQuery } from "@tanstack/react-query";
import { useCatalogList } from "@/ml/lib/useModelCatalog";
import { allStudies } from "@/studies/registry";

export interface DatasetEntity {
  id: string;
  name: string;
  category: string;
  description?: string;
}

export interface FeatureEntity {
  id: string;
  name: string;
  category: string;
  description?: string;
}

export interface StrategyEntity {
  id: string;
  name: string;
  description?: string;
}

export function useEntityModels() {
  const { data, isLoading, error } = useCatalogList({ category: null, subcategory: null, search: "", includeEmpty: true });
  return {
    data: data?.models || [],
    isLoading,
    error
  };
}

export function useEntityStudies() {
  return useQuery({
    queryKey: ['/entities/studies'],
    queryFn: async () => allStudies()
  });
}

export function useEntityDatasets() {
  return useQuery<DatasetEntity[]>({
    queryKey: ['/api/entities/datasets'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/entities/datasets');
        if (!res.ok) return [];
        return res.json();
      } catch (err) {
        return [];
      }
    }
  });
}

export function useEntityFeatures() {
  return useQuery<FeatureEntity[]>({
    queryKey: ['/api/entities/features'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/entities/features');
        if (!res.ok) return [];
        return res.json();
      } catch (err) {
        return [];
      }
    }
  });
}

export interface GraphNode {
  id: string;
  /** `column`, `base`, `derived` or `transform` — read from the id prefix. */
  kind: string;
  component: 'base' | 'derived';
}
export interface GraphEdge {
  source: string;
  target: string;
  /** `input_column`, `derives`, `derives_with`, `derives_unpaired` or `depends_on`. */
  kind: string;
  via: string | null;
}
export interface GraphTransform {
  id: string;
  derivedCount: number;
}

/**
 * The feature dependency graph.
 *
 * `disconnected` is part of the contract, not a hint: the base layer
 * (raw columns -> 44 features) and the derived layer (130 indicator columns ->
 * 400 derived columns) share no node, so a viewer that draws one blob is
 * lying. Filter by component before drawing.
 */
export interface FeatureGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  transforms: GraphTransform[];
  counts: { baseFeatures: number; derivedColumns: number };
  disconnected: boolean;
}

export function useFeatureGraph(component?: 'base' | 'derived', transform?: string) {
  const params = new URLSearchParams();
  if (component) params.set('component', component);
  if (transform) params.set('transform', transform);
  const query = params.toString();
  return useQuery<FeatureGraph>({
    queryKey: ['/api/entities/feature-graph', component ?? null, transform ?? null],
    queryFn: async () => {
      try {
        const res = await fetch(`/api/entities/feature-graph${query ? `?${query}` : ''}`);
        if (!res.ok) {
          return { nodes: [], edges: [], transforms: [], counts: { baseFeatures: 0, derivedColumns: 0 }, disconnected: true };
        }
        return res.json();
      } catch (err) {
        // A graph that failed to load is drawn as empty, so the failure is
        // logged here rather than surfacing as a silently blank panel.
        console.error("[feature-graph] load failed", err);
        return { nodes: [], edges: [], transforms: [], counts: { baseFeatures: 0, derivedColumns: 0 }, disconnected: true };
      }
    }
  });
}

export function useEntityStrategies() {
  return useQuery<StrategyEntity[]>({
    queryKey: ['/api/entities/strategies'],
    queryFn: async () => {
      try {
        const res = await fetch('/api/entities/strategies');
        if (!res.ok) return [];
        return res.json();
      } catch (err) {
        return [];
      }
    }
  });
}


export interface ModelVersionEntity { versionId: number; catalogId: string; status: string; symbol: string; timeframe: string; versionAlias: string | null; runnerKey: string; }
export function useModelVersions() { return useQuery<{ items: ModelVersionEntity[] }>({ queryKey: ['/api/model-versions'], queryFn: async () => { const res = await fetch('/api/model-versions?limit=10000'); if (!res.ok) return { items: [] }; return res.json(); } }); }