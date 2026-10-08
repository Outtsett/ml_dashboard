/**
 * How one model is judged: its metrics, the type of each, its role, and why it
 * applies to this model. Two layers, switched with one control:
 *
 *   Native    what the algorithm produces and optimises, and the metrics that are
 *             correct for that output, whether or not the dashboard computes them;
 *   As run    what the Model Cycle measures when the model's call on the close
 *             `label_horizon_bars` ahead is traded with costs: the numbers that
 *             test something this model's mechanism produced, and the ones that
 *             are measured but say nothing about it.
 *
 * Every row opens to the metric's definition (the engine's own text when the
 * engine computes it), its formula, units and reference point. The record comes
 * from the model itself (`metrics` on its registry entry, or the block in its
 * specification); the names and definitions from `packages/config/metric_registry.json`.
 * Colours are Okabe-Ito, and every colour is repeated by a glyph and a word.
 */
import { useState } from "react";

import type { MetricAvailability, MetricRegistry, MetricRole, SpecificationMetrics } from "@shared/cycle/metrics";
import { notMeaningfulOf, rowsOf, summaryOf, type MetricLayer, type MetricViewRow } from "@/ml/metrics/rows";

const ROLES: Record<MetricRole, { glyph: string; color: string; label: string; meaning: string }> = {
  primary: { glyph: "●", color: "#E69F00", label: "primary", meaning: "The number that says whether the model did its job." },
  secondary: { glyph: "◆", color: "#56B4E9", label: "secondary", meaning: "Supports or qualifies the primary number." },
  diagnostic: { glyph: "○", color: "#999999", label: "diagnostic", meaning: "Explains why; never a score." },
};
const ROLE_NAMES: MetricRole[] = ["primary", "secondary", "diagnostic"];

const AVAILABILITY: Record<MetricAvailability, { glyph: string; color: string; label: string }> = {
  computed: { glyph: "■", color: "#0072B2", label: "computed by the dashboard" },
  computed_not_recorded: { glyph: "◧", color: "#F0E442", label: "computed in training, not recorded" },
  derivable: { glyph: "◨", color: "#F0E442", label: "derivable from the run record" },
  not_computed: { glyph: "□", color: "#999999", label: "not computed yet" },
};

