/**
 * Section C: the decayed sum S(t), term by term. Pick a bar (slider or the
 * step buttons) and a half-life, and the headlines known before that bar open
 * are listed with the weight, score and fading factor each contributes;
 * stepping the term index i lights terms up and shows the running total.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SliderControl, TOOLTIP, fmt, fmtInt, fmtTime } from "@/studies/kit";
import { decayStep, type DecayTerm, type NewsStory } from "@shared/studies/finbert-sentiment";
import { PagedTable, type PagedColumn } from "./parts";

const CHART_TERMS = 25;
const TABLE_TERMS = 40;

const TERM_COLUMNS: Array<PagedColumn<DecayTerm>> = [
  { key: "known_at_utc", label: "known_at_utc", cell: (row) => fmtTime(row.knownAt * 1000) },
  { key: "age_minutes", label: "age_minutes", align: "right", cell: (row) => fmt(row.ageMinutes, 1) },
  { key: "weight", label: "weight_w", align: "right", cell: (row) => fmt(row.weight, 2) },
  { key: "score", label: "score_s", align: "right", cell: (row) => fmt(row.score, 3) },
  { key: "decay", label: "decay_factor_2^(-age/h)", align: "right", cell: (row) => fmt(row.decay, 4) },
  { key: "term", label: "term", align: "right", cell: (row) => <span style={{ color: row.term >= 0 ? OKABE.orange : OKABE.blue }}>{row.term >= 0 ? "▲" : "▼"} {fmt(row.term, 4)}</span> },
  { key: "title", label: "headline", cell: (row) => <span className="whitespace-normal font-sans">{row.title}</span> },
];

export function Stepper({
  stories, times, barIndex, halfLifeMinutes, defaultHalfLifeMinutes, termCount, onBar, onHalfLife, onTerm,
}: {
  stories: readonly NewsStory[];
  times: Float64Array;
  barIndex: number;
  halfLifeMinutes: number;
  defaultHalfLifeMinutes: number;
  termCount: number;
  onBar: (index: number) => void;
  onHalfLife: (minutes: number) => void;
  onTerm: (count: number) => void;
}) {
  if (times.length === 0 || stories.length === 0) {
    return (
      <Section title="C. The decayed sum, term by term" question="S(t) adds up every headline known before a bar opens, each faded by its age.">
        <Finding>No bars or no headlines to step through. Widen the window or pick another root.</Finding>
      </Section>
    );
  }
  const barTime = times[barIndex] as number;
  const step = decayStep(stories, barTime, halfLifeMinutes);
  const shown = step.terms.slice(0, TABLE_TERMS);
  const available = Math.max(1, shown.length);
  const index = Math.min(Math.max(1, termCount), available);
  const selected = shown[index - 1];
  let running = 0;
  for (let k = 0; k < index; k += 1) running += (shown[k] as DecayTerm).term;
  const chartData = step.terms.slice(0, CHART_TERMS).map((term, k) => ({
    label: `${term.term >= 0 ? "▲" : "▼"} ${fmtTime(term.knownAt * 1000).slice(8)}`,
    term: term.term,
    ageMinutes: term.ageMinutes,
    weight: term.weight,
    score: term.score,
    decay: term.decay,
    lit: k < index,
    current: k === index - 1,
  }));

  return (
    <div className="space-y-3">
      <Section title="C. The decayed sum, term by term" question="Step a bar and a half-life: each headline known before the bar opened adds weight x score x a fading factor; the sum is what the first column reads.">
        <ControlBar>
          <div className="flex items-end gap-1">
            <button type="button" onClick={() => onBar(Math.max(0, barIndex - 1))} disabled={barIndex === 0} className="rounded border border-neutral-700 p-1 text-neutral-300 disabled:opacity-30" aria-label="Previous bar">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <SliderControl label="Bar" value={barIndex} min={0} max={Math.max(0, times.length - 1)} onChange={onBar} format={(v) => fmtTime((times[v] as number) * 1000).slice(5)} hint="Step through the window: the bar whose open time is shown" />
            <button type="button" onClick={() => onBar(Math.min(times.length - 1, barIndex + 1))} disabled={barIndex >= times.length - 1} className="rounded border border-neutral-700 p-1 text-neutral-300 disabled:opacity-30" aria-label="Next bar">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <SliderControl
            label="Half-life h"
            value={halfLifeMinutes}
            min={5}
            max={2880}
            step={5}
            onChange={onHalfLife}
            format={(v) => `${v} min`}
            hint={`Minutes until a headline counts half. The model uses max(20 min, 4 bars) = ${defaultHalfLifeMinutes} min on this grid.`}
          />
          <SliderControl label="Term i" value={index} min={1} max={available} onChange={onTerm} hint="Light up the newest i terms and watch the running total" />
        </ControlBar>

        <FormulaCard
          tex={"S(t)\\;=\\;\\sum_{i\\,:\\,a_i<t} w_i\\,s_i\\,2^{-(t-a_i)/h}"}
          caption={`Bar opening ${fmtTime(barTime * 1000)} UTC, h = ${halfLifeMinutes} min. The model sees sign(S)·log(1+|S|) = ${fmt(step.modelValue, 4)}.`}
          symbols={[
            { tex: "S(t)", name: "decayed sentiment on the bar opening at t, before the signed log", value: fmt(step.sum, 4) },
            { tex: "\\sum_{i:\\,a_i<t}", name: "sum over every headline known strictly before the bar opened", value: `${fmtInt(step.knownCount)} headlines` },
            { tex: "a_i", name: `when headline i became known (GDELT: the end of its 15-minute crawl bucket); term i = ${index}`, value: selected ? fmtTime(selected.knownAt * 1000).slice(5) : "—" },
            { tex: "w_i", name: "weight: relevance x direction, -1 when the story is about a pair's quote currency", value: fmt(selected?.weight, 2) },
            { tex: "s_i", name: "score: FinBERT p(positive) - p(negative)", value: fmt(selected?.score, 3) },
            { tex: "h", name: "half-life: minutes until a headline counts half", value: `${halfLifeMinutes} min` },
            { tex: "2^{-(t-a_i)/h}", name: "fading factor of term i", value: fmt(selected?.decay, 4) },
            { tex: "\\textstyle\\sum_{k\\le i}", name: `running total of the newest ${index} terms`, value: fmt(running, 4) },
          ]}
        />

        <Finding>
          {fmtInt(step.knownCount)} headlines known before the bar. S(t) = <strong>{step.sum >= 0 ? "+" : ""}{fmt(step.sum, 4)}</strong>; newest {index} terms sum to {fmt(running, 4)}
          {step.terms.length > TABLE_TERMS && ` (the table lists the ${TABLE_TERMS} newest of ${fmtInt(step.terms.length)}; older ones are nearly faded)`}.
        </Finding>

        <div className="grid gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={Math.max(220, 18 * chartData.length + 40)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
                <CartesianGrid {...GRID} horizontal={false} />
                <XAxis type="number" {...AXIS} tickFormatter={(value: number) => fmt(value, 3)} />
                <YAxis type="category" dataKey="label" width={84} {...AXIS} interval={0} />
                <ReferenceLine x={0} stroke={OKABE.grey} />
                <Tooltip
                  {...TOOLTIP}
                  content={({ payload }) => {
                    const row = payload?.[0]?.payload as (typeof chartData)[number] | undefined;
                    if (!row) return null;
                    return (
                      <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                        <div className="font-semibold">{row.label}</div>
                        <div>age {fmt(row.ageMinutes, 1)} min</div>
                        <div>
                          w {fmt(row.weight, 2)} x s {fmt(row.score, 3)} x fading {fmt(row.decay, 4)}
                        </div>
                        <div>term {fmt(row.term, 5)}</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="term" name="term = w·s·2^(-age/h)" isAnimationActive={false}>
                  {chartData.map((row) => (
                    <Cell key={row.label} fill={row.term >= 0 ? OKABE.orange : OKABE.blue} fillOpacity={row.lit ? 1 : 0.25} stroke={row.current ? "#f5f5f5" : "none"} strokeWidth={row.current ? 2 : 0} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <p className="text-[11px] text-neutral-400">
              The {CHART_TERMS} newest terms, newest first: <span style={{ color: OKABE.orange }}>▲ orange adds</span>, <span style={{ color: OKABE.blue }}>▼ blue subtracts</span>; dimmed terms are past term i.
            </p>
          </div>
          <PagedTable rows={shown} columns={TERM_COLUMNS} rowKey={(row, k) => `${row.knownAt}|${k}`} />
        </div>
      </Section>
    </div>
  );
}
