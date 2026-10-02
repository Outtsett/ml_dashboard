/**
 * Live day: the flag replayed in the browser (regimeScan, the port of
 * trend_state._regime_scan) on one Globex day of the landed sample bars, with τ
 * and η scaled by the reader's multipliers. Three panes share one time axis:
 * price with the flag's episodes shaded, every rung's scaled t with the chosen
 * rung's ±τ and ±η, and the entry evidence against 1.
 */

import {
  CartesianGrid, ComposedChart, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AXIS, ColumnGrid, ControlBar, Finding, GRID, OKABE, Section, SelectControl, SliderControl, TOOLTIP, fmt, fmtInt, fmtTime } from "@/studies/kit";
import {
  SESSION_TYPES, regimeScan, scaledLevels, type SampleBarRow, type ThresholdRow,
} from "@shared/studies/trend-state-calibration";
import { SESSION_LABEL, rungStyle, useWidth } from "./common";

export interface LiveDayControls {
  day: string;
  tauMultiplier: number;
  etaMultiplier: number;
  levelRung: string;
}

function levelMatrix(thresholds: readonly ThresholdRow[], rungs: readonly string[], key: "entry_threshold_scaled_t" | "exit_threshold_scaled_t"): number[][] {
  return rungs.map((rung) =>
    SESSION_TYPES.map((session) => thresholds.find((row) => row.rung === rung && row.session_type === session)?.[key] ?? Number.NaN),
  );
}

function runsOf(times: readonly number[], states: ReadonlyArray<number | null>): Array<{ start: number; end: number; side: number }> {
  const runs: Array<{ start: number; end: number; side: number }> = [];
  let open: { start: number; end: number; side: number } | null = null;
  states.forEach((state, index) => {
    const time = times[index] as number;
    const side = state ?? 0;
    if (open && side === open.side) {
      open.end = time;
      return;
    }
    if (open) runs.push(open);
    open = side !== 0 ? { start: time, end: time, side } : null;
  });
  if (open) runs.push(open);
  return runs;
}

