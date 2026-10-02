// @vitest-environment jsdom
/**
 * Inside the model — the shell (`apps/web/src/cycle/inside/InsidePanel.tsx`,
 * `useExplain.ts`, `InputsColumn.tsx`, `OutputChain.tsx`) against the explain
 * routes, stubbed with the fixtures in `tests/fixtures/cycle_explain_client/`:
 * which bar it explains (follow the model, hover, pin, ← / → and the arrow
 * keys, "Follow the model"), the source badge, the Direction / Price toggle
 * (price off without a price model), the sentences for an old run, a fold
 * still training and a bar no fold tested, fetches carrying an AbortSignal,
 * the neighbouring bars prefetched, and the inputs and output columns.
 */
import "./setup";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { emptyBarColumns, type CycleBarColumns, type CycleCursor } from "@shared/cycle/schema";
import { InsidePanel, neighbourTestBar } from "../src/cycle/inside/InsidePanel";
import { inputUsage, sortInputs } from "../src/cycle/inside/InputsColumn";
import { foldForTimestamp } from "../src/cycle/inside/useExplain";
import { useCycleStore } from "@/cycle/store";
import { cycleExplainBarSchema, cycleExplainManifestSchema } from "@shared/cycle/explain";

const FIXTURES = path.resolve(__dirname, "../../../tests/fixtures/cycle_explain_client");
const fixture = (name: string): Record<string, unknown> => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf-8"));

const XGBOOST_ID = "cycle_xgboost_fixture";
const FOREST_ID = "cycle_forest_fixture";
const OLD_ID = "cycle_old_fixture";

const MANIFESTS: Record<string, string> = {
  [XGBOOST_ID]: "manifest_xgboost.json",
  [FOREST_ID]: "manifest_no_price.json",
  [OLD_ID]: "manifest_unavailable.json",
};
const STRUCTURES: Record<string, Record<string, string>> = {
  [XGBOOST_ID]: { direction: "structure_xgboost.json", price: "structure_xgboost_price.json" },
  [FOREST_ID]: { direction: "structure_forest.json" },
};
const BARS: Record<string, Record<string, string>> = {
  [XGBOOST_ID]: { direction: "bar_xgboost.json", price: "bar_xgboost_price.json" },
  [FOREST_ID]: { direction: "bar_forest.json" },
};

/** Test bars (the model predicted them) every 300 s from 1760000000; one context bar before. */
const TEST_BARS = [1760000300, 1760000600, 1760000900, 1760001200];
const CURSOR_BAR = 1760000600;

function barColumns(): CycleBarColumns {
  const columns = emptyBarColumns();
  const add = (timestamp: number, role: "context" | "processed", probabilityUp: number | null) => {
    columns.timestamps.push(timestamp);
    columns.open.push(21000);
    columns.high.push(21010);
    columns.low.push(20990);
    columns.close.push(21012.25);
    columns.volume.push(100);
    columns.role.push(role);
    columns.foldIndex.push(role === "processed" ? 0 : null);
    columns.probabilityUp.push(probabilityUp);
    columns.predictedDirection.push(probabilityUp === null ? null : probabilityUp >= 0.5 ? 1 : -1);
    columns.position.push(null);
    columns.equityUsd.push(null);
    columns.predictedClose.push(null);
    columns.forecastTimestamp.push(null);
    columns.actualDirection.push(null);
    columns.correct.push(null);
  };
  add(1759999700, "context", null);
  for (const timestamp of TEST_BARS) add(timestamp, "processed", timestamp === CURSOR_BAR ? 0.5299640517645717 : 0.45);
  return columns;
}

let fetchMock: ReturnType<typeof vi.fn>;

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function installFetch() {
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const match = /^\/api\/training\/cycle\/([^/]+)\/explain(?:\/(structure|tree|bar))?$/.exec(url.pathname);
    if (!match) return respond({ error: "not found" }, 404);
    const modelId = decodeURIComponent(match[1]!);
    const route = match[2];
    const role = url.searchParams.get("role") ?? "direction";
    if (!route) return MANIFESTS[modelId] ? respond(fixture(MANIFESTS[modelId]!)) : respond({ error: "There is no saved run." }, 404);
    if (route === "structure") return respond(fixture(STRUCTURES[modelId]![role]!));
    if (route === "tree") return respond(fixture(`tree_xgboost_${url.searchParams.get("tree")}.json`));
    const bar = fixture(BARS[modelId]![role]!);
    return respond({ ...bar, timestamp: Number(url.searchParams.get("timestamp")) });
  });
  vi.stubGlobal("fetch", fetchMock);
}

function setRun(modelId: string, options: { inspectTimestamp?: number | null; source?: "cursor" | "hover" | "pinned"; role?: "direction" | "price" } = {}) {
  useCycleStore.setState({
    modelId,
    modelType: `${modelId}+walk_forward_cycle`,
    status: "complete",
    cursor: { phase: "complete", foldIndex: 0, barTimestamp: CURSOR_BAR, barIndex: 2, barCount: 5 } as unknown as CycleCursor,
    bars: barColumns(),
    barsVersion: 1,
    barCount: 5,
    inspectTimestamp: options.inspectTimestamp ?? null,
    inspectSource: options.source ?? "cursor",
    inspectRole: options.role ?? "direction",
  });
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InsidePanel />
    </QueryClientProvider>,
  );
}

