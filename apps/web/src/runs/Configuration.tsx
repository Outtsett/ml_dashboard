/**
 * Every setting a run was given, and what each fold actually fitted with:
 * the model's base hyperparameters, the run's own settings, the cost model,
 * the feature list, and the per-fold values the search chose (changed values
 * marked). Reads the run view; nothing here fetches.
 */
import { useState } from "react";

import type { RunConfiguration, RunParameterValue } from "@shared/runs/types";
import { Chip } from "@/runs/learning";

function show(value: RunParameterValue): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString("en-US") : value.toPrecision(4).replace(/\.?0+$/, "");
  return value;
}

function Table({ title, caption, rows }: { title: string; caption: string; rows: Array<[string, RunParameterValue]> }) {
  return (
    <div className="rounded-md border border-border bg-card/60 p-3">
      <div className="text-[12px] font-semibold text-foreground">{title}</div>
      <div className="text-[11px] leading-snug text-muted-foreground">{caption}</div>
      {rows.length === 0 ? (
        <div className="mt-2 text-[11px] text-muted-foreground">Nothing recorded.</div>
      ) : (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11px]">
          {rows.map(([name, value]) => (
            <div key={name} className="contents">
              <dt className="text-muted-foreground">{name.replace(/_/g, " ")}</dt>
              <dd className="tabular-nums text-foreground">{show(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

const SOURCE_WORDS: Record<RunConfiguration["folds"][number]["source"], string> = {
  tuned: "chosen by the fold's own search",
  manual: "typed for the run",
  reviewed_defaults: "the registry's defaults",
};

export function Configuration({ configuration }: { configuration: RunConfiguration | null }) {
  const [showFeatures, setShowFeatures] = useState(false);
  if (!configuration) {
    return <div className="rounded-md border border-border bg-card/60 p-3 text-[11px] text-muted-foreground">The configuration lands with the run's plan, before the first fit.</div>;
  }
  const names = [...new Set([...Object.keys(configuration.parameters), ...configuration.folds.flatMap((fold) => Object.keys(fold.parameters))])].sort();
  return (
    <div className="space-y-2" data-testid="configuration">
      <div className="grid gap-2 xl:grid-cols-3">
        <Table title="Model hyperparameters, as given" caption="The base values the run started with. A fold's search starts from these; the table below shows what each fold ended up using." rows={Object.entries(configuration.parameters)} />
        <Table title="Run settings" caption="The label, the walk-forward windows, the trading rule, the search budget, the device and the data window." rows={Object.entries(configuration.settings)} />
        <Table title="Cost model" caption="What every trade is charged, from packages/config/cost_model.json." rows={Object.entries(configuration.costModel)} />
      </div>
      <div className="rounded-md border border-border bg-card/60 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[12px] font-semibold text-foreground">What each fold fitted with</div>
            <div className="text-[11px] leading-snug text-muted-foreground">One column per fold. A value in orange differs from the base value above: the fold's search changed it. The row under the header says how the fold chose.</div>
          </div>
        </div>
        {configuration.folds.length === 0 ? (
          <div className="mt-2 text-[11px] text-muted-foreground">Lands as each fold chooses its settings.</div>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse font-mono text-[11px]">
              <thead>
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-1">parameter</th>
                  <th className="px-2 py-1 text-right">base</th>
                  {configuration.folds.map((fold) => (
                    <th key={fold.foldIndex} className="px-2 py-1 text-right">fold {fold.foldIndex + 1}</th>
                  ))}
                </tr>
                <tr className="border-b border-border/50 text-[10px] text-muted-foreground">
                  <td className="px-2 py-1">how chosen</td>
                  <td />
                  {configuration.folds.map((fold) => (
                    <td key={fold.foldIndex} className="px-2 py-1 text-right" title={fold.pinned.length ? `pinned: ${fold.pinned.join(", ")}` : undefined}>
                      {SOURCE_WORDS[fold.source]}
                      {fold.source === "tuned" && fold.trialCount !== null ? ` · ${fold.trialCount} trials` : ""}
                      {fold.bestValue !== null && fold.objectiveName ? ` · best ${fold.objectiveName.replace(/_/g, " ")} ${fold.bestValue.toFixed(3)}` : ""}
                    </td>
                  ))}
                </tr>
              </thead>
              <tbody>
                {names.map((name) => {
                  const base = configuration.parameters[name] ?? null;
                  return (
                    <tr key={name} className="border-b border-border/40">
                      <td className="px-2 py-0.5 text-muted-foreground">{name.replace(/_/g, " ")}</td>
                      <td className="px-2 py-0.5 text-right tabular-nums text-foreground">{show(base)}</td>
                      {configuration.folds.map((fold) => {
                        const value = fold.parameters[name] ?? null;
                        const changed = value !== null && base !== null && String(value) !== String(base);
                        return (
                          <td key={fold.foldIndex} className={`px-2 py-0.5 text-right tabular-nums ${changed ? "font-bold text-[#E69F00]" : "text-foreground"}`}>
                            {show(value)}{changed ? " ●" : ""}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="rounded-md border border-border bg-card/60 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-[12px] font-semibold text-foreground">Features the model reads ({configuration.featureNames.length})</div>
          <Chip active={showFeatures} onClick={() => setShowFeatures(!showFeatures)}>{showFeatures ? "Hide" : "Show"}</Chip>
        </div>
        {showFeatures && (
          <div className="mt-2 flex flex-wrap gap-1 font-mono text-[10px]">
            {configuration.featureNames.map((name) => (
              <span key={name} className="rounded border border-border px-1.5 py-0.5 text-muted-foreground">{name}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
