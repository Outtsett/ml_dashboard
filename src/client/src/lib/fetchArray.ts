/**
 * Fetch helpers for useQuery hooks that expect array responses.
 *
 * Throws on HTTP errors so TanStack Query surfaces them via `error` state
 * instead of silently returning []. Non-array 2xx responses still coerce to [].
 */

/** Fetch JSON from a URL and guarantee an array result. Throws on HTTP error. */
export async function fetchArray<T = unknown>(url: string): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchArray ${url}: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** Fetch JSON and extract a nested array field, with fallback. Throws on HTTP error. */
export async function fetchArrayField<T = unknown>(
  url: string,
  field: string,
): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchArrayField ${url}: ${res.status}`);
  const data = await res.json();
  const nested = data?.[field];
  return Array.isArray(nested) ? nested : [];
}
