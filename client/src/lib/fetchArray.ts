/**
 * Safe fetch helpers for useQuery hooks that expect array responses.
 *
 * When a backend service is down (e.g. QuestDB), API endpoints may
 * return error objects like {error: "..."} instead of arrays, causing
 * .filter() / .map() / .length crashes in React components.
 *
 * These helpers guarantee an array is always returned.
 */

/** Fetch JSON from a URL and guarantee an array result. */
export async function fetchArray<T = any>(url: string): Promise<T[]> {
  const res = await fetch(url);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/** Fetch JSON and extract a nested array field, with fallback. */
export async function fetchArrayField<T = any>(
  url: string,
  field: string,
): Promise<T[]> {
  const res = await fetch(url);
  const data = await res.json();
  const nested = data?.[field];
  return Array.isArray(nested) ? nested : [];
}
