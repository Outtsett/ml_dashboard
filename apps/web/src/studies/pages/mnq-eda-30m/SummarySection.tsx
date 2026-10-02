/**
 * The page's opening: the series in numbers, which bars each source holds, and the notebook's
 * closing summary table with live values (its cells read "run cell 4", "run cell 12": it never
 * filled them in). Every row's implication is decided by the number beside it.
 */

import { Finding, OKABE, Section, Stat, StudyNotes, StudyState, fmt, fmtInt, fmtPercent, fmtTime } from "@/studies/kit";
import type { SummaryBody } from "@shared/studies/mnq-eda-30m";
import { pText, signed } from "./format";
import { useSection, type SeriesChoice } from "./use";

interface FindingRow {
  finding: string;
  value: string;
  implication: string;
}

function findings(body: SummaryBody): FindingRow[] {
  const series = body.series;
  const returns = body.returns;
  const band = body.confidenceBand;
  const lagOne = body.lagOneAutocorrelation;
  const lagOneSquared = body.lagOneSquaredAutocorrelation;
  const up = body.upShareHorizonOne;
  const rows: FindingRow[] = [];
  if (series) {
    rows.push({
      finding: "Bars",
      value: fmtInt(series.barCount),
      implication: `${fmtTime(series.firstTimestamp)} to ${fmtTime(series.lastTimestamp)}; about ${series.measuredBarsPerDay !== null ? fmt(series.measuredBarsPerDay, 0) : "—"} bars per calendar day against the ${series.nominalBarsPerDay} the notebook assumed.`,
    });
  }
  if (returns?.kurtosis !== null && returns?.kurtosis !== undefined) {
    rows.push({ finding: "Excess kurtosis", value: fmt(returns.kurtosis, 2), implication: returns.kurtosis > 3 ? "Fat tails: clamping the model's inputs to ±5 is essential." : "Close to normal tails." });
  }
  if (lagOne !== null && band !== null) {
    const significant = Math.abs(lagOne) > band;
    rows.push({ finding: "Lag-1 ACF of returns", value: signed(lagOne, 4), implication: significant ? (lagOne < 0 ? "Outside the 95 % band, negative: mean reversion." : "Outside the 95 % band, positive: momentum.") : `Inside the ±${fmt(band, 4)} band: no linear signal at lag 1.` });
  }
  if (lagOneSquared !== null && band !== null) {
    rows.push({ finding: "Lag-1 ACF of squared returns", value: signed(lagOneSquared, 4), implication: Math.abs(lagOneSquared) > band ? "Volatility clusters: the size of the next move is forecastable, its sign is not." : "No volatility clustering at lag 1." });
  }
  if (body.adfReturnsP !== null) {
    rows.push({ finding: "ADF p-value (returns)", value: pText(body.adfReturnsP), implication: body.adfReturnsP < 0.05 ? "Rejects the unit root: the returns are stationary." : "Cannot reject a unit root." });
  }
  if (body.kpssReturnsP !== null) {
    rows.push({ finding: "KPSS p-value (returns)", value: `≥ ${pText(body.kpssReturnsP)}`, implication: body.kpssReturnsP > 0.05 ? "Does not reject stationarity (statsmodels' table stops at 0.10, so the true p is larger)." : "Rejects stationarity." });
  }
  if (body.dayOfWeekKruskalP !== null) {
    rows.push({ finding: "Day-of-week Kruskal-Wallis p", value: pText(body.dayOfWeekKruskalP), implication: body.dayOfWeekKruskalP < 0.05 ? "A weekday effect in the bar returns." : "No weekday effect in the returns." });
  }
  if (up !== null) {
    const baseline = Math.max(up, 1 - up);
    rows.push({ finding: "Label balance (horizon 1, no flat zone)", value: `${fmtPercent(up, 2)} up`, implication: `A classifier has to beat ${fmtPercent(baseline, 2)}; ${Math.abs(up - 0.5) < 0.03 ? "the classes are close to balanced" : "the classes are imbalanced"}.` });
  }
  return rows;
}

