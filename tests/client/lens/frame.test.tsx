// @vitest-environment jsdom
/**
 * LensFrame resizing: the grip must actually change the frame's height, must
 * remember it per slot, and must put it back on reset — otherwise a layout the
 * user tuned silently reverts on the next render.
 */

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { LensFrame } from "@/lens/Frame";

const STORAGE_KEY = "lens-frame-height:test-slot";

function renderFrame(extra: Partial<React.ComponentProps<typeof LensFrame>> = {}) {
  return render(
    <LensFrame title="Test view" resizeKey="test-slot" defaultHeight={400} testId="test-frame" {...extra}>
      <p>body</p>
    </LensFrame>,
  );
}

describe("LensFrame resizing", () => {
  beforeEach(() => window.localStorage.clear());

  it("starts at the default height and offers a labelled resize grip", () => {
    renderFrame();
    expect(screen.getByTestId("test-frame")).toHaveStyle({ height: "400px" });
    const grip = screen.getByTestId("test-frame-resize");
    expect(grip).toHaveAttribute("role", "separator");
    expect(grip).toHaveAttribute("aria-valuenow", "400");
    expect(grip.getAttribute("aria-label")).toContain("Resize Test view");
  });

  it("grows while the pointer drags and stores the height when it is released", () => {
    renderFrame();
    const grip = screen.getByTestId("test-frame-resize");

    fireEvent.pointerDown(grip, { clientY: 500 });
    fireEvent.pointerMove(window, { clientY: 620 });
    expect(screen.getByTestId("test-frame")).toHaveStyle({ height: "520px" });

    fireEvent.pointerUp(window, { clientY: 620 });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("520");
  });

  it("never shrinks below the minimum height", () => {
    renderFrame({ minHeight: 200 });
    const grip = screen.getByTestId("test-frame-resize");
    fireEvent.pointerDown(grip, { clientY: 500 });
    fireEvent.pointerMove(window, { clientY: 100 });
    expect(screen.getByTestId("test-frame")).toHaveStyle({ height: "200px" });
  });

  it("adjusts with the arrow keys and resets with Home", () => {
    renderFrame();
    const grip = screen.getByTestId("test-frame-resize");

    fireEvent.keyDown(grip, { key: "ArrowDown" });
    expect(screen.getByTestId("test-frame")).toHaveStyle({ height: "424px" });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("424");

    fireEvent.keyDown(grip, { key: "Home" });
    expect(screen.getByTestId("test-frame")).toHaveStyle({ height: "400px" });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("restores a height stored for its slot", () => {
    window.localStorage.setItem(STORAGE_KEY, "777");
    renderFrame();
    expect(screen.getByTestId("test-frame")).toHaveStyle({ height: "777px" });
  });

  it("has no grip when the frame is not resizable", () => {
    render(
      <LensFrame title="Fixed view" testId="fixed-frame">
        <p>body</p>
      </LensFrame>,
    );
    expect(screen.queryByTestId("fixed-frame-resize")).toBeNull();
    expect(screen.getByTestId("fixed-frame").style.height).toBe("");
  });
});
