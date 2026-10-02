// @vitest-environment jsdom
/**
 * `apps/web/src/cycle/ConfigForm.tsx` — renders a model's grouped
 * hyperparameter fields from a fixture runner catalog, picks models through
 * the `ModelBrowser` (registry cards from a fixture), remembers the last model,
 * puts the runner's own parameter description ahead of `parameterHelp.ts`,
 * and `validateCycleForm` blocks Play when `step_days` is below `test_days`
 * (and is not 0).
 */
import "./setup";
import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

import {
  ConfigForm,
  createInitialCycleFormState,
  validateCycleForm,
  type CycleFormState,
} from "@/cycle/ConfigForm";
import type { CycleCatalogEntry } from "@/cycle/useCycleCatalog";
import { CYCLE_PARAMETER_HELP, parameterHelpFor } from "@/cycle/parameterHelp";
import type { CycleModelsResponse } from "@shared/cycle/models";
import type { HyperparameterDef } from "@shared/trainingTypes";

// ─── Fixture catalog ─────────────────────────────────────────────────────────

function def(partial: Partial<HyperparameterDef> & Pick<HyperparameterDef, "default" | "type" | "label">): HyperparameterDef {
  return partial as HyperparameterDef;
}

const XGBOOST_HYPERPARAMETERS: Record<string, HyperparameterDef> = {
  boosting_rounds: def({ type: "int", default: 400, min: 50, max: 1000, step: 10, label: "Boosting rounds", group: "Model" }),
  learning_rate: def({ type: "float", default: 0.05, min: 0.001, max: 0.5, step: 0.001, label: "Learning rate", group: "Model" }),
  train_days: def({ type: "int", default: 60, min: 5, max: 365, step: 1, label: "Train days", group: "Walk-forward" }),
  test_days: def({ type: "int", default: 10, min: 1, max: 90, step: 1, label: "Test days", group: "Walk-forward" }),
  step_days: def({ type: "int", default: 0, min: 0, max: 90, step: 1, label: "Step days", group: "Walk-forward" }),
  long_only: def({ type: "bool", default: false, label: "Long only", group: "Trading" }),
  device: def({ type: "categorical", default: "auto", choices: ["auto", "cuda", "cpu"], label: "Device", group: "Runtime" }),
};

const XGBOOST_ENTRY: CycleCatalogEntry = {
  key: "xgboost+walk_forward_cycle",
  family: "xgboost",
  label: "XGBoost",
  description: "Gradient-boosted trees.",
  hyperparameters: XGBOOST_HYPERPARAMETERS,
  groups: [
    { name: "Model", parameters: [
      { key: "boosting_rounds", def: XGBOOST_HYPERPARAMETERS.boosting_rounds! },
      { key: "learning_rate", def: XGBOOST_HYPERPARAMETERS.learning_rate! },
    ] },
    { name: "Walk-forward", parameters: [
      { key: "train_days", def: XGBOOST_HYPERPARAMETERS.train_days! },
      { key: "test_days", def: XGBOOST_HYPERPARAMETERS.test_days! },
      { key: "step_days", def: XGBOOST_HYPERPARAMETERS.step_days! },
    ] },
    { name: "Trading", parameters: [{ key: "long_only", def: XGBOOST_HYPERPARAMETERS.long_only! }] },
    { name: "Runtime", parameters: [{ key: "device", def: XGBOOST_HYPERPARAMETERS.device! }] },
  ],
};

const MODELS_RESPONSE: CycleModelsResponse = {
  categories: [
    {
      id: "supervised",
      label: "Supervised learning",
      runnableCount: 1,
      subcategories: [
        {
          id: "boosting-methods",
          label: "Boosting methods",
          models: [
            {
              key: "xgboost",
              runnerKey: "xgboost+walk_forward_cycle",
              displayName: "XGBoost",
              catalogSpecId: "machine-learning-supervised-learning-boosting-methods-xgboost",
              specAvailable: true,
              kind: "Tree ensemble",
              summary: "Trees built one after another.",
              implementationNote: null,
              runnable: true,
              unavailableReason: null,
              implementation: "xgboost",
              explainKind: "trees",
              directionMode: "classifier",
              hasPriceModel: true,
              sequence: false,
              speed: "fast",
              estimatedTrainingTime: "2-30 min (paced replay)",
            },
          ],
        },
      ],
    },
  ],
  runnableCount: 1,
  totalCount: 1,
  catalogAvailable: true,
};

// The runner read and the registry read are both replaced; the pure helpers the browser uses stay real.
vi.mock("@/cycle/useCycleCatalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/cycle/useCycleCatalog")>()),
  useCycleCatalog: () => ({
    entries: [XGBOOST_ENTRY],
    byFamily: new Map([["xgboost", XGBOOST_ENTRY]]),
    isLoading: false,
  }),
  useCycleModels: () => ({ data: MODELS_RESPONSE, isLoading: false, isError: false, error: null }),
}));

vi.mock("../src/shared/contexts/SymbolContext", () => ({
  useSymbolContext: () => ({ symbol: "MNQ", timeframeMinutes: 5, assetType: "futures", setSymbol: vi.fn(), setAssetType: vi.fn(), setTimeframeMinutes: vi.fn() }),
}));