export function SummarySection({ choice }: { choice: SeriesChoice }) {
  const { query, notes, body, unavailable } = useSection<SummaryBody>("summary", choice);
  const series = body?.series;
  const returns = body?.returns;
  const notebook = body?.provenance.find((row) => row.source === "notebook" && row.timeframe === choice.timeframe);
  const full = body?.provenance.find((row) => row.source === "full" && row.timeframe === choice.timeframe);

  return (
    <Section title="1 · Load data" question="Which bars are analysed, and what the notebook's closing table says when it is filled in.">
      <div className="space-y-3">
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={notes} />
          {unavailable || !body || !series ? (
            <p className="text-xs text-neutral-500">These bars are not in the lake, so there is nothing to analyse for this selection.</p>
          ) : (
            <>
              <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
                <Stat label="Bars" value={fmtInt(series.barCount)} hint={series.view} />
                <Stat label="From" value={fmtTime(series.firstTimestamp)} hint="the lake's Pacific wall-clock stamp" />
                <Stat label="To" value={fmtTime(series.lastTimestamp)} />
                <Stat label="Close range" value={`${fmt(series.closeMinimum, 0)} – ${fmt(series.closeMaximum, 0)}`} hint="index points" />
                <Stat label="Return mean" value={`${fmt((returns?.mean ?? 0) * 100, 4)} %`} />
                <Stat label="Return standard deviation" value={`${fmt((returns?.standardDeviation ?? 0) * 100, 4)} %`} />
                <Stat label="Excess kurtosis" value={fmt(returns?.kurtosis, 2)} tone={OKABE.orange} />
                <Stat label="Lag-1 ACF" value={signed(body.lagOneAutocorrelation, 4)} tone={OKABE.blue} hint={`band ±${fmt(body.confidenceBand, 4)}`} />
              </div>
              {notebook && full && notebook.bar_count !== full.bar_count && (
                <Finding>
                  Two sources hold different histories for {choice.timeframe}. The dedicated view {full.view} has {fmtInt(full.bar_count)} bars from {full.first_bar_label}; the view the notebook&apos;s own loader reads today, {notebook.view}, has {fmtInt(notebook.bar_count)} from {notebook.first_bar_label}, because the shared view&apos;s history is cut. {choice.timeframe === "30m" ? "The notebook's prose describes the longer series (about 78,474 bars from 2019-05-05), so " : ""}{choice.timeframe === "30m" ? "this page reads that one" : "This page reads the longer one"}; the control above switches to the other. Through the shorter one the notebook&apos;s fold cell finds {notebook.default_walk_forward_fold_count} folds; through the longer one, {full.default_walk_forward_fold_count}.
                </Finding>
              )}
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="min-w-0 overflow-x-auto rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
                  <h4 className="mb-1 text-xs font-semibold text-neutral-200">What each source holds</h4>
                  {body.provenance.length === 0 ? (
                    <p className="text-[11px] text-neutral-500">The provenance table is not landed (packages/ml-engine/src/studies/mnq_eda_30m/build.py).</p>
                  ) : (
                    <table className="w-full text-[11px] font-mono tnum">
                      <thead>
                        <tr className="text-left text-neutral-500">
                          <th className="font-normal">bar</th>
                          <th className="font-normal">source</th>
                          <th className="text-right font-normal">bars</th>
                          <th className="font-normal pl-2">first bar</th>
                          <th className="text-right font-normal">per day</th>
                          <th className="text-right font-normal">folds*</th>
                        </tr>
                      </thead>
                      <tbody>
                        {body.provenance.map((row) => (
                          <tr key={`${row.timeframe}-${row.source}`} className={`border-t border-neutral-900 ${row.timeframe === choice.timeframe && row.source === choice.source ? "bg-neutral-800/60" : ""}`}>
                            <td className="py-0.5 text-neutral-300">{row.timeframe}</td>
                            <td className="text-neutral-300">{row.source === "full" ? "full history" : "notebook loader"}</td>
                            <td className="text-right text-neutral-100">{fmtInt(row.bar_count)}</td>
                            <td className="pl-2">{row.first_bar_label.slice(0, 10)}</td>
                            <td className="text-right">{fmt(row.median_bars_per_calendar_day, 0)}</td>
                            <td className="text-right">{fmtInt(row.default_walk_forward_fold_count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <p className="mt-1 text-[10px] text-neutral-500">* the notebook&apos;s own generate_folds at its defaults (12-month tests, 240-bar purge, 24-month minimum training). The shaded row is the selection above.</p>
                </div>
                <div className="min-w-0 overflow-x-auto rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
                  <h4 className="mb-1 text-xs font-semibold text-neutral-200">Summary, filled in</h4>
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-neutral-500">
                        <th className="font-normal">finding</th>
                        <th className="font-normal">value</th>
                        <th className="font-normal">implication</th>
                      </tr>
                    </thead>
                    <tbody>
                      {findings(body).map((row) => (
                        <tr key={row.finding} className="border-t border-neutral-900 align-top">
                          <td className="py-1 pr-2 text-neutral-300">{row.finding}</td>
                          <td className="pr-2 font-mono tnum text-neutral-100">{row.value}</td>
                          <td className="text-neutral-400">{row.implication}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </StudyState>
      </div>
    </Section>
  );
}
