/**
 * What the hyperparameter search learned: the objective against each setting
 * it varied (one chip per parameter), the best trial marked, and how the
 * trials ended. Reads the run view's trials; nothing here fetches.
 */
import { useState } from "react";
import { CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";

import type { CycleTrial } from "@shared/cycle/schema";
import { Chip } from "@/runs/learning";
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

/** The parameters the search varied: those that take more than one value across completed trials. */
function variedParameters(trials: CycleTrial[]): string[] {
  const values = new Map<string, Set<string>>();
  for (const trial of trials) {
    for (const [name, value] of Object.entries(trial.parameters)) {
      const set = values.get(name) ?? new Set<string>();
      set.add(String(value));
      values.set(name, set);
    }
  }
  return [...values.entries()].filter(([, set]) => set.size > 1).map(([name]) => name).sort();
}

function numeric(value: number | string | boolean): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function TrialParameterChart({ trials }: { trials: CycleTrial[] }) {
  const complete = trials.filter((trial) => trial.state === "complete" && trial.objectiveValue !== null);
  const parameters = variedParameters(complete);
  const [parameter, setParameter] = useState<string | null>(null);
  const active = parameter !== null && parameters.includes(parameter) ? parameter : parameters[0] ?? null;
  const objective = complete[0]?.objectiveName ?? "sharpe_ratio";
  const lowerIsBetter = objective === "log_loss";
  const ended = { complete: 0, pruned: 0, failed: 0, running: 0 };
  for (const trial of trials) ended[trial.state] += 1;

  // categorical values get an ordinal x; numeric ones their own value
  const categories = active ? [...new Set(complete.map((trial) => String(trial.parameters[active])))].sort() : [];
  const categorical = active ? complete.some((trial) => numeric(trial.parameters[active] ?? "") === null) : false;
  const rows = active
    ? complete.map((trial) => {
        const raw = trial.parameters[active];
        const x = categorical ? categories.indexOf(String(raw)) : numeric(raw ?? "") ?? 0;
        return { x, y: trial.objectiveValue as number, fold: trial.foldIndex ?? 0, trial: trial.trial + 1, raw: String(raw) };
      })
    : [];
  const best = rows.reduce<(typeof rows)[number] | null>((keep, row) => (keep === null || (lowerIsBetter ? row.y < keep.y : row.y > keep.y) ? row : keep), null);
  const folds = [...new Set(rows.map((row) => row.fold))].sort((a, b) => a - b);
  const logScale = !categorical && rows.length > 2 && rows.every((row) => row.x > 0) && Math.max(...rows.map((row) => row.x)) / Math.min(...rows.map((row) => row.x)) > 100;

  return (
    <div className="rounded-md border border-border bg-card/60 p-3" data-testid="trial-parameters">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold text-foreground">Objective against each setting the search varied</div>
          <div className="text-[11px] leading-snug text-muted-foreground">
            One dot per completed trial, placed by the value it tried for the chosen parameter and the {objective.replace(/_/g, " ")} it scored; one colour per fold, the best trial ringed in yellow. A slope means the parameter matters; a cloud means it does not.
            {" "}
            {ended.complete} complete{ended.pruned > 0 ? `, ${ended.pruned} pruned early` : ""}{ended.failed > 0 ? `, ${ended.failed} failed` : ""}{ended.running > 0 ? `, ${ended.running} running` : ""}.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {parameters.map((name) => (
            <Chip key={name} active={active === name} onClick={() => setParameter(name)}>{name.replace(/_/g, " ")}</Chip>
          ))}
        </div>
      </div>
      <div className="mt-2 h-56">
        {rows.length === 0 || active === null ? (
          <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
            {complete.length === 0 ? "No completed trials. A run on reviewed defaults does not search." : "Every trial used the same settings; nothing was varied."}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID} strokeDasharray="2 4" />
              <XAxis
                dataKey="x"
                type="number"
                name={active}
                scale={logScale ? "log" : "auto"}
                domain={categorical ? [-0.5, categories.length - 0.5] : ["auto", "auto"]}
                ticks={categorical ? categories.map((_, index) => index) : undefined}
                tickFormatter={(value: number) => (categorical ? categories[value] ?? "" : logScale ? value.toExponential(0) : String(value))}
                tick={AXIS}
              />
              <YAxis dataKey="y" type="number" tick={AXIS} width={48} tickFormatter={(value: number) => value.toFixed(2)} />
              <ZAxis range={[36, 36]} />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                cursor={{ strokeDasharray: "3 3" }}
                formatter={(value: number, name: string, item: { payload?: { raw?: string; trial?: number; fold?: number } }) =>
                  name === active ? item.payload?.raw ?? String(value) : `${value.toFixed(3)} (fold ${(item.payload?.fold ?? 0) + 1}, trial ${item.payload?.trial ?? "?"})`
                }
              />
              {objective === "sharpe_ratio" && <ReferenceLine y={0} stroke="#808A99" />}
              {folds.map((fold) => (
                <Scatter key={fold} name={objective} data={rows.filter((row) => row.fold === fold)} fill={foldColor(fold)} isAnimationActive={false} />
              ))}
              {best && <ReferenceDot x={best.x} y={best.y} r={8} fill="none" stroke={BEST} strokeWidth={2} />}
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
