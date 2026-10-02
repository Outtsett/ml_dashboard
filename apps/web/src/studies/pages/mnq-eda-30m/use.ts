/**
 * One data hook for the page: every section asks the handler for its own body
 * (`?section=`) with the page-wide series choice and its own controls, so a
 * slider recomputes only the section it belongs to.
 */

import { useStudyQuery } from "@/studies/kit";
import type { SeriesSource, Timeframe } from "@shared/studies/mnq-eda-30m";

export interface SeriesChoice {
  timeframe: Timeframe;
  source: SeriesSource;
}

type Params = Record<string, string | number | boolean>;

export const SLUG = "mnq-eda-30m";

export function useSection<T>(section: string, choice: SeriesChoice, params: Params = {}) {
  const query = useStudyQuery<T | { unavailable: true }>(SLUG, { section, timeframe: choice.timeframe, source: choice.source, ...params });
  const data = query.data?.data;
  const unavailable = data !== undefined && typeof data === "object" && data !== null && "unavailable" in data;
  return {
    query,
    notes: query.data?.notes ?? [],
    body: data === undefined || unavailable ? null : (data as T),
    unavailable,
  };
}