function StateStrip({ times, rows }: { times: number[]; rows: Array<{ label: string; states: Array<number | null> }> }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const first = times[0] ?? 0;
  const last = times[times.length - 1] ?? 1;
  const left = 96;
  const plot = Math.max(10, width - left - 12);
  const x = (time: number) => left + ((time - first) / (last - first || 1)) * plot;
  const minute = 60_000;
  return (
    <div ref={ref} className="min-w-0">
      {width > 0 && (
        <svg width={width} height={rows.length * 16 + 4}>
          {rows.map((row, index) => (
            <g key={row.label}>
              <text x={left - 6} y={index * 16 + 12} textAnchor="end" fontSize={10} fill="#a3a3a3">{row.label}</text>
              <rect x={left} y={index * 16 + 3} width={plot} height={11} fill="#171717" />
              {runsOf(times, row.states).map((run) => (
                <rect
                  key={`${run.start}`}
                  x={x(run.start)}
                  y={index * 16 + 3}
                  width={Math.max(1, x(run.end + minute) - x(run.start))}
                  height={11}
                  fill={run.side > 0 ? OKABE.orange : OKABE.blue}
                >
                  <title>{`${run.side > 0 ? "▲ long" : "▼ short"} ${fmtTime(run.start)} to ${fmtTime(run.end)}`}</title>
                </rect>
              ))}
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

export function LiveDay({
  controls, set, bars, days, day, rungs, thresholds,
}: {
  controls: LiveDayControls;
  set: <K extends keyof LiveDayControls>(key: K, value: LiveDayControls[K]) => void;
  bars: SampleBarRow[];
  days: string[];
  day: string;
  rungs: string[];
  thresholds: ThresholdRow[];
}) {
  const entry = levelMatrix(thresholds, rungs, "entry_threshold_scaled_t");
  const exit = levelMatrix(thresholds, rungs, "exit_threshold_scaled_t");
  const levels = scaledLevels(entry, exit, controls.tauMultiplier, controls.etaMultiplier);
  const scaled = bars.map((bar) => rungs.map((rung) => {
    const value = bar[`trend_t_statistic_scaled_${rung}`];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }));
  const session = bars.map((bar) => {
    const code = SESSION_TYPES.indexOf(String(bar.trend_regime_session_type) as (typeof SESSION_TYPES)[number]);
    return code >= 0 ? code : SESSION_TYPES.indexOf("overnight");
  });
  const scan = regimeScan(scaled, session, levels.entry, levels.exit, true);
  const levelRungIndex = Math.max(0, rungs.indexOf(controls.levelRung));
  const levelRung = rungs[levelRungIndex] ?? "";
  const levelStyle = rungStyle(levelRungIndex);

  const data = bars.map((bar, index) => {
    const code = session[index] as number;
    const tau = (levels.entry[levelRungIndex] ?? [])[code] ?? Number.NaN;
    const eta = (levels.exit[levelRungIndex] ?? [])[code] ?? Number.NaN;
    const row: Record<string, number | string | null> = {
      time: bar.close_time,
      close: bar.close,
      state: scan.state[index] ?? 0,
      calibrated: typeof bar.trend_regime_state === "number" ? bar.trend_regime_state : null,
      entryEvidence: Number.isFinite(scan.entryEvidence[index]) ? (scan.entryEvidence[index] as number) : null,
      exitEvidence: Number.isFinite(scan.exitEvidence[index]) ? (scan.exitEvidence[index] as number) : null,
      winner: rungs[scan.winner[index] ?? -1] ?? "",
      session: SESSION_TYPES[code] ?? "",
      tauUp: tau, tauDown: -tau, etaUp: eta, etaDown: -eta,
    };
    rungs.forEach((rung, rungIndex) => {
      row[rung] = scaled[index]?.[rungIndex] ?? null;
    });
    return row;
  });
  const times = bars.map((bar) => bar.close_time);
  const liveOn = scan.state.filter((state) => state !== 0).length;
  const calibratedOn = bars.filter((bar) => typeof bar.trend_regime_state === "number" && bar.trend_regime_state !== 0).length;
  const agreeing = bars.filter((bar, index) => (bar.trend_regime_state ?? 0) === scan.state[index]).length;
  const bands = runsOf(times, scan.state);
  const domain: [number, number] = [times[0] ?? 0, times[times.length - 1] ?? 1];
  const tick = (value: number) => fmtTime(value).slice(11);
  const closes = bars.map((bar) => bar.close);
  const priceDomain: [number, number] = closes.length ? [Math.min(...closes), Math.max(...closes)] : [0, 1];
  const pad = (priceDomain[1] - priceDomain[0]) * 0.05 || 1;

  return (
    <div className="space-y-3">
      <ControlBar>
        <SelectControl label="Globex day (the landed sample)" value={day} options={days.map((value) => ({ value, label: value }))} onChange={(value) => set("day", value)} />
        <SliderControl label="τ × (entry levels)" value={controls.tauMultiplier} min={0.5} max={2} step={0.05} onChange={(value) => set("tauMultiplier", value)} format={(value) => value.toFixed(2)} />
        <SliderControl label="η × (exit levels)" value={controls.etaMultiplier} min={0.3} max={1.5} step={0.05} onChange={(value) => set("etaMultiplier", value)} format={(value) => value.toFixed(2)} hint="η is capped at 0.999 τ so the trigger keeps its hysteresis" />
        <SelectControl label="Levels drawn for rung" value={levelRung} options={rungs.map((value, index) => ({ value, label: `${rungStyle(index).glyph} ${value}` }))} onChange={(value) => set("levelRung", value)} />
      </ControlBar>

      <Section
        title={`${day}: the flag on price with τ × ${controls.tauMultiplier.toFixed(2)}, η × ${controls.etaMultiplier.toFixed(2)}`}
        question={`${fmtInt(liveOn)} bars on (replayed here), ${fmtInt(calibratedOn)} with the calibrated levels in the lake. ▲ orange = long, ▼ blue = short. Clock: Eastern, as stamped.`}
      >
        {bars.length === 0 ? (
          <p className="text-[11px] text-neutral-500">No sample bars for this run.</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data} syncId="trend-state-live-day" margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="time" type="number" domain={domain} tickFormatter={tick} {...AXIS} />
                <YAxis domain={[priceDomain[0] - pad, priceDomain[1] + pad]} tickFormatter={(value: number) => fmt(value, 0)} {...AXIS} width={52} />
                {bands.map((band) => (
                  <ReferenceArea key={band.start} x1={band.start} x2={band.end + 60_000} fill={band.side > 0 ? OKABE.orange : OKABE.blue} fillOpacity={0.22} ifOverflow="hidden"
                    label={{ value: band.side > 0 ? "▲" : "▼", position: "insideTop", fill: band.side > 0 ? OKABE.orange : OKABE.blue, fontSize: 10 }} />
                ))}
                <Tooltip
                  {...TOOLTIP}
                  labelFormatter={(value: number) => fmtTime(value)}
                  content={({ payload, label }) => {
                    const row = payload?.[0]?.payload as Record<string, number | string | null> | undefined;
                    if (!row) return null;
                    return (
                      <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px] font-mono">
                        <div>{fmtTime(Number(label))} · {SESSION_LABEL[String(row.session)] ?? row.session}</div>
                        <div>close {fmt(row.close as number, 2)}</div>
                        <div>replayed flag {row.state === 1 ? "▲ long" : row.state === -1 ? "▼ short" : "flat"} · calibrated {row.calibrated === 1 ? "▲ long" : row.calibrated === -1 ? "▼ short" : "flat"}</div>
                        <div>entry evidence {fmt(row.entryEvidence as number | null, 3)} · winning rung {row.winner || "—"}</div>
                      </div>
                    );
                  }}
                />
                <Line dataKey="close" stroke="#e5e5e5" dot={false} strokeWidth={1.2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <StateStrip times={times} rows={[{ label: "replayed here", states: scan.state }, { label: "calibrated (lake)", states: bars.map((bar) => bar.trend_regime_state) }]} />

            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={data} syncId="trend-state-live-day" margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="time" type="number" domain={domain} tickFormatter={tick} {...AXIS} />
                <YAxis {...AXIS} width={52} label={{ value: "scaled t per rung", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
                <Tooltip {...TOOLTIP} labelFormatter={(value: number) => fmtTime(value)} formatter={(value: number, name: string) => [fmt(value, 3), name]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <ReferenceLine y={0} stroke="#525252" />
                {rungs.map((rung, index) => {
                  const style = rungStyle(index);
                  return <Line key={rung} dataKey={rung} name={`${style.glyph} ${rung}`} stroke={style.color} strokeDasharray={style.dash} dot={false} strokeWidth={1.1} isAnimationActive={false} connectNulls={false} />;
                })}
                <Line dataKey="tauUp" name={`+τ ${levelRung}`} type="stepAfter" stroke={levelStyle.color} strokeWidth={2} strokeDasharray="10 3" dot={false} isAnimationActive={false} />
                <Line dataKey="tauDown" name={`−τ ${levelRung}`} type="stepAfter" stroke={levelStyle.color} strokeWidth={2} strokeDasharray="10 3" dot={false} isAnimationActive={false} legendType="none" />
                <Line dataKey="etaUp" name={`±η ${levelRung}`} type="stepAfter" stroke={levelStyle.color} strokeWidth={1.4} strokeDasharray="1 3" dot={false} isAnimationActive={false} />
                <Line dataKey="etaDown" name={`−η ${levelRung}`} type="stepAfter" stroke={levelStyle.color} strokeWidth={1.4} strokeDasharray="1 3" dot={false} isAnimationActive={false} legendType="none" />
              </ComposedChart>
            </ResponsiveContainer>

            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={data} syncId="trend-state-live-day" margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="time" type="number" domain={domain} tickFormatter={tick} {...AXIS} />
                <YAxis {...AXIS} width={52} label={{ value: "evidence", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
                <Tooltip {...TOOLTIP} labelFormatter={(value: number) => fmtTime(value)} formatter={(value: number, name: string) => [fmt(value, 3), name]} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <ReferenceLine y={1} stroke={OKABE.vermillion} strokeDasharray="4 3" label={{ value: "1.0", fill: OKABE.vermillion, fontSize: 9, position: "right" }} />
                <Line dataKey="entryEvidence" name="entry evidence: max over rungs of |scaled t| ÷ τ" stroke="#e5e5e5" dot={false} strokeWidth={1.4} isAnimationActive={false} />
                <Line dataKey="exitEvidence" name="exit evidence (held side): |scaled t| ÷ η" stroke={OKABE.sky} strokeDasharray="3 2" dot={false} strokeWidth={1.2} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <Finding>
              The flag can only turn on when the entry evidence crosses 1, and stays on while the held side's exit evidence is at least 1. At τ × {controls.tauMultiplier.toFixed(2)} and
              η × {controls.etaMultiplier.toFixed(2)} the replay agrees with the calibrated flag on {fmtInt(agreeing)} of {fmtInt(bars.length)} bars. The replay starts flat at the day's
              first bar, as the notebook's did; the lake's column is one continuous run and can open a day already holding a position (the spec-ladder run opens 2025-12-25 long,
              carried from 2025-12-23), which the replay cannot see.
            </Finding>
          </>
        )}
      </Section>

      <Section title={`Every column of ${day}'s sample bars`} question="One histogram and eight numbers per column: close, every rung's slope, t, scaled t and R², and the fused flag columns.">
        <ColumnGrid rows={bars as unknown as Array<Record<string, unknown>>} exclude={["close_time"]} />
      </Section>
    </div>
  );
}
