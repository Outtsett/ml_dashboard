// @vitest-environment jsdom
/**
 * `apps/web/src/ml/metrics/ModelMetricsPanel.tsx` against a small record and
 * registry: the two layers, the role and type filters, a row opening to its
 * definition, the "measured but not meaningful" and "not applicable" lists, a
 * specification the Model Cycle does not run, and reset.
 */
import "./setup";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { ModelMetricsPanel } from "@/ml/metrics/ModelMetricsPanel";
import { metricRegistrySchema, specificationMetricsSchema, type MetricRegistry, type SpecificationMetrics } from "@shared/cycle/metrics";

const metric = (metricId: string, fullName: string, metricType: string, availability: "computed" | "not_computed", engineId: string | null) => ({
  metricId,
  fullName,
  metricType,
  layer: "both" as const,
  definition: `Definition of ${fullName}.`,
  formula: `formula(${metricId})`,
  units: "ratio",
  direction: "higher",
  baseline: null,
  availability,
  engineId,
  engineTable: engineId ? "model_metrics" : null,
  engineSource: null,
  reading: null,
});

const REGISTRY: MetricRegistry = metricRegistrySchema.parse({
  version: 1,
  description: "test",
  availabilityValues: { computed: "c", computed_not_recorded: "n", derivable: "d", not_computed: "x" },
  roleValues: { primary: "p", secondary: "s", diagnostic: "d" },
  faithfulToSpecificationValues: { faithful: "The runnable adapter is the algorithm the specification describes.", partial: "p", stand_in: "s", no_specification: "n" },
  probabilitySourceValues: { own_likelihood_probability: "The model's own likelihood output." },
  priceForecastSourceValues: { second_model_same_family: "A second model of the same family.", none: "none" },
  checkpointSelectedByValues: { validation_logarithmic_loss: "The step with the lowest validation logarithmic loss is kept.", none: "none" },
  metricTypes: [
    { typeId: "proper_scoring_rule", name: "Proper scoring rule", layer: "both", questionItAnswers: "Are the stated odds honest?" },
    { typeId: "discrimination", name: "Discrimination and ranking", layer: "both", questionItAnswers: "Does the output order the outcomes?" },
    { typeId: "risk_adjusted_return", name: "Risk-adjusted return", layer: "as_run", questionItAnswers: "What was earned per unit of risk?" },
    { typeId: "risk_and_cost", name: "Risk and cost", layer: "as_run", questionItAnswers: "What came with the return?" },
  ],
  metrics: [
    metric("logarithmic_loss", "Logarithmic loss", "proper_scoring_rule", "computed", "log_loss"),
    metric("area_under_receiver_operating_characteristic_curve", "Area under the receiver operating characteristic curve", "discrimination", "computed", "roc_auc"),
    metric("held_out_log_likelihood_nats_per_row", "Held-out log-likelihood", "proper_scoring_rule", "not_computed", null),
    metric("sharpe_ratio", "Sharpe ratio", "risk_adjusted_return", "computed", "sharpe_ratio"),
    metric("exposure_fraction", "Exposure", "risk_and_cost", "computed", "exposure_fraction"),
  ],
  objectives: [{ objectiveId: "regularized_boosted_log_loss", fullName: "Regularised boosting objective on log loss", formula: "sum log loss + penalty", plainWords: "Trees added one at a time." }],
  profiles: [{ profileId: "class_probability", name: "Class probability", appliesTo: "a", produces: "A probability for each class.", typicalObjectives: [], metrics: [], notApplicable: [] }],
  asRunRules: [],
  assignmentRules: [],
  engineGaps: [],
});

const RECORD: SpecificationMetrics = specificationMetricsSchema.parse({
  recordVersion: 1,
  profileIdNative: "class_probability",
  profileIdAsRun: "class_probability",
  additionalProfileIds: [],
  registryModelKey: "xgboost",
  native: {
    produces: "A probability that the bar is followed by a rise.",
    targetVariable: "whether the close several bars ahead is above this bar's close",
    objectiveId: "regularized_boosted_log_loss",
    objectiveNote: null,
    metrics: [
      { metricId: "area_under_receiver_operating_characteristic_curve", type: "discrimination", role: "secondary", why: "The summed leaf scores order the bars.", baseline: null, groupKind: null, availability: "computed" },
      { metricId: "logarithmic_loss", type: "proper_scoring_rule", role: "primary", why: "Each tree is fitted to the gradient of this loss.", baseline: "the training up share", groupKind: null, availability: "computed" },
      { metricId: "held_out_log_likelihood_nats_per_row", type: "proper_scoring_rule", role: "diagnostic", why: "A diagnostic the dashboard does not compute.", baseline: null, groupKind: null, availability: "not_computed" },
    ],
    notApplicable: [{ name: "Gaussian NLL Loss", metricId: null, why: "The model states a class probability, not a Gaussian over returns." }],
  },
  asRun: {
    faithfulToSpecification: "faithful",
    standInNote: null,
    directionMode: "classifier",
    probabilitySource: "own_likelihood_probability",
    classWeighted: false,
    probabilityNote: "The sigmoid of the summed leaf scores.",
    priceForecastSource: "second_model_same_family",
    objectiveId: "regularized_boosted_log_loss",
    checkpointSelectedBy: "validation_logarithmic_loss",
    tuned: true,
    stepQuantity: { trainName: "logarithmic_loss", validationName: "logarithmic_loss", unit: "nats", direction: "lower", sameQuantityOnTrainAndValidation: true },
    meaningful: [{ metricId: "sharpe_ratio", type: "risk_adjusted_return", role: "primary", why: "The call's sign is traded by the engine's rule." }],
    measuredNotMeaningful: [{ metricId: "exposure_fraction", why: "The engine is always in the market." }],
    caveats: ["The fold's last bar exits at its close."],
  },
});

