import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/infrastructure/api/query_client";
import { type EntityType } from "@/shared/contexts/EntityContext";

export interface EntityAnnotation {
  id: string;
  entityType: string;
  entityId: string;
  content: string;
  createdAt: number;
}

export interface EntityRelationship {
  id: string;
  sourceType: string;
  sourceId: string;
  targetType: string;
  targetId: string;
  relationshipType: string;
  createdAt: number;
}

export interface EntityProfileData {
  id: string;
  type: EntityType;
  name: string;
  description?: string;
  createdAt?: number;
  updatedAt?: number;
  status?: string;
  // Dynamic fields depending on type
  [key: string]: any;
}

export interface EntityMetricsData {
  timestamp: number;
  [metric: string]: number;
}

export function useEntityProfile(type: string, id: string) {
  // Fetch overview
  const { data: profile, isLoading: isLoadingProfile } = useQuery<EntityProfileData>({
    queryKey: [`/api/entity/${type}/${id}`],
    staleTime: 1000 * 60,
  });

  // Fetch relationships
  const { data: relationships, isLoading: isLoadingRelationships } = useQuery<EntityRelationship[]>({
    queryKey: [`/api/entity/${type}/${id}/relationships`],
    staleTime: 1000 * 60,
  });

  // Fetch metrics (if model)
  const { data: metrics, isLoading: isLoadingMetrics } = useQuery<EntityMetricsData[]>({
    queryKey: [`/api/entity/${type}/${id}/metrics`],
    enabled: type === "model",
  });

  // Fetch annotations
  const { data: annotations, isLoading: isLoadingAnnotations } = useQuery<EntityAnnotation[]>({
    queryKey: [`/api/entity/${type}/${id}/annotations`],
  });

  // Fetch lineage (if applicable)
  const { data: lineage, isLoading: isLoadingLineage } = useQuery<any>({
    queryKey: [`/api/entity/${type}/${id}/lineage`],
  });

  // Add annotation mutation
  const addAnnotation = useMutation({
    mutationFn: async (content: string) => {
      const res = await apiRequest("POST", `/api/entity/${type}/${id}/annotations`, { content });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/entity/${type}/${id}/annotations`] });
    },
  });

  return {
    profile,
    isLoadingProfile,
    relationships: relationships || [],
    isLoadingRelationships,
    metrics: metrics || [],
    isLoadingMetrics,
    annotations: annotations || [],
    isLoadingAnnotations,
    lineage,
    isLoadingLineage,
    addAnnotation: addAnnotation.mutate,
    isAddingAnnotation: addAnnotation.isPending,
  };
}
