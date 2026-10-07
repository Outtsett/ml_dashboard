/**
 * Every number the fit logs, each as its own picture: one small panel per
 * logged quantity (training loss, validation loss, accuracy, F1, learning
 * rate, gradient norm), one colour per fold, and the fold's loss surface in 3D.
 * Nothing here fetches; it all reads the run view.
 */
import { useState, type ReactNode } from "react";
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { RunEpochPoint, RunLossSurface } from "@shared/runs/types";
import { COIN_FLIP_LOG_LOSS } from "@shared/runs/verdicts";
import { Surface3DScene, SurfaceContourFallback } from "@/ml/components/Surface3DRenderer";
import { foldColor } from "@/runs/format";

const AXIS = { fontSize: 10, fill: "hsl(var(--muted-foreground))", fontFamily: "ui-monospace, monospace" } as const;
const GRID = "hsl(var(--border))";
const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 6,
  fontSize: 11,
  fontFamily: "ui-monospace, monospace",
} as const;
const BEST = "#F0E442";

export function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`cursor-pointer rounded border px-2 py-0.5 font-mono text-[11px] ${
        active ? "border-foreground/60 bg-foreground/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ─── one panel per logged quantity ──────────────────────────────────────────

interface Quantity {
  key: keyof Pick<RunEpochPoint, "trainLoss" | "validationLoss" | "validationAccuracy" | "validationF1Score" | "learningRate" | "gradientNorm">;
  label: string;
  /** What the number is, in plain words. */
  meaning: (role: "direction" | "price") => string;
  format: (value: number) => string;
  /** A line the value has to cross to mean something. */
  reference?: (role: "direction" | "price") => { value: number; label: string } | null;
  log?: boolean;
}

const QUANTITIES: Quantity[] = [
  {
    key: "trainLoss",
    label: "Training loss",
    meaning: (role) => (role === "direction" ? "How wrong the model is on the bars it is fitting (log loss)." : "Mean absolute error on the bars it is fitting, in volatility units."),
    format: (value) => value.toFixed(4),
  },
  {
    key: "validationLoss",
    label: "Validation loss",
    meaning: (role) => (role === "direction" ? "The same error on held-out bars. Rising while training loss falls is memorising." : "Mean absolute error on held-out bars, in volatility units."),
    format: (value) => value.toFixed(4),
    reference: (role) => (role === "direction" ? { value: COIN_FLIP_LOG_LOSS, label: "coin flip" } : null),
  },
  {
    key: "validationAccuracy",
    label: "Validation accuracy",
    meaning: (role) => (role === "direction" ? "Share of held-out bars whose direction it called right." : "Share of held-out bars whose move sign it got right."),
    format: (value) => `${(value * 100).toFixed(1)}%`,
    reference: () => ({ value: 0.5, label: "coin flip" }),
  },
  {
    key: "validationF1Score",
    label: "Validation F1",
    meaning: () => "Precision and recall of the up call in one number; 0 means it never calls up, or is never right when it does.",
    format: (value) => value.toFixed(3),
  },
  {
    key: "learningRate",
    label: "Learning rate",
    meaning: () => "How big a step the optimiser takes each batch; the schedule warms up, peaks, then decays.",
    format: (value) => value.toExponential(1),
    log: true,
  },
  {
    key: "gradientNorm",
    label: "Gradient norm",
    meaning: () => "Size of the weight update before clipping at 1.0. Spikes are unstable batches; a flat 0 is a dead network.",
    format: (value) => value.toFixed(3),
  },
];

function foldIndexes(points: readonly RunEpochPoint[]): number[] {
  return [...new Set(points.map((point) => point.foldIndex))].sort((a, b) => a - b);
}

function Panel({ quantity, points, folds, role }: { quantity: Quantity; points: RunEpochPoint[]; folds: number[]; role: "direction" | "price" }) {
  const bySteps = new Map<number, Record<string, number | null>>();
  const bests: Array<{ step: number; value: number; fold: number }> = [];
  let any = false;
  for (const point of points) {
    const value = point[quantity.key];
    const row = bySteps.get(point.step) ?? { step: point.step };
    row[`fold_${point.foldIndex}`] = value;
    bySteps.set(point.step, row);
    if (value !== null) {
      any = true;
      if (point.isBest) bests.push({ step: point.step, value, fold: point.foldIndex });
    }
  }
  const rows = [...bySteps.values()].sort((a, b) => (a.step ?? 0) - (b.step ?? 0));
  const reference = quantity.reference?.(role) ?? null;
  return (
    <div className="rounded-md border border-border bg-card/60 p-2" data-testid={`learning-panel-${quantity.key}`}>
      <div className="text-[12px] font-semibold text-foreground">{quantity.label}</div>
      <div className="min-h-[2.4em] text-[10px] leading-snug text-muted-foreground">{quantity.meaning(role)}</div>
      <div className="mt-1 h-36">
        {!any ? (
          <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">Not logged by this model.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
              <XAxis dataKey="step" type="number" domain={["dataMin", "dataMax"]} tick={AXIS} />
              <YAxis tick={AXIS} width={52} scale={quantity.log ? "log" : "auto"} domain={quantity.log ? ["auto", "auto"] : ["auto", "auto"]} tickFormatter={quantity.format} />
              <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(step) => `step ${step}`} formatter={(value: number) => quantity.format(value)} />
              {reference && <ReferenceLine y={reference.value} stroke="#808A99" strokeDasharray="6 3" label={{ value: reference.label, fontSize: 9, fill: "#808A99", position: "insideTopRight" }} />}
              {folds.map((index) => (
                <Line key={index} dataKey={`fold_${index}`} name={`fold ${index + 1}`} stroke={foldColor(index)} strokeWidth={1.5} dot={false} connectNulls isAnimationActive={false} />
              ))}
              {bests.map((best) => (
                <ReferenceDot key={`${best.fold}-${best.step}`} x={best.step} y={best.value} r={3} fill={BEST} stroke={foldColor(best.fold)} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

/** Six panels, one per logged quantity, sharing the fold and role choice. The yellow dot is the step whose weights the fold kept. */
export function LearningGrid({ epochs }: { epochs: RunEpochPoint[] }) {
  const roles = [...new Set(epochs.map((point) => point.modelRole))];
  const [role, setRole] = useState<"direction" | "price">("direction");
  const [fold, setFold] = useState<number | "all">("all");
  const activeRole = roles.includes(role) ? role : roles[0] ?? "direction";
  const ofRole = epochs.filter((point) => point.modelRole === activeRole);
  const folds = foldIndexes(ofRole);
  const shownFolds = fold === "all" || !folds.includes(fold) ? folds : [fold];
  const points = ofRole.filter((point) => shownFolds.includes(point.foldIndex));
  const steps = points.length;
  return (
    <div className="space-y-2" data-testid="learning-grid">
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[11px] text-muted-foreground">
          Every quantity the fit logged, one panel each; {steps.toLocaleString("en-US")} steps across {shownFolds.length} fold{shownFolds.length === 1 ? "" : "s"}. The yellow dot marks the step whose weights were kept.
        </span>
        {roles.length > 1 && roles.map((entry) => (
          <Chip key={entry} active={activeRole === entry} onClick={() => setRole(entry)}>{entry === "direction" ? "Direction model" : "Price model"}</Chip>
        ))}
        <Chip active={fold === "all"} onClick={() => setFold("all")}>All folds</Chip>
        {folds.map((index) => (
          <Chip key={index} active={fold === index} onClick={() => setFold(index)}>Fold {index + 1}</Chip>
        ))}
      </div>
      {epochs.length === 0 ? (
        <div className="rounded-md border border-border bg-card/60 p-3 text-[11px] text-muted-foreground">No training steps reported yet.</div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
          {QUANTITIES.map((quantity) => (
            <Panel key={quantity.key} quantity={quantity} points={points} folds={shownFolds} role={activeRole} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── the loss surface ───────────────────────────────────────────────────────

function readSurface(surface: RunLossSurface) {
  // the renderer's grid shape; a missing cell (a non-finite loss) is drawn at the grid's own maximum
  const finite = surface.losses.flat().filter((value): value is number => value !== null && Number.isFinite(value));
  const ceiling = finite.length > 0 ? Math.max(...finite) : 1;
  return {
    alphas: surface.alphas,
    betas: surface.betas,
    losses: surface.losses.map((row) => row.map((value) => (value === null || !Number.isFinite(value) ? ceiling : value))),
    resolution: surface.resolution,
    range: surface.range,
  };
}

function describe(surface: RunLossSurface): Array<{ label: string; value: string; reading: string }> {
  const d = surface.diagnostics;
  const sharpness = d.sharpness;
  const condition = d.conditionNumber;
  const width = d.valleyWidth;
  return [
    {
      label: "Sharpness",
      value: sharpness === null ? "—" : sharpness.toFixed(4),
      reading: sharpness === null ? "not measured" : sharpness < 0.05 ? "flat: small weight changes barely move the loss (generalises)" : sharpness < 0.2 ? "moderate" : "sharp: a tiny weight change raises the loss a lot (fragile fit)",
    },
    {
      label: "Condition number",
      value: condition === null ? "—" : condition.toFixed(1),
      reading: condition === null ? "not measured" : condition < 10 ? "round bowl: both directions curve alike" : condition < 50 ? "an oval valley" : "a long narrow trench: one direction is far stiffer",
    },
    {
      label: "Valley width",
      value: width === null ? "—" : width.toFixed(3),
      reading: "how far from the kept weights the loss is 1% worse, in units of the weights' own scale",
    },
    {
      label: "Shape at the minimum",
      value: d.locallyConvex ? "bowl" : "saddle / ridge",
      reading: d.locallyConvex ? "every direction climbs: the optimiser is at a minimum" : "some direction still descends: training stopped short of a minimum",
    },
  ];
}

/** The loss landscape around each fold's kept weights, drawn as a 3D surface the user can orbit. */
export function LossSurfacePanel({ surfaces, modelLabel }: { surfaces: RunLossSurface[]; modelLabel: string | null }) {
  const [index, setIndex] = useState(0);
  const [mode, setMode] = useState<"3d" | "contour">("3d");
  const active = surfaces[Math.min(index, Math.max(0, surfaces.length - 1))] ?? null;
  return (
    <div className="rounded-md border border-border bg-card/60 p-3" data-testid="loss-surface">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold text-foreground">Loss surface around the kept weights</div>
          <div className="text-[11px] leading-snug text-muted-foreground">
            Height and colour are the validation loss when the weights are pushed along two random directions (x and z); the centre is the fit itself. A wide flat bowl generalises; a sharp pit or a saddle does not. Drag to orbit, scroll to zoom.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {surfaces.map((surface, position) => (
            <Chip key={`${surface.foldIndex}-${surface.modelRole}`} active={position === index} onClick={() => setIndex(position)}>
              Fold {(surface.foldIndex ?? 0) + 1}{surface.modelRole === "price" ? " price" : ""}
            </Chip>
          ))}
          {surfaces.length > 0 && (
            <>
              <Chip active={mode === "3d"} onClick={() => setMode("3d")}>3D</Chip>
              <Chip active={mode === "contour"} onClick={() => setMode("contour")}>Contour</Chip>
            </>
          )}
        </div>
      </div>
      {active === null ? (
        <div className="mt-3 text-[11px] text-muted-foreground">
          {modelLabel ? `${modelLabel} is not a neural network: it has no weights to perturb, so it has no loss surface. ` : ""}
          A neural model's surface lands after each fold's final fit.
        </div>
      ) : (
        <div className="mt-2 grid gap-3 lg:grid-cols-[1fr_280px]">
          <div className="h-72 overflow-hidden rounded bg-black/40">
            {mode === "3d" ? <Surface3DScene data={readSurface(active)} /> : <SurfaceContourFallback data={readSurface(active)} />}
          </div>
          <div className="space-y-1.5">
            {describe(active).map((item) => (
              <div key={item.label} className="rounded bg-black/20 px-2 py-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[10px] text-muted-foreground">{item.label}</span>
                  <span className="font-mono text-[13px] font-semibold tabular-nums text-foreground">{item.value}</span>
                </div>
                <div className="text-[10px] leading-snug text-muted-foreground">{item.reading}</div>
              </div>
            ))}
            <div className="font-mono text-[10px] text-muted-foreground">
              {active.resolution}×{active.resolution} grid · {active.batchCount ?? "?"} validation batches per point · {active.secondsElapsed.toFixed(1)} s
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
