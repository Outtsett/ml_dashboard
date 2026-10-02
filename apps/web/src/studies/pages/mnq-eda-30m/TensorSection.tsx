/**
 * Section 8: what the model sees. The (window × 5) tensor build_log_return_tensor hands the
 * SimpleDirectionTransformer, for any bar window (the notebook showed only the newest 32):
 * five channels, each the log of a field over its OWN previous value (not over the previous
 * close, as the notebook's axis labels say), clamped to ±5. The first row of a window is
 * always zero. The volume channel is thousands of times wider than the price channels, so it
 * can sit on its own axis.
 */

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SliderControl, StudyNotes, StudyState, SwitchControl, TOOLTIP, fmt, fmtInt, fmtTime, useStudyControls } from "@/studies/kit";
import type { TensorBody } from "@shared/studies/mnq-eda-30m";
import { DASHES, sci } from "./format";
import { useSection, type SeriesChoice } from "./use";

const COLORS = [OKABE.blue, OKABE.sky, OKABE.orange, OKABE.purple, OKABE.yellow];
const LABELS = ["open / previous open", "high / previous high", "low / previous low", "close / previous close", "volume / previous volume"];
const FIELD = ["open", "high", "low", "close", "volume"];

/** The window as a matrix: bars down, channels across, each channel scaled by its own largest magnitude. */
function TensorMatrix({ body }: { body: TensorBody }) {
  const cell = Math.max(6, Math.min(14, Math.floor(420 / Math.max(body.values.length, 1))));
  const left = 96;
  const top = 18;
  const scales = LABELS.map((_, channel) => Math.max(1e-12, ...body.values.map((row) => Math.abs(row[channel] as number))));
  return (
    <svg viewBox={`0 0 ${left + 5 * 54} ${top + body.values.length * cell + 4}`} className="w-full max-w-md" role="img" aria-label="The model input window as a matrix">
      {FIELD.map((name, channel) => (
        <text key={name} x={left + channel * 54 + 27} y={12} fontSize="9" textAnchor="middle" fill="#a3a3a3">{name}</text>
      ))}
      {body.values.map((row, index) => (
        <g key={index}>
          {index % Math.max(1, Math.ceil(body.values.length / 8)) === 0 && (
            <text x={left - 6} y={top + index * cell + cell * 0.75} fontSize="8" textAnchor="end" fill="#737373">bar {index}</text>
          )}
          {row.map((value, channel) => {
            const strength = Math.min(1, Math.abs(value) / (scales[channel] as number));
            return (
              <g key={channel}>
                <rect x={left + channel * 54} y={top + index * cell} width={52} height={cell - 1} fill={value >= 0 ? OKABE.orange : OKABE.blue} fillOpacity={0.12 + 0.88 * strength}>
                  <title>{`bar ${index}, ${FIELD[channel]}: ${sci(value, 4)}`}</title>
                </rect>
                {cell >= 10 && strength > 0.55 && (
                  <text x={left + channel * 54 + 26} y={top + index * cell + cell * 0.72} fontSize="8" textAnchor="middle" fill="#0a0a0a">{value >= 0 ? "▲" : "▼"}</text>
                )}
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}

export function TensorSection({ choice }: { choice: SeriesChoice }) {
  const [controls, set, reset] = useStudyControls({ tensorWindow: 32, tensorPosition: 1000, tensorClamp: 5, separateVolumeAxis: true });
  const { query, notes, body, unavailable } = useSection<TensorBody>("tensor", choice, { tensorWindow: controls.tensorWindow, tensorPosition: controls.tensorPosition, tensorClamp: controls.tensorClamp });

  const data = (body?.values ?? []).map((row, index) => ({ bar: index, open: row[0], high: row[1], low: row[2], close: row[3], volume: row[4] }));
  const clampedTotal = body ? body.perChannel.reduce((sum, channel) => sum + channel.clampedCount, 0) : 0;

  return (
    <Section title="8 · What the model sees" question="The exact window of log changes the SimpleDirectionTransformer is fed, for any point in the history.">
      <div className="space-y-3">
        <ControlBar onReset={reset}>
          <SliderControl label="Window" value={controls.tensorWindow} min={2} max={128} onChange={(v) => set("tensorWindow", v)} format={(v) => `${v} bars`} hint="The notebook's model uses 32" />
          <SliderControl label="Window ends at" value={controls.tensorPosition} min={0} max={1000} step={1} onChange={(v) => set("tensorPosition", v)} format={(v) => `${(v / 10).toFixed(1)}% of history`} hint="Scrub the window through the series; 100% is the newest bar, the notebook's window" />
          <SliderControl label="Clamp" value={controls.tensorClamp} min={0.5} max={10} step={0.5} onChange={(v) => set("tensorClamp", v)} format={(v) => `±${v}`} hint="The model clips every value to ±5" />
          <SwitchControl label="Volume on its own axis" checked={controls.separateVolumeAxis} onChange={(v) => set("separateVolumeAxis", v)} />
        </ControlBar>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={notes} />
          {unavailable || !body ? (
            <p className="text-xs text-neutral-500">The bars are not in the lake for this selection.</p>
          ) : (
            <>
              <Finding>
                Shape ({fmtInt(body.values.length)}, 5), bars {fmtTime(body.startTimestamp)} to {fmtTime(body.endTimestamp)}, values between {fmt(body.minimum, 4)} and {fmt(body.maximum, 4)}; {fmtInt(clampedTotal)} values hit the ±{body.clamp} clamp. The price channels move by a few hundredths of a percent a bar while the volume channel swings by whole units, so a model without the clamp would be dominated by volume. The notebook labelled the channels &quot;log(O/Cp) … log(V/Vp)&quot;, meaning over the previous close; the code divides each field by its own previous value, which is what is drawn here.
              </Finding>
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="min-w-0 space-y-1">
                  <h4 className="text-xs font-semibold text-neutral-200">The five channels across the window (oldest bar on the left)</h4>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={data} margin={{ top: 8, right: controls.separateVolumeAxis ? 4 : 8, left: 0, bottom: 4 }}>
                      <CartesianGrid {...GRID} vertical={false} />
                      <XAxis dataKey="bar" {...AXIS} label={{ value: "bar index in the window (0 = oldest)", position: "insideBottom", offset: -6, fill: "#9ca3af", fontSize: 10 }} />
                      <YAxis yAxisId="price" {...AXIS} width={52} tickFormatter={(v: number) => sci(v, 2)} />
                      {controls.separateVolumeAxis && <YAxis yAxisId="volume" orientation="right" {...AXIS} width={40} tickFormatter={(v: number) => fmt(v, 1)} />}
                      <Tooltip {...TOOLTIP} formatter={(value: number, name: string) => [sci(value, 4), name]} labelFormatter={(bar) => `bar ${bar}`} />
                      <Legend verticalAlign="top" wrapperStyle={{ fontSize: 10 }} />
                      <ReferenceLine yAxisId="price" y={0} stroke="#525252" />
                      {FIELD.map((field, channel) => (
                        <Line
                          key={field}
                          yAxisId={channel === 4 && controls.separateVolumeAxis ? "volume" : "price"}
                          dataKey={field}
                          name={`${LABELS[channel]} ${channel === 4 && controls.separateVolumeAxis ? "(right axis)" : ""}`}
                          stroke={COLORS[channel]}
                          strokeDasharray={DASHES[channel]}
                          strokeWidth={1.8}
                          dot={{ r: 2, strokeWidth: 0, fill: COLORS[channel] }}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="min-w-0 space-y-1">
                  <h4 className="text-xs font-semibold text-neutral-200">The same window as the matrix the network reads</h4>
                  <TensorMatrix body={body} />
                  <p className="text-[11px] text-neutral-400">Orange ▲ positive, blue ▼ negative; each column is shaded against its own largest magnitude, so the small price channels are as visible as volume.</p>
                </div>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="min-w-0 overflow-x-auto rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
                  <table className="w-full text-[11px] font-mono tnum">
                    <thead>
                      <tr className="text-left text-neutral-500">
                        <th className="font-normal">channel</th>
                        <th className="pl-3 text-right font-normal">mean</th>
                        <th className="pl-3 text-right font-normal">std</th>
                        <th className="pl-3 text-right font-normal">min</th>
                        <th className="pl-3 text-right font-normal">max</th>
                        <th className="pl-3 text-right font-normal">clamped</th>
                      </tr>
                    </thead>
                    <tbody>
                      {body.perChannel.map((channel, index) => (
                        <tr key={channel.name} className="border-t border-neutral-900">
                          <td className="py-0.5 font-sans text-neutral-300" style={{ color: COLORS[index] }}>{channel.name}</td>
                          <td className="pl-3 text-right text-neutral-100">{sci(channel.mean, 3)}</td>
                          <td className="pl-3 text-right">{sci(channel.standardDeviation, 3)}</td>
                          <td className="pl-3 text-right">{sci(channel.minimum, 3)}</td>
                          <td className="pl-3 text-right">{sci(channel.maximum, 3)}</td>
                          <td className="pl-3 text-right">{fmtInt(channel.clampedCount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1 text-[10px] text-neutral-500">Population standard deviation, as numpy&apos;s .std() in the notebook.</p>
                </div>
                <FormulaCard
                  tex={String.raw`x_{t,f}=\operatorname{clip}\!\left(\ln\frac{F_{t,f}}{F_{t-1,f}},\,-c,\,c\right),\qquad x_{\text{first},f}=0`}
                  caption="One channel per field f; a previous value that is not positive is replaced by 1 before dividing."
                  symbols={[
                    { tex: String.raw`F_{t,f}`, name: "field f (open, high, low, close, volume) of bar t", value: "from the bars" },
                    { tex: "c", name: "the clamp", value: `${body.clamp}` },
                    { tex: String.raw`x_{t,f}`, name: "the network's input for bar t, channel f", value: `${fmtInt(body.values.length)} × 5 shown` },
                    { tex: "T", name: "window length in bars", value: fmtInt(body.window) },
                  ]}
                />
              </div>
            </>
          )}
        </StudyState>
      </div>
    </Section>
  );
}
