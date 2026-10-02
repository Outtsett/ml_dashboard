/**
 * Panels D and E, both over the per-decile rows of one timeframe and one
 * volume reading (fetched as part=deciles).
 *
 * D: the shape of each candle part across volume deciles, as the median with
 * its 25th to 75th percentile band (three lines told apart by dash and
 * marker, not colour alone), each panel on its own y scale.
 * E: hold the volume level fixed and split by candle colour: does a rising
 * candle's wick differ from a falling candle's at the same volume decile?
 */

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Finding, GRID, OKABE, Section, SelectControl, StudyNotes, StudyState, SwitchControl, TOOLTIP,
  fmt, fmtInt, useStudyQuery,
} from "@/studies/kit";
import { DECILE_ENCODINGS, MEASURE_ORDER, type BoardDecileRow, type VolumeCandleAnatomyBody } from "@shared/studies/volume-candle-anatomy";
import { POPULATION_LABEL, SHORT_ENCODING, SHORT_MEASURE, shortName, type Controls, type SetControl } from "./controls";

interface DotProps {
  cx?: number;
  cy?: number;
}

function upTriangle({ cx = 0, cy = 0, fill }: DotProps & { fill?: string }) {
  return <polygon key={`${cx}-${cy}`} points={`${cx},${cy - 4.5} ${cx - 4},${cy + 3.5} ${cx + 4},${cy + 3.5}`} fill={fill} />;
}

function downTriangle({ cx = 0, cy = 0, fill }: DotProps & { fill?: string }) {
  return <polygon key={`${cx}-${cy}`} points={`${cx},${cy + 4.5} ${cx - 4},${cy - 3.5} ${cx + 4},${cy - 3.5}`} fill={fill} />;
}

function circle({ cx = 0, cy = 0, fill }: DotProps & { fill?: string }) {
  return <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={3} fill={fill} />;
}

function byDecile(rows: readonly BoardDecileRow[], measure: string, population: string): BoardDecileRow[] {
  return rows.filter((row) => row.anatomy_measure === measure && row.bar_population === population).sort((a, b) => a.volume_decile - b.volume_decile);
}

const E_MEASURES = ["upper_wick_in_average_ranges", "lower_wick_in_average_ranges", "wick_asymmetry_upper_minus_lower", "body_fraction_of_range"] as const;
const RISING = "rising_candles_inside_range";
const FALLING = "falling_candles_inside_range";

