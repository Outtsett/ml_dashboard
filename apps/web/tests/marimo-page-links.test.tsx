// @vitest-environment jsdom
/**
 * The Notebooks page follows a link: /marimo?notebook=<path tail> makes that
 * notebook the active tab even when tabs restored from the last visit put a
 * different one in front, and the URL is then rewritten to the notebook's id.
 */
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MarimoPage from "@/marimo/MarimoPage";
import type { CatalogResponse, NotebookEntry } from "@/marimo/types";

function notebook(id: string, file: string, title: string): NotebookEntry {
  return {
    id,
    path: `E:/source/repos/ml_dashboard/notebooks/${file}`,
    groupSlug: "ml-dashboard",
    category: "ML Dashboard",
    repoLabel: "ml_dashboard/notebooks",
    relativePath: `ml_dashboard/notebooks/${file}`,
    title,
    description: "",
    sizeBytes: 1,
    modifiedAtIso: "2026-09-28T10:00:00.000Z",
    createdAtIso: "2026-09-28T10:00:00.000Z",
    url: `/marimo/ml-dashboard/?file=${file}`,
    datasets: [],
    cellCount: 1,
    gitState: "clean",
    pinned: false,
    health: null,
  };
}

const CATALOG: CatalogResponse = {
  groups: [{
    slug: "ml-dashboard", label: "ML Dashboard", python: "python", cwd: ".", port: 17186, status: "ready",
    expectedStartupSeconds: 3, memoryBytes: null, openConnections: 0, idleSeconds: 0, keptWarm: false,
  }],
  notebooks: [notebook("aaaaaaaaaaaa", "process_census.py", "Process census"), notebook("bbbbbbbbbbbb", "contract_specifications.py", "Contract specifications")],
  roots: [],
  idleStopMinutes: 30,
  healthQueue: { queued: 0, running: 0 },
};

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("MarimoPage links", () => {
  it("activates the linked notebook over the restored active tab, then writes its id to the URL", async () => {
    window.localStorage.setItem("notebook-tabs-v1", JSON.stringify({
      tabs: [
        { key: "run:aaaaaaaaaaaa", notebookId: "aaaaaaaaaaaa", mode: "run" },
        { key: "run:bbbbbbbbbbbb", notebookId: "bbbbbbbbbbbb", mode: "run" },
      ],
      activeKey: "run:bbbbbbbbbbbb",
    }));
    window.history.replaceState(null, "", "/marimo?notebook=notebooks/process_census.py");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify(CATALOG), { status: 200 }));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<StrictMode><QueryClientProvider client={client}><MarimoPage /></QueryClientProvider></StrictMode>);

    await waitFor(() => {
      const selected = screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true");
      expect(selected?.textContent).toContain("Process census");
    });
    await waitFor(() => expect(window.location.search).toBe("?notebook=aaaaaaaaaaaa"));
  });

  it("does the same when the catalog is already cached and the environment is stopped", async () => {
    window.localStorage.setItem("notebook-tabs-v1", JSON.stringify({
      tabs: [
        { key: "run:aaaaaaaaaaaa", notebookId: "aaaaaaaaaaaa", mode: "run" },
        { key: "run:bbbbbbbbbbbb", notebookId: "bbbbbbbbbbbb", mode: "run" },
      ],
      activeKey: "run:bbbbbbbbbbbb",
    }));
    window.history.replaceState(null, "", "/marimo?notebook=notebooks/process_census.py");
    const stopped = { ...CATALOG, groups: CATALOG.groups.map((g) => ({ ...g, status: "stopped" as const })) };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      new Response(JSON.stringify(String(input).includes("/start") ? { status: "ready" } : stopped), { status: 200 }));

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["marimo", "notebooks"], stopped);
    render(<StrictMode><QueryClientProvider client={client}><MarimoPage /></QueryClientProvider></StrictMode>);

    await waitFor(() => {
      const selected = screen.getAllByRole("tab").find((tab) => tab.getAttribute("aria-selected") === "true");
      expect(selected?.textContent).toContain("Process census");
    });
    await waitFor(() => expect(window.location.search).toBe("?notebook=aaaaaaaaaaaa"));
  });
});
