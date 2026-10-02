/**
 * The acceptance gate: one look at the locked holdout, taken by
 * `python -m multimodal.gate` and never by this page. The page reads only what
 * a gate run lands (summary rows whose recipe starts with gate_) and the look
 * counters in the plan's state.json.
 */

import { GATE_DEFINITIONS, GATE_KEYS, type GateFlags, type MultimodalBody } from "@shared/studies/multimodal-model";
import { Empty, Finding, OKABE, Section, Stat, fmt } from "@/studies/kit";
import { GateChips } from "./parts";

function gateFlags(summary: Record<string, unknown>): GateFlags {
  const source = typeof summary.gate === "object" && summary.gate !== null ? (summary.gate as Record<string, unknown>) : {};
  const flags: GateFlags = {};
  for (const key of GATE_KEYS) if (key in source) flags[key] = Boolean(source[key]);
  return flags;
}

function show(value: unknown): string {
  if (typeof value === "number") return fmt(value, 4);
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "—";
  return JSON.stringify(value);
}

export function Gate({ body }: { body: MultimodalBody }) {
  const { holdout, gates } = body;
  const looks = holdout.looks;
  const budget = holdout.lookBudget;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Holdout looks" value={`${looks ?? "?"} of ${budget ?? "?"}`} tone={(looks ?? 0) > 0 ? OKABE.orange : undefined} hint="2025-07-01 to 2025-12-31, Pacific wall clock; a second look burns the period" />
        <Stat label="Forward looks (2026)" value={`${holdout.forwardLooks ?? "?"} of ${holdout.forwardLookBudget ?? "?"}`} hint="2026-01-01 onward, the clean confirmation set" />
        <Stat label="Plan phase" value={holdout.phase ?? "—"} hint={holdout.step ?? undefined} />
        <Stat label="Last checkpoint" value={holdout.lastCheckpoint ?? "—"} hint="docs/plans/2026-09-29-multimodal/CHECKPOINTS.md" />
      </div>

      <Section title="The acceptance gate (holdout, one look)" question="The gate asks five things of the frozen candidate, once, on data no design choice has seen.">
        {gates.length === 0 ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-900/60 px-3 py-2 text-xs text-neutral-200">
              <span aria-hidden="true">🔒</span>
              <span>
                Not run yet: the holdout 2025-07-01 to 2025-12-31 is still locked ({looks ?? "?"} of {budget ?? "?"} looks).
                {holdout.step ? ` The plan is at: ${holdout.step}.` : ""}
              </span>
            </p>
            <Empty>No gate_* record is landed in derived_multimodal_runs_summary.</Empty>
          </div>
        ) : (
          <div className="space-y-3">
            {gates.map((gate) => (
              <div key={`${gate.recipe}-${gate.scope}`} className="min-w-0 space-y-1 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-100">
                  <span className="font-mono">{gate.recipe}</span>
                  <span className="text-neutral-500">{gate.scope}</span>
                  <GateChips gate={gateFlags(gate.summary)} />
                </div>
                <dl className="grid gap-x-4 gap-y-0.5 text-[11px] grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
                  {Object.entries(gate.summary)
                    .filter(([key]) => key !== "gate" && key !== "quarter_net_points")
                    .map(([key, value]) => (
                      <div key={key} className="flex justify-between gap-2">
                        <dt className="truncate text-neutral-500" title={key}>{key}</dt>
                        <dd className="font-mono tnum text-neutral-200">{show(value)}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="What the gate measures" question="Scored after AMP costs; the same five gates the scoreboard applies to every development trial.">
        <table className="w-full text-[11px]">
          <tbody>
            {GATE_KEYS.map((key) => (
              <tr key={key} className="border-t border-neutral-900 align-top">
                <td className="py-1 pr-2 font-mono text-neutral-100">{key}</td>
                <td className="py-1 pr-2 text-neutral-200">{GATE_DEFINITIONS[key].name}</td>
                <td className="py-1 text-neutral-400">{GATE_DEFINITIONS[key].threshold}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Finding>
          This page never takes the look: the gate and the holdout reader are not reachable from any request. Training launches stay in ML Studio, where the runner <span className="font-mono">multimodal_fusion+bracket_meta_label</span> streams its folds live.
        </Finding>
      </Section>
    </div>
  );
}