function Chip({ active, onClick, title, children, testId }: { active: boolean; onClick: () => void; title?: string; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      data-testid={testId}
      aria-pressed={active}
      className={`cursor-pointer rounded border px-2 py-0.5 font-mono text-[11px] ${
        active ? "border-foreground/60 bg-foreground/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="contents">
      <dt className="font-mono text-[10px] uppercase text-muted-foreground">{label}</dt>
      <dd className="text-[11px] leading-snug text-foreground">{children}</dd>
    </div>
  );
}

function MetricRow({ row, open, onToggle }: { row: MetricViewRow; open: boolean; onToggle: () => void }) {
  const role = ROLES[row.role];
  const availability = AVAILABILITY[row.availability];
  return (
    <li className="rounded-md border border-border bg-card/60" data-testid={`metric-row-${row.metricId}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full cursor-pointer flex-col gap-1 px-3 py-2 text-left">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span style={{ color: role.color }} className="font-mono text-[11px] font-bold" title={role.meaning}>
            {role.glyph} {role.label}
          </span>
          <span className="text-[13px] font-semibold text-foreground">{row.fullName}</span>
          <span className="rounded border border-border px-1.5 py-px font-mono text-[10px] text-muted-foreground" title={row.typeQuestion}>
            {row.typeName}
          </span>
          <span className="ml-auto font-mono text-[10px]" style={{ color: availability.color }}>
            {availability.glyph} <span className="text-muted-foreground">{availability.label}</span>
          </span>
        </div>
        <div className="text-[12px] leading-snug text-foreground/90">{row.why}</div>
      </button>
      {open && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-border px-3 py-2" data-testid={`metric-detail-${row.metricId}`}>
          <Fact label="How it is computed">{row.definition}</Fact>
          <Fact label="Formula">
            <code className="font-mono text-[11px]">{row.formula}</code>
          </Fact>
          <Fact label="Units">{row.units || "none"}</Fact>
          <Fact label="Better when">{row.direction}</Fact>
          <Fact label="Reference point">{row.referencePoint ?? "none"}</Fact>
          <Fact label="This type answers">{row.typeQuestion}</Fact>
          {row.reading && <Fact label="How to read it">{row.reading}</Fact>}
          <Fact label="Metric id">
            <code className="font-mono text-[11px]">{row.metricId}</code>
            {row.engineId && row.engineId !== row.metricId && (
              <span className="text-muted-foreground">
                {" "}
                (the engine's column is <code className="font-mono">{row.engineId}</code>)
              </span>
            )}
          </Fact>
          {row.engineSource && <Fact label="Source">{row.engineSource}</Fact>}
        </dl>
      )}
    </li>
  );
}

export interface ModelMetricsPanelProps {
  record: SpecificationMetrics;
  registry: MetricRegistry;
  /** The layer shown first; "asRun" falls back to "native" when the model is not run by the Model Cycle. */
  initialLayer?: MetricLayer;
  /** The model's name, for the sentences. */
  modelName: string;
}

export function ModelMetricsPanel({ record, registry, initialLayer = "native", modelName }: ModelMetricsPanelProps) {
  const runs = record.asRun !== null;
  const startLayer: MetricLayer = initialLayer === "asRun" && runs ? "asRun" : "native";
  const [layer, setLayer] = useState<MetricLayer>(startLayer);
  const [roles, setRoles] = useState<Set<MetricRole>>(new Set(ROLE_NAMES));
  const [type, setType] = useState<string | "all">("all");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showNotMeaningful, setShowNotMeaningful] = useState(true);
  const [showNotApplicable, setShowNotApplicable] = useState(false);

  const profiles = new Map(registry.profiles.map((profile) => [profile.profileId, profile]));
  const objectives = new Map(registry.objectives.map((objective) => [objective.objectiveId, objective]));
  const all = rowsOf(record, registry, layer);
  const typesPresent = [...new Map(all.map((row) => [row.type, row.typeName])).entries()];
  const shown = all.filter((row) => roles.has(row.role) && (type === "all" || row.type === type));
  const summary = summaryOf(all);
  const notMeaningful = notMeaningfulOf(record, registry);
  const asRun = record.asRun;
  const profileId = layer === "native" ? record.profileIdNative : record.profileIdAsRun;
  const profile = profileId ? profiles.get(profileId) : undefined;
  const objectiveId = layer === "native" ? record.native.objectiveId : asRun?.objectiveId;
  const objective = objectiveId ? objectives.get(objectiveId) : undefined;

  function toggleRole(role: MetricRole) {
    const next = new Set(roles);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    setRoles(next.size === 0 ? new Set(ROLE_NAMES) : next);
  }
  function toggleOpen(metricId: string) {
    const next = new Set(open);
    if (next.has(metricId)) next.delete(metricId);
    else next.add(metricId);
    setOpen(next);
  }
  function changeLayer(next: MetricLayer) {
    setLayer(next);
    setType("all");
    setOpen(new Set());
  }
  function reset() {
    setLayer(startLayer);
    setRoles(new Set(ROLE_NAMES));
    setType("all");
    setOpen(new Set());
    setShowNotMeaningful(true);
    setShowNotApplicable(false);
  }

  const layerSentence =
    layer === "native"
      ? `What ${modelName} is judged on by its own output, whether or not the dashboard computes the number today.`
      : `What the Model Cycle measures when ${modelName}'s call on the close label_horizon_bars ahead is traded with costs, and which of those numbers test something this model's mechanism produced.`;

  return (
    <div className="space-y-3" data-testid="model-metrics-panel">
      {/* layer + filters */}
      <div className="flex flex-wrap items-center gap-1">
        <Chip active={layer === "native"} onClick={() => changeLayer("native")} testId="layer-native" title="What the algorithm produces and optimises, and the metrics that are correct for that output.">
          Native
        </Chip>
        <Chip
          active={layer === "asRun"}
          onClick={() => runs && changeLayer("asRun")}
          testId="layer-as-run"
          title={runs ? "What the Model Cycle measures once the model is adapted to direction over a horizon and traded." : "This specification is not run by the Model Cycle."}
        >
          As run (Model Cycle){runs ? "" : ": not run"}
        </Chip>
        <span className="mx-1 text-muted-foreground">·</span>
        {ROLE_NAMES.map((role) => (
          <Chip key={role} active={roles.has(role)} onClick={() => toggleRole(role)} title={ROLES[role].meaning} testId={`role-${role}`}>
            <span style={{ color: ROLES[role].color }}>{ROLES[role].glyph}</span> {ROLES[role].label} ({summary[role]})
          </Chip>
        ))}
        <span className="mx-1 text-muted-foreground">·</span>
        <Chip active={type === "all"} onClick={() => setType("all")}>
          all types
        </Chip>
        {typesPresent.map(([typeId, typeName]) => (
          <Chip key={typeId} active={type === typeId} onClick={() => setType(type === typeId ? "all" : typeId)} title={registry.metricTypes.find((entry) => entry.typeId === typeId)?.questionItAnswers}>
            {typeName}
          </Chip>
        ))}
        <button type="button" onClick={reset} className="ml-auto cursor-pointer rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground" data-testid="metrics-reset">
          reset
        </button>
      </div>

      {/* what the model is, in this layer */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border border-border bg-card/60 p-3">
        <Fact label="Evaluation profile">
          <span className="font-semibold">{profile?.name ?? profileId ?? "none"}</span>
          {profile && <span className="text-muted-foreground">: {profile.produces}</span>}
          {layer === "native" && record.additionalProfileIds.length > 0 && (
            <span className="text-muted-foreground"> Also borrows named metrics from: {record.additionalProfileIds.map((entry) => profiles.get(entry)?.name ?? entry).join(", ")}.</span>
          )}
        </Fact>
        {layer === "native" && <Fact label="Produces">{record.native.produces}</Fact>}
        {layer === "native" && <Fact label="Target">{record.native.targetVariable}</Fact>}
        <Fact label={layer === "native" ? "Objective" : "Objective as run"}>
          <span className="font-semibold">{objective?.fullName ?? objectiveId ?? "none"}</span>
          {objective && <span className="text-muted-foreground">: {objective.plainWords}</span>}
          {layer === "native" && record.native.objectiveNote && <span> {record.native.objectiveNote}</span>}
          {objective?.formula && (
            <div>
              <code className="font-mono text-[11px] text-muted-foreground">{objective.formula}</code>
            </div>
          )}
        </Fact>
        {layer === "asRun" && asRun && (
          <>
            <Fact label="Fidelity">
              <span className="font-semibold">{asRun.faithfulToSpecification.replace(/_/g, " ")}</span>
              <span className="text-muted-foreground">: {registry.faithfulToSpecificationValues[asRun.faithfulToSpecification]}</span>
              {asRun.standInNote && <span> {asRun.standInNote}</span>}
            </Fact>
            <Fact label="Probability of up">
              <span className="font-semibold">{asRun.probabilitySource.replace(/_/g, " ")}</span>
              {asRun.classWeighted && <span className="font-semibold">, class weighted</span>}
              <span className="text-muted-foreground">: {registry.probabilitySourceValues[asRun.probabilitySource]}</span> {asRun.probabilityNote}
            </Fact>
            <Fact label="Price forecast">
              <span className="font-semibold">{asRun.priceForecastSource.replace(/_/g, " ")}</span>
              <span className="text-muted-foreground">: {registry.priceForecastSourceValues[asRun.priceForecastSource]}</span>
            </Fact>
            <Fact label="Checkpoint">
              <span className="text-muted-foreground">{registry.checkpointSelectedByValues[asRun.checkpointSelectedBy]}</span> Hyperparameters are {asRun.tuned ? "searched inside every fold" : "not searched"}.
            </Fact>
            <Fact label="Loss curves">
              {asRun.stepQuantity === null ? (
                "None logged: the model is fitted in one step."
              ) : (
                <>
                  train_loss holds <code className="font-mono">{asRun.stepQuantity.trainName ?? "nothing"}</code> and validation_loss holds{" "}
                  <code className="font-mono">{asRun.stepQuantity.validationName ?? "nothing"}</code>; {asRun.stepQuantity.direction} is better.{" "}
                  {asRun.stepQuantity.sameQuantityOnTrainAndValidation
                    ? "The two curves are the same quantity, so their gap measures overfitting."
                    : "The two curves are different quantities, so their gap is not an overfitting measure."}{" "}
                  <span className="text-muted-foreground">Unit: {asRun.stepQuantity.unit}</span>
                </>
              )}
            </Fact>
          </>
        )}
      </dl>

      {/* the metrics */}
      <div className="text-[11px] leading-snug text-muted-foreground" data-testid="metrics-summary">
        {layerSentence} Showing {shown.length} of {summary.total}: {summary.primary} primary, {summary.secondary} secondary, {summary.diagnostic} diagnostic. The dashboard computes and records{" "}
        {summary.computed} of the {summary.total} today. Click a metric for how it is computed.
      </div>
      <ul className="space-y-1.5">
        {shown.map((row) => (
          <MetricRow key={row.metricId} row={row} open={open.has(row.metricId)} onToggle={() => toggleOpen(row.metricId)} />
        ))}
      </ul>
      {layer === "asRun" && asRun && asRun.caveats.length > 0 && (
        <div className="rounded-md border border-border bg-card/60 p-3">
          <div className="font-mono text-[10px] uppercase text-muted-foreground">Caveats that attach to this model as run</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] leading-snug text-foreground/90">
            {asRun.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </div>
      )}

      {/* what does not count */}
      {layer === "asRun" && notMeaningful.length > 0 && (
        <div className="rounded-md border border-border bg-card/60 p-3">
          <button type="button" onClick={() => setShowNotMeaningful(!showNotMeaningful)} aria-expanded={showNotMeaningful} className="cursor-pointer font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground" data-testid="toggle-not-meaningful">
            {showNotMeaningful ? "▾" : "▸"} Measured but not meaningful for this model ({notMeaningful.length})
          </button>
          {showNotMeaningful && (
            <ul className="mt-1 space-y-1">
              {notMeaningful.map((row) => (
                <li key={row.metricId} className="text-[11px] leading-snug">
                  <span className="font-semibold text-foreground">⊘ {row.fullName}</span>
                  <span className="text-muted-foreground">: {row.why}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {layer === "native" && record.native.notApplicable.length > 0 && (
        <div className="rounded-md border border-border bg-card/60 p-3">
          <button type="button" onClick={() => setShowNotApplicable(!showNotApplicable)} aria-expanded={showNotApplicable} className="cursor-pointer font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground" data-testid="toggle-not-applicable">
            {showNotApplicable ? "▾" : "▸"} Metrics that do not apply to this model ({record.native.notApplicable.length})
          </button>
          {showNotApplicable && (
            <ul className="mt-1 space-y-1">
              {record.native.notApplicable.map((row) => (
                <li key={row.name} className="text-[11px] leading-snug">
                  <span className="font-semibold text-foreground">⊘ {row.name}</span>
                  <span className="text-muted-foreground">: {row.why}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** The panel for a catalog specification or a runnable model, with its loading and empty states. */
export function ModelMetricsState({ loading, error, absent, children }: { loading: boolean; error: Error | null; absent: string | null; children: React.ReactNode }) {
  if (loading) return <div className="rounded-md border border-border bg-card/60 p-3 text-[11px] text-muted-foreground">Reading the model's metrics record.</div>;
  if (error) return <div className="rounded-md border border-border bg-card/60 p-3 text-[11px] text-[#D55E00]">The metrics record could not be read: {error.message}</div>;
  if (absent) return <div className="rounded-md border border-border bg-card/60 p-3 text-[11px] text-muted-foreground">{absent}</div>;
  return <>{children}</>;
}
