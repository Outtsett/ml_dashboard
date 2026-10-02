/**
 * Section B: what the archetypes look like. Each shape is the MEAN of the real
 * windows assigned to its code (not the decoder's reconstruction), drawn as
 * candles from the stored open, close and wick fractions.
 */

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, Stat, TOOLTIP,
  fmt, fmtInt, fmtPercent, useStudyControls,
} from "@/studies/kit";
import {
  entropyTerms, glyphBars, groupArchetypes, orderCodes, perplexity,
  type ArchetypeCode, type ArchetypeOrder, type ArchetypeRow, type ArchetypeSet,
} from "@shared/studies/candle-vocabulary";

const CHANNEL_ROWS: Array<{ key: keyof ArchetypeCode["bars"][number]; label: string; magnitude?: boolean }> = [
  { key: "open", label: "open position in the bar" },
  { key: "close", label: "close position in the bar" },
  { key: "body", label: "body, signed (close − open)" },
  { key: "upperWick", label: "upper wick" },
  { key: "lowerWick", label: "lower wick" },
  { key: "logRangeZscore", label: "log range z-score", magnitude: true },
  { key: "logVolumeZscore", label: "log volume z-score", magnitude: true },
];

/** One archetype as candles. x: bar, y: fraction of the bar's own range. Rising = filled body, falling = hollow. */
function Glyph({ code, width, selected, onSelect, onHover }: {
  code: ArchetypeCode; width: number; selected: boolean; onSelect: () => void; onHover: (hovered: boolean) => void;
}) {
  const bars = glyphBars(code.bars);
  const viewWidth = width + 0.4;
  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      aria-pressed={selected}
      aria-label={`archetype ${code.code}, ${fmtInt(code.count)} windows`}
      className={`min-w-0 rounded border px-1 pb-1 pt-0.5 text-left ${selected ? "border-[#E69F00] bg-[#E69F00]/10" : "border-neutral-800 bg-neutral-900/40 hover:border-neutral-600"}`}
    >
      <div className="truncate text-[10px] font-mono text-neutral-400">#{code.code} n={fmtInt(code.count)}</div>
      <svg viewBox={`-0.7 -0.1 ${viewWidth} 1.2`} className="block w-full" style={{ aspectRatio: `${viewWidth} / 1.2` }} role="img">
        <line x1={-0.7} x2={width - 0.3} y1={0.5} y2={0.5} stroke="#404040" strokeWidth={0.008} strokeDasharray="0.04 0.04" />
        {bars.map((bar) => {
          const colour = bar.rising ? OKABE.orange : OKABE.blue;
          return (
            <g key={bar.position}>
              <line x1={bar.position} x2={bar.position} y1={1 - bar.wickLow} y2={1 - bar.wickHigh} stroke={colour} strokeWidth={0.035} />
              <rect
                x={bar.position - 0.28}
                y={1 - (bar.bodyBottom + bar.bodyHeight)}
                width={0.56}
                height={bar.bodyHeight}
                fill={bar.rising ? colour : "#0a0a0a"}
                stroke={colour}
                strokeWidth={0.035}
              />
            </g>
          );
        })}
      </svg>
    </button>
  );
}

