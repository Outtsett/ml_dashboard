/**
 * The run header the notebook printed (bars, sessions, ladder, null, replicates,
 * purge, round trip, chosen p_entry / p_exit, verdict), every acceptance gate as a
 * chip, and τ and η materialised per rung and session type.
 */

import { OKABE, Section, Stat, fmt, fmtInt } from "@/studies/kit";
import type { ThresholdRow } from "@shared/studies/trend-state-calibration";
import { DataTable, GateChip, SESSION_LABEL, cell, fmtProbability, numberOrNull, parseProbabilities, rungStyle } from "./common";

type Settings = Record<string, string | number | boolean | null>;

export function RunHeader({ settings, thresholds, rungs }: { settings: Settings; thresholds: ThresholdRow[]; rungs: string[] }) {
  const usable = settings.usable === true;
  const verdict = String(settings.verdict ?? "");
  const gates = Object.entries(settings)
    .filter(([key]) => key.startsWith("check_"))
    .map(([key, value]) => ({ name: key.slice("check_".length), passed: typeof value === "boolean" ? value : null }));
  const failed = gates.filter((gate) => gate.passed === false).length;
  const entryBySession = parseProbabilities(settings.entry_probability_by_session_type);

  return (
    <Section
      title={`Run ${String(settings.setting_root ?? "")} ${String(settings.setting_start ?? "")} → ${String(settings.setting_end ?? "")}`}
      question={`ladder ${String(settings.setting_ladder ?? "")} · null ${String(settings.setting_null_scheme ?? "")} · ${cell(settings.setting_replicates)} replicates · seed ${cell(settings.setting_seed)}`}
    >
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Verdict" value={usable ? "✓ usable" : "✗ not yet usable"} tone={usable ? OKABE.orange : OKABE.blue} hint={verdict} />
        <Stat label="One-minute bars" value={fmtInt(numberOrNull(settings.bars))} hint={`${String(settings.first_bar ?? "")} to ${String(settings.last_bar ?? "")}`} />
        <Stat label="Sessions (regular / overnight)" value={`${cell(settings.sessions_regular_trading_hours)} / ${cell(settings.sessions_overnight)}`} />
        <Stat label="Real episodes" value={fmtInt(numberOrNull(settings.episodes))} />
        <Stat label="Round trip (points)" value={fmt(numberOrNull(settings.round_trip_cost_points), 3)} hint="the cost every episode's net points are charged, from the run's cost model" />
        <Stat label="Purge (bars)" value={fmtInt(numberOrNull(settings.purge_bars))} hint="the block's lookback plus the label horizon, in one-minute bars" />
        <Stat label="Chosen p exit" value={fmtProbability(numberOrNull(settings.exit_probability))} />
        <Stat label="Probability of backtest overfitting" value={fmt(numberOrNull(settings.probability_of_backtest_overfitting), 3)} tone={(numberOrNull(settings.probability_of_backtest_overfitting) ?? 1) < 0.5 ? OKABE.orange : OKABE.blue} />
      </div>
      <p className="mt-2 text-[11px] text-neutral-400">
        Chosen p_entry by session type:{" "}
        {Object.entries(entryBySession).map(([session, value]) => (
          <span key={session} className="mr-3 font-mono text-neutral-200">
            {SESSION_LABEL[session] ?? session} {fmtProbability(value)}
          </span>
        ))}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {gates.map((gate) => (
          <GateChip key={gate.name} name={gate.name} passed={gate.passed} />
        ))}
      </div>
      <p className="mt-1 text-[11px] text-neutral-400">
        {failed} of {gates.length} gates fail. {verdict}
      </p>

      <h4 className="mt-3 mb-1 text-xs font-semibold text-neutral-200">τ and η materialised: entry and exit levels per rung and session type (scaled-t units)</h4>
      <DataTable
        rows={thresholds as unknown as Array<Record<string, unknown>>}
        maxHeight={320}
        columns={[
          {
            key: "rung", label: "rung", align: "left",
            render: (row) => {
              const index = rungs.indexOf(String(row.rung));
              const style = rungStyle(index);
              return <span style={{ color: style.color }}>{style.glyph} {String(row.rung)}</span>;
            },
          },
          { key: "timeframe", label: "timeframe", align: "left" },
          { key: "window_bars", label: "window bars" },
          { key: "session_type", label: "session type", align: "left", render: (row) => SESSION_LABEL[String(row.session_type)] ?? String(row.session_type) },
          { key: "entry_probability", label: "p entry", render: (row) => fmtProbability(numberOrNull(row.entry_probability)) },
          { key: "exit_probability", label: "p exit", render: (row) => fmtProbability(numberOrNull(row.exit_probability)) },
          { key: "entry_threshold_scaled_t", label: "entry level τ" },
          { key: "exit_threshold_scaled_t", label: "exit level η" },
        ]}
      />
    </Section>
  );
}
