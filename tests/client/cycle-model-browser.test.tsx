// @vitest-environment jsdom
/**
 * `src/client/src/cycle/ModelBrowser.tsx` against a fixture
 * `GET /api/training/cycle-models` response (fetch stubbed, validated through
 * `cycleModelsResponseSchema` by the real `useCycleModels`): category
 * accordions with subcategory groups, runnable cards select their runner key,
 * greyed cards show their reason, chips / badge / note / spec link, search,
 * and the fallback grouping when the registry endpoint fails. Plus the pure
 * helpers in `useCycleCatalog.ts`.
 */
import "./setup";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ModelBrowser } from "../../src/client/src/cycle/ModelBrowser";
import {
  categoryOfRunnerKey,
  cycleModelsFromRunnerEntries,
  filterCycleModels,
  runnerKeyForCard,
  type CycleCatalogEntry,
} from "../../src/client/src/cycle/useCycleCatalog";
import { cycleModelsResponseSchema, type CycleModelCard, type CycleModelsResponse } from "../../src/shared/cycle/models";

// ─── Fixture ─────────────────────────────────────────────────────────────────

function card(partial: Partial<CycleModelCard> & Pick<CycleModelCard, "displayName">): CycleModelCard {
  const key = partial.key === undefined ? null : partial.key;
  return {
    key,
    runnerKey: key ? `${key}+walk_forward_cycle` : null,
    catalogSpecId: null,
    specAvailable: false,
    kind: null,
    summary: null,
    implementationNote: null,
    runnable: false,
    unavailableReason: null,
    implementation: null,
    explainKind: null,
    directionMode: null,
    hasPriceModel: null,
    sequence: false,
    speed: null,
    estimatedTrainingTime: null,
    ...partial,
  };
}

const XGBOOST = card({
  key: "xgboost",
  displayName: "XGBoost",
  catalogSpecId: "machine-learning-supervised-learning-boosting-methods-xgboost",
  specAvailable: true,
  kind: "Tree ensemble",
  summary: "Trees built one after another, each one fixing the last one's mistakes.",
  runnable: true,
  implementation: "xgboost",
  explainKind: "trees",
  directionMode: "classifier",
  hasPriceModel: true,
  speed: "fast",
  estimatedTrainingTime: "2-30 min (paced replay)",
});
const CATBOOST = card({
  key: "catboost",
  displayName: "CatBoost",
  catalogSpecId: "machine-learning-supervised-learning-boosting-methods-catboost",
  specAvailable: false,
  kind: "Tree ensemble",
  summary: "Symmetric trees.",
  runnable: false,
  unavailableReason: "Being built for the Cycle.",
  speed: "medium",
});
const PROBIT = card({
  key: "probit_regression",
  displayName: "Probit regression",
  kind: "Linear",
  summary: "A normal-curve cousin of logistic regression.",
  implementationNote: "statsmodels Probit. It has no regression form, so this model draws no forecast line.",
  runnable: true,
  hasPriceModel: false,
  speed: "fast",
});
const ORDINAL = card({ displayName: "Ordinal regression", catalogSpecId: "ordinal", specAvailable: true, runnable: false, unavailableReason: "Ordered classes, not up and down." });
const LSTM = card({
  key: "lstm",
  displayName: "LSTM",
  kind: "Sequence network",
  summary: "Reads the bars in order, keeping a running memory.",
  runnable: true,
  sequence: true,
  hasPriceModel: true,
  speed: "slow",
});

const RESPONSE: CycleModelsResponse = {
  categories: [
    {
      id: "supervised",
      label: "Supervised learning",
      runnableCount: 2,
      subcategories: [
        { id: "boosting-methods", label: "Boosting methods", models: [XGBOOST, CATBOOST] },
        { id: "linear-models", label: "Linear models", models: [PROBIT, ORDINAL] },
      ],
    },
    {
      id: "neural-network",
      label: "Neural network architectures",
      runnableCount: 1,
      subcategories: [{ id: "recurrent", label: "Recurrent and sequential models", models: [LSTM] }],
    },
  ],
  runnableCount: 3,
  totalCount: 5,
  catalogAvailable: true,
};

function runnerEntry(key: string, label: string, unavailableReason?: string): CycleCatalogEntry {
  return {
    key: `${key}+walk_forward_cycle`, family: key, label, description: `${label} runner.`,
    available: unavailableReason === undefined, unavailableReason, groups: [], hyperparameters: {},
  };
}
const RUNNERS = [
  runnerEntry("xgboost", "XGBoost"),
  runnerEntry("probit_regression", "Probit regression"),
  runnerEntry("lstm", "LSTM"),
  runnerEntry("ridge_regression", "Ridge regression", "Being built for the Cycle."),
];

