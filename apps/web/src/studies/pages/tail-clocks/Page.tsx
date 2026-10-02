/**
 * Tail clocks. The same 1-minute futures data sampled by the calendar, by
 * contracts and by dollars, with the same bar count: how many of the fat
 * tails are the calendar's own doing? The numbers come from one request
 * (root, bar size, sigma); which clocks are drawn, and where the two-week
 * activity window sits, are client-side controls.
 */

import {
  ColumnGrid, ControlBar, Finding, Section, SegmentControl, SelectControl, SliderControl, Stat, StudyNotes, StudyState, SummaryTable,
  SwitchControl, fmt, fmtInt, fmtTime, useStudyControls, useStudyQuery, OKABE,
} from "@/studies/kit";
import {
  ACTIVITY_WINDOW_HOURS, BAR_SIZES, CLOCK_NAMES, activityWindowStart, consequenceNumbers, ruleSaysOneEvery, seenOneBarEvery,
  type BarSize, type ClockName, type ClockSeries, type ExtremeBar, type TailClocksBody,
} from "@shared/studies/tail-clocks";
import { ActivityChart, CountBars, ExtremesScatter, HourOfDayChart, LadderChart, TailHistogram, VolumeHistogram, activityWindow } from "./Charts";
import { CLOCK_STYLE, ClockKey } from "./clocks";
import { CumulativeChart, Formulas } from "./Formulas";

const DEFAULTS = { root: "MNQ", size: "4h", sigma: 4, clocks: "time,volume", activityPosition: 50 };

function parseClocks(raw: string): ClockName[] {
  const chosen = CLOCK_NAMES.filter((clock) => raw.split(",").includes(clock));
  return chosen.length > 0 ? chosen : ["time"];
}

