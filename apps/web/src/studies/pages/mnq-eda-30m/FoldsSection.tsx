/**
 * Section 10: the walk-forward folds generate_folds cuts, planned before a run is started.
 * An expanding window: training always starts at bar 0 and grows; each test window is
 * `foldMonths` long, `purgeBars` bars away from the training end. Blue solid is training,
 * orange hatched is test, and the grey gap between them is the purge. The fold indices are the
 * ones the trainers slice as [start, end); test windows include every bar stamped on their last
 * day, so neighbours overlap by a few bars. Through the notebook's own loader (history from
 * 2023-03) there is no fold at all: the first test month would start after the data ends.
 */

import { Finding, FormulaCard, ControlBar, OKABE, Section, SliderControl, Stat, StudyNotes, StudyState, fmt, fmtInt, fmtTime, useStudyControls } from "@/studies/kit";
import type { FoldsBody } from "@shared/studies/mnq-eda-30m";
import { dayOf } from "./format";
import { useSection, type SeriesChoice } from "./use";

function Gantt({ body }: { body: FoldsBody }) {
  const first = body.firstTimestamp as number;
  const last = body.lastTimestamp as number;
  const width = 900;
  const left = 62;
  const right = 12;
  const rowHeight = 30;
  const top = 26;
  const height = top + body.folds.length * rowHeight + 10;
  const x = (stamp: number) => left + ((stamp - first) / (last - first || 1)) * (width - left - right);
  const firstYear = new Date(first).getUTCFullYear();
  const lastYear = new Date(last).getUTCFullYear();
  const years: number[] = [];
  for (let year = firstYear + 1; year <= lastYear; year += 1) years.push(year);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Walk-forward fold timeline">
      <defs>
        <pattern id="mnq-test-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill={OKABE.orange} />
          <line x1="0" y1="0" x2="0" y2="6" stroke="#000" strokeWidth="1.6" />
        </pattern>
      </defs>
      {years.map((year) => {
        const position = x(Date.UTC(year, 0, 1));
        return (
          <g key={year}>
            <line x1={position} y1={top - 6} x2={position} y2={height - 6} stroke="#262626" />
            <text x={position} y={top - 10} fontSize="10" textAnchor="middle" fill="#a3a3a3">{year}</text>
          </g>
        );
      })}
      {body.folds.map((fold, index) => {
        const y = top + index * rowHeight;
        return (
          <g key={fold.fold}>
            <text x={left - 8} y={y + 15} fontSize="10" textAnchor="end" fill="#d4d4d4">fold {fold.fold}</text>
            <rect x={x(fold.trainStart)} y={y + 4} width={Math.max(1, x(fold.trainEnd) - x(fold.trainStart))} height={20} fill={OKABE.blue}>
              <title>{`train ${dayOf(fold.trainStart)} to ${dayOf(fold.trainEnd)}: ${fmtInt(fold.trainCount)} bars`}</title>
            </rect>
            <rect x={x(fold.trainEnd)} y={y + 13} width={Math.max(1, x(fold.testStart) - x(fold.trainEnd))} height={2} fill="#737373">
              <title>{`purge: ${fmtInt(fold.purgedBars)} bars`}</title>
            </rect>
            <rect x={x(fold.testStart)} y={y + 4} width={Math.max(2, x(fold.testEnd) - x(fold.testStart))} height={20} fill="url(#mnq-test-hatch)" stroke={OKABE.orange}>
              <title>{`test ${dayOf(fold.testStart)} to ${dayOf(fold.testEnd)}: ${fmtInt(fold.testCount)} bars`}</title>
            </rect>
          </g>
        );
      })}
    </svg>
  );
}

