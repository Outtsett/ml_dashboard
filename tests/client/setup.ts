/**
 * Vitest setup for frontend component tests.
 * Import this at the top of component test files:
 *   import './setup';
 *
 * Or use // @vitest-environment jsdom pragma + import "@testing-library/jest-dom/vitest"
 */

import "@testing-library/jest-dom/vitest";

// ─── jsdom gaps ──────────────────────────────────────────────────────────────

/**
 * jsdom implements neither `ResizeObserver` nor element layout. Recharts'
 * `ResponsiveContainer` constructs a `ResizeObserver` on mount and throws
 * without one, so ANY test that renders a chart dies before asserting anything.
 *
 * The stub reports a fixed non-zero size once, synchronously. Zero would be
 * worse than absent: `ResponsiveContainer` skips rendering children at width 0,
 * so the test would pass vacuously against an empty chart.
 */
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub implements ResizeObserver {
    constructor(private readonly cb: ResizeObserverCallback) {}
    observe(target: Element): void {
      const entry = {
        target,
        contentRect: { width: 800, height: 400, top: 0, left: 0, bottom: 400, right: 800, x: 0, y: 0 },
      } as unknown as ResizeObserverEntry;
      this.cb([entry], this);
    }
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// Recharts also reads offsetWidth/offsetHeight, which jsdom pins to 0.
for (const [prop, value] of [["offsetWidth", 800], ["offsetHeight", 400]] as const) {
  if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)?.get) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get() { return value; },
    });
  }
}