function sigmaLabel(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}σ`;
}

function clockList(clocks: readonly ClockName[]): string {
  return clocks.map((clock) => CLOCK_STYLE[clock].label).join(", ");
}

function TableHead({ children }: { children: string }) {
  return <th className="px-1.5 py-1 text-right font-normal text-neutral-500">{children}</th>;
}

function StatisticsTable({ series, size, sigma }: { series: ClockSeries[]; size: string; sigma: number }) {
  const gate = sigmaLabel(sigma);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-[11px] font-mono tnum">
        <thead>
          <tr className="border-b border-neutral-800">
            <th className="px-1.5 py-1 text-left font-normal text-neutral-500">clock</th>
            <TableHead>bar size</TableHead>
            <TableHead>bars</TableHead>
            <TableHead>excess kurtosis</TableHead>
            <TableHead>skewness</TableHead>
            <TableHead>{`observed beyond ${gate}`}</TableHead>
            <TableHead>{`rule predicts beyond ${gate}`}</TableHead>
            <TableHead>observed ÷ predicted</TableHead>
            <TableHead>seen one bar every</TableHead>
            <TableHead>rule says one every</TableHead>
            <TableHead>biggest move (σ)</TableHead>
          </tr>
        </thead>
        <tbody>
          {series.map((entry) => {
            const style = CLOCK_STYLE[entry.clock];
            return (
              <tr key={entry.clock} className="border-b border-neutral-900">
                <td className="px-1.5 py-1 text-left" style={{ color: style.color }}>{style.glyph} {style.label}</td>
                <td className="px-1.5 py-1 text-right text-neutral-300">{size}</td>
                <td className="px-1.5 py-1 text-right text-neutral-200">{fmtInt(entry.returnCount)}</td>
                <td className="px-1.5 py-1 text-right text-neutral-200">{fmt(entry.standardised.kurtosis, 3)}</td>
                <td className="px-1.5 py-1 text-right text-neutral-200">{fmt(entry.standardised.skewness, 3)}</td>
                <td className="px-1.5 py-1 text-right text-neutral-100">{fmtInt(entry.beyond.observed)}</td>
                <td className="px-1.5 py-1 text-right text-neutral-200">{fmt(entry.beyond.predicted, 2)}</td>
                <td className="px-1.5 py-1 text-right text-neutral-100">{fmt(entry.beyond.ratio, 1)}</td>
                <td className="px-1.5 py-1 text-right text-neutral-200">{fmtInt(seenOneBarEvery(entry.returnCount, entry.beyond.observed))}</td>
                <td className="px-1.5 py-1 text-right text-neutral-200">{fmtInt(ruleSaysOneEvery(sigma))}</td>
                <td className="px-1.5 py-1 text-right text-neutral-200">{fmt(entry.biggestMoveSigma, 1)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PivotTable({ title, keyLabel, keys, clocks, counts }: { title: string; keyLabel: string; keys: number[]; clocks: ClockName[]; counts: Map<string, number> }) {
  const totals = new Map(clocks.map((clock) => [clock, keys.reduce((sum, key) => sum + (counts.get(`${clock}:${key}`) ?? 0), 0)]));
  return (
    <div className="min-w-0 space-y-1">
      <h4 className="text-[11px] font-semibold text-neutral-200">{title}</h4>
      <div className="max-h-64 overflow-auto rounded border border-neutral-800">
        <table className="w-full text-[11px] font-mono tnum">
          <thead className="sticky top-0 bg-neutral-950">
            <tr className="border-b border-neutral-800">
              <th className="px-1.5 py-1 text-left font-normal text-neutral-500">{keyLabel}</th>
              {clocks.map((clock) => (
                <th key={clock} className="px-1.5 py-1 text-right font-normal" style={{ color: CLOCK_STYLE[clock].color }}>{CLOCK_STYLE[clock].glyph} {clock} bars</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key} className="border-b border-neutral-900">
                <td className="px-1.5 py-0.5 text-left text-neutral-300">{key}</td>
                {clocks.map((clock) => {
                  const count = counts.get(`${clock}:${key}`) ?? 0;
                  const share = (totals.get(clock) ?? 0) > 0 ? count / (totals.get(clock) as number) : 0;
                  return (
                    <td key={clock} className="px-1.5 py-0.5 text-right text-neutral-200">
                      {fmtInt(count)} <span className="text-neutral-500">{count > 0 ? `${fmt(share * 100, 0)}%` : ""}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopTable({ clock, bars }: { clock: ClockName; bars: ExtremeBar[] }) {
  const style = CLOCK_STYLE[clock];
  return (
    <div className="min-w-0 space-y-1">
      <h4 className="text-[11px] font-semibold" style={{ color: style.color }}>{style.glyph} {style.label}: the ten biggest</h4>
      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full text-[11px] font-mono tnum">
          <thead>
            <tr className="border-b border-neutral-800 text-neutral-500">
              <th className="px-1.5 py-1 text-left font-normal">bar starts (stamped)</th>
              <TableHead>move (σ)</TableHead>
              <TableHead>move (%)</TableHead>
              <TableHead>hour</TableHead>
              <TableHead>year</TableHead>
            </tr>
          </thead>
          <tbody>
            {bars.length === 0 && (
              <tr><td colSpan={5} className="px-1.5 py-2 text-center text-neutral-500">nothing past this threshold</td></tr>
            )}
            {bars.map((bar) => (
              <tr key={`${bar.timestamp}`} className="border-b border-neutral-900">
                <td className="px-1.5 py-0.5 text-left text-neutral-300">{fmtTime(bar.timestamp)}</td>
                <td className="px-1.5 py-0.5 text-right text-neutral-100">{bar.standardisedReturn >= 0 ? "▲" : "▼"} {fmt(Math.abs(bar.standardisedReturn), 2)}</td>
                <td className="px-1.5 py-0.5 text-right text-neutral-200">{fmt(bar.percentReturn, 2)}</td>
                <td className="px-1.5 py-0.5 text-right text-neutral-200">{bar.hour}</td>
                <td className="px-1.5 py-0.5 text-right text-neutral-200">{bar.year}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function barSeconds(size: BarSize): number {
  return { "15m": 900, "1h": 3600, "4h": 14_400, "1d": 86_400 }[size];
}

export default function Page() {
  const [controls, set, reset] = useStudyControls(DEFAULTS);
  const query = useStudyQuery<TailClocksBody>("tail-clocks", { root: controls.root, size: controls.size, sigma: controls.sigma });
  const body = query.data?.data;
  const clocks = parseClocks(controls.clocks);
  const size = (BAR_SIZES as readonly string[]).includes(controls.size) ? (controls.size as BarSize) : "4h";

  const toggleClock = (clock: ClockName, on: boolean) => {
    const next = CLOCK_NAMES.filter((name) => (name === clock ? on : clocks.includes(name)));
    if (next.length > 0) set("clocks", next.join(","));
  };

  const series = (body?.series ?? []).filter((entry) => clocks.includes(entry.clock));
  const allSeries = body?.series ?? [];
  const extremes = (body?.extremes ?? []).filter((bar) => clocks.includes(bar.clock));
  const sigma = body?.selection.sigma ?? controls.sigma;
  const timeSeries = allSeries.find((entry) => entry.clock === "time");
  const consequence = consequenceNumbers(timeSeries);
  const visibleClocks = series.map((entry) => entry.clock);

  const activity = body?.activity;
  const windowStart = activity ? activityWindowStart(activity.hourCount, controls.activityPosition) : 0;
  const window = activity ? activityWindow(activity.hours, windowStart, ACTIVITY_WINDOW_HOURS) : null;

  const hourKeys = [...new Set((body?.countByHour ?? []).filter((row) => clocks.includes(row.clock)).map((row) => row.hour))].sort((a, b) => a - b);
  const hourCounts = new Map((body?.countByHour ?? []).map((row) => [`${row.clock}:${row.hour}`, row.count]));
  const yearKeys = [...new Set((body?.countByYear ?? []).filter((row) => clocks.includes(row.clock)).map((row) => row.year))].sort((a, b) => a - b);
  const yearCounts = new Map((body?.countByYear ?? []).map((row) => [`${row.clock}:${row.year}`, row.count]));
  const hourRows = hourKeys.map((hour) => ({ hour, ...Object.fromEntries(visibleClocks.map((clock) => [clock, hourCounts.get(`${clock}:${hour}`) ?? 0])) }));
  const yearRows = yearKeys.map((year) => ({ year, ...Object.fromEntries(visibleClocks.map((clock) => [clock, yearCounts.get(`${clock}:${year}`) ?? 0])) }));

  const bucketsPerDay = 86_400 / barSeconds(size);
  const timeHours = (body?.countByHour ?? []).filter((row) => row.clock === "time");
  const timeTotal = timeHours.reduce((sum, row) => sum + row.count, 0);
  const busiestHour = timeHours.reduce<{ hour: number; count: number } | null>((best, row) => (best === null || row.count > best.count ? row : best), null);

  const oneMinuteBars = body?.roots.find((entry) => entry.root === controls.root)?.oneMinuteBarCount ?? null;
  const empty = !query.isLoading && (body?.series.length ?? 0) === 0;

  return (
    <div className="space-y-3">
      <div className="space-y-1 text-[12px] leading-relaxed text-neutral-300">
        <p>
          A <b>tail</b> is the rare big move: most bar returns pile up near zero and a few sit far out at the edges. <b>Fat</b> means the big moves
          happen far more often than a bell curve allows. The claim here is that much of that is an artifact of cutting bars on the clock,
          because an hour of the earth's rotation is not a constant amount of trading. Sample every <i>N contracts</i> or <i>N dollars</i> and
          much of it disappears: same data, same number of bars, a different rule for where a bar ends.
        </p>
      </div>

      <ControlBar onReset={reset}>
        <SelectControl
          label="Instrument"
          value={controls.root}
          options={(body?.roots.length ? body.roots : [{ root: controls.root, oneMinuteBarCount: 0 }]).map((entry) => ({ value: entry.root, label: entry.oneMinuteBarCount ? `${entry.root} (${fmtInt(entry.oneMinuteBarCount)} one-minute bars)` : entry.root }))}
          onChange={(value) => set("root", value)}
          hint="Front-month, ratio back-adjusted 1-minute bars of one futures root"
        />
        <SegmentControl label="Bar size (equivalent)" value={size} options={BAR_SIZES.map((value) => ({ value, label: value }))} onChange={(value) => set("size", value)} hint="The calendar bar length; the activity clocks are calibrated to produce the same number of bars" />
        <SliderControl label="Call it extreme beyond" value={controls.sigma} min={2} max={6} step={0.5} onChange={(value) => set("sigma", value)} format={sigmaLabel} hint="The gate, in standard deviations, that counts a bar as extreme" />
        {CLOCK_NAMES.map((clock) => (
          <SwitchControl key={clock} label={`${CLOCK_STYLE[clock].glyph} ${CLOCK_STYLE[clock].label}`} checked={clocks.includes(clock)} onChange={(on) => toggleClock(clock, on)} hint={`Bars cut ${CLOCK_STYLE[clock].rule}`} />
        ))}
      </ControlBar>

      <StudyState isLoading={query.isLoading && !body} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {empty ? (
          <p className="rounded-md border border-neutral-800 px-3 py-6 text-center text-xs text-neutral-400">
            No landed series for {controls.root} at {controls.size}. Run <code>packages/ml-engine/src/studies/tail_clocks/build.py</code> to land them.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <Stat label="One-minute bars" value={fmtInt(oneMinuteBars)} hint="Every front-month 1-minute bar of the root, before any clock" />
              <Stat label={`${size} bars (calendar)`} value={fmtInt(timeSeries?.producedBarCount)} hint="The bar count the volume and dollar clocks are calibrated to" />
              <Stat label="Development bars" value={fmtInt(timeSeries?.developmentBarCount)} hint="The first 80% of each series; the last fifth stays sealed" />
              <Stat label={`Calendar bars past ${sigmaLabel(sigma)}`} value={fmtInt(timeSeries?.beyond.observed)} tone={OKABE.blue} hint={`A bell curve predicts ${fmt(timeSeries?.beyond.predicted, 2)}`} />
            </div>

            <Section title="The numbers" question={`Every clock on the same ${controls.root} data at ${size}, counted against the 68-95-99.7 rule at ${sigmaLabel(sigma)}.`}>
              <StatisticsTable series={series} size={size} sigma={sigma} />
              <Finding>
                <b>observed ÷ predicted</b> is the observed count divided by what the bell curve predicts: 1 would mean the rule was right, below 1 means fewer
                moves than a bell curve, above means more.
                {series.length > 0 && ` At ${sigmaLabel(sigma)}: ${series.map((entry) => `${CLOCK_STYLE[entry.clock].label} ${fmt(entry.beyond.ratio, 1)}×`).join(", ")}.`}
              </Finding>
              <div className="mt-2 grid gap-3 xl:grid-cols-2">
                <div className="min-w-0 space-y-1">
                  <h4 className="text-[11px] font-semibold text-neutral-200">Standardised bar return (σ): the eight numbers</h4>
                  <SummaryTable columns={series.map((entry) => ({ name: `${CLOCK_STYLE[entry.clock].glyph} ${entry.clock}`, summary: entry.standardised, decimals: 4 }))} />
                </div>
                <div className="min-w-0 space-y-1">
                  <h4 className="text-[11px] font-semibold text-neutral-200">Bar return (percent): the eight numbers</h4>
                  <SummaryTable columns={series.map((entry) => ({ name: `${CLOCK_STYLE[entry.clock].glyph} ${entry.clock}`, summary: entry.percent, decimals: 4 }))} />
                </div>
              </div>
              <p className="mt-1 text-[10px] text-neutral-500">Skewness and kurtosis here are population moments (scipy's defaults), so the excess kurtosis of a bell curve is 0. The standardised mean is 0 and its standard deviation √((n−1)/n) by construction.</p>
            </Section>

            <Section title="WHY: every one of these bars is the same length of time, and they are not the same measurement" question="Contracts traded per calendar hour, a fortnight scrubbed through the development span, with the quietest and the busiest hour.">
              <ControlBar>
                <SliderControl label="Where in history" value={controls.activityPosition} min={0} max={100} step={1} onChange={(value) => set("activityPosition", value)} format={(value) => `${value}%`} hint="The two-week window starts this far through the development span; 50% is the notebook's middle" />
                <span className="self-center font-mono text-[11px] text-neutral-400">
                  {window && window.rows.length > 0 ? `${fmtTime(window.rows[0]?.timestamp)} to ${fmtTime(window.rows[window.rows.length - 1]?.timestamp)} (stamped)` : ""}
                </span>
              </ControlBar>
              {window && <ActivityChart rows={window.rows} summary={window.summary} />}
              {window?.summary && (
                <Finding>
                  Quietest hour {fmtInt(window.summary.quietest)} contracts, busiest {fmtInt(window.summary.busiest)}, a ratio of {fmtInt(window.summary.busiest / Math.max(window.summary.quietest, 1))}×
                  (median {fmtInt(window.summary.median)}). The line breaks across the weekend halt rather than joining Friday's close to Sunday's open.
                </Finding>
              )}
              {activity && (
                <div className="mt-2 grid gap-3 xl:grid-cols-2">
                  <div className="min-w-0 space-y-1">
                    <h4 className="text-[11px] font-semibold text-neutral-200">The median hour, by hour of the day</h4>
                    <HourOfDayChart rows={activity.hourOfDayMedian} />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <h4 className="text-[11px] font-semibold text-neutral-200">All {fmtInt(activity.hourCount)} hours, by size</h4>
                    <VolumeHistogram bins={activity.logHistogram} />
                  </div>
                  <div className="xl:col-span-2">
                    <h4 className="mb-1 text-[11px] font-semibold text-neutral-200">Contracts per hour over the development span: the eight numbers</h4>
                    <SummaryTable columns={[{ name: "contracts per hour", summary: activity.summary, decimals: 1 }]} />
                  </div>
                </div>
              )}
            </Section>

            <Section title="THE SHAPE: moves seen, divided by moves predicted" question="A fat-tailed series has too few moderate moves and too many extreme ones, so the ratio starts below 1 and crosses it.">
              <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1">{visibleClocks.map((clock) => <ClockKey key={clock} clock={clock} />)}</div>
              <LadderChart series={series} />
              {timeSeries && (
                <Finding>
                  The calendar sits at {fmt(timeSeries.gates[0]?.ratio, 2)}× the bell curve at 1σ (too few moderate moves) and climbs to {fmt(timeSeries.beyond.ratio, 1)}× at {sigmaLabel(sigma)}.
                  A distribution that really were Gaussian would sit flat on the line at every gate.
                </Finding>
              )}
            </Section>

            <Section title="WHAT: a fat tail is the histogram sitting above the bell curve out in the wings" question={`Bar returns in standard deviations on a log axis, against the standard normal; the shaded wings are beyond ±${sigmaLabel(sigma)}.`}>
              <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1">
                {visibleClocks.map((clock) => <ClockKey key={clock} clock={clock} />)}
                <span className="inline-flex items-center gap-1.5 text-[11px] text-neutral-300">
                  <svg width="34" height="12" aria-hidden="true"><line x1="0" x2="30" y1="6" y2="6" stroke="#8a8a8a" strokeWidth="1.4" strokeDasharray="1 3" /></svg>
                  the bell curve says this
                </span>
              </div>
              <TailHistogram series={series} sigma={sigma} />
              <Finding>
                Excess kurtosis: {series.map((entry) => `${CLOCK_STYLE[entry.clock].label} ${fmt(entry.standardised.kurtosis, 2)}`).join(", ")} (0 for a bell curve).
                {timeSeries && ` The biggest calendar move is ${fmt(timeSeries.biggestMoveSigma, 1)}σ.`}
              </Finding>
            </Section>

            <Section
              title={`SO WHAT: every bar beyond ${sigmaLabel(sigma)}, plotted where it happened`}
              question={timeSeries ? `A bell curve says about ${fmt(timeSeries.beyond.predicted, 1)} such bars in ${fmtInt(timeSeries.returnCount)}. Count the dots.` : undefined}
            >
              <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1">
                {series.map((entry) => <ClockKey key={entry.clock} clock={entry.clock} suffix={`${fmtInt(entry.beyond.observed)}`} />)}
              </div>
              <ExtremesScatter series={series} extremes={extremes} sigma={sigma} />
              <CumulativeChart series={series} extremes={extremes} sigma={sigma} />
            </Section>

            <Section title={`The bars past ${sigmaLabel(sigma)}: when they start`} question="If extremes were a property of the market rather than of the sampling, they would not care which bucket of the day they landed in, so the hour is the test.">
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="min-w-0 space-y-1">
                  <h4 className="text-[11px] font-semibold text-neutral-200">Which hour of the day they start in (Pacific wall clock; the lake stamps futures in Pacific time as UTC)</h4>
                  <CountBars rows={hourRows as Array<Record<string, number>>} keyName="hour" clocks={visibleClocks} label="stamped hour of the bar's start" />
                </div>
                <div className="min-w-0 space-y-1">
                  <h4 className="text-[11px] font-semibold text-neutral-200">Which year</h4>
                  <CountBars rows={yearRows as Array<Record<string, number>>} keyName="year" clocks={visibleClocks} label="year" />
                </div>
              </div>
              {busiestHour && timeTotal > 0 && (
                <Finding>
                  A day holds {fmtInt(bucketsPerDay)} calendar bucket{bucketsPerDay === 1 ? "" : "s"} of {size}, so an even spread would put about {fmt(100 / bucketsPerDay, 0)}% in each. The calendar's busiest start hour is {busiestHour.hour}:00 with {fmt((100 * busiestHour.count) / timeTotal, 0)}% of its {fmtInt(timeTotal)} extreme bars.
                </Finding>
              )}
              <div className="mt-2 grid gap-3 xl:grid-cols-2">
                <PivotTable title="Counts by hour" keyLabel="hour" keys={hourKeys} clocks={visibleClocks} counts={hourCounts} />
                <PivotTable title="Counts by year" keyLabel="year" keys={yearKeys} clocks={visibleClocks} counts={yearCounts} />
              </div>
              <div className="mt-2 grid gap-3 xl:grid-cols-2">
                {visibleClocks.map((clock) => (
                  <TopTable key={clock} clock={clock} bars={(body?.extremes ?? []).filter((bar) => bar.clock === clock).slice(0, 10)} />
                ))}
              </div>
            </Section>

            <Section title="Why this matters for a model" question="Four consequences that are already load-bearing in this repo.">
              <ol className="max-w-prose list-decimal space-y-2 pl-5 text-[12px] leading-relaxed text-neutral-300">
                <li><b>Every performance number is built on a standard deviation.</b> Sharpe is mean divided by it; confidence intervals are multiples of it; the break-even hit rate is cost divided by twice the barrier times it. When a handful of monster bars set that number, all of them wobble, and the formula prints the same value either way without warning you.</li>
                <li><b>Triple-barrier labels are placed at ±k sigma.</b> If sigma jumps around, "2 sigma" is a different distance in March than in October and the label stops measuring a consistent event.</li>
                <li><b>Position sizing.</b> Size off a bell curve and you have planned for {consequence ? `the ${fmt(consequence.predicted, 1)} extreme bars, not the ${fmtInt(consequence.observed)}` : "the few extreme bars the bell curve predicts, not the many that happen"}. That gap is the difference between a drawdown you survive and one you do not.</li>
                <li><b>Model fitting.</b> Anything minimising squared error is dominated by its largest residuals, so {consequence ? `with ${fmtInt(consequence.observed)} monsters in ${fmtInt(consequence.bars)} bars the model spends its capacity on ${fmt(consequence.shareOfBars * 100, 1)}% of the data` : "a few monsters take the model's capacity"}.</li>
              </ol>
              {consequence && <p className="mt-1 text-[10px] text-neutral-500">Numbers are the calendar clock at {sigmaLabel(consequence.sigma)} on {controls.root} {size} bars.</p>}
              <Finding>
                The through-line: fat tails are the arithmetic signature of <i>some bars contain more market than others</i>. The bell curve assumes every bar is an equal draw. It is not, and forcing a dead overnight hour and a Fed release into the same histogram is what manufactures the monsters.
              </Finding>
            </Section>

            <Formulas series={series} sigma={sigma} size={size} oneMinuteBarCount={oneMinuteBars} />

            <Section title="Every column, graphed" question={`The frames behind the pictures: the bars past ${sigmaLabel(sigma)} (largest ${fmtInt(body?.extremesCapPerClock)} per clock), and the hourly contract counts.`}>
              <div className="space-y-4">
                <ColumnGrid
                  title={`Bars past ${sigmaLabel(sigma)} (${clockList(visibleClocks)})`}
                  rows={extremes.map((bar) => ({ standardisedReturn: bar.standardisedReturn, absoluteStandardisedReturn: Math.abs(bar.standardisedReturn), percentReturn: bar.percentReturn, startHour: bar.hour, startYear: bar.year }))}
                />
                {activity && (
                  <ColumnGrid
                    title="Contracts per calendar hour (development span)"
                    rows={activity.hours.contracts.map((contracts, index) => ({ contractsTraded: contracts, startHour: new Date(activity.hours.timestamps[index] as number).getUTCHours() }))}
                  />
                )}
              </div>
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