export function FoldsSection({ choice }: { choice: SeriesChoice }) {
  const [controls, set, reset] = useStudyControls({ foldMonths: 12, purgeBars: 240, minTrainMonths: 24 });
  const { query, notes, body, unavailable } = useSection<FoldsBody>("folds", choice, controls);
  const barsTested = body ? body.folds.reduce((sum, fold) => sum + fold.testCount, 0) : 0;
  const overlap = body ? body.folds.reduce((sum, fold) => sum + fold.overlapWithNext, 0) : 0;

  return (
    <Section title="10 · Walk-forward folds" question="Which bars does each fold train on and test on, before a run is started?">
      <div className="space-y-3">
        <ControlBar onReset={reset}>
          <SliderControl label="Test window" value={controls.foldMonths} min={1} max={36} onChange={(v) => set("foldMonths", v)} format={(v) => `${v} months`} />
          <SliderControl label="Purge" value={controls.purgeBars} min={0} max={2000} step={10} onChange={(v) => set("purgeBars", v)} format={(v) => `${v} bars`} hint="Bars between the training end and the test start; it must be at least the label horizon. The notebook used 5 days x 48 bars = 240" />
          <SliderControl label="Minimum training" value={controls.minTrainMonths} min={1} max={72} onChange={(v) => set("minTrainMonths", v)} format={(v) => `${v} months`} hint="Calendar months before the first test window opens" />
        </ControlBar>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={notes} />
          {unavailable || !body ? (
            <p className="text-xs text-neutral-500">The bars are not in the lake for this selection.</p>
          ) : body.folds.length === 0 ? (
            <Finding>
              No fold fits: the series runs {fmtTime(body.firstTimestamp)} to {fmtTime(body.lastTimestamp)} ({fmtInt(body.barCount)} bars), the first test month would open {controls.minTrainMonths} months after the first bar and close {controls.foldMonths} months after that, which is beyond the last bar.
              {choice.source === "notebook" ? " This is what the notebook's own loader finds today: its history starts in 2023-03." : " Shorten the training minimum or the test window."}
            </Finding>
          ) : (
            <>
              <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
                <Stat label="Folds" value={fmtInt(body.folds.length)} />
                <Stat label="Bars tested" value={fmtInt(barsTested)} hint="sum of the test windows" />
                <Stat label="Test bars counted twice" value={fmtInt(overlap)} hint="shared between a fold's test window and the next one's" />
                <Stat label="Bars between train and test" value={fmtInt(body.folds[0]?.purgedBars)} hint={`the purge is ${body.purgeBars}; the trainer's train end is exclusive, so one more bar is unused`} />
              </div>
              <Finding>
                {body.folds.length} folds over {fmtTime(body.firstTimestamp)} to {fmtTime(body.lastTimestamp)}: training grows from {fmtInt(body.folds[0]?.trainCount)} to {fmtInt(body.folds[body.folds.length - 1]?.trainCount)} bars, each test window holds about {fmtInt(barsTested / body.folds.length)}. Adjacent test windows share {fmtInt(overlap)} bars in total because each includes every bar stamped on its boundary day (date-prefix comparison in generate_folds); fix that before pooling folds into one bootstrap. The gap between train and test is {fmtInt(body.folds[0]?.purgedBars)} bars, one more than the purge setting.
              </Finding>
              <div className="min-w-0">
                <Gantt body={body} />
                <p className="text-[11px] text-neutral-400">
                  <span style={{ color: OKABE.blue }}>■ train (solid blue)</span> · <span style={{ color: OKABE.orange }}>▨ test (hatched orange)</span> · grey rule: the purge. Hover a bar for its dates and bars.
                </p>
              </div>
              <div className="overflow-x-auto rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
                <table className="w-full text-[11px] font-mono tnum">
                  <thead>
                    <tr className="text-left text-neutral-500">
                      <th className="font-normal">fold</th>
                      <th className="font-normal">train start</th>
                      <th className="font-normal">train end</th>
                      <th className="font-normal">test start</th>
                      <th className="font-normal">test end</th>
                      <th className="text-right font-normal">train bars</th>
                      <th className="text-right font-normal">test bars</th>
                      <th className="text-right font-normal">purged</th>
                      <th className="text-right font-normal">overlap next</th>
                    </tr>
                  </thead>
                  <tbody>
                    {body.folds.map((fold) => (
                      <tr key={fold.fold} className="border-t border-neutral-900">
                        <td className="py-0.5 text-neutral-300">{fold.fold}</td>
                        <td>{dayOf(fold.trainStart)}</td>
                        <td>{dayOf(fold.trainEnd)}</td>
                        <td>{dayOf(fold.testStart)}</td>
                        <td>{dayOf(fold.testEnd)}</td>
                        <td className="text-right text-neutral-100">{fmtInt(fold.trainCount)}</td>
                        <td className="text-right text-neutral-100">{fmtInt(fold.testCount)}</td>
                        <td className="text-right">{fmtInt(fold.purgedBars)}</td>
                        <td className="text-right">{fmtInt(fold.overlapWithNext)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-[10px] text-neutral-500">Bar indices are half-open, [start, end), as the trainers and the notebook slice them. Dates are the lake&apos;s Pacific wall-clock stamps.</p>
              </div>
              <FormulaCard
                tex={String.raw`\text{train}_k=[0,\;s_k-P-1),\qquad \text{test}_k=[s_k,\;e_k),\qquad s_{k+1}=\text{first bar of month}\left(m_0+M_{\min}+kM\right)`}
                caption="Expanding-window walk-forward with a purge. Each test window opens on the first day of a month; its end is the last bar stamped on the first day of the month M months later."
                symbols={[
                  { tex: "M", name: "test window length in months", value: fmtInt(body.foldMonths) },
                  { tex: "P", name: "purge in bars", value: fmtInt(body.purgeBars) },
                  { tex: String.raw`M_{\min}`, name: "minimum training span in months", value: fmtInt(body.minTrainMonths) },
                  { tex: "m_0", name: "month of the first bar", value: body.firstTimestamp ? fmtTime(body.firstTimestamp).slice(0, 7) : "—" },
                  { tex: "s_k", name: "index of fold k's first test bar", value: body.folds[0] ? fmtInt(body.folds[0].testStartIndex) + " (fold 1)" : "—" },
                  { tex: "K", name: "number of folds", value: fmt(body.folds.length, 0) },
                ]}
              />
            </>
          )}
        </StudyState>
      </div>
    </Section>
  );
}
