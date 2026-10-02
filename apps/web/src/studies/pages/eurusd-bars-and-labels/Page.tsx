/**
 * EURUSD bars, forward labels and distributions. Three queries, one per
 * section of the endpoint, so the window slider never refetches the tables:
 * the candles (window), the log-return distribution (returns) and the landed
 * label tables (labels). Every control is in the URL.
 */

import { useEffect, useState } from "react";
import {
  ColumnGrid, ControlBar, Empty, Finding, Section, SegmentControl, SelectControl, SliderControl, Stat, StudyNotes, StudyState,
  SwitchControl, fmt, fmtInt, fmtPercent, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  MAXIMUM_BARS_SHOWN, MINIMUM_BARS_SHOWN, TIMEFRAMES, horizonLabel, windowCounts,
  type LabelDistribution, type LabelsBody, type ReturnsBody, type Timeframe, type WindowBody,
} from "@shared/studies/eurusd-bars-and-labels";
import { CandleChart } from "./CandleChart";
import { ClassBalanceTable, DistributionPanel, DistributionTable, HorizonGridTable, LabelFormula, catalogMeaning } from "./LabelPanels";
import { ReturnFormulas, ReturnHistogram, ReturnStatisticsTable, returnComparison } from "./ReturnDistribution";

const SLUG = "eurusd-bars-and-labels";
const DEFAULT_PICKED = 5;