// ─── Harness ─────────────────────────────────────────────────────────────────

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderBrowser(props: Partial<ComponentProps<typeof ModelBrowser>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSelect = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <ModelBrowser selectedRunnerKey={null} onSelect={onSelect} runnerEntries={RUNNERS} {...props} />
    </QueryClientProvider>,
  );
  return { onSelect };
}

beforeEach(() => {
  stubFetch(RESPONSE);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Rendering ───────────────────────────────────────────────────────────────

describe("ModelBrowser — grouping", () => {
  it("the fixture is a valid cycle-models response", () => {
    expect(cycleModelsResponseSchema.safeParse(RESPONSE).success).toBe(true);
  });

  it("reads GET /api/training/cycle-models with an abort signal", async () => {
    const fetchMock = stubFetch(RESPONSE);
    renderBrowser();
    await screen.findByText("XGBoost");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/training/cycle-models");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("opens the first category with a runnable model, groups by subcategory, and counts runnable models", async () => {
    renderBrowser();
    await screen.findByText("XGBoost");
    expect(screen.getByText("3 of 5 runnable")).toBeInTheDocument();
    expect(screen.getByText("Boosting methods")).toBeInTheDocument();
    expect(screen.getByText("Linear models")).toBeInTheDocument();
    expect(screen.getByText("2 of 4 runnable")).toBeInTheDocument();
    // The neural category is closed until clicked.
    expect(screen.queryByText("LSTM")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Neural network architectures/ }));
    expect(screen.getByText("LSTM")).toBeInTheDocument();
    expect(screen.getByText("Recurrent and sequential models")).toBeInTheDocument();
  });

  it("opens the category holding the selected model instead", async () => {
    renderBrowser({ selectedRunnerKey: "lstm+walk_forward_cycle" });
    await screen.findByText("LSTM");
    expect(screen.queryByText("XGBoost")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("cycle-model-card-lstm")).getByRole("button", { pressed: true })).toBeInTheDocument();
  });
});

describe("ModelBrowser — cards", () => {
  it("a runnable card selects its runner key", async () => {
    const { onSelect } = renderBrowser();
    fireEvent.click(await screen.findByText("XGBoost"));
    expect(onSelect).toHaveBeenCalledWith("xgboost+walk_forward_cycle");
  });

  it("shows the kind badge, summary, speed in words, and the spec link", async () => {
    renderBrowser();
    const xgboost = within(await screen.findByTestId("cycle-model-card-xgboost"));
    expect(xgboost.getByText("Tree ensemble")).toBeInTheDocument();
    expect(xgboost.getByText(/fixing the last one's mistakes/)).toBeInTheDocument();
    expect(xgboost.getByText("Fast to train")).toHaveAttribute("title", "Estimated training time: 2-30 min (paced replay)");
    expect(xgboost.getByRole("link", { name: /XGBoost spec/ })).toHaveAttribute(
      "href",
      "/model-catalog?model=machine-learning-supervised-learning-boosting-methods-xgboost",
    );
  });

  it("a greyed card is disabled and shows its reason; no spec link when the spec is not on disk", async () => {
    const { onSelect } = renderBrowser();
    const catboost = within(await screen.findByTestId("cycle-model-card-catboost"));
    expect(catboost.getByText("Being built for the Cycle.")).toBeInTheDocument();
    const button = catboost.getByRole("button");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onSelect).not.toHaveBeenCalled();
    expect(catboost.queryByRole("link")).not.toBeInTheDocument();
    // A catalog spec with no registry entry still links to its spec and says why.
    const ordinal = within(screen.getByTestId("cycle-model-card-ordinal"));
    expect(ordinal.getByText("Ordered classes, not up and down.")).toBeInTheDocument();
    expect(ordinal.getByRole("link")).toHaveAttribute("href", "/model-catalog?model=ordinal");
  });

  it("chips: no price model, reads a window of bars; and the implementation note", async () => {
    renderBrowser();
    const probit = within(await screen.findByTestId("cycle-model-card-probit_regression"));
    expect(probit.getByText("No price model — no forecast line")).toBeInTheDocument();
    expect(probit.getByText(/statsmodels Probit/)).toBeInTheDocument();
    expect(probit.queryByText("Reads a window of bars")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Neural network architectures/ }));
    const lstm = within(screen.getByTestId("cycle-model-card-lstm"));
    expect(lstm.getByText("Reads a window of bars")).toBeInTheDocument();
    expect(lstm.getByText("Slow to train")).toBeInTheDocument();
    expect(lstm.queryByText("No price model — no forecast line")).not.toBeInTheDocument();
  });

  it("a runnable model whose runner the server lacks is disabled with that reason", async () => {
    renderBrowser({ runnerEntries: RUNNERS.filter((entry) => entry.family !== "xgboost") });
    const xgboost = within(await screen.findByTestId("cycle-model-card-xgboost"));
    expect(xgboost.getByRole("button")).toBeDisabled();
    expect(xgboost.getByText(/no runner for this model/)).toBeInTheDocument();
  });

  it("every card is disabled while a run is going", async () => {
    renderBrowser({ disabled: true });
    const xgboost = within(await screen.findByTestId("cycle-model-card-xgboost"));
    expect(xgboost.getByRole("button")).toBeDisabled();
  });
});