function barRequests(): URL[] {
  return fetchMock.mock.calls.map(([input]) => new URL(String(input), "http://localhost")).filter((url) => url.pathname.endsWith("/explain/bar"));
}

beforeEach(() => {
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useCycleStore.getState().reset();
  useCycleStore.setState({ inspectRole: "direction" });
});

describe("pure helpers", () => {
  it("steps to the neighbouring test bar, skipping context bars, from a bar or from between bars", () => {
    const bars = barColumns();
    expect(neighbourTestBar(bars, 1760000600, 1)).toBe(1760000900);
    expect(neighbourTestBar(bars, 1760000600, -1)).toBe(1760000300);
    expect(neighbourTestBar(bars, 1760000300, -1)).toBeNull(); // only a context bar before it
    expect(neighbourTestBar(bars, 1760001200, 1)).toBeNull();
    expect(neighbourTestBar(bars, 1760000700, 1)).toBe(1760000900);
    expect(neighbourTestBar(bars, 1760000700, -1)).toBe(1760000600);
    expect(neighbourTestBar(bars, null, 1)).toBeNull();
  });

  it("picks the fold whose test span holds the bar", () => {
    const manifest = cycleExplainManifestSchema.parse(fixture("manifest_xgboost.json"));
    expect(foldForTimestamp(manifest, 1760000600)?.foldIndex).toBe(0);
    expect(foldForTimestamp(manifest, 1760003600)?.foldIndex).toBe(1);
    expect(foldForTimestamp(manifest, 1750000000)).toBeNull();
  });

  it("sorts the inputs by how often this bar's tree paths asked about them", () => {
    const bar = cycleExplainBarSchema.parse(fixture("bar_xgboost.json"));
    const usage = inputUsage(bar, 4)!;
    expect(usage.values).toEqual([2, 2, 1, 1]);
    // Ties keep model order.
    expect(sortInputs(bar, 4, "used", usage)).toEqual([0, 1, 2, 3]);
    expect(sortInputs(bar, 4, "largest_input", usage)).toEqual([2, 0, 3, 1]);
  });
});

