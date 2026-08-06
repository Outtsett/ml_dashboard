import { useEffect } from 'react';

/** Dev-only Web Vitals monitoring. Logs LCP, FID, CLS to console. */
export function useWebVitals(): void {
  useEffect(() => {
    if (import.meta.env.PROD) return;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const name = entry.entryType === 'largest-contentful-paint' ? 'LCP'
          : entry.entryType === 'first-input' ? 'FID'
          : entry.entryType === 'layout-shift' ? 'CLS' : entry.name;
        // Dev-only instrumentation: the styled console output IS the
        // deliverable, and the whole effect is gated on !PROD above.
        // eslint-disable-next-line no-console
        console.log(`%c[WebVital] ${name}: ${entry.startTime.toFixed(1)}ms`, 'color: #4ade80; font-weight: bold;');
      }
    });
    try {
      observer.observe({ type: 'largest-contentful-paint', buffered: true });
      observer.observe({ type: 'first-input', buffered: true });
      observer.observe({ type: 'layout-shift', buffered: true });
    } catch { /* entry type not supported in all browsers */ }
    return () => observer.disconnect();
  }, []);
}