function Harness({ initial }: { initial: CycleFormState }) {
  const [state, setState] = useState(initial);
  return <ConfigForm value={state} onChange={setState} />;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("ConfigForm — model fields", () => {
  it("renders the selected family's grouped fields from the fixture catalog", () => {
    const initial: CycleFormState = {
      ...createInitialCycleFormState(),
      familyKey: "xgboost+walk_forward_cycle",
      hyperparameters: {
        boosting_rounds: 400,
        learning_rate: 0.05,
        train_days: 60,
        test_days: 10,
        step_days: 0,
        long_only: false,
        device: "auto",
      },
    };
    render(<Harness initial={initial} />);

    // The model's card is present, selected, and carries the registry's kind badge.
    const card = within(screen.getByTestId("cycle-model-card-xgboost"));
    expect(card.getByText("XGBoost")).toBeInTheDocument();
    expect(card.getByText("Tree ensemble")).toBeInTheDocument();
    expect(card.getByRole("button", { pressed: true })).toBeInTheDocument();

    // Group labels from the fixture's group order.
    expect(screen.getAllByText("Model")).toHaveLength(2); // the browser's heading and the parameter group
    expect(screen.getByText("Walk-forward")).toBeInTheDocument();
    expect(screen.getByText("Trading")).toBeInTheDocument();
    expect(screen.getByText("Runtime")).toBeInTheDocument();

    // Field labels for every parameter in the fixture.
    expect(screen.getByText("Boosting rounds")).toBeInTheDocument();
    expect(screen.getByText("Learning rate")).toBeInTheDocument();
    expect(screen.getByText("Train days")).toBeInTheDocument();
    expect(screen.getByText("Test days")).toBeInTheDocument();
    expect(screen.getByText("Step days")).toBeInTheDocument();
    expect(screen.getByText("Long only")).toBeInTheDocument();
    expect(screen.getByText("Device")).toBeInTheDocument();

    // Read-only symbol from SymbolContext.
    expect(screen.getByText("MNQ")).toBeInTheDocument();
  });

  it("picking a model fills its defaults and remembers it as the last model", () => {
    const initial = createInitialCycleFormState();
    render(<Harness initial={initial} />);
    expect(screen.queryByText("Boosting rounds")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("XGBoost"));
    expect(screen.getByText("Boosting rounds")).toBeInTheDocument();
    expect(window.localStorage.getItem("cycle-last-family-v1")).toBe("xgboost+walk_forward_cycle");
    const stored = JSON.parse(window.localStorage.getItem("cycle-config-xgboost+walk_forward_cycle-v1") ?? "{}");
    expect(stored.hyperparameters.boosting_rounds).toBe(400);
  });

  it("a reload opens on the last model with its remembered values", () => {
    window.localStorage.setItem("cycle-last-family-v1", "xgboost+walk_forward_cycle");
    window.localStorage.setItem(
      "cycle-config-xgboost+walk_forward_cycle-v1",
      JSON.stringify({ familyKey: "xgboost+walk_forward_cycle", timeframe: "15m", hyperparameters: { boosting_rounds: 250 } }),
    );
    const onChange = vi.fn();
    render(<ConfigForm value={createInitialCycleFormState()} onChange={onChange} />);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as CycleFormState;
    expect(next.familyKey).toBe("xgboost+walk_forward_cycle");
    expect(next.timeframe).toBe("15m");
    expect(next.hyperparameters.boosting_rounds).toBe(250);
    expect(next.hyperparameters.learning_rate).toBe(0.05); // not remembered: the default
  });
});

describe("parameterHelpFor — the runner's description first", () => {
  it("uses the runner's description when it has one", () => {
    expect(parameterHelpFor("learning_rate", "The registry's own sentence.")).toBe("The registry's own sentence.");
  });

  it("falls back to parameterHelp.ts when the description is missing or blank", () => {
    expect(parameterHelpFor("learning_rate")).toBe(CYCLE_PARAMETER_HELP.learning_rate);
    expect(parameterHelpFor("learning_rate", "   ")).toBe(CYCLE_PARAMETER_HELP.learning_rate);
    expect(parameterHelpFor("not_a_known_key")).toBeUndefined();
  });
});

describe("validateCycleForm — step_days blocks Play", () => {
  const base: CycleFormState = {
    ...createInitialCycleFormState(),
    familyKey: "xgboost+walk_forward_cycle",
    hyperparameters: {
      test_days: 10,
      step_days: 0,
    },
  };

  it("is valid when step_days is 0 (defaults to the test window)", () => {
    expect(validateCycleForm(base).valid).toBe(true);
  });

  it("is valid when step_days is at least test_days", () => {
    const state = { ...base, hyperparameters: { ...base.hyperparameters, step_days: 10 } };
    expect(validateCycleForm(state).valid).toBe(true);
  });

  it("blocks Play when step_days is positive but less than test_days", () => {
    const state = { ...base, hyperparameters: { ...base.hyperparameters, step_days: 3 } };
    const result = validateCycleForm(state);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/step days/i);
  });

  it("blocks Play when the date range is inverted", () => {
    const state = { ...base, dateStart: "2025-12-30", dateEnd: "2025-08-01" };
    expect(validateCycleForm(state).valid).toBe(false);
  });

  it("blocks Play when no model is selected", () => {
    expect(validateCycleForm(createInitialCycleFormState()).valid).toBe(false);
  });
});
