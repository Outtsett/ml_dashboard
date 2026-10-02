/**
 * Calibration: the null |scaled t| tail per rung (log tail probability, reversed),
 * τ read off it at the p_entry slider, and the (p_entry, p_exit) grid the run chose on.
 */

import { CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, TOOLTIP, fmt } from "@/studies/kit";
import {
  ENTRY_PROBABILITY_STEPS, SESSION_TYPES, tauAt, type NullQuantileRow, type ThresholdGridRow, type ThresholdRow,
} from "@shared/studies/trend-state-calibration";
import { DataTable, SESSION_LABEL, fmtProbability, numberOrNull, parseProbabilities, rungStyle } from "./common";
import { GridHeatmap } from "./GridHeatmap";

const SCHEME_DASH: Record<string, string> = { shuffle_within_session_type: "0", shuffle_within_session: "5 3", sign_flip: "2 3" };

function Glyph({ cx, cy, index, color }: { cx?: number; cy?: number; index: number; color: string }) {
  if (cx === undefined || cy === undefined || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const r = 3.2;
  switch (index % 5) {
    case 1:
      return <path d={`M${cx},${cy - r} L${cx + r},${cy + r} L${cx - r},${cy + r}Z`} fill={color} />;
    case 2:
      return <rect x={cx - r} y={cy - r} width={2 * r} height={2 * r} fill={color} />;
    case 3:
      return <path d={`M${cx},${cy - r} L${cx + r},${cy} L${cx},${cy + r} L${cx - r},${cy}Z`} fill={color} />;
    case 4:
      return <path d={`M${cx - r},${cy} H${cx + r} M${cx},${cy - r} V${cy + r}`} stroke={color} strokeWidth={1.6} />;
    default:
      return <circle cx={cx} cy={cy} r={r * 0.85} fill={color} />;
  }
}

export interface CalibrationControls {
  session: string;
  entryStep: number;
  hiddenSchemes: string;
}

export function Calibration({
  controls, set, rungs, nullQuantiles, thresholds, thresholdGrid, settings,
}: {
  controls: CalibrationControls;
  set: <K extends keyof CalibrationControls>(key: K, value: CalibrationControls[K]) => void;
  rungs: string[];
  nullQuantiles: NullQuantileRow[];
  thresholds: ThresholdRow[];
  thresholdGrid: ThresholdGridRow[];
  settings: Record<string, string | number | boolean | null>;
}) {
  const schemes = [...new Set(nullQuantiles.map((row) => row.null_scheme))].sort();
  const hidden = new Set(controls.hiddenSchemes.split(",").filter(Boolean));
  const shownSchemes = schemes.filter((scheme) => !hidden.has(scheme));
  const entryProbability = ENTRY_PROBABILITY_STEPS[Math.min(Math.max(0, controls.entryStep), ENTRY_PROBABILITY_STEPS.length - 1)] as number;

  const inSession = nullQuantiles.filter((row) => row.session_type === controls.session && shownSchemes.includes(row.null_scheme));
  const series = shownSchemes.flatMap((scheme) =>
    rungs.map((rung, index) => ({
      scheme, rung, index,
      rows: inSession.filter((row) => row.null_scheme === scheme && row.rung === rung),
      points: inSession
        .filter((row) => row.null_scheme === scheme && row.rung === rung)
        .map((row) => ({ tail: 1 - row.quantile_level, value: row.scaled_t_quantile, quantile: row.quantile_level, observations: row.null_observations, rung, scheme }))
        .sort((a, b) => b.tail - a.tail),
    })),
  ).filter((entry) => entry.points.length > 0);

  const chosen = thresholds
    .filter((row) => row.session_type === controls.session)
    .map((row) => ({ tail: row.entry_probability, value: row.entry_threshold_scaled_t, rung: row.rung, scheme: "chosen level τ" }));
  const tauRows = series.map((entry) => {
    const run = thresholds.find((row) => row.rung === entry.rung && row.session_type === controls.session);
    const tau = tauAt(entry.rows, entryProbability);
    return {
      null_scheme: entry.scheme, rung: entry.rung, p_entry: entryProbability, tau_scaled_t: tau,
      run_entry_level: run?.entry_threshold_scaled_t ?? null, run_p_entry: run?.entry_probability ?? null,
    };
  });
  const firstTau = tauRows[0];
  const firstSeries = series[0];
  const bracket = firstSeries
    ? (() => {
        const sorted = [...firstSeries.points].sort((a, b) => a.tail - b.tail);
        const upper = sorted.find((point) => point.tail >= entryProbability) ?? sorted[sorted.length - 1];
        const lower = [...sorted].reverse().find((point) => point.tail <= entryProbability) ?? sorted[0];
        return { lower, upper };
      })()
    : null;

  const grid = thresholdGrid.filter((row) => row.session_type === controls.session);
  const chosenEntry = parseProbabilities(settings.entry_probability_by_session_type)[controls.session] ?? null;
  const chosenExit = numberOrNull(settings.exit_probability);
  const target = numberOrNull(settings.setting_target_false_entries_per_session);
  const chosenCell = grid.find((row) => chosenEntry !== null && chosenExit !== null && Math.abs(row.entry_probability - chosenEntry) < 1e-12 && Math.abs(row.exit_probability - chosenExit) < 1e-12);

  return (
    <div className="space-y-3">
      <ControlBar>
        <SelectControl label="Session type" value={controls.session} options={SESSION_TYPES.map((value) => ({ value, label: SESSION_LABEL[value] ?? value }))} onChange={(value) => set("session", value)} />
        <SliderControl
          label="p entry (τ per rung follows)"
          value={controls.entryStep}
          min={0}
          max={ENTRY_PROBABILITY_STEPS.length - 1}
          onChange={(value) => set("entryStep", value)}
          format={(value) => fmtProbability(ENTRY_PROBABILITY_STEPS[value] ?? null)}
          hint="Steps 0.01 … 0.0001, the calibration grid's p_entry values"
        />
        {schemes.map((scheme) => (
          <SegmentControl
            key={scheme}
            label={`Null ${scheme.replace(/_/g, " ")}`}
            value={hidden.has(scheme) ? "hidden" : "shown"}
            options={[{ value: "shown", label: "shown" }, { value: "hidden", label: "hidden" }]}
            onChange={(value) => {
              const next = new Set(hidden);
              if (value === "hidden") next.add(scheme);
              else next.delete(scheme);
              set("hiddenSchemes", [...next].sort().join(","));
            }}
          />
        ))}
      </ControlBar>

      <div className="grid gap-3 xl:grid-cols-2">
        <Section title={`Null tables, ${SESSION_LABEL[controls.session] ?? controls.session}`} question="The |scaled t| a rung must reach for a given false rate under the null. ◆ white diamonds are the run's chosen levels; the dotted line is the slider's p entry.">
          <ResponsiveContainer width="100%" height={320}>
            <ComposedChart margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
              <CartesianGrid {...GRID} />
              <XAxis
                type="number" dataKey="tail" scale="log" domain={[1e-4, 0.5]} reversed allowDataOverflow {...AXIS}
                ticks={[0.5, 0.1, 0.01, 0.001, 0.0001]} tickFormatter={(value: number) => fmtProbability(value)}
                label={{ value: "tail probability p (log scale)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }}
              />
              <YAxis type="number" dataKey="value" {...AXIS} width={40} label={{ value: "null |scaled t|", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
              <Tooltip
                {...TOOLTIP}
                content={({ payload }) => {
                  if (!payload || payload.length === 0) return null;
                  return (
                    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                      {payload.slice(0, 12).map((item) => {
                        const point = item.payload as { tail: number; value: number; quantile?: number; observations?: number | null; rung: string; scheme: string };
                        return (
                          <div key={`${point.scheme}-${point.rung}`} className="font-mono">
                            {point.rung} · {point.scheme}: p {fmtProbability(point.tail)} → {fmt(point.value, 3)}
                            {point.observations !== undefined && point.observations !== null ? ` (${point.observations.toLocaleString("en-US")} null observations)` : ""}
                          </div>
                        );
                      })}
                    </div>
                  );
                }}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <ReferenceLine x={entryProbability} stroke={OKABE.yellow} strokeDasharray="2 3" />
              {series.map((entry) => {
                const style = rungStyle(entry.index);
                return (
                  <Line
                    key={`${entry.scheme}-${entry.rung}`}
                    data={entry.points}
                    dataKey="value"
                    name={`${style.glyph} ${entry.rung} · ${entry.scheme}`}
                    stroke={style.color}
                    strokeDasharray={SCHEME_DASH[entry.scheme] ?? "1 2"}
                    strokeWidth={1.5}
                    dot={(props: { cx?: number; cy?: number; key?: string }) => <Glyph key={props.key} cx={props.cx} cy={props.cy} index={entry.index} color={style.color} />}
                    isAnimationActive={false}
                  />
                );
              })}
              <Scatter data={chosen} dataKey="value" name="◆ chosen τ" fill="#fafafa" shape="diamond" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-neutral-500">Line dash = null scheme ({shownSchemes.map((scheme) => `${scheme}: ${SCHEME_DASH[scheme] === "0" ? "solid" : "dashed/dotted"}`).join(", ")}); colour and glyph = rung.</p>
        </Section>

        <Section title={`τ per rung at p entry = ${fmtProbability(entryProbability)}`} question="Interpolated on the log tail probability between the two table points around p, per null scheme and rung.">
          {firstTau && firstSeries && bracket?.lower && bracket.upper && (
            <FormulaCard
              tex={"\\tau(p) = q_{a} + \\frac{\\ln p - \\ln p_{a}}{\\ln p_{b} - \\ln p_{a}}\\,\\bigl(q_{b} - q_{a}\\bigr)"}
              caption={`Worked for ${firstTau.rung} under ${firstTau.null_scheme}, ${SESSION_LABEL[controls.session] ?? controls.session}.`}
              symbols={[
                { tex: "p", name: "entry probability: the null's false rate per bar the entry level allows", value: fmtProbability(entryProbability) },
                { tex: "p_a", name: "table tail probability at or below p", value: fmtProbability(bracket.lower.tail) },
                { tex: "p_b", name: "table tail probability at or above p", value: fmtProbability(bracket.upper.tail) },
                { tex: "q_a", name: "null |scaled t| quantile at p_a", value: fmt(bracket.lower.value, 3) },
                { tex: "q_b", name: "null |scaled t| quantile at p_b", value: fmt(bracket.upper.value, 3) },
                { tex: "\\tau(p)", name: "entry level: the |scaled t| the rung must reach to turn the flag on", value: fmt(firstTau.tau_scaled_t, 3) },
              ]}
            />
          )}
          <div className="mt-2">
            <DataTable
              rows={tauRows}
              maxHeight={260}
              columns={[
                { key: "null_scheme", label: "null scheme", align: "left" },
                { key: "rung", label: "rung", align: "left", render: (row) => { const style = rungStyle(rungs.indexOf(String(row.rung))); return <span style={{ color: style.color }}>{style.glyph} {String(row.rung)}</span>; } },
                { key: "p_entry", label: "p entry", render: (row) => fmtProbability(numberOrNull(row.p_entry)) },
                { key: "tau_scaled_t", label: "τ at p (scaled t)" },
                { key: "run_p_entry", label: "run's p entry", render: (row) => fmtProbability(numberOrNull(row.run_p_entry)) },
                { key: "run_entry_level", label: "run's τ" },
              ]}
            />
          </div>
          <Finding>
            The raw t of a line fitted to log price grows like √L on a random walk, so each rung is thresholded on t ÷ √L, and even that null moves with the time of day: that is why
            τ is held per rung and per session type rather than as one constant.
          </Finding>
        </Section>
      </div>

      <Section
        title={`The grid the choice was made on: ${SESSION_LABEL[controls.session] ?? controls.session}`}
        question={`Chosen p exit ${fmtProbability(chosenExit)}, p entry ${fmtProbability(chosenEntry)} for this session type; target ${fmt(target, 2)} false entries per session.`}
      >
        <div className="grid gap-3 xl:grid-cols-2">
          <GridHeatmap rows={grid} valueKey="null_false_entries_per_session" palette="cividis" decimals={2} title="Null false entries per session" chosen={{ entry: chosenEntry, exit: chosenExit }} />
          <GridHeatmap rows={grid} valueKey="null_mean_episode_bars" palette="viridis" decimals={0} title="Null mean false-episode length (bars)" chosen={{ entry: chosenEntry, exit: chosenExit }} />
        </div>
        {chosenCell && (
          <Finding>
            At the chosen cell the null fires {fmt(chosenCell.null_false_entries_per_session, 3)} false entries per session against the target {fmt(target, 2)}, and a false episode lasts
            {" "}{fmt(chosenCell.null_mean_episode_bars, 0)} bars on average; its tail is {chosenCell.tail_supported ? "supported" : "not supported"} by the null sample
            ({fmt(chosenCell.expected_null_exceedances, 1)} expected exceedances; supported means at least 100). The null_tail_supported gate needs every session type's pick supported.
          </Finding>
        )}
      </Section>
    </div>
  );
}
