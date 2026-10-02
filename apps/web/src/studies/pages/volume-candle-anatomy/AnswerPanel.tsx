/**
 * Panel G and the answer tables: how to encode this on top of the pattern
 * model, the two traps, and the two tables the landed rows answer (computed
 * by SQL in the handler: bars closing inside their range, pairings that
 * share no construction term).
 */

import { Finding, Section, fmt, fmtInt } from "@/studies/kit";
import type { BoardBody } from "@shared/studies/volume-candle-anatomy";

const FEATURE_BLOCK = [
  "volume_rank_trailing_120_bars",
  "volume_zscore_trailing_120_bars",
  "volume_bar_height_relative_to_trailing_maximum",
  "upper_wick_in_average_ranges",
  "lower_wick_in_average_ranges",
  "body_fraction_of_range",
  "wick_asymmetry_upper_minus_lower",
  "upper_wick_in_average_ranges_times_volume_rank_trailing",
  "lower_wick_in_average_ranges_times_volume_rank_trailing",
  "wick_asymmetry_times_volume_rank_trailing",
] as const;

function Code({ children }: { children: string }) {
  return <code className="rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-neutral-100">{children}</code>;
}

export function AnswerPanel({ board }: { board: BoardBody }) {
  return (
    <>
      <Section
        title="G. How to encode this on top of the pattern model"
        question="The pattern recogniser sees a (batch, 5, 4) open-high-low-close tensor and no volume, by design, so a pattern label stays volume-invariant. Volume belongs beside the pattern, never inside it."
      >
        <div className="space-y-3">
          <div>
            <h4 className="text-xs font-semibold text-neutral-100">1. A new causal feature block: the cheap, correct first move</h4>
            <Finding>
              <Code>model/scripts/candle_norm.py::build_candle_embedding</Code> already has the precedent: <Code>HAR_RV_COLUMNS</Code> was appended to <Code>_BASE_EMBEDDING_COLUMNS</Code> as a block. Add a <Code>VOLUME_ANATOMY_COLUMNS</Code> block the same way, computed with <Code>rolling_z</Code> and <Code>min_periods=window</Code>, drawing the volume half from <Code>analytics/volrange/features.py</Code>, which is already causal and verified. The last three names are the point: Panel D shows the conditional medians bend across deciles, and an additive coefficient cannot represent a bend.
            </Finding>
            <ol className="mt-1 grid gap-x-4 gap-y-0.5 text-[11px] sm:grid-cols-2">
              {FEATURE_BLOCK.map((name, index) => (
                <li key={name} className="flex gap-2">
                  <span className="w-4 shrink-0 text-right text-neutral-500">{index + 1}</span>
                  <span className={`font-mono ${index >= 7 ? "text-[#E69F00]" : "text-neutral-200"}`}>{name}{index >= 7 ? "  (interaction)" : ""}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-neutral-100">2. Late fusion into the pattern network</h4>
            <Finding>
              <Code>train_synth_cnn.py</Code>&apos;s <Code>Net.embed()</Code> already exposes a 256-number vector documented as the embedding used downstream. Concatenating a volume-anatomy vector after the convolutions keeps the pattern head volume-invariant while giving the downstream head both. Read the frozen-encoder notebook first: that embedding was measured at shuffled-noise level for direction, so fuse volume onto the pattern probabilities, which are honest, rather than onto the embedding.
            </Finding>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-neutral-100">3. Volume as a sixth channel in the shape encoder</h4>
            <Finding>
              <Code>build_mnq_shape_embedding.py</Code> decomposes each candle into 5 price parts; adding volume means widening every <Code>Conv1d</Code> <Code>in_channels</Code> from 5 to 6 and reworking <Code>parts_to_prices</Code>. Not a drop-in change, and worth doing only after a plain feature block shows the information is there, since those label-free encoders currently lose to their own raw-number controls.
            </Finding>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-neutral-100">Two traps this study had to dodge</h4>
            <Finding>
              <strong>The family classifier will silently swallow these columns.</strong> <Code>build_binned_features.py::family_of()</Code> is first-hit-wins over an ordered tuple and <Code>&quot;volume&quot;</Code> is checked before <Code>&quot;pattern&quot;</Code>, so every column above lands in the existing volume family and becomes invisible as a distinct effect. A new <Code>volume_anatomy</Code> entry must go ahead of <Code>volume</Code>.
            </Finding>
            <Finding>
              <strong>Circularity.</strong> <Code>volume_signed_by_candle_direction</Code> and <Code>body_signed_in_average_ranges</Code> share the sign by construction, so the page hides that pairing by default. The <Code>volrange</Code> package was once caught by a log-range-minus-log-volume ratio that was pure negative volume at correlation -1.0000. Any new fused column needs the same check before its correlation is believed.
            </Finding>
          </div>
        </div>
      </Section>

      <Section title="The answer, in one place" question={`Measured on ${fmtInt(board.rowCount)} rows across ${board.timeframes.length} timeframes, 2021 to 2025, every statistic causal, every wick statistic reported with and without the bid-ask-bounce control. Bars closing inside their range.`}>
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="min-w-0 overflow-x-auto">
            <p className="mb-1 text-[11px] text-neutral-400">Which reading of the volume bar carries the most, averaged over every candle part and timeframe:</p>
            <table className="w-full text-[11px]">
              <thead className="text-left text-neutral-500"><tr><th className="pr-3 font-normal">volume reading</th><th className="pr-3 text-right font-normal">pairings</th><th className="text-right font-normal">mean absolute Spearman</th></tr></thead>
              <tbody className="text-neutral-200">
                {board.byEncoding.map((row, index) => (
                  <tr key={row.volume_encoding} className="border-t border-neutral-800">
                    <td className="py-1 pr-3 font-mono">{index === 0 ? "▲ " : ""}{row.volume_encoding}</td>
                    <td className="pr-3 text-right font-mono tnum">{fmtInt(row.pairing_count)}</td>
                    <td className="text-right font-mono tnum">{fmt(row.mean_absolute_spearman, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="min-w-0 overflow-x-auto">
            <p className="mb-1 text-[11px] text-neutral-400">Which part of the candle volume knows most about, best case over all readings:</p>
            <table className="w-full text-[11px]">
              <thead className="text-left text-neutral-500"><tr><th className="pr-3 font-normal">candle part</th><th className="pr-3 font-normal">best reading</th><th className="text-right font-normal">best absolute Spearman</th></tr></thead>
              <tbody className="text-neutral-200">
                {board.byMeasure.map((row, index) => (
                  <tr key={row.anatomy_measure} className="border-t border-neutral-800">
                    <td className="py-1 pr-3 font-mono">{index === 0 ? "▲ " : ""}{row.anatomy_measure}</td>
                    <td className="pr-3">{row.best_volume_encoding.replace(/_/g, " ")}</td>
                    <td className="text-right font-mono tnum">{fmt(row.best_absolute_spearman, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Section>
    </>
  );
}