export function ArchetypeSection({ rows }: { rows: readonly ArchetypeRow[] }) {
  const [controls, set, reset] = useStudyControls({ set: "", order: "count", columns: 8, selected: -1, termIndex: 0 });
  const sets: ArchetypeSet[] = groupArchetypes(rows);
  // the notebook's default: the last file sorted, which is the with-magnitude set
  const active = sets.find((candidate) => candidate.runName === controls.set) ?? sets[sets.length - 1];
  const ordered = active ? orderCodes(active.codes, controls.order as ArchetypeOrder) : [];
  const byCount = active ? orderCodes(active.codes, "count") : [];
  const [hovered, setHovered] = useState<number | null>(null);
  const selected = active?.codes.find((code) => code.code === (hovered ?? controls.selected)) ?? null;

  const terms = entropyTerms(byCount.map((code) => code.count));
  const termIndex = Math.min(Math.max(controls.termIndex === 0 ? terms.length : controls.termIndex, 1), Math.max(terms.length, 1));
  const currentTerm = terms[termIndex - 1];
  const totalWindows = byCount.reduce((sum, code) => sum + code.count, 0);
  const effective = perplexity(byCount.map((code) => code.count));
  const shapeOnlySet = sets.find((candidate) => !candidate.withMagnitude);
  const shapeOnlyPerplexity = shapeOnlySet ? perplexity(shapeOnlySet.codes.map((code) => code.count)) : null;
  const usageData = ordered.map((code) => ({ code: String(code.code), count: code.count, share: code.share }));

  return (
    <Section title="B. The archetypes themselves" question="Each shape is the mean of the real windows assigned to that code, not the decoder's reconstruction: what the shape actually was.">
      <div className="space-y-3">
        {sets.length === 0 ? (
          <p className="py-6 text-center text-xs text-neutral-500">No archetype file was landed.</p>
        ) : (
          <>
            <ControlBar onReset={reset}>
              <SelectControl
                label="Archetype set"
                value={active?.runName ?? ""}
                options={sets.map((candidate) => ({ value: candidate.runName, label: `${candidate.runName} · ${candidate.withMagnitude ? "▲ with magnitude" : "△ shape only"}` }))}
                onChange={(v) => set("set", v)}
              />
              <SegmentControl
                label="Order"
                value={controls.order}
                options={[{ value: "count", label: "commonest first" }, { value: "rare", label: "rarest first" }, { value: "code", label: "code id" }]}
                onChange={(v) => set("order", v)}
                hint="Commonest first is the notebook's order: a rare code is mostly noise"
              />
              <SliderControl label="Columns" value={controls.columns} min={2} max={12} onChange={(v) => set("columns", v)} />
            </ControlBar>

            <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
              <Stat label="Archetypes" value={String(active?.codeCount ?? 0)} hint={`${active?.width} bars each`} />
              <Stat label="Windows assigned" value={fmtInt(totalWindows)} hint="train windows the means are taken over" />
              <Stat label="Perplexity" value={fmt(effective, 2)} hint="effective number of codes in use, recomputed from the counts: equals the stored codebook perplexity" />
              <Stat label="Commonest / rarest" value={byCount.length ? `${fmtPercent(byCount[0]?.share, 1)} / ${fmtPercent(byCount[byCount.length - 1]?.share, 2)}` : "—"} />
            </div>
            <p className="text-[11px] text-neutral-400">
              <span style={{ color: OKABE.orange }}>■ filled: close ≥ open (rising)</span> · <span style={{ color: OKABE.blue }}>□ hollow: close &lt; open (falling)</span>. Click an archetype to pin it; hover to preview.
            </p>

            <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${controls.columns}, minmax(0, 1fr))` }}>
              {active && ordered.map((code) => (
                <Glyph
                  key={code.code}
                  code={code}
                  width={active.width}
                  selected={code.code === controls.selected}
                  onSelect={() => set("selected", code.code === controls.selected ? -1 : code.code)}
                  onHover={(isOver) => setHovered(isOver ? code.code : null)}
                />
              ))}
            </div>

            <div className="grid gap-3 xl:grid-cols-2">
              <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
                {selected && active ? (
                  <>
                    <div className="mb-1 flex items-baseline justify-between">
                      <h4 className="text-xs font-semibold text-neutral-100">Archetype #{selected.code}</h4>
                      <span className="text-[11px] text-neutral-400">
                        {fmtInt(selected.count)} windows · {fmtPercent(selected.share, 2)} · rank {selected.rank} of {active.codeCount}
                      </span>
                    </div>
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-neutral-500">
                          <th className="text-left font-normal">channel</th>
                          {selected.bars.map((bar) => (
                            <th key={bar.position} className="text-right font-normal">bar {bar.position}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {CHANNEL_ROWS.filter((channel) => !channel.magnitude || active.withMagnitude).map((channel) => (
                          <tr key={channel.key} className="border-t border-neutral-900">
                            <td className="py-0.5 text-neutral-400">{channel.label}</td>
                            {selected.bars.map((bar) => (
                              <td key={bar.position} className="py-0.5 text-right font-mono tnum text-neutral-200">
                                {fmt(bar[channel.key] as number | null, 3)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-1 text-[10px] text-neutral-500">Shape channels are fractions of the bar&apos;s own range; the two z-scores (when present) restore size, causal, window 100.</p>
                  </>
                ) : (
                  <p className="py-6 text-center text-xs text-neutral-500">Hover or click an archetype to see its channel values.</p>
                )}
              </div>

              <div className="min-w-0">
                <p className="mb-1 text-[11px] text-neutral-400">Windows assigned per archetype (same order as the grid; the pinned one is orange)</p>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={usageData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid {...GRID} vertical={false} />
                    <XAxis dataKey="code" {...AXIS} interval={0} fontSize={9} />
                    <YAxis {...AXIS} />
                    <Tooltip {...TOOLTIP} formatter={(value, _name, item) => [`${fmtInt(Number(value))} (${fmtPercent((item.payload as { share: number }).share, 2)})`, "windows"]} labelFormatter={(label) => `archetype #${String(label)}`} />
                    <Bar dataKey="count" isAnimationActive={false} onClick={(entry) => set("selected", Number((entry as unknown as { code: string }).code))}>
                      {usageData.map((entry) => (
                        <Cell key={entry.code} fill={Number(entry.code) === (selected?.code ?? -2) ? OKABE.orange : OKABE.sky} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <Finding>
              The {active?.codeCount} archetypes are far from equally used: the commonest covers {fmtPercent(byCount[0]?.share, 1)} of the windows and the rarest {fmtPercent(byCount[byCount.length - 1]?.share, 2)}, so a rare code
              is mostly noise and the grid lists the commonest first. Perplexity {fmt(effective, 1)} of {active?.codeCount} is the effective number of codes in use
              {active?.withMagnitude && shapeOnlyPerplexity !== null && effective < shapeOnlyPerplexity
                ? `: the shape-only set spreads its windows over an effective ${fmt(shapeOnlyPerplexity, 1)} codes, so keeping magnitude concentrates usage onto fewer codes`
                : ""}.
            </Finding>

            <ControlBar>
              <SliderControl
                label="Index i (archetypes by count)"
                value={termIndex}
                min={1}
                max={Math.max(terms.length, 1)}
                onChange={(v) => set("termIndex", v)}
                hint="Step the sum over archetypes, commonest first, and watch each term join the running total"
              />
            </ControlBar>
            <div className="grid gap-3 xl:grid-cols-2">
              <FormulaCard
                tex={"\\text{perplexity} \\;=\\; \\exp\\!\\Bigl(-\\sum_{c=1}^{K} p_c \\ln p_c\\Bigr), \\qquad p_c=\\frac{n_c}{\\sum_{j} n_j}"}
                caption={`Through i = ${termIndex} the running sum is ${fmt(currentTerm?.running, 4)} nats; exp of it would read ${fmt(currentTerm ? Math.exp(currentTerm.running) : null, 2)}. At i = K it is the perplexity ${fmt(effective, 4)}.`}
                symbols={[
                  { tex: "K", name: "number of archetypes", value: String(active?.codeCount ?? 0) },
                  { tex: "c", name: "archetype, ordered by window count", value: String(termIndex) },
                  { tex: "n_c", name: "train windows assigned to archetype c", value: fmtInt(byCount[termIndex - 1]?.count) },
                  { tex: "p_c", name: "share of all windows on archetype c", value: fmt(currentTerm?.probability, 5) },
                  { tex: "-p_c\\ln p_c", name: "term i: this archetype's contribution to the entropy, nats", value: fmt(currentTerm?.term, 5) },
                  { tex: "\\sum_{c\\le i}", name: "running total through i, nats", value: fmt(currentTerm?.running, 4) },
                ]}
              />
              <div className="min-w-0">
                <p className="mb-1 text-[11px] text-neutral-400">Terms −p ln p, commonest first: lit (orange) up to i, grey after</p>
                <ResponsiveContainer width="100%" height={190}>
                  <BarChart data={terms} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid {...GRID} vertical={false} />
                    <XAxis dataKey="index" {...AXIS} interval={0} fontSize={9} />
                    <YAxis {...AXIS} />
                    <Tooltip {...TOOLTIP} formatter={(value) => [fmt(Number(value), 5), "−p ln p"]} labelFormatter={(label) => `archetype ${String(label)} by count`} />
                    <Bar dataKey="term" isAnimationActive={false}>
                      {terms.map((entry) => (
                        <Cell key={entry.index} fill={entry.index <= termIndex ? OKABE.orange : "#525252"} stroke={entry.index === termIndex ? OKABE.purple : undefined} strokeWidth={entry.index === termIndex ? 2 : 0} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </div>
    </Section>
  );
}