describe("ModelBrowser — search and fallback", () => {
  it("search narrows the cards and opens every matching category", async () => {
    renderBrowser();
    await screen.findByText("XGBoost");
    fireEvent.change(screen.getByLabelText("Search models"), { target: { value: "sequence" } });
    expect(screen.getByText("LSTM")).toBeInTheDocument();
    expect(screen.queryByText("XGBoost")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 1 runnable")).toBeInTheDocument(); // the matching category, recounted
    expect(screen.getByText("3 of 5 runnable")).toBeInTheDocument(); // the header keeps the whole registry
    fireEvent.change(screen.getByLabelText("Search models"), { target: { value: "nothing like this" } });
    expect(screen.getByText('No model matches "nothing like this".')).toBeInTheDocument();
  });

  it("falls back to the runner entries when the registry endpoint fails", async () => {
    stubFetch({ error: "not found" }, 404);
    const { onSelect } = renderBrowser();
    expect(await screen.findByText(/The model registry did not load/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Probit regression"));
    expect(onSelect).toHaveBeenCalledWith("probit_regression+walk_forward_cycle");
  });

  it("a response of the wrong shape is refused and falls back the same way", async () => {
    stubFetch({ categories: "no" });
    renderBrowser();
    expect(await screen.findByText(/shape the browser cannot read/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("XGBoost")).toBeInTheDocument());
  });
});

// ─── Pure helpers ────────────────────────────────────────────────────────────

describe("useCycleCatalog helpers", () => {
  it("filterCycleModels matches every term across name, kind, summary and labels, and recounts", () => {
    const result = filterCycleModels(RESPONSE, "linear FORECAST");
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]!.subcategories[0]!.models.map((model) => model.displayName)).toEqual(["Probit regression"]);
    expect(result.runnableCount).toBe(1);
    expect(result.totalCount).toBe(1);
    expect(filterCycleModels(RESPONSE, "   ")).toBe(RESPONSE);
  });

  it("runnerKeyForCard prefers the server's runner key and builds one from the key otherwise", () => {
    expect(runnerKeyForCard(XGBOOST)).toBe("xgboost+walk_forward_cycle");
    expect(runnerKeyForCard({ ...XGBOOST, runnerKey: null })).toBe("xgboost+walk_forward_cycle");
    expect(runnerKeyForCard(ORDINAL)).toBeNull();
  });

  it("categoryOfRunnerKey finds the category of a runner key", () => {
    expect(categoryOfRunnerKey(RESPONSE, "lstm+walk_forward_cycle")).toBe("neural-network");
    expect(categoryOfRunnerKey(RESPONSE, "missing+walk_forward_cycle")).toBeNull();
    expect(categoryOfRunnerKey(RESPONSE, null)).toBeNull();
  });

  it("cycleModelsFromRunnerEntries builds a valid response: available runners selectable, the rest greyed with the server's reason", () => {
    const fallback = cycleModelsFromRunnerEntries(RUNNERS);
    expect(cycleModelsResponseSchema.safeParse(fallback).success).toBe(true);
    expect(fallback.runnableCount).toBe(3);
    const models = fallback.categories[0]!.subcategories[0]!.models;
    expect(models.filter((model) => model.runnable).map((model) => model.key)).toEqual(["xgboost", "probit_regression", "lstm"]);
    expect(models.find((model) => model.key === "ridge_regression")).toMatchObject({ runnable: false, unavailableReason: "Being built for the Cycle." });
    expect(cycleModelsFromRunnerEntries([]).categories).toEqual([]);
  });
});