describe("ModelMetricsPanel", () => {
  it("opens on the native layer, primary first, and says what the dashboard computes", () => {
    render(<ModelMetricsPanel record={RECORD} registry={REGISTRY} modelName="XGBoost" />);
    const rows = screen.getAllByTestId(/^metric-row-/);
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "metric-row-logarithmic_loss",
      "metric-row-area_under_receiver_operating_characteristic_curve",
      "metric-row-held_out_log_likelihood_nats_per_row",
    ]);
    expect(screen.getByTestId("metrics-summary").textContent).toContain("Showing 3 of 3: 1 primary, 1 secondary, 1 diagnostic");
    expect(screen.getByTestId("metrics-summary").textContent).toContain("computes and records 2 of the 3");
    expect(within(rows[0]!).getByText("Each tree is fitted to the gradient of this loss.")).toBeTruthy();
    expect(within(rows[2]!).getByText("not computed yet")).toBeTruthy();
  });

  it("a row opens to the metric's definition, formula and the engine's column name", () => {
    render(<ModelMetricsPanel record={RECORD} registry={REGISTRY} modelName="XGBoost" />);
    fireEvent.click(within(screen.getByTestId("metric-row-logarithmic_loss")).getByRole("button"));
    const detail = screen.getByTestId("metric-detail-logarithmic_loss");
    expect(detail.textContent).toContain("Definition of Logarithmic loss.");
    expect(detail.textContent).toContain("formula(logarithmic_loss)");
    expect(detail.textContent).toContain("the training up share");
    expect(detail.textContent).toContain("log_loss");
  });

  it("the role chips filter the rows, and never to nothing", () => {
    render(<ModelMetricsPanel record={RECORD} registry={REGISTRY} modelName="XGBoost" />);
    fireEvent.click(screen.getByTestId("role-secondary"));
    fireEvent.click(screen.getByTestId("role-diagnostic"));
    expect(screen.getAllByTestId(/^metric-row-/)).toHaveLength(1);
    fireEvent.click(screen.getByTestId("role-primary"));
    expect(screen.getAllByTestId(/^metric-row-/)).toHaveLength(3);
  });

  it("the as-run layer shows the adapter's facts, what is meaningful and what is not", () => {
    render(<ModelMetricsPanel record={RECORD} registry={REGISTRY} modelName="XGBoost" />);
    fireEvent.click(screen.getByTestId("layer-as-run"));
    expect(screen.getAllByTestId(/^metric-row-/).map((row) => row.getAttribute("data-testid"))).toEqual(["metric-row-sharpe_ratio"]);
    const panel = screen.getByTestId("model-metrics-panel");
    expect(panel.textContent).toContain("The sigmoid of the summed leaf scores.");
    expect(panel.textContent).toContain("The two curves are the same quantity");
    expect(panel.textContent).toContain("The engine is always in the market.");
    expect(panel.textContent).toContain("The fold's last bar exits at its close.");
    fireEvent.click(screen.getByTestId("toggle-not-meaningful"));
    expect(panel.textContent).not.toContain("The engine is always in the market.");
  });

  it("the not-applicable list opens on request and reset restores the first view", () => {
    render(<ModelMetricsPanel record={RECORD} registry={REGISTRY} modelName="XGBoost" initialLayer="asRun" />);
    expect(screen.getAllByTestId(/^metric-row-/)).toHaveLength(1);
    fireEvent.click(screen.getByTestId("layer-native"));
    fireEvent.click(screen.getByTestId("toggle-not-applicable"));
    expect(screen.getByTestId("model-metrics-panel").textContent).toContain("not a Gaussian over returns");
    fireEvent.click(screen.getByTestId("metrics-reset"));
    expect(screen.getAllByTestId(/^metric-row-/).map((row) => row.getAttribute("data-testid"))).toEqual(["metric-row-sharpe_ratio"]);
  });

  it("a specification the Model Cycle does not run stays on the native layer", () => {
    const unlinked = specificationMetricsSchema.parse({ ...RECORD, profileIdAsRun: null, registryModelKey: null, asRun: null });
    render(<ModelMetricsPanel record={unlinked} registry={REGISTRY} modelName="Option-Critic" initialLayer="asRun" />);
    expect(screen.getByTestId("layer-as-run").textContent).toContain("not run");
    fireEvent.click(screen.getByTestId("layer-as-run"));
    expect(screen.getAllByTestId(/^metric-row-/)).toHaveLength(3);
  });
});
