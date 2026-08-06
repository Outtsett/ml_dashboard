import { useState, useEffect } from 'react';

/**
 * Debounce a value — returns the latest value only after `delay` ms of inactivity.
 * Prevents rapid-fire API calls when the user is switching symbols/timeframes quickly.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