describe("InsidePanel", () => {
  it("follows the model's cursor and explains that bar: inputs, the tree view and the output chain", async () => {
    setRun(XGBOOST_ID);
    renderPanel();
    await waitFor(() => expect(useCycleStore.getState().inspectTimestamp).toBe(CURSOR_BAR));
    expect(screen.getByTestId("inside-source").textContent).toBe("Following the model");
    await screen.findByTestId("inside-flow");

    const rows = screen.getAllByTestId("inside-input-row");
    expect(rows).toHaveLength(4);
    expect(rows[0]!.textContent).toContain("Relative strength index 14");
    expect(rows[0]!.textContent).toContain("▲ +0.8");
    expect(rows[0]!.textContent).toContain("Raw value 58.4");
    expect(rows[0]!.textContent).toContain("79th percentile");
    expect(rows[1]!.textContent).toContain("▼ −0.3");

    expect(screen.getByTestId("trees-view")).toBeTruthy();
    expect(screen.getByTestId("inside-output-probability").textContent).toContain("53.0%");
    expect(screen.getByTestId("inside-output-direction").textContent).toBe("▲ up");
    expect(screen.getByTestId("inside-output-chain").textContent).toContain("Same as the chart: ▲ at 53.0%.");

    const requests = barRequests();
    expect(requests.some((url) => url.searchParams.get("timestamp") === String(CURSOR_BAR) && url.searchParams.get("fold") === "0" && url.searchParams.get("role") === "direction")).toBe(true);
    // Every fetch carries the query's AbortSignal.
    for (const call of fetchMock.mock.calls) expect((call[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    // The neighbours are prefetched so ← / → answer from the cache.
    await waitFor(() => {
      const asked = barRequests().map((url) => url.searchParams.get("timestamp"));
      expect(asked).toContain("1760000300");
      expect(asked).toContain("1760000900");
    });
  });

  it("the arrows and arrow keys pin the neighbouring test bar; Follow the model unpins", async () => {
    setRun(XGBOOST_ID);
    renderPanel();
    await screen.findByTestId("inside-flow");

    fireEvent.click(screen.getByRole("button", { name: "Next test bar" }));
    expect(useCycleStore.getState()).toMatchObject({ inspectTimestamp: 1760000900, inspectSource: "pinned" });
    expect(screen.getByTestId("inside-source").textContent).toBe("Pinned bar");

    fireEvent.keyDown(screen.getByTestId("inside-panel"), { key: "ArrowRight" });
    expect(useCycleStore.getState().inspectTimestamp).toBe(1760001200);
    fireEvent.keyDown(screen.getByTestId("inside-panel"), { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByTestId("inside-panel"), { key: "ArrowLeft" });
    expect(useCycleStore.getState().inspectTimestamp).toBe(1760000600);
    fireEvent.click(screen.getByRole("button", { name: "Previous test bar" }));
    expect(useCycleStore.getState().inspectTimestamp).toBe(1760000300);
    expect((screen.getByRole("button", { name: "Previous test bar" }) as HTMLButtonElement).disabled).toBe(true);

    // Arrow keys on the tree scrubber move the scrubber, not the bar.
    fireEvent.keyDown(await screen.findByRole("slider", { name: "Trees counted" }), { key: "ArrowRight" });
    expect(useCycleStore.getState().inspectTimestamp).toBe(1760000300);

    fireEvent.click(screen.getByRole("button", { name: "Follow the model" }));
    expect(useCycleStore.getState()).toMatchObject({ inspectTimestamp: CURSOR_BAR, inspectSource: "cursor" });
    expect(screen.getByTestId("inside-source").textContent).toBe("Following the model");
  });

  it("a hovered bar from the chart becomes the explained bar, and the badge says so", async () => {
    setRun(XGBOOST_ID);
    renderPanel();
    await screen.findByTestId("inside-flow");
    act(() => useCycleStore.getState().setInspect(1760000900, "hover"));
    expect(screen.getByTestId("inside-source").textContent).toBe("Hovered bar");
    await waitFor(() => expect(barRequests().filter((url) => url.searchParams.get("timestamp") === "1760000900").length).toBeGreaterThan(0));
  });

  it("the price toggle opens the price model: target units × scale = points → predicted close", async () => {
    setRun(XGBOOST_ID, { inspectTimestamp: CURSOR_BAR, source: "pinned" });
    renderPanel();
    await screen.findByTestId("inside-flow");
    const price = screen.getByRole("button", { name: "Price" });
    expect((price as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(price);
    expect(useCycleStore.getState().inspectRole).toBe("price");
    await waitFor(() => expect(screen.getByTestId("inside-output-move").textContent).toContain("▲ +5 points"));
    expect(screen.getByTestId("inside-output-predicted-close").textContent).toContain("21,017.25");
    expect(barRequests().some((url) => url.searchParams.get("role") === "price")).toBe(true);
  });

  it("price is off, with the reason, when the model has no price model", async () => {
    setRun(FOREST_ID, { inspectTimestamp: CURSOR_BAR, source: "pinned", role: "price" });
    renderPanel();
    await screen.findByTestId("inside-flow");
    const price = screen.getByRole("button", { name: "Price" }) as HTMLButtonElement;
    expect(price.disabled).toBe(true);
    expect(price.title).toBe("This model has no price model, so there is no price forecast to open.");
    expect(screen.getByTestId("inside-panel").textContent).toContain("Price is off: this model has no price model.");
    // The stored preference was price, but the panel explains the direction model.
    expect(screen.getByRole("button", { name: "Direction" }).getAttribute("aria-pressed")).toBe("true");
    expect(barRequests().every((url) => url.searchParams.get("role") === "direction")).toBe(true);
  });

  it("an old run says why there is nothing inside to show", async () => {
    setRun(OLD_ID);
    renderPanel();
    const message = await screen.findByTestId("inside-unavailable");
    expect(message.textContent).toBe("This run was made before Inside the model existed, so its inputs were never saved.");
    expect(barRequests()).toHaveLength(0);
  });

  it("a fold still training says so instead of asking the explainer for that bar", async () => {
    setRun(XGBOOST_ID, { inspectTimestamp: 1760003600, source: "pinned" });
    renderPanel();
    const message = await screen.findByTestId("inside-fold-status");
    expect(message.textContent).toBe("Fold 2's direction model is still training; you can look inside it once it is saved.");
    // Only the ready neighbour in fold 1 is prefetched; the training bar itself is never asked for.
    expect(barRequests().map((url) => url.searchParams.get("timestamp"))).toEqual(["1760001200"]);
  });

  it("a bar no fold tested gets a sentence, not a request for it", async () => {
    setRun(XGBOOST_ID, { inspectTimestamp: 1759999700, source: "pinned" });
    renderPanel();
    const message = await screen.findByTestId("inside-no-fold");
    expect(message.textContent).toContain("No fold tested the bar at");
    // → would step to the first test bar, which is prefetched; the untested bar is never asked for.
    expect(barRequests().map((url) => url.searchParams.get("timestamp"))).toEqual(["1760000300"]);
  });

  it("the inputs can be re-sorted", async () => {
    setRun(XGBOOST_ID, { inspectTimestamp: CURSOR_BAR, source: "pinned" });
    renderPanel();
    await screen.findByTestId("inside-flow");
    fireEvent.change(screen.getByRole("combobox", { name: "Sort the inputs" }), { target: { value: "largest_input" } });
    const order = within(screen.getByTestId("inside-inputs-list"))
      .getAllByTestId("inside-input-row")
      .map((row) => row.getAttribute("data-feature-index"));
    expect(order).toEqual(["2", "0", "3", "1"]);
  });
});
