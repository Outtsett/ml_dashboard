// @vitest-environment jsdom
import "../setup";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PlaybackPanel } from "@/lens/playback/PlaybackPanel";
import { makeBar, makeBarWindow, makeManifest } from "./fixtures";

afterEach(() => cleanup());

/** A thin controlled wrapper, mirroring how LensPage owns cursorIndex. */
function Harness({
  onReachWindowEnd,
  hasMoreAfterWindow = false,
  initialCursor = 0,
  bars,
}: {
  onReachWindowEnd?: () => void;
  hasMoreAfterWindow?: boolean;
  initialCursor?: number;
  bars: ReturnType<typeof makeBar>[];
}) {
  const [cursorIndex, setCursorIndex] = useState(initialCursor);
  const window_ = makeBarWindow({}, bars);
  return (
    <PlaybackPanel
      window={window_}
      manifest={makeManifest()}
      cursorIndex={cursorIndex}
      onCursorIndexChange={setCursorIndex}
      onReachWindowEnd={onReachWindowEnd}
      hasMoreAfterWindow={hasMoreAfterWindow}
    />
  );
}

describe("PlaybackPanel", () => {
  it("shows the decision text for the bar at the cursor", () => {
    const bars = [
      makeBar({ rowIndex: 0, timestampSeconds: 1000, decision: "flat", position: 0 }),
      makeBar({ rowIndex: 1, timestampSeconds: 1060, decision: "enter_long", position: 1 }),
    ];
    render(<Harness bars={bars} initialCursor={0} />);
    expect(screen.getByTestId("playback-decision-text").textContent).toContain("flat — no position");
  });

  it("step forward moves the cursor and the decision text updates to the next bar", () => {
    const bars = [
      makeBar({ rowIndex: 0, timestampSeconds: 1000, decision: "flat", position: 0 }),
      makeBar({ rowIndex: 1, timestampSeconds: 1060, decision: "enter_long", position: 1 }),
    ];
    render(<Harness bars={bars} initialCursor={0} />);
    fireEvent.click(screen.getByTestId("playback-step-forward"));
    expect(screen.getByTestId("playback-decision-text").textContent).toContain("enter long");
  });

  it("step back moves the cursor to the previous bar", () => {
    const bars = [
      makeBar({ rowIndex: 0, timestampSeconds: 1000, decision: "flat", position: 0 }),
      makeBar({ rowIndex: 1, timestampSeconds: 1060, decision: "enter_long", position: 1 }),
    ];
    render(<Harness bars={bars} initialCursor={1} />);
    fireEvent.click(screen.getByTestId("playback-step-back"));
    expect(screen.getByTestId("playback-decision-text").textContent).toContain("flat — no position");
  });

  it("jump-to-next-trade skips straight to the next entry decision", () => {
    const bars = [
      makeBar({ rowIndex: 0, timestampSeconds: 1000, decision: "flat", position: 0 }),
      makeBar({ rowIndex: 1, timestampSeconds: 1060, decision: "flat", position: 0 }),
      makeBar({ rowIndex: 2, timestampSeconds: 1120, decision: "enter_short", position: -1 }),
    ];
    render(<Harness bars={bars} initialCursor={0} />);
    fireEvent.click(screen.getByTestId("playback-jump-next-trade"));
    expect(screen.getByTestId("playback-decision-text").textContent).toContain("enter short");
  });

  it("stepping past the last bar of the window asks the page to slide the window forward, when more rows exist", () => {
    const bars = [makeBar({ rowIndex: 0, timestampSeconds: 1000 }), makeBar({ rowIndex: 1, timestampSeconds: 1060 })];
    const onReachWindowEnd = vi.fn();
    render(<Harness bars={bars} initialCursor={1} hasMoreAfterWindow onReachWindowEnd={onReachWindowEnd} />);
    fireEvent.click(screen.getByTestId("playback-step-forward"));
    expect(onReachWindowEnd).toHaveBeenCalledTimes(1);
  });

  it("distinguishes the two skip reasons by the bar's resulting position", () => {
    const barsAlreadyInPosition = [makeBar({ rowIndex: 0, decision: "skip", position: 1 })];
    const { unmount } = render(<Harness bars={barsAlreadyInPosition} />);
    expect(screen.getByTestId("playback-decision-text").textContent).toContain("already in a position");
    unmount();

    const barsBelowThreshold = [makeBar({ rowIndex: 0, decision: "skip", position: 0 })];
    render(<Harness bars={barsBelowThreshold} />);
    expect(screen.getByTestId("playback-decision-text").textContent).toContain("conviction below threshold");
  });

  it("shows the no-attribution message when the window carries no features", () => {
    const bars = [makeBar({ rowIndex: 0 })];
    render(<Harness bars={bars} />);
    expect(screen.getByTestId("playback-features").textContent).toContain("No attribution artifact for this model");
  });

  it("says so on a bar the model made no prediction for, instead of printing a probability", () => {
    const bars = [makeBar({ rowIndex: 0, probabilityUp: null, label: null, decision: "flat", position: 0 })];
    render(<Harness bars={bars} />);
    const prediction = screen.getByTestId("playback-prediction").textContent ?? "";
    expect(prediction).toContain("P(up) none");
    expect(prediction).toContain("no prediction on this bar");
  });

  it("renders the market state UTC timestamp and OHLC for the cursor bar", () => {
    const bars = [makeBar({ rowIndex: 0, timestampSeconds: 1558465140, open: 7500, high: 7505, low: 7495, close: 7502 })];
    render(<Harness bars={bars} />);
    const marketState = screen.getByTestId("playback-market-state").textContent ?? "";
    expect(marketState).toContain("UTC");
    expect(marketState).toContain("7500.00");
    expect(marketState).toContain("7502.00");
  });
});
