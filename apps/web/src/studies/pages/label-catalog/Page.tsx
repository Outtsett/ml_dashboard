/**
 * Label catalog. The server aggregates every number (a 1-minute set is 2.3
 * million rows); the page draws them. Controls: the label set, histogram bins
 * and the usable-rows filter re-read the set; the log count axis, the scatter
 * zoom and legend, and the stepper's focused term act in the browser; the
 * stepper's window re-reads sixty rows.
 */

import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LabelCatalogOverview, LabelCatalogWindow, LabelSetProfile, ManifestRow } from "@shared/studies/label-catalog";
import { MAXIMUM_CLASS_COUNT } from "@shared/studies/label-catalog";
import { LABEL_VOLATILITY_WINDOW_BARS } from "@shared/labels/contract";
import {
  AXIS, ColumnGrid, ControlBar, Empty, Finding, GRID, OKABE, Section, SelectControl, SliderControl, Stat, StudyNotes, StudyState,
  SwitchControl, TOOLTIP, fmt, fmtInt, fmtPercent, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import { AuditRecord } from "./AuditRecord";
import { BinnedGrid } from "./BinnedGrid";
import { domainOf, labelStyle } from "./classes";
import { ScatterCanvas } from "./ScatterCanvas";
import { DataTable, type TableColumn } from "./Table";
import { UniquenessStepper } from "./UniquenessStepper";

const MANIFEST_COLUMNS: Array<TableColumn<ManifestRow>> = (
  [
    "label_set_id", "recipe", "generator_type", "label_encoding", "symbol", "timeframe_minutes", "rows", "first_event", "last_event",
    "max_horizon_bars", "purge_bars", "validation_passed", "class_balance_ratio", "coverage_fraction", "no_lookahead", "written_at", "parameters", "current",
  ] as const
).map((key) => ({ key, label: key, value: (row: ManifestRow) => row[key] }));

const monthLabel = (month: number) => new Date(month).toISOString().slice(0, 7);

/** One line describing the chosen manifest line; a field the manifest does not carry is left out, never printed as "null". */
function setSummary(line: ManifestRow): string {
  const span = line.first_event || line.last_event ? `${line.first_event?.slice(0, 10) ?? "?"} to ${line.last_event?.slice(0, 10) ?? "?"}` : null;
  return [
    line.generator_type,
    line.label_encoding,
    line.symbol && line.timeframe_minutes !== null ? `${line.symbol} ${line.timeframe_minutes}-minute` : line.symbol,
    span,
    line.max_horizon_bars !== null ? `horizon ${line.max_horizon_bars} bars${line.purge_bars !== null ? `, purge ${line.purge_bars}` : ""}` : null,
  ].filter(Boolean).join(" · ");
}

function CountBars({ title, rows, total }: { title: string; rows: Array<{ key: string; rows: number }>; total: number }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-[11px] font-medium text-neutral-300">{title}</div>
      {rows.map((row) => (
        <div key={row.key} className="space-y-0.5" title={`${fmtInt(row.rows)} of ${fmtInt(total)} rows`}>
          <div className="flex justify-between gap-2 text-[11px]">
            <span className="truncate text-neutral-300">{row.key}</span>
            <span className="font-mono tnum text-neutral-100">
              {fmtInt(row.rows)} <span className="text-neutral-500">({fmtPercent(total > 0 ? row.rows / total : null)})</span>
            </span>
          </div>
          <div className="h-1.5 rounded bg-neutral-800">
            <div className="h-full rounded" style={{ width: `${total > 0 ? (100 * row.rows) / total : 0}%`, background: OKABE.sky }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ValidationPanel({ profile, manifestLine }: { profile: LabelSetProfile; manifestLine: ManifestRow | undefined }) {
  const distributionTotal = profile.labelDistribution.reduce((sum, row) => sum + row.rows, 0);
  const costTotal = profile.clearsRoundTripCost.reduce((sum, row) => sum + row.rows, 0);
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="min-w-0 space-y-1">
        <div className="text-[11px] font-medium text-neutral-300">
          Validation gates {manifestLine?.validation_passed === true ? "✓ passed" : manifestLine?.validation_passed === false ? "✕ failed" : ""}
        </div>
        {profile.gates.length === 0 ? (
          <p className="text-[11px] text-neutral-500">The manifest line records no gates.</p>
        ) : (
          <ul className="space-y-1">
            {profile.gates.map((gate) => (
              <li key={gate.gate} className="text-[11px]">
                <span className="font-mono" style={{ color: gate.passed === null ? OKABE.grey : gate.passed ? OKABE.orange : OKABE.blue }}>
                  {gate.passed === null ? "○ not recorded" : gate.passed ? "✓ passed" : "✕ failed"} · {gate.gate}
                </span>
                <span className="text-neutral-400"> — {gate.detail ?? "no detail"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0 space-y-3">
        <CountBars title="Label distribution at landing (manifest)" rows={profile.labelDistribution.map((row) => ({ key: `label ${row.key}`, rows: row.rows }))} total={distributionTotal} />
        <CountBars title="Why rows are usable or not (whole set)" rows={profile.usableReasons} total={profile.totalRows} />
        <CountBars title={`Realised move against one round trip (${profile.usableOnly ? "usable rows" : "all rows"})`} rows={profile.clearsRoundTripCost} total={costTotal} />
      </div>
    </div>
  );
}

function EightNumbers({ profile }: { profile: LabelSetProfile }) {
  const columns = profile.columns;
  const find = (name: string) => columns.find((column) => column.column === name)?.summary;
  const uniqueness = find("sample_uniqueness_weight");
  const concurrency = find("concurrent_label_count");
  const volatilityUnits = find("realized_return_volatility_units");
  return (
    <div className="space-y-2">
      <DataTable
        rows={columns}
        rowKey={(row) => row.column}
        pageSize={20}
        columns={[
          { key: "column", label: "column", value: (row) => row.column },
          { key: "count", label: "count", value: (row) => row.summary.count },
          { key: "mean", label: "mean", value: (row) => row.summary.mean },
          { key: "median", label: "median", value: (row) => row.summary.median },
          { key: "standardDeviation", label: "standard deviation", value: (row) => row.summary.standardDeviation },
          { key: "skewness", label: "skewness", value: (row) => row.summary.skewness },
          { key: "kurtosis", label: "excess kurtosis", value: (row) => row.summary.kurtosis },
          { key: "percentile25", label: "25th percentile", value: (row) => row.summary.percentile25 },
          { key: "percentile75", label: "75th percentile", value: (row) => row.summary.percentile75 },
          { key: "minimum", label: "minimum", value: (row) => row.summary.minimum },
          { key: "maximum", label: "maximum", value: (row) => row.summary.maximum },
        ]}
      />
      <Finding>
        Mean sample uniqueness {fmt(uniqueness?.mean, 4)}: an average label&apos;s bars are shared by about {fmt(uniqueness?.mean ? 1 / uniqueness.mean : null, 1)} labels
        (mean concurrent_label_count at the event bar {fmt(concurrency?.mean, 2)}), so the {fmtInt(profile.rows)} rows carry roughly {fmtInt(uniqueness?.mean ? profile.rows * uniqueness.mean : null)} independent outcomes.
        Realised return in volatility units: mean {fmt(volatilityUnits?.mean, 3)}, median {fmt(volatilityUnits?.median, 3)}, skewness {fmt(volatilityUnits?.skewness, 2)}, excess kurtosis {fmt(volatilityUnits?.kurtosis, 1)}.
      </Finding>
      <p className="text-[10px] text-neutral-500">
        Skewness and excess kurtosis are the sample-adjusted forms (DuckDB skewness / kurtosis, the dashboard&apos;s eightNumberSummary); percentiles interpolate linearly. Non-finite values are dropped per column, as the notebook did.
      </p>
    </div>
  );
}

function LabelThroughTime({ profile }: { profile: LabelSetProfile }) {
  if (profile.distinctLabelCount > MAXIMUM_CLASS_COUNT || profile.monthlyClasses.length === 0) {
    const means = profile.monthlyMeans.map((row) => ({ ...row, monthText: monthLabel(row.month) }));
    const values = means.map((row) => row.meanLabel).filter((value): value is number => value !== null);
    return (
      <div className="space-y-1">
        <Finding>
          {fmtInt(profile.distinctLabelCount)} distinct labels, so the label is drawn as its monthly mean (the notebook&apos;s rule: more than {MAXIMUM_CLASS_COUNT} classes).
          The monthly mean runs from {fmt(values.length ? Math.min(...values) : null, 3)} to {fmt(values.length ? Math.max(...values) : null, 3)} over {means.length} months.
        </Finding>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={means} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="monthText" {...AXIS} minTickGap={30} />
            <YAxis {...AXIS} width={48} tickFormatter={(value: number) => fmt(value, 2)} />
            <Tooltip {...TOOLTIP} formatter={(value: number, name: string, item) => [name === "mean label" ? `${fmt(value, 4)} (${fmtInt((item.payload as { rows: number }).rows)} rows)` : fmt(value, 4), name]} />
            <Line dataKey="meanLabel" name="mean label" stroke={OKABE.sky} dot={{ r: 2 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    );
  }
  const domain = domainOf(profile.labelClasses.map((row) => row.label));
  const labels = profile.labelClasses.map((row) => row.label);
  const keyOf = (label: number | null) => `label ${label ?? "none"}`;
  const byMonth = new Map<number, Record<string, number | string>>();
  for (const row of profile.monthlyClasses) {
    const entry = byMonth.get(row.month) ?? { month: row.month, monthText: monthLabel(row.month) };
    // A class absent from a month has zero rows there (a missing key would leave a gap in the stack).
    for (const other of labels) {
      entry[keyOf(other)] ??= 0;
      entry[`${keyOf(other)} share`] ??= 0;
    }
    entry[keyOf(row.label)] = row.rows;
    entry[`${keyOf(row.label)} share`] = row.share;
    byMonth.set(row.month, entry);
  }
  const data = [...byMonth.values()].sort((a, b) => Number(a.month) - Number(b.month));
  const shareRanges = labels.map((label) => {
    const shares = data.map((row) => Number(row[`${keyOf(label)} share`] ?? 0));
    return { label, low: Math.min(...shares), high: Math.max(...shares) };
  });
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-3 text-[11px]">
        {labels.map((label) => {
          const style = labelStyle(label, domain);
          return <span key={String(label)} style={{ color: style.color }}>{style.name}</span>;
        })}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data} stackOffset="expand" margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="monthText" {...AXIS} minTickGap={30} />
          <YAxis {...AXIS} width={40} tickFormatter={(value: number) => fmtPercent(value, 0)} />
          <Tooltip
            {...TOOLTIP}
            content={({ payload, label }) => {
              const row = payload?.[0]?.payload as Record<string, number | string> | undefined;
              if (!row) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{label}</div>
                  {labels.map((value) => (
                    <div key={String(value)} style={{ color: labelStyle(value, domain).color }}>
                      {labelStyle(value, domain).name}: {fmtInt(Number(row[keyOf(value)] ?? 0))} rows, {fmtPercent(Number(row[`${keyOf(value)} share`] ?? 0))}
                    </div>
                  ))}
                </div>
              );
            }}
          />
          {labels.map((value) => {
            const style = labelStyle(value, domain);
            return <Area key={String(value)} type="stepAfter" dataKey={keyOf(value)} stackId="labels" stroke={style.color} fill={style.color} fillOpacity={0.75} isAnimationActive={false} />;
          })}
        </AreaChart>
      </ResponsiveContainer>
      <Finding>
        Share of rows by month, {data.length} months:{" "}
        {shareRanges.map((range) => `${labelStyle(range.label, domain).name} ${fmtPercent(range.low)} to ${fmtPercent(range.high)}`).join("; ")}.
      </Finding>
    </div>
  );
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
}

function ReturnAgainstVolatility({ profile }: { profile: LabelSetProfile }) {
  const points = profile.scatter;
  if (points.length === 0) return <Empty>No row has both a realised return and a trailing volatility.</Empty>;
  const domain = domainOf(points.map((point) => point.label));
  const correlation = pearson(points.map((point) => point.volatility), points.map((point) => Math.abs(point.returnPoints)));
  const perClass = new Map<string, { label: number | null; count: number; points: number; units: number }>();
  for (const point of points) {
    const key = point.label === null ? "none" : String(point.label);
    const entry = perClass.get(key) ?? { label: point.label, count: 0, points: 0, units: 0 };
    entry.count += 1;
    entry.points += point.returnPoints;
    entry.units += point.volatility > 0 ? point.returnPoints / point.volatility : 0;
    perClass.set(key, entry);
  }
  const classRows = [...perClass.values()].sort((a, b) => (a.label ?? 0) - (b.label ?? 0));
  return (
    <div className="space-y-2">
      <ScatterCanvas points={points} domain={domain} xLabel={`trailing volatility (points; causal standard deviation of one-bar changes over ${LABEL_VOLATILITY_WINDOW_BARS} bars)`} yLabel="realised return (points)" />
      <Finding>
        {fmtInt(points.length)} of {fmtInt(profile.scatterEligibleRows)} eligible rows drawn{points.length < profile.scatterEligibleRows ? " (a fixed-seed reservoir sample)" : ""}.
        Pearson r between trailing volatility and |realised return| = {fmt(correlation, 3)}: {correlation !== null && correlation > 0.1 ? "the size of the realised move grows with the volatility scale, which is why the contract carries the return in volatility units too" : "the size of the realised move barely tracks the volatility scale in this set"}.
      </Finding>
      {classRows.length <= MAXIMUM_CLASS_COUNT && (
        <DataTable
          rows={classRows}
          rowKey={(row) => String(row.label)}
          columns={[
            { key: "label", label: "label", value: (row) => row.label, render: (row) => <span style={{ color: labelStyle(row.label, domain).color }}>{labelStyle(row.label, domain).name}</span> },
            { key: "count", label: "rows in the sample", value: (row) => row.count },
            { key: "points", label: "mean realised return (points)", value: (row) => row.points / row.count },
            { key: "units", label: "mean return / trailing volatility", value: (row) => row.units / row.count },
          ]}
        />
      )}
    </div>
  );
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({ recipe: "", bins: 40, usable: true, logScale: false, windowStart: 0, step: 0 });
  const overviewQuery = useStudyQuery<LabelCatalogOverview>("label-catalog", {
    part: "overview",
    recipe: controls.recipe || null,
    bins: controls.bins,
    usable: controls.usable,
  });
  const windowQuery = useStudyQuery<LabelCatalogWindow>("label-catalog", {
    part: "window",
    recipe: controls.recipe || null,
    usable: controls.usable,
    windowStart: controls.windowStart,
  });
  const body = overviewQuery.data?.data;
  const manifest = body?.manifest ?? [];
  const profile = body?.profile ?? null;
  const currentLines = manifest.filter((row) => row.current);
  const superseded = manifest.length - currentLines.length;
  const selectedRecipe = controls.recipe || profile?.recipe || "";
  const selectedLine = currentLines.find((row) => row.recipe === selectedRecipe);
  const options = currentLines.map((row) => ({ value: row.recipe, label: `#${row.label_set_id ?? "?"} ${row.recipe}` }));

  const chooseRecipe = (recipe: string) => {
    set("recipe", recipe);
    set("windowStart", 0);
    set("step", 0);
  };

  return (
    <div className="min-w-0 space-y-3">
      <StudyState isLoading={overviewQuery.isLoading} error={overviewQuery.error}>
        <StudyNotes notes={[...(overviewQuery.data?.notes ?? []), ...(windowQuery.data?.notes ?? []).filter((note) => !(overviewQuery.data?.notes ?? []).includes(note))]} />

        <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
          <Stat label="Manifest lines" value={fmtInt(manifest.length)} hint="one line per landing in meta/ingest_manifests/labels.jsonl" />
          <Stat label="Label sets (recipes)" value={fmtInt(body?.recipeCount)} hint="distinct recipes among the manifest lines (each is served by derived_labels)" />
          <Stat label="Current sets passing validation" value={`${fmtInt(currentLines.filter((row) => row.validation_passed === true).length)} of ${fmtInt(currentLines.length)}`} />
          <Stat label="Rows in the chosen set" value={profile ? `${fmtInt(profile.rows)} of ${fmtInt(profile.totalRows)}` : "—"} hint={controls.usable ? "usable rows of all rows" : "all rows"} />
        </div>

        <Section title={`Landed sets — ${fmtInt(body?.recipeCount)} recipes in derived_labels`} question="The manifest is the registry: one line per landing, with its validation report. Click a row to choose that set.">
          <Finding>
            {fmtInt(manifest.length)} manifest lines for {fmtInt(body?.recipeCount)} recipes: {superseded} line{superseded === 1 ? " was" : "s were"} superseded by a later landing of the same recipe
            (greyed; the latest is marked current). The notebook titled this table with the line count.
          </Finding>
          <DataTable
            rows={manifest}
            columns={MANIFEST_COLUMNS}
            rowKey={(row, index) => `${row.recipe}|${row.written_at ?? index}`}
            selectedKey={selectedLine ? `${selectedLine.recipe}|${selectedLine.written_at ?? ""}` : null}
            onRowClick={(row) => chooseRecipe(row.recipe)}
            rowTone={(row) => (row.current ? undefined : "muted")}
          />
          <div className="mt-3">
            <ColumnGrid rows={manifest as unknown as Array<Record<string, unknown>>} exclude={["label_set_id"]} title="Every numeric column of the manifest" />
          </div>
        </Section>

        <ControlBar onReset={reset}>
          {options.length > 0 && (
            <SelectControl label="Label set" value={selectedRecipe} options={options} onChange={chooseRecipe} hint="Which landed label set to profile" />
          )}
          <SliderControl label="Histogram bins" value={controls.bins} min={10} max={80} step={5} onChange={(value) => set("bins", value)} />
          <SwitchControl label="Usable rows only" checked={controls.usable} onChange={(value) => { set("usable", value); set("windowStart", 0); }} hint="usable = resolved, past the volatility warm-up, not an ambiguous same-bar touch" />
          <SwitchControl label="Log count axis" checked={controls.logScale} onChange={(value) => set("logScale", value)} />
        </ControlBar>

        {!profile ? (
          <Empty>No label set is landed in derived_labels yet. Land one from the Labels page.</Empty>
        ) : (
          <>
            <Section title={`The chosen set: ${profile.recipe}`} question={selectedLine ? setSummary(selectedLine) : undefined}>
              <ValidationPanel profile={profile} manifestLine={selectedLine} />
            </Section>

            <Section title={`Eight numbers per contract column — ${fmtInt(profile.rows)} rows`}>
              <EightNumbers profile={profile} />
            </Section>

            <Section title="Distribution of every column" question={`Equal-width bins (${profile.bins}) between each column's minimum and maximum, binned in the lake; hover a bar for its range and row count.`}>
              <BinnedGrid columns={profile.columns} logScale={controls.logScale} />
            </Section>

            <Section title="The label through time" question="Does the class mix drift through the history? Share of rows per month, stacked to 100%.">
              <LabelThroughTime profile={profile} />
            </Section>

            <Section title="Return against volatility" question="Realised return against the causal volatility scale: what one unit of the label was worth.">
              <ReturnAgainstVolatility profile={profile} />
            </Section>
          </>
        )}

        <Section title="The sample weights, as objects" question="Step a window of the chosen set: pick a label, then walk its span bar by bar and watch each 1/c_t add into the weight.">
          <StudyState isLoading={windowQuery.isLoading} error={windowQuery.error}>
            <UniquenessStepper
              body={windowQuery.data?.data}
              windowStart={controls.windowStart}
              step={controls.step}
              onWindowStart={(value) => set("windowStart", value)}
              onStep={(value) => set("step", value)}
            />
          </StudyState>
        </Section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-neutral-100">The audit record (2026-09-26) — derived_label_audit_*</h2>
          {body && <AuditRecord audit={body.audit} />}
        </section>
      </StudyState>
    </div>
  );
}