export function DecilePanel({ controls, set }: { controls: Controls; set: SetControl }) {
  const query = useStudyQuery<VolumeCandleAnatomyBody>("volume-candle-anatomy", {
    part: "deciles", timeframe: controls.timeframe, population: controls.population, encoding: controls.decileEncoding,
  });
  const rows = query.data?.data.deciles?.rows ?? [];

  const asymmetry = byDecile(rows, "wick_asymmetry_upper_minus_lower", RISING);
  const asymmetryFalling = byDecile(rows, "wick_asymmetry_upper_minus_lower", FALLING);
  const topRising = asymmetry[asymmetry.length - 1];
  const topFalling = asymmetryFalling[asymmetryFalling.length - 1];

  return (
    <>
      <Section
        title="D. The shape of the candle across volume deciles"
        question="For each tenth of the volume distribution: the median of each candle part with its 25th to 75th percentile band. A flat line means volume says nothing about that part."
      >
        <div className="space-y-2">
          <Finding>
            <strong>Solution line: feed the model the volume decile as an interaction term against the anatomy columns, not only as an additive feature.</strong> The panels bend, and an additive coefficient cannot represent a bend.
          </Finding>
          <ControlBar>
            <SelectControl
              label="Volume reading" value={controls.decileEncoding}
              options={DECILE_ENCODINGS.map((value) => ({ value, label: value }))}
              onChange={(value) => set("decileEncoding", value)}
            />
            <SwitchControl label="Show the 25th to 75th percentile band" checked={controls.showBand} onChange={(value) => set("showBand", value)} />
          </ControlBar>
          <StudyNotes notes={query.data?.notes ?? []} />
          <StudyState isLoading={query.isLoading} error={query.error}>
            <p className="text-[11px] text-neutral-400">
              <strong>{controls.decileEncoding}</strong>, {controls.timeframe}, {POPULATION_LABEL[controls.population]}. Solid orange with round markers is the median;
              {controls.showBand ? " dashed sky blue with a down triangle is the 25th percentile and dotted white with an up triangle the 75th." : " the band is hidden."}
            </p>
            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(250px,1fr))]">
              {MEASURE_ORDER.map((measure) => {
                const data = byDecile(rows, measure, controls.population).map((row) => ({
                  decile: row.volume_decile, median: row.anatomy_median, p25: row.anatomy_percentile_25, p75: row.anatomy_percentile_75, bars: row.bar_count,
                }));
                return (
                  <div key={measure} className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
                    <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={measure}>{shortName(measure)}</div>
                    <ResponsiveContainer width="100%" height={160}>
                      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 14 }}>
                        <CartesianGrid {...GRID} />
                        <XAxis dataKey="decile" {...AXIS} label={{ value: "volume decile (0 = quietest)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 9 }} />
                        <YAxis domain={["auto", "auto"]} width={42} {...AXIS} tickFormatter={(v: number) => v.toFixed(2)} />
                        <Tooltip
                          {...TOOLTIP}
                          content={({ payload, label }) => {
                            const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                            if (!row) return null;
                            return (
                              <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                                <div className="font-semibold">decile {String(label)} · {fmtInt(row.bars)} bars</div>
                                <div>median {fmt(row.median, 4)}</div>
                                <div>25th {fmt(row.p25, 4)} · 75th {fmt(row.p75, 4)}</div>
                              </div>
                            );
                          }}
                        />
                        {controls.showBand && <Line dataKey="p25" name="25th percentile" stroke={OKABE.sky} strokeWidth={1.5} strokeDasharray="5 3" dot={downTriangle} isAnimationActive={false} />}
                        <Line dataKey="median" name="median" stroke={OKABE.orange} strokeWidth={2.5} dot={circle} isAnimationActive={false} />
                        {controls.showBand && <Line dataKey="p75" name="75th percentile" stroke="#f5f5f5" strokeWidth={1.5} strokeDasharray="1 3" dot={upTriangle} isAnimationActive={false} />}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                );
              })}
            </div>
            <ColumnGrid rows={rows} exclude={["volume_decile"]} title="Every column of the decile rows on screen" />
          </StudyState>
        </div>
      </Section>

      <Section
        title="E. What the colour of the volume bar adds"
        question="Hold the volume level fixed, split the bars by colour, and ask whether the candle's shape differs. If a rising and a falling bar of the same height make the same wicks, the colour is decoration."
      >
        <StudyState isLoading={query.isLoading} error={query.error}>
          <div className="space-y-2">
            <Finding>
              Positive wick asymmetry means the rejection happened above the body, negative below.
              {topRising && topFalling && (
                <> At the top decile the asymmetry is <strong>{fmt(topRising.anatomy_median, 4)}</strong> on rising candles against <strong>{fmt(topFalling.anatomy_median, 4)}</strong> on falling ones ({controls.decileEncoding}, {controls.timeframe}).</>
              )}
            </Finding>
            <p className="text-[11px] text-neutral-400">
              <span style={{ color: OKABE.orange }}>▲ rising candle (up-coloured volume bar), solid</span> · <span style={{ color: OKABE.blue }}>▼ falling candle (down-coloured volume bar), dashed</span>
            </p>
            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
              {E_MEASURES.map((measure) => {
                const rising = byDecile(rows, measure, RISING);
                const falling = byDecile(rows, measure, FALLING);
                const data = rising.map((row, index) => ({
                  decile: row.volume_decile, rising: row.anatomy_median, falling: falling[index]?.anatomy_median ?? null,
                  risingBars: row.bar_count, fallingBars: falling[index]?.bar_count ?? null,
                }));
                return (
                  <div key={measure} className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
                    <div className="mb-1 truncate text-[11px] font-medium text-neutral-200" title={measure}>{SHORT_MEASURE[measure]}</div>
                    <ResponsiveContainer width="100%" height={190}>
                      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 14 }}>
                        <CartesianGrid {...GRID} />
                        <XAxis dataKey="decile" {...AXIS} label={{ value: `${SHORT_ENCODING[controls.decileEncoding] ?? controls.decileEncoding} decile`, position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 9 }} />
                        <YAxis domain={["auto", "auto"]} width={42} {...AXIS} tickFormatter={(v: number) => v.toFixed(2)} />
                        <Tooltip
                          {...TOOLTIP}
                          content={({ payload, label }) => {
                            const row = payload?.[0]?.payload as (typeof data)[number] | undefined;
                            if (!row) return null;
                            return (
                              <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                                <div className="font-semibold">decile {String(label)}</div>
                                <div>▲ rising median {fmt(row.rising, 4)} ({fmtInt(row.risingBars)} bars)</div>
                                <div>▼ falling median {fmt(row.falling, 4)} ({fmtInt(row.fallingBars)} bars)</div>
                              </div>
                            );
                          }}
                        />
                        <Line dataKey="rising" name="rising candle" stroke={OKABE.orange} strokeWidth={2} dot={upTriangle} isAnimationActive={false} />
                        <Line dataKey="falling" name="falling candle" stroke={OKABE.blue} strokeWidth={2} strokeDasharray="6 3" dot={downTriangle} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                );
              })}
            </div>
          </div>
        </StudyState>
      </Section>
    </>
  );
}
