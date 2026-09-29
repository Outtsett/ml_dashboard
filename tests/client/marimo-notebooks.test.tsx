// @vitest-environment jsdom
/**
 * The Notebooks tab (src/client/src/marimo/): which notebooks the library shows
 * and in what order, what the health badge says about a stale result, how a
 * link resolves, how tabs open and cap, the startup bar, and the list rendered
 * with a description, a pinned section and dataset chips that filter without
 * opening the notebook.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import {
  healthView,
  MAXIMUM_OPEN_TABS,
  openTab,
  resolveNotebookReference,
  sectionNotebooks,
  selectNotebooks,
  startupProgress,
  touchRecent,
  type ListFilters,
} from "@/marimo/format";
import { datasetCovers } from "@/marimo/ReadByNotebooks";
import { suggestFileName } from "@/marimo/NewNotebookDialog";
import { NotebookList, type NotebookListProps } from "@/marimo/NotebookList";
import type { NotebookEntry } from "@/marimo/types";

function notebook(overrides: Partial<NotebookEntry>): NotebookEntry {
  return {
    id: "000000000000",
    path: "E:/repo/notebooks/a.py",
    groupSlug: "datalake",
    category: "Data lake",
    repoLabel: "datalake/notebooks",
    relativePath: "datalake/notebooks/a.py",
    title: "A",
    description: "",
    sizeBytes: 100,
    modifiedAtIso: "2026-09-28T10:00:00.000Z",
    createdAtIso: "2026-09-01T10:00:00.000Z",
    url: "/marimo/datalake/?file=a",
    datasets: [],
    cellCount: 3,
    gitState: "clean",
    pinned: false,
    health: null,
    ...overrides,
  };
}

const LIBRARY: NotebookEntry[] = [
  notebook({ id: "aaaaaaaaaaaa", title: "Lake audit", category: "Data lake", modifiedAtIso: "2026-09-27T10:00:00.000Z", relativePath: "datalake/notebooks/lake_audit.py" }),
  notebook({
    id: "bbbbbbbbbbbb",
    title: "Model Cycle runs",
    category: "ML Dashboard",
    relativePath: "ml_dashboard/notebooks/model_cycle_runs.py",
    modifiedAtIso: "2026-09-28T12:00:00.000Z",
    datasets: [{ name: "derived_model_cycle_runs_*", kind: "lake view" }],
    gitState: "modified",
    pinned: true,
  }),
  notebook({
    id: "cccccccccccc",
    title: "Candle vocabulary",
    category: "Quant model research",
    relativePath: "Trading/quant/model/notebooks/candle_vocab.py",
    modifiedAtIso: "2026-09-20T09:00:00.000Z",
    description: "Every candle shape, counted",
    health: { status: "failed", checkedAtIso: "2026-09-21T00:00:00.000Z", sourceModifiedAtIso: "2026-09-20T09:00:00.000Z", durationSeconds: 12, error: "KeyError: 'close'" },
  }),
];

const NO_FILTERS: ListFilters = { text: "", categories: new Set(), dataset: null, health: null, uncommittedOnly: false };

describe("selectNotebooks", () => {
  it("keeps pinned notebooks apart and sorts the rest newest first", () => {
    const { pinned, rest } = selectNotebooks(LIBRARY, NO_FILTERS, "edited");
    expect(pinned.map((n) => n.title)).toEqual(["Model Cycle runs"]);
    expect(rest.map((n) => n.title)).toEqual(["Lake audit", "Candle vocabulary"]);
  });

  it("filters by category, dataset, health, uncommitted work and text together", () => {
    expect(selectNotebooks(LIBRARY, { ...NO_FILTERS, categories: new Set(["Data lake"]) }, "name").rest.map((n) => n.title)).toEqual(["Lake audit"]);
    expect(selectNotebooks(LIBRARY, { ...NO_FILTERS, dataset: "derived_model_cycle_runs_*" }, "name").pinned).toHaveLength(1);
    expect(selectNotebooks(LIBRARY, { ...NO_FILTERS, health: "fails" }, "name").rest.map((n) => n.title)).toEqual(["Candle vocabulary"]);
    expect(selectNotebooks(LIBRARY, { ...NO_FILTERS, uncommittedOnly: true }, "name").pinned.map((n) => n.title)).toEqual(["Model Cycle runs"]);
    expect(selectNotebooks(LIBRARY, { ...NO_FILTERS, text: "every candle" }, "name").rest.map((n) => n.title)).toEqual(["Candle vocabulary"]);
  });

  it("sections by category when sorted by category, alphabetically otherwise one section", () => {
    const { rest } = selectNotebooks(LIBRARY, NO_FILTERS, "category");
    expect(sectionNotebooks(rest, "category").map((s) => s.label)).toEqual(["Data lake", "Quant model research"]);
    expect(sectionNotebooks(rest, "name").map((s) => s.label)).toEqual(["A to Z"]);
  });
});

describe("healthView", () => {
  const passed = { status: "passed" as const, checkedAtIso: "2026-09-28T11:00:00.000Z", sourceModifiedAtIso: "2026-09-28T10:00:00.000Z", durationSeconds: 5 };
  it("reports a result about an older version of the file as changed, not as passing", () => {
    expect(healthView(passed, "2026-09-28T10:00:00.000Z")).toBe("passes");
    expect(healthView(passed, "2026-09-28T10:30:00.000Z")).toBe("changed");
    expect(healthView(null, "2026-09-28T10:00:00.000Z")).toBe("unchecked");
    expect(healthView({ ...passed, status: "running" }, "2026-09-28T10:30:00.000Z")).toBe("checking");
    expect(healthView({ ...passed, status: "cancelled" }, "2026-09-28T10:00:00.000Z")).toBe("unchecked");
  });
});

describe("resolveNotebookReference", () => {
  it("finds a notebook by id, by relative path, or by the tail of its path", () => {
    expect(resolveNotebookReference(LIBRARY, "cccccccccccc")?.title).toBe("Candle vocabulary");
    expect(resolveNotebookReference(LIBRARY, "ml_dashboard/notebooks/model_cycle_runs.py")?.title).toBe("Model Cycle runs");
    expect(resolveNotebookReference(LIBRARY, "notebooks\\model_cycle_runs.py")?.title).toBe("Model Cycle runs");
    expect(resolveNotebookReference(LIBRARY, "cycle_runs.py")).toBeUndefined();
    expect(resolveNotebookReference(LIBRARY, null)).toBeUndefined();
  });
});

describe("openTab", () => {
  it("focuses an open tab, keeps one editor tab, and closes the oldest past the cap", () => {
    const run = (id: string) => ({ key: `run:${id}`, notebookId: id, mode: "run" as const });
    const edit = (id: string) => ({ key: `edit:${id}`, notebookId: id, mode: "edit" as const });
    let tabs = openTab([], run("a"));
    expect(openTab(tabs, run("a"))).toBe(tabs);
    tabs = openTab(openTab(tabs, edit("a")), edit("b"));
    expect(tabs.map((t) => t.key)).toEqual(["run:a", "edit:b"]);
    for (const id of ["c", "d", "e", "f", "g"]) tabs = openTab(tabs, run(id));
    expect(tabs).toHaveLength(MAXIMUM_OPEN_TABS);
    expect(tabs.map((t) => t.key)).toEqual(["edit:b", "run:c", "run:d", "run:e", "run:f", "run:g"]);
  });
});

describe("touchRecent", () => {
  it("keeps the most recently viewed tabs first and forgets closed ones", () => {
    let recent: string[] = [];
    recent = touchRecent(recent, "a", ["a", "b", "c"]);
    recent = touchRecent(recent, "b", ["a", "b", "c"]);
    recent = touchRecent(recent, "c", ["a", "b", "c"]);
    recent = touchRecent(recent, "a", ["a", "b", "c"]);
    expect(recent).toEqual(["a", "c", "b"]);
    expect(touchRecent(recent, "a", ["a", "b"])).toEqual(["a", "b"]);
    expect(touchRecent(recent, null, ["c"])).toEqual(["c"]);
  });
});

describe("startupProgress", () => {
  it("measures against the last start and never claims done before the group says so", () => {
    const since = "2026-09-28T10:00:00.000Z";
    const at = (seconds: number) => Date.parse(since) + seconds * 1000;
    expect(startupProgress(since, 10, at(5))).toBeCloseTo(0.5);
    expect(startupProgress(since, 10, at(30))).toBe(0.95);
    expect(startupProgress(since, null, at(0))).toBe(0);
    expect(startupProgress(since, null, at(120))).toBeLessThan(0.95);
    expect(startupProgress(undefined, 10, at(5))).toBe(0);
  });
});

describe("datasetCovers and suggestFileName", () => {
  it("matches a view to itself, to its family and to its dataset path", () => {
    expect(datasetCovers("derived_labels", "derived_labels")).toBe(true);
    expect(datasetCovers("derived_model_cycle_runs_*", "derived_model_cycle_runs_runs")).toBe(true);
    expect(datasetCovers("derived/labels", "derived_labels")).toBe(true);
    expect(datasetCovers("derived/labels", "derived_label_audit")).toBe(false);
    expect(datasetCovers("ohlcv_1d", "ohlcv_1h")).toBe(false);
  });

  it("turns a title into a snake-case file name", () => {
    expect(suggestFileName("Volume at the Open — 5m")).toBe("volume_at_the_open_5m");
    expect(suggestFileName("2025 regime study")).toBe("regime_study");
  });
});

function listProps(overrides: Partial<NotebookListProps> = {}): NotebookListProps {
  const { pinned, rest } = selectNotebooks(LIBRARY, NO_FILTERS, "edited");
  return {
    total: LIBRARY.length,
    categories: [{ name: "Data lake", count: 1 }, { name: "ML Dashboard", count: 1 }, { name: "Quant model research", count: 1 }],
    pinned,
    rest,
    sort: "edited",
    onSortChange: vi.fn(),
    text: "",
    onTextChange: vi.fn(),
    mode: "titles",
    onModeChange: vi.fn(),
    selectedCategories: new Set(),
    onToggleCategory: vi.fn(),
    onClearCategories: vi.fn(),
    dataset: null,
    onDatasetChange: vi.fn(),
    health: null,
    onHealthChange: vi.fn(),
    uncommittedOnly: false,
    onUncommittedChange: vi.fn(),
    activeId: null,
    onOpen: vi.fn(),
    onTogglePin: vi.fn(),
    search: { isFetching: false, error: null },
    notebooksById: new Map(LIBRARY.map((n) => [n.id, n])),
    ...overrides,
  };
}

describe("NotebookList", () => {
  it("shows the pinned section first, each description, and the git and health signs as words", () => {
    render(<NotebookList {...listProps()} />);
    const pinned = screen.getByTestId("pinned-section");
    expect(within(pinned).getByText("Model Cycle runs")).toBeTruthy();
    expect(screen.getByText("Every candle shape, counted")).toBeTruthy();
    expect(within(pinned).getByTestId("git-marker").textContent).toContain("edited");
    const failing = screen.getAllByTestId("health-badge").find((badge) => badge.dataset.health === "fails");
    expect(failing?.textContent).toContain("fails");
  });

  it("filters by a dataset chip without opening the notebook, and pins without opening it", () => {
    const props = listProps();
    render(<NotebookList {...props} />);
    fireEvent.click(screen.getByTitle(/lake view: derived_model_cycle_runs_\*/));
    expect(props.onDatasetChange).toHaveBeenCalledWith("derived_model_cycle_runs_*");
    fireEvent.click(screen.getByLabelText("Pin Lake audit"));
    expect(props.onTogglePin).toHaveBeenCalledWith(expect.objectContaining({ title: "Lake audit" }));
    expect(props.onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Lake audit"));
    expect(props.onOpen).toHaveBeenCalledWith(expect.objectContaining({ title: "Lake audit" }));
  });

  it("shows cell-search hits with their line numbers and the matched word marked", () => {
    const props = listProps({
      mode: "cells",
      text: "calibration",
      search: {
        isFetching: false,
        error: null,
        data: {
          query: "calibration",
          notebookCount: 1,
          results: [{ id: "cccccccccccc", path: "x", title: "Candle vocabulary", relativePath: "Trading/quant/model/notebooks/candle_vocab.py", total: 7, matches: [{ lineNumber: 42, text: "the calibration table", matchStart: 4, matchEnd: 15 }] }],
        },
      },
    });
    render(<NotebookList {...props} />);
    const results = screen.getByTestId("cell-search-results");
    expect(within(results).getByText("42")).toBeTruthy();
    expect(results.querySelector("mark")?.textContent).toBe("calibration");
    expect(within(results).getByText("+6 more lines")).toBeTruthy();
  });
});
