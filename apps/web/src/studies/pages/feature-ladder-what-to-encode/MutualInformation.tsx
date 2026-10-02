/**
 * The marginal-versus-conditional formula, wired to the ladder: the rung the
 * reader steps to is the conditioning set Z (every block below it) and the
 * candidate X (the block it adds); the legend carries the values at that rung.
 */

import { FormulaCard, OKABE, SliderControl, fmt, fmtInt, Empty } from "@/studies/kit";
import {
  blockLabel,
  isEarned,
  metricLabel,
  rungsOf,
  signed,
  targetLabel,
  type LadderRow,
} from "@shared/studies/feature-ladder-what-to-encode";

export function MutualInformation({
  rows,
  target,
  rung,
  onRung,
  minimumIncrement,
}: {
  rows: readonly LadderRow[];
  target: string;
  rung: number;
  onRung: (rung: number) => void;
  minimumIncrement: number;
}) {
  const rungs = rungsOf(rows, "derivatives_first", target);
  if (rungs.length < 2) return <Empty>The ladder for this target is not landed.</Empty>;

  const step = Math.min(Math.max(1, rung), rungs.length - 1);
  const current = rungs[step] as LadderRow;
  const below = rungs[step - 1] as LadderRow;
  const earned = isEarned(current, minimumIncrement);
  const metric = metricLabel(current.metric);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-4">
        <SliderControl
          label="Rung r"
          value={step}
          min={1}
          max={rungs.length - 1}
          onChange={onRung}
          format={(value) => `${value} of ${rungs.length - 1}`}
          hint="Step the ladder: the blocks below rung r become Z, the block rung r adds becomes X"
        />
        <ol className="flex min-w-0 flex-wrap gap-1 text-[11px]" aria-label="The ladder, one chip per rung">
          {rungs.map((entry) => {
            const role = entry.rung_index < step ? "Z" : entry.rung_index === step ? "X" : "later";
            const style =
              role === "X"
                ? { background: OKABE.orange, color: "#111", borderColor: OKABE.orange }
                : role === "Z"
                  ? { background: `${OKABE.sky}33`, color: "#e5e5e5", borderColor: OKABE.sky }
                  : { background: "transparent", color: "#737373", borderColor: "#404040" };
            return (
              <li key={entry.rung_index} className="rounded border px-1.5 py-0.5 font-mono" style={style} title={`rung ${entry.rung_index}: ${entry.block_added}`}>
                {role === "X" ? "◆ X " : role === "Z" ? "■ Z " : "□ "}
                {blockLabel(entry.block_added)}
              </li>
            );
          })}
        </ol>
      </div>

      <FormulaCard
        tex={String.raw`\underbrace{I(X;Y)}_{\text{what was reported}}\qquad\text{versus}\qquad\underbrace{I(X;Y\mid Z)}_{\text{what decides whether it ships}}`}
        caption={`Rung ${step}: X is ${blockLabel(current.block_added)}, Z is the ${below.feature_count} features already in the model, Y is ${targetLabel(target)}.`}
        symbols={[
          { tex: "X", name: "the candidate feature block this rung adds", value: blockLabel(current.block_added) },
          { tex: "Y", name: "the target being forecast", value: targetLabel(target) },
          { tex: "Z", name: "everything the model already has: every block below this rung", value: `${fmtInt(below.feature_count)} features` },
          { tex: "I(X;Y)", name: "marginal information: X against knowing nothing, always the larger number (not measured on this page)", value: "cited: 0.0616 nats, volume with the signed body" },
          { tex: "I(X;Y\\mid Z)", name: `conditional information: what X adds that Z did not say; stood in for here by the out-of-sample ${metric} increment`, value: `${signed(current.score_increment_over_previous_rung)} ${metric}` },
        ]}
      />

      <FormulaCard
        tex={String.raw`\text{earned}_r \iff \Big(S_r - S_{r-1} > \delta\Big)\ \wedge\ \Big(S_r > \max_{k=1,\dots,5}\tilde S_r^{(k)}\Big)`}
        caption={`${earned ? "Both parts hold" : "At least one part fails"}: ${blockLabel(current.block_added)} ${earned ? "earns" : "does not earn"} its place on ${targetLabel(target)}.`}
        symbols={[
          { tex: "S_r", name: `${metric} on 2025 at rung r, scored once`, value: fmt(current.score_holdout, 5) },
          { tex: "S_{r-1}", name: "the same score one rung lower", value: fmt(below.score_holdout, 5) },
          { tex: "\\delta", name: "materiality floor, 0 in the notebook (the control above the ladder)", value: fmt(minimumIncrement, 4) },
          { tex: "\\tilde S_r^{(k)}", name: "score of rung r with its newest block's rows shuffled, refitted: copy k of five", value: "five refits per rung" },
          { tex: "\\max_k \\tilde S_r^{(k)}", name: "the best of the five shuffled scores", value: fmt(current.shuffled_block_score_best_of_five, 5) },
          { tex: "S_r - S_{r-1}", name: "the increment this block adds", value: signed(current.score_increment_over_previous_rung, 5) },
        ]}
      />
    </div>
  );
}