function useDebouncedNumber(value: number, delayMs: number): number {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

const BASE_ORDER = ["fwd_beta", "fwd_t", "fwd_r2", "fwd_ret", "fwd_beta_vol"];

/** The notebook's column order: the trailing t-statistics by window, then each horizon's forward columns. */
function columnOrder(column: string): [number, number, number] {
  const trailing = /^t_(\d+)$/.exec(column);
  if (trailing) return [0, Number(trailing[1]), 0];
  const forward = /^(fwd_\w+?)_h(\d+)$/.exec(column);
  if (forward) return [1, Number(forward[2]), BASE_ORDER.indexOf(forward[1] as string)];
  return [2, 0, 0];
}

function sortedColumns(rows: readonly LabelDistribution[]): LabelDistribution[] {
  return [...rows].sort((a, b) => {
    const [ag, av, ao] = columnOrder(a.labelColumn);
    const [bg, bv, bo] = columnOrder(b.labelColumn);
    return ag - bg || av - bv || ao - bo;
  });
}

function ColumnPicker({ available, picked, onChange }: { available: readonly LabelDistribution[]; picked: readonly string[]; onChange: (columns: string[]) => void }) {
  return (
    <details className="rounded-md border border-neutral-800 bg-neutral-900/50 px-3 py-2">
      <summary className="cursor-pointer text-xs text-neutral-200">
        Continuous label columns: {picked.length} of {available.length} shown
      </summary>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
        <button type="button" onClick={() => onChange(available.slice(0, DEFAULT_PICKED).map((row) => row.labelColumn))} className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:border-neutral-500">first five</button>
        <button type="button" onClick={() => onChange(available.map((row) => row.labelColumn))} className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:border-neutral-500">all</button>
        <button type="button" onClick={() => onChange([])} className="rounded border border-neutral-700 px-2 py-0.5 text-neutral-300 hover:border-neutral-500">none</button>
      </div>
      <div className="mt-2 grid gap-x-4 gap-y-1 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
        {available.map((row) => (
          <label key={row.labelColumn} className="flex items-start gap-2 text-[11px] text-neutral-300" title={row.labelColumn}>
            <input
              type="checkbox"
              className="mt-0.5"
              checked={picked.includes(row.labelColumn)}
              onChange={(event) => onChange(event.target.checked ? [...picked, row.labelColumn] : picked.filter((column) => column !== row.labelColumn))}
            />
            <span>
              {row.displayName}
              <span className="block font-mono text-[10px] text-neutral-500">{row.labelColumn}</span>
            </span>
          </label>
        ))}
      </div>
    </details>
  );
}

function stampDate(timestamp: number | null | undefined): string {
  return timestamp === null || timestamp === undefined ? "—" : new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({ timeframe: "1h", barsShown: 120, start: -1, horizon: 0, columns: "", logCounts: false });
  const timeframe = controls.timeframe as Timeframe;
  const barsShown = useDebouncedNumber(controls.barsShown, 200);
  const start = useDebouncedNumber(controls.start, 200);

  const windowQuery = useStudyQuery<WindowBody>(SLUG, { section: "window", timeframe, barsShown, start, horizon: controls.horizon });
  const returnsQuery = useStudyQuery<ReturnsBody>(SLUG, { section: "returns", timeframe });
  const labelsQuery = useStudyQuery<LabelsBody>(SLUG, { section: "labels", timeframe });

  const view = windowQuery.data?.data;
  const returns = returnsQuery.data?.data;
  const labels = labelsQuery.data?.data;

  const horizon = view?.horizon ?? null;
  const gridRow = labels?.grid.find((row) => row.horizonBars === horizon);
  const horizonColumn = horizon === null ? null : `dir_h${horizon}`;
  const horizonText = horizonColumn === null ? null : `${horizonColumn}`;
  const counts = view && horizon !== null ? windowCounts(view.bars) : null;

  const continuous = sortedColumns(labels?.distributions ?? []);
  const requested = controls.columns === "" ? null : controls.columns.split(",");
  const picked = requested ? requested.filter((column) => continuous.some((row) => row.labelColumn === column)) : continuous.slice(0, DEFAULT_PICKED).map((row) => row.labelColumn);
  const pickedRows = continuous.filter((row) => picked.includes(row.labelColumn));

  const shown = view?.bars ?? [];
  const last = shown[shown.length - 1];
  const beforeLast = shown[shown.length - 2];
  const labelsStale = labels?.run?.lastBarTimestamp != null && view?.lastTimestamp != null && labels.run.lastBarTimestamp < view.lastTimestamp;

  return (
    <div className="space-y-3">
      <StudyNotes notes={[...(windowQuery.data?.notes ?? []), ...(labelsQuery.data?.notes ?? []).filter((note) => !(windowQuery.data?.notes ?? []).includes(note))]} />

      <div className="grid gap-2 grid-cols-2 xl:grid-cols-5">
        <Stat label="Timeframe" value={timeframe} hint="EURUSD 1-minute bars from the lake, bucketed to this timeframe" />
        <Stat label="Bars" value={fmtInt(view?.barCount)} hint="Every bar at this timeframe" />
        <Stat label="Range (UTC)" value={`${stampDate(view?.firstTimestamp).slice(0, 10)} to ${stampDate(view?.lastTimestamp).slice(0, 10)}`} />
        <Stat label="Development slice (first 80%)" value={fmtInt(view?.developmentBarCount)} hint="Models are tuned only here" />
        <Stat label="Sealed fifth (last 20%)" value={fmtInt(view?.sealedBarCount)} hint="Touched once, at the end" />
      </div>

      <ControlBar onReset={reset}>
        <SegmentControl label="Timeframe" value={timeframe} options={TIMEFRAMES.map((value) => ({ value, label: value }))} onChange={(value) => { set("timeframe", value); set("start", -1); set("horizon", 0); set("columns", ""); }} />
        <SliderControl label="Bars shown" value={controls.barsShown} min={MINIMUM_BARS_SHOWN} max={MAXIMUM_BARS_SHOWN} step={10} onChange={(value) => set("barsShown", value)} />
        <div className="w-72">
          <SliderControl
            label="Window start (bar index)"
            value={view?.windowStartIndex ?? 0}
            min={0}
            max={Math.max((view?.barCount ?? 0) - controls.barsShown, 1)}
            onChange={(value) => set("start", value)}
            format={(value) => fmtInt(value)}
            hint="The first bar on screen; the default is the latest window"
          />
        </div>
        {view && view.horizons.length > 0 ? (
          <SelectControl
            label="Forward horizon (markers show dir_h…)"
            value={String(view.horizon ?? view.horizons[0] ?? 0)}
            options={view.horizons.map((value) => ({ value: String(value), label: horizonLabel(value, labels?.grid.find((row) => row.horizonBars === value)?.horizonTradingDays) }))}
            onChange={(value) => set("horizon", Number(value))}
          />
        ) : (
          <span className="self-center text-[11px] text-neutral-500">No forward labels at {timeframe}</span>
        )}
      </ControlBar>

      <Section
        title="Candles, forward direction and log return"
        question={view && view.bars.length > 0 ? `${fmtInt(view.bars.length)} bars from ${stampDate(view.bars[0]?.timestamp)} to ${stampDate(last?.timestamp)} UTC` : "The window of bars on screen."}
      >
        <StudyState isLoading={windowQuery.isLoading} error={windowQuery.error}>
          {view && view.bars.length > 0 ? (
            <div className="space-y-2">
              {counts && horizonText && (
                <Finding>
                  <span className="font-mono">{horizonText}</span> in this window: <b>{counts.up}</b> ▲ up / <b>{counts.ranging}</b> ■ ranging / <b>{counts.down}</b> ▼ down / <b>{counts.unlabelled}</b> unlabelled.
                  Unlabelled means no label exists, never ranging: the last bars of the series and any bar whose forward window crosses a weekend carry none.
                  {labelsStale && ` The labels were built through ${stampDate(labels?.run?.lastBarTimestamp)} UTC and the bars run to ${stampDate(view.lastTimestamp)}, so the newest bars have none until the build is re-run.`}
                </Finding>
              )}
              <CandleChart bars={view.bars} timeframe={timeframe} horizonLabel={horizonText} showMarkers={view.labelsLanded} />
            </div>
          ) : (
            <Empty>No EURUSD bars for this timeframe.</Empty>
          )}
        </StudyState>
      </Section>

      {shown.length > 0 && (
        <Section title="Every column of the bars on screen" question="Each column of the window, with its eight numbers; it follows the window and its length.">
          <ColumnGrid
            title="Bars in the window"
            rows={shown.map((bar) => ({
              open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume,
              log_return_basis_points: bar.logReturnBasisPoints,
            }))}
          />
        </Section>
      )}

      <Section title="Log return: development slice against the sealed fifth" question="Basis points per bar at this timeframe; the first 80% of bars in time against the last fifth.">
        <StudyState isLoading={returnsQuery.isLoading} error={returnsQuery.error}>
          {returns && returns.statistics.length > 0 ? (
            <div className="space-y-3">
              <Finding>{returnComparison(returns.statistics)}</Finding>
              <ReturnStatisticsTable statistics={returns.statistics} />
              <ReturnHistogram body={returns} />
              <ReturnFormulas
                barCount={returns.barCount}
                developmentBarCount={returns.developmentBarCount}
                lastClose={last?.close ?? null}
                previousClose={beforeLast?.close ?? null}
                lastReturn={last?.logReturnBasisPoints ?? null}
              />
            </div>
          ) : (
            <Empty>No returns at this timeframe.</Empty>
          )}
        </StudyState>
      </Section>

      <Section
        title="Forward labels: class balance"
        question={labels?.run ? `${labels.run.labelColumnCount} label columns at ${timeframe}, horizons ${labels.run.horizons.join(", ")} bars; built ${stampDate(labels.run.builtAt)} UTC from the lake's bars.` : "Every integer label column with at most eight distinct values."}
      >
        <StudyState isLoading={labelsQuery.isLoading} error={labelsQuery.error}>
          {labels?.landed ? (
            <div className="space-y-3">
              {gridRow && horizon !== null && (
                <Finding>
                  At <span className="font-mono">dir_h{horizon}</span> {fmtPercent(gridRow.rangingShare, 1)} of the labelled bars are ranging, {fmtPercent(gridRow.upShare, 1)} up and {fmtPercent(gridRow.downShare, 1)} down, on {fmtPercent(gridRow.labelledBarShare, 1)} of all bars.
                  The boundary |t| is {fmt(gridRow.upperBoundaryTStatistic, 2)}, the 90th percentile of |t| on shuffled returns, so a driftless series would itself be called trending on about a tenth of its bars; the real series is trending on {fmtPercent(gridRow.trendingShare, 1)} against {fmtPercent(gridRow.shuffledTrendingShare, 1)} shuffled ({gridRow.trendingExcessOverShuffle !== null && gridRow.trendingExcessOverShuffle >= 0 ? "+" : ""}{fmt((gridRow.trendingExcessOverShuffle ?? 0) * 100, 2)} points).
                </Finding>
              )}
              <ClassBalanceTable rows={labels.classBalance} highlightColumn={horizonColumn} />
              <HorizonGridTable rows={labels.grid} selectedHorizon={horizon} />
              <LabelFormula grid={gridRow} horizon={horizon} />
            </div>
          ) : (
            <Empty>No trend labels at {timeframe}: no horizon there labels at least 20% of the bars (its contiguous runs are too short), the state the notebook reported as "No trend_labels on disk at this timeframe".</Empty>
          )}
        </StudyState>
      </Section>

      {labels?.landed && (
        <Section title="Forward labels: every continuous column" question="The notebook's full distribution table for the columns picked, and a histogram with the eight numbers for each.">
          <div className="space-y-3">
            <ColumnPicker available={continuous} picked={picked} onChange={(columns) => set("columns", columns.length === 0 ? "none" : columns.join(","))} />
            <DistributionTable rows={pickedRows} />
            <SwitchControl label="Log counts in the histograms" checked={controls.logCounts} onChange={(value) => set("logCounts", value)} />
            <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(190px,1fr))]">
              {pickedRows.map((row) => (
                <DistributionPanel key={row.labelColumn} row={row} meaning={catalogMeaning(labels.catalog, row.labelColumn)} logScale={controls.logCounts} />
              ))}
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}
