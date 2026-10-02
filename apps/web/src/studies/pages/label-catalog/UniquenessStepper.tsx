/**
 * The AFML 4.5 average-uniqueness weight, stepped. Sixty consecutive rows of
 * the chosen set are laid out as spans (event bar to resolution bar); the
 * step slider picks the label to trace, and clicking a bar (in the span chart,
 * the term chart or the table) focuses one term of the sum, lighting it in
 * the typeset expansion and in every picture.
 */

import { useState } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { WINDOW_ROWS, gapsInWindow, uniquenessTrace, type LabelCatalogWindow } from "@shared/studies/label-catalog";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, SliderControl, TOOLTIP, Tex, fmt, fmtInt, fmtTime } from "@/studies/kit";
import { DataTable } from "./Table";

const FORMULA =
  "\\bar u_i \\;=\\; \\frac{1}{t_{i,1}-t_{i,0}+1}\\sum_{t=t_{i,0}}^{t_{i,1}} \\frac{1}{c_t}, \\qquad c_t \\;=\\; \\#\\{\\, j : t_{j,0} \\le t \\le t_{j,1} \\,\\}";
const EXPANDED_TERMS_SHOWN = 24;

function SpanChart({ spans, chosen, focusBar, onFocus }: {
  spans: Array<{ position: number; eventBar: number; resolutionBar: number }>;
  chosen: number;
  focusBar: number;
  onFocus: (bar: number) => void;
}) {
  const lastBar = Math.max(WINDOW_ROWS, ...spans.map((span) => span.resolutionBar)) + 1;
  const rowHeight = 4;
  const height = spans.length * rowHeight + 22;
  const width = 1000;
  const xOf = (bar: number) => 30 + (bar / lastBar) * (width - 40);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" style={{ height: Math.max(160, height) }} role="img" aria-label="Label spans in the window">
      {spans.map((span) => {
        const covers = span.eventBar <= focusBar && span.resolutionBar >= focusBar;
        const isChosen = span.position === chosen;
        const color = isChosen ? OKABE.orange : covers ? OKABE.sky : "#52525b";
        return (
          <g key={span.position}>
            <line x1={xOf(span.eventBar)} x2={xOf(span.resolutionBar + 1)} y1={span.position * rowHeight + 4} y2={span.position * rowHeight + 4} stroke={color} strokeWidth={isChosen ? 3.5 : 2.2} />
            <title>{`row ${span.position}: bars ${span.eventBar} to ${span.resolutionBar}${covers ? ` · covers bar ${focusBar}` : ""}`}</title>
          </g>
        );
      })}
      <line x1={xOf(focusBar + 0.5)} x2={xOf(focusBar + 0.5)} y1={0} y2={spans.length * rowHeight + 6} stroke={OKABE.purple} strokeWidth={2} />
      {Array.from({ length: lastBar }, (_, bar) => (
        <rect key={bar} x={xOf(bar)} y={0} width={xOf(bar + 1) - xOf(bar)} height={spans.length * rowHeight + 8} fill="transparent" onClick={() => onFocus(bar)} style={{ cursor: "pointer" }}>
          <title>{`bar t = ${bar}`}</title>
        </rect>
      ))}
      {[0, 10, 20, 30, 40, 50, 60, 70, 80].filter((bar) => bar < lastBar).map((bar) => (
        <text key={bar} x={xOf(bar)} y={height - 4} fontSize={11} fill="#a1a1aa" textAnchor="middle">{bar}</text>
      ))}
    </svg>
  );
}

