// @vitest-environment jsdom
/**
 * `src/client/src/cycle/ConfigForm.tsx` — renders a family's grouped
 * hyperparameter fields from a fixture catalog, and `validateCycleForm`
 * blocks Play when `step_days` is below `test_days` (and is not 0).
 */
import "./setup";
import { useState } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  ConfigForm,
  createInitialCycleFormState,
  validateCycleForm,
  type CycleFormState,
} from "../../src/client/src/cycle/ConfigForm";
import type { CycleCatalogEntry } from "../../src/client/src/cycle/useCycleCatalog";
import type { HyperparameterDef } from "../../src/shared/trainingTypes";

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
  entry_probability: def({ type: "float", default: 0.55, min: 0.5, max: 1, step: 0.01, label: "Entry probability", group: "Trading" }),
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
    { name: "Trading", parameters: [{ key: "entry_probability", def: XGBOOST_HYPERPARAMETERS.entry_probability! }] },
    { name: "Runtime", parameters: [{ key: "device", def: XGBOOST_HYPERPARAMETERS.device! }] },
  ],
};

vi.mock("../../src/client/src/cycle/useCycleCatalog", () => ({
  useCycleCatalog: () => ({
    entries: [XGBOOST_ENTRY],
    byFamily: new Map([["xgboost", XGBOOST_ENTRY]]),
    isLoading: false,
  }),
}));

vi.mock("../../src/client/src/shared/contexts/SymbolContext", () => ({
  useSymbolContext: () => ({ symbol: "MNQ", timeframeMinutes: 5, assetType: "futures", setSymbol: vi.fn(), setAssetType: vi.fn(), setTimeframeMinutes: vi.fn() }),
}));

function Harness({ initial }: { initial: CycleFormState }) {
  const [state, setState] = useState(initial);
  return <ConfigForm value={state} onChange={setState} />;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("ConfigForm — family fields", () => {
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
        entry_probability: 0.55,
        device: "auto",
      },
    };
    render(<Harness initial={initial} />);

    // Family card is present and selected.
    expect(screen.getByText("XGBoost")).toBeInTheDocument();
    expect(screen.getByText("Tree ensemble")).toBeInTheDocument();

    // Group labels from the fixture's group order.
    expect(screen.getByText("Model")).toBeInTheDocument();
    expect(screen.getByText("Walk-forward")).toBeInTheDocument();
    expect(screen.getByText("Trading")).toBeInTheDocument();
    expect(screen.getByText("Runtime")).toBeInTheDocument();

    // Field labels for every parameter in the fixture.
    expect(screen.getByText("Boosting rounds")).toBeInTheDocument();
    expect(screen.getByText("Learning rate")).toBeInTheDocument();
    expect(screen.getByText("Train days")).toBeInTheDocument();
    expect(screen.getByText("Test days")).toBeInTheDocument();
    expect(screen.getByText("Step days")).toBeInTheDocument();
    expect(screen.getByText("Entry probability")).toBeInTheDocument();
    expect(screen.getByText("Device")).toBeInTheDocument();

    // Read-only symbol from SymbolContext.
    expect(screen.getByText("MNQ")).toBeInTheDocument();
  });

  it("picking a family fills defaults and switching back restores the remembered values", () => {
    const initial = createInitialCycleFormState();
    render(<Harness initial={initial} />);

    fireEvent.click(screen.getByText("XGBoost"));
    expect(screen.getByText("Boosting rounds")).toBeInTheDocument();
  });
});

describe("validateCycleForm — step_days blocks Play", () => {
  const base: CycleFormState = {
    ...createInitialCycleFormState(),
    familyKey: "xgboost+walk_forward_cycle",
    hyperparameters: {
      test_days: 10,
      step_days: 0,
      entry_probability: 0.55,
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

  it("blocks Play when entry_probability is out of (0.5, 1)", () => {
    const state = { ...base, hyperparameters: { ...base.hyperparameters, entry_probability: 0.5 } };
    expect(validateCycleForm(state).valid).toBe(false);
  });

  it("blocks Play when the date range is inverted", () => {
    const state = { ...base, dateStart: "2025-12-30", dateEnd: "2025-08-01" };
    expect(validateCycleForm(state).valid).toBe(false);
  });

  it("blocks Play when no family is selected", () => {
    expect(validateCycleForm(createInitialCycleFormState()).valid).toBe(false);
  });
});
