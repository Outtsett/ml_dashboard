/**
 * The one data pattern every study uses.
 *
 * `useStudyControls` holds the page's control values and mirrors them into the
 * URL (`?bins=40&timeframe=5m`), so a view is linkable and survives a reload.
 * `useStudyQuery` fetches `GET /api/studies/<slug>` with those values; every
 * control is in the query key, and the previous picture stays on screen while
 * a slider drags (keepPreviousData).
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";

export interface StudyBody<T> {
  slug: string;
  notes: string[];
  data: T;
}

type ControlValue = string | number | boolean;

function toSearch(controls: Record<string, ControlValue | null | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(controls)) {
    if (value === null || value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  return params.toString();
}

export async function fetchStudy<T>(slug: string, controls: Record<string, ControlValue | null | undefined>, signal?: AbortSignal): Promise<StudyBody<T>> {
  const search = toSearch(controls);
  const response = await fetch(`/api/studies/${slug}${search ? `?${search}` : ""}`, { signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${slug} failed (${response.status})`);
  }
  return (await response.json()) as StudyBody<T>;
}

export function useStudyQuery<T>(slug: string, controls: Record<string, ControlValue | null | undefined> = {}, options: { enabled?: boolean; refetchIntervalMs?: number } = {}) {
  return useQuery({
    queryKey: ["study", slug, controls],
    queryFn: ({ signal }) => fetchStudy<T>(slug, controls, signal),
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
    refetchInterval: options.refetchIntervalMs ?? false,
  });
}

function readUrl(): URLSearchParams {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

function coerce<V extends ControlValue>(raw: string | null, fallback: V): V {
  if (raw === null) return fallback;
  if (typeof fallback === "number") {
    const value = Number(raw);
    return (Number.isFinite(value) ? value : fallback) as V;
  }
  if (typeof fallback === "boolean") return (raw === "true" || raw === "1") as V;
  return raw as V;
}

/** Literal defaults (`true`, `"5m"`) widened to their base types, so any value of that type can be set. */
export type WidenControls<C> = { [K in keyof C]: C[K] extends string ? string : C[K] extends number ? number : C[K] extends boolean ? boolean : C[K] };

/**
 * Control state with URL persistence. `defaultValues` fixes the keys and their
 * types; a value in the URL overrides its default on first render.
 */
export function useStudyControls<D extends Record<string, ControlValue>>(defaultValues: D): [WidenControls<D>, <K extends keyof D>(key: K, value: WidenControls<D>[K]) => void, () => void] {
  type C = WidenControls<D>;
  const defaults = defaultValues as unknown as C;
  const [values, setValues] = useState<C>(() => {
    const url = readUrl();
    const initial = { ...defaults };
    for (const key of Object.keys(defaults) as Array<keyof C>) {
      initial[key] = coerce(url.get(String(key)), defaults[key]);
    }
    return initial;
  });

  const write = (next: C) => {
    try {
      const url = new URL(window.location.href);
      for (const [key, value] of Object.entries(next)) {
        if (value === defaults[key]) url.searchParams.delete(key);
        else url.searchParams.set(key, String(value));
      }
      window.history.replaceState(window.history.state, "", url);
    } catch {
      // A URL that cannot be rewritten only costs the shareable link.
    }
  };

  const set = <K extends keyof C>(key: K, value: C[K]) => {
    setValues((previous) => {
      const next = { ...previous, [key]: value };
      write(next);
      return next;
    });
  };

  const reset = () => {
    setValues(defaults);
    write(defaults);
  };

  return [values, set, reset];
}