export function UniquenessStepper({
  body, windowStart, step, onWindowStart, onStep,
}: {
  body: LabelCatalogWindow | undefined;
  windowStart: number;
  step: number;
  onWindowStart: (value: number) => void;
  onStep: (value: number) => void;
}) {
  const [focus, setFocus] = useState<number | null>(null);
  const windowRows = body?.window ?? [];
  const trace = uniquenessTrace(windowRows, step);
  const maximumStart = Math.max(0, (body?.rows ?? 0) - WINDOW_ROWS);
  if (!body || !trace) {
    return <p className="text-xs text-neutral-500">No rows in this window.</p>;
  }
  const focusBar = focus !== null && focus >= trace.eventBar && focus <= trace.resolutionBar ? focus : trace.eventBar;
  const focusTerm = trace.terms.find((term) => term.bar === focusBar) ?? trace.terms[0]!;
  const chosenRow = windowRows[trace.position]!;
  const gaps = gapsInWindow(windowRows, body.timeframeMinutes);

  const shownTerms = trace.terms.slice(0, EXPANDED_TERMS_SHOWN);
  const expansion =
    shownTerms
      .map((term) => {
        const fraction = term.concurrency > 0 ? `\\tfrac{1}{${term.concurrency}}` : "0";
        return term.bar === focusBar ? `\\textcolor{#CC79A7}{\\boldsymbol{${fraction}}}` : fraction;
      })
      .join(" + ") + (trace.terms.length > EXPANDED_TERMS_SHOWN ? " + \\cdots" : "");
  const expansionTex = `\\bar u_{${chosenRow.rowIndex}} = \\frac{1}{${trace.spanLength}}\\left(${expansion}\\right) = \\frac{${fmt(trace.runningSum, 4)}}{${trace.spanLength}} = ${fmt(trace.estimate, 4)}`;

  const termData = trace.terms.map((term) => ({ ...term, reciprocalShown: term.reciprocal ?? 0 }));

  return (
    <div className="space-y-3">
      <ControlBar>
        <SliderControl
          label="First row of the window"
          value={Math.min(windowStart, maximumStart)}
          min={0}
          max={Math.max(1, maximumStart)}
          onChange={onWindowStart}
          format={(value) => fmtInt(value)}
          hint="Row index in the chosen set, ordered by time"
        />
        <SliderControl label="Label to trace (step)" value={trace.position} min={0} max={Math.max(1, windowRows.length - 1)} onChange={onStep} />
        <div className="flex gap-1 pb-0.5">
          <button type="button" onClick={() => onStep(Math.max(0, trace.position - 1))} className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-neutral-500">◀ previous label</button>
          <button type="button" onClick={() => onStep(Math.min(windowRows.length - 1, trace.position + 1))} className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-neutral-500">next label ▶</button>
          <button type="button" onClick={() => setFocus(Math.min(trace.resolutionBar, focusBar + 1))} className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-neutral-500">next term t ▶</button>
        </div>
      </ControlBar>

      <FormulaCard
        tex={FORMULA}
        caption="Average uniqueness of label i over its span (López de Prado, Advances in Financial Machine Learning, 4.5). Read left to right: the weight of label i is the average, over every bar its outcome depends on, of one over how many labels depend on that bar."
        symbols={[
          { tex: "i", name: "label index: the row being weighted (row index in the chosen set)", value: fmtInt(chosenRow.rowIndex) },
          { tex: "t_{i,0}", name: "event bar: the bar the label is computed from (timestamp), as a bar ordinal in the window", value: `${trace.eventBar} (${fmtTime(chosenRow.timestamp)})` },
          { tex: "t_{i,1}", name: "resolution bar: event bar + resolution_bars", value: `${trace.resolutionBar} (+${fmtInt(chosenRow.resolutionBars)} bars)` },
          { tex: "t", name: "the bar the sum is at (click a bar to move it)", value: String(focusBar) },
          { tex: "c_t", name: "concurrency: labels in the window whose span covers bar t, count", value: fmtInt(focusTerm.concurrency) },
          { tex: "\\tfrac{1}{c_t}", name: "this bar's share of label i", value: fmt(focusTerm.reciprocal, 4) },
          { tex: "\\sum", name: "sum over t from the event bar to the resolution bar; running total up to bar t", value: fmt(focusTerm.runningSum, 4) },
          { tex: "t_{i,1}-t_{i,0}+1", name: "span length, bars", value: fmtInt(trace.spanLength) },
          { tex: "\\bar u_i", name: "average uniqueness, fraction in (0, 1]: this window's estimate", value: fmt(trace.estimate, 4) },
          { tex: "\\bar u_i^{\\,\\text{landed}}", name: "sample_uniqueness_weight as landed (counts labels outside the window too)", value: fmt(trace.landedWeight, 4) },
        ]}
      />
      <div className="overflow-x-auto rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-neutral-100">
        <Tex source={expansionTex} display />
      </div>

      <Finding>
        Label at row <b>{fmtInt(chosenRow.rowIndex)}</b> ({fmtTime(chosenRow.timestamp)}), label {fmt(chosenRow.label, 0)}, resolves {fmtInt(chosenRow.resolutionBars)} bars later.
        Window estimate of ū = {fmt(trace.runningSum, 4)} / {trace.spanLength} = <b>{fmt(trace.estimate, 4)}</b>; landed sample_uniqueness_weight = <b>{fmt(trace.landedWeight, 4)}</b>.
        The landed value also counts labels that start before this sixty-row window, so near the window&apos;s left edge the window estimate runs high.
      </Finding>
      <p className="text-[11px] text-neutral-400">
        Bar ordinal = row index inside the window (the notebook&apos;s convention). It is exact where every bar has a row; here {gaps} of {Math.max(0, windowRows.length - 1)} steps between
        consecutive rows are longer than one {body.timeframeMinutes ?? "?"}-minute bar (a session gap, a filtered row or a sparse generator), and across those the row index undercounts bars.
      </p>

      <div className="grid gap-3 xl:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1 text-[11px] text-neutral-400">
            Spans in the window: <span style={{ color: OKABE.orange }}>━ label i</span> · <span style={{ color: OKABE.sky }}>━ covers bar t</span> · <span className="text-neutral-500">━ other</span> · <span style={{ color: OKABE.purple }}>│ bar t</span>
          </div>
          <SpanChart spans={trace.spans} chosen={trace.position} focusBar={focusBar} onFocus={setFocus} />
        </div>
        <div className="min-w-0">
          <div className="mb-1 text-[11px] text-neutral-400">Each term 1/c<sub>t</sub> (bars) and the running sum (line); click a bar to focus it</div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={termData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }} onClick={(state) => {
              const bar = (state as { activeLabel?: number | string } | null)?.activeLabel;
              if (bar !== undefined) setFocus(Number(bar));
            }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="bar" {...AXIS} />
              <YAxis yAxisId="term" {...AXIS} width={34} domain={[0, 1]} />
              <YAxis yAxisId="sum" orientation="right" {...AXIS} width={34} />
              <Tooltip
                {...TOOLTIP}
                formatter={(value: number, name: string) => [fmt(value, 4), name]}
                labelFormatter={(bar) => `bar t = ${bar}`}
              />
              <ReferenceLine yAxisId="term" x={focusBar} stroke={OKABE.purple} />
              <Bar yAxisId="term" dataKey="reciprocalShown" name="1 / c_t" isAnimationActive={false}>
                {termData.map((term) => (
                  <Cell key={term.bar} fill={term.bar === focusBar ? OKABE.purple : OKABE.sky} />
                ))}
              </Bar>
              <Line yAxisId="sum" dataKey="runningSum" name="running sum" stroke={OKABE.orange} dot={{ r: 2 }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <DataTable
        rows={trace.terms}
        rowKey={(term) => String(term.bar)}
        selectedKey={String(focusBar)}
        onRowClick={(term) => setFocus(term.bar)}
        pageSize={30}
        columns={[
          { key: "bar", label: "bar t", value: (term) => term.bar },
          { key: "concurrency", label: "c_t (labels covering t)", value: (term) => term.concurrency },
          { key: "reciprocal", label: "1 / c_t", value: (term) => term.reciprocal },
          { key: "runningSum", label: "running sum", value: (term) => term.runningSum },
        ]}
      />
    </div>
  );
}
