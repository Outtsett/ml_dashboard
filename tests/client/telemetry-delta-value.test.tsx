// @vitest-environment jsdom
/**
 * DeltaValue — the contract that direction survives without color.
 *
 * These tests exist because color is the one channel this codebase's maintainer
 * cannot read. If the glyph or the sign ever stops rendering, the component
 * still "looks fine" in review while communicating nothing. So they are pinned
 * here rather than left to visual inspection.
 */

import "./setup";
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { DeltaValue } from "../../src/client/src/ml/telemetry/DeltaValue";

afterEach(cleanup);

/** jsdom has no matchMedia; every test needs one before mounting. */
function stubMatchMedia(reducedMotion: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: reducedMotion && query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
        onchange: null,
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => stubMatchMedia(false));
afterEach(() => vi.unstubAllGlobals());

describe("DeltaValue", () => {
  it("renders the value", () => {
    render(<DeltaValue value={1.25} label="Sharpe" />);
    expect(screen.getByText("1.25")).toBeTruthy();
    expect(screen.getByText("Sharpe")).toBeTruthy();
  });

  it("shows no delta on first render", () => {
    // A value arriving is not a change. Without this, every metric flashes a
    // spurious delta the moment the ticker mounts.
    render(<DeltaValue value={1.25} />);
    expect(screen.queryByText("▲")).toBeNull();
    expect(screen.queryByText("▼")).toBeNull();
  });

  it("shows an up glyph and a signed delta when the value rises", () => {
    const { rerender } = render(<DeltaValue value={1.0} />);
    rerender(<DeltaValue value={1.5} />);

    expect(screen.getByText("▲")).toBeTruthy();
    expect(screen.getByText("increased")).toBeTruthy();
    // The default formatter scales precision to magnitude, so a 0.5 delta on a
    // 1.50 value renders with more decimals than the value itself. That is
    // intentional: a small delta rounded to the value's precision would read
    // as "+0.00" and say nothing.
    expect(screen.getByText("+0.500")).toBeTruthy();
    expect(screen.getByText("1.50")).toBeTruthy();
  });

  it("shows a down glyph when the value falls", () => {
    const { rerender } = render(<DeltaValue value={1.5} />);
    rerender(<DeltaValue value={1.0} />);

    expect(screen.getByText("▼")).toBeTruthy();
    expect(screen.getByText("decreased")).toBeTruthy();
  });

  it("keeps the glyph pointing at actual direction for lower-is-better metrics", () => {
    // Loss falling is a decrease AND an improvement. The glyph must report the
    // decrease; only the tone color flips. Reporting "▲" for a falling loss
    // would be a lie about the number.
    const { rerender } = render(<DeltaValue value={0.9} lowerIsBetter />);
    rerender(<DeltaValue value={0.4} lowerIsBetter />);

    expect(screen.getByText("▼")).toBeTruthy();
    expect(screen.getByText("decreased")).toBeTruthy();
  });

  it("treats movement inside epsilon as no movement", () => {
    const { rerender } = render(<DeltaValue value={1.0} epsilon={0.01} />);
    rerender(<DeltaValue value={1.001} epsilon={0.01} />);
    expect(screen.queryByText("▲")).toBeNull();

    // ...but movement beyond it still registers, so epsilon suppresses noise
    // rather than suppressing the component.
    rerender(<DeltaValue value={1.5} epsilon={0.01} />);
    expect(screen.getByText("▲")).toBeTruthy();
  });

  it("suppresses the delta chip under prefers-reduced-motion", () => {
    stubMatchMedia(true);
    const { rerender } = render(<DeltaValue value={1.0} />);
    rerender(<DeltaValue value={2.0} />);

    // The value still updates — only the animation is withheld.
    expect(screen.getByText("2.00")).toBeTruthy();
    expect(screen.queryByText("▲")).toBeNull();
  });

  it("expires the delta chip", () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<DeltaValue value={1.0} />);
      rerender(<DeltaValue value={1.5} />);
      expect(screen.getByText("▲")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.queryByText("▲")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders a non-finite value as an em dash without throwing", () => {
    render(<DeltaValue value={NaN} />);
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("does not treat a transition through NaN as a delta", () => {
    // A dropped frame in the stream must not register as movement.
    const { rerender } = render(<DeltaValue value={1.0} />);
    rerender(<DeltaValue value={NaN} />);

    expect(screen.queryByText("▲")).toBeNull();
    expect(screen.queryByText("▼")).toBeNull();
  });

  it("uses a custom formatter for both the value and the delta", () => {
    const { rerender } = render(
      <DeltaValue value={0.5} format={(v) => `${(v * 100).toFixed(0)}%`} />,
    );
    expect(screen.getByText("50%")).toBeTruthy();

    rerender(<DeltaValue value={0.75} format={(v) => `${(v * 100).toFixed(0)}%`} />);
    expect(screen.getByText("+25%")).toBeTruthy();
  });
});
