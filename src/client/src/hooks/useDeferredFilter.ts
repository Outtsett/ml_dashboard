import { useState, useDeferredValue } from 'react';

/** Reusable hook for deferred search/filter inputs. Keeps typing responsive while results lag. */
export function useDeferredFilter(initialValue = '') {
  const [query, setQuery] = useState(initialValue);
  const deferredQuery = useDeferredValue(query);
  const isStale = query !== deferredQuery;
  return { query, setQuery, deferredQuery, isStale } as const;
}
