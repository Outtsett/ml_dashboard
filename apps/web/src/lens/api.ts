/**
 * Model Lens data hooks. Endpoints (apps/api/lens):
 *   GET  /api/lens/models                       -> LensModelList
 *   GET  /api/lens/models/:id/manifest          -> LensManifest
 *   POST /api/lens/models/:id/build             -> { manifest: LensManifest }
 *   GET  /api/lens/models/:id/evaluation?params -> LensEvaluation
 *   GET  /api/lens/models/:id/bars?params&startRowIndex&endRowIndex&maxBars -> LensBarWindow
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LENS_MAX_WINDOW_BARS,
  lensParamsToSearch,
  type LensBarWindow,
  type LensEvaluation,
  type LensEvaluationParams,
  type LensManifest,
  type LensModelList,
  type LensRowWindow,
} from "@shared/lens/types";

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = typeof body?.error === "string" ? body.error : `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

const modelPath = (modelId: string) => `/api/lens/models/${encodeURIComponent(modelId)}`;

export function useLensModels() {
  return useQuery({
    queryKey: ["lens", "models"],
    queryFn: ({ signal }) => getJson<LensModelList>("/api/lens/models", signal),
    staleTime: 30_000,
  });
}

export function useLensManifest(modelId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["lens", "manifest", modelId],
    queryFn: ({ signal }) => getJson<LensManifest>(`${modelPath(modelId!)}/manifest`, signal),
    enabled: enabled && modelId !== null,
    staleTime: Infinity,
  });
}

export function useLensEvaluation(modelId: string | null, params: LensEvaluationParams | null) {
  return useQuery({
    queryKey: ["lens", "evaluation", modelId, params],
    queryFn: ({ signal }) =>
      getJson<LensEvaluation>(`${modelPath(modelId!)}/evaluation?${lensParamsToSearch(params!)}`, signal),
    enabled: modelId !== null && params !== null,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
}

export function useLensBars(
  modelId: string | null,
  params: LensEvaluationParams | null,
  rowWindow: LensRowWindow | null,
) {
  const maxBars = rowWindow ? Math.min(LENS_MAX_WINDOW_BARS, rowWindow.endRowIndex - rowWindow.startRowIndex + 1) : 0;
  return useQuery({
    queryKey: ["lens", "bars", modelId, params, rowWindow],
    queryFn: ({ signal }) =>
      getJson<LensBarWindow>(
        `${modelPath(modelId!)}/bars?${lensParamsToSearch(params!, { ...rowWindow!, maxBars })}`,
        signal,
      ),
    enabled: modelId !== null && params !== null && rowWindow !== null,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
}

export function useBuildLens() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (modelId: string) => {
      const response = await fetch(`${modelPath(modelId)}/build`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : `build failed (${response.status})`);
      return body as { manifest: LensManifest };
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["lens"] }),
  });
}
