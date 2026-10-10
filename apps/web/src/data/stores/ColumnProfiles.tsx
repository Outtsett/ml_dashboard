/**
 * ColumnProfiles — every column of a lake table, seen rather than summarised.
 *
 * One panel per column: its distribution, its line through time, and the eight
 * numbers underneath (mean, median, standard deviation, skewness, kurtosis,
 * 25th and 75th percentiles, minimum, maximum). Mean and standard deviation
 * describe a bell curve and almost nothing here is one, so the shape is drawn
 * beside them rather than left to the imagination.
 *
 * Every panel states how much of the column is null. A gap is drawn as a gap;
 * an unknown is never drawn as a zero.
 */

import { useState } from "react";
import { ReadByNotebooks } from "@/marimo/ReadByNotebooks";
import { useQuery } from "@tanstack/react-query";
import { LensFrame } from "@/lens/Frame";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { measuredValue, percentage, wholeNumber } from "@shared/stores/format";
import { cn } from "@/shared/utils/utils";

interface HistogramBin {
  start: number;
  end: number;
  count: number;
}

interface ColumnProfile {
  name: string;
  type: string;
  numeric: boolean;
  /** Computed from bars after the one it sits on — never a feature. */
  forwardLooking?: boolean;
  nonNullCount: number;
  nullFraction: number | null;
  distinctApproximate: number;
  minimum: number | null;
  maximum: number | null;
  mean: number | null;
  median: number | null;
  standardDeviation: number | null;
  skewness: number | null;
  kurtosis: number | null;
  percentile25: number | null;
  percentile75: number | null;
  histogram: HistogramBin[];
  sparkline: Array<number | null>;
}

interface ProfileResponse {
  name: string;
  symbol: string | null;
  symbolColumn: string | null;
  timestampColumn: string | null;
  sampleRows: number;
  sampleDescription: string;
  sparklineTimestampsSeconds: number[];
  columns: ColumnProfile[];
}

const SORTS = {
  position: "table order",
  name: "name",
  nulls: "most null",
  spread: "widest spread",
} as const;

type SortKey = keyof typeof SORTS;

/** Okabe-Ito orange for the distribution, blue for the line through time. */
const DISTRIBUTION_COLOR = "#E69F00";
const TIME_COLOR = "#0072B2";

/** What each of the eight numbers is and how DuckDB computed it, shown on hover. */
const STATISTIC_COMPUTATIONS: Record<string, string> = {
  mean: "The average of the non-null sampled values. DuckDB: avg(column).",
  median: "The middle value of the non-null sampled values. DuckDB: median(column).",
  "standard deviation": "How far the sampled values typically sit from their mean. DuckDB: stddev_samp(column).",
  skewness: "How lopsided the distribution is; 0 is symmetric and a negative value means a longer left tail. DuckDB: skewness(column).",
  kurtosis: "How heavy the tails are against a bell curve, which reads 0. DuckDB: kurtosis(column).",
  "distinct values": "About how many different values the sample holds. DuckDB: approx_count_distinct(column), an estimate.",
  "25th percentile": "A quarter of the sampled values are at or below this. DuckDB: quantile_cont(column, 0.25).",
  "75th percentile": "Three quarters of the sampled values are at or below this. DuckDB: quantile_cont(column, 0.75).",
  minimum: "The smallest sampled value. DuckDB: min(column).",
  maximum: "The largest sampled value. DuckDB: max(column).",
};

function Histogram({ bins }: { bins: HistogramBin[] }) {
  const peak = Math.max(1, ...bins.map((bin) => bin.count));
  const width = 100 / Math.max(1, bins.length);
  return (
    <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="h-[34px] w-full" role="img"
      aria-label={`Distribution across ${bins.length} bins`}>
      {bins.map((bin, index) => {
        const height = (bin.count / peak) * 32;
        return (
          <rect
            key={index}
            x={index * width + width * 0.12}
            y={33 - height}
            width={width * 0.76}
            height={Math.max(height, bin.count > 0 ? 0.6 : 0)}
            fill={DISTRIBUTION_COLOR}
            opacity={0.85}
          >
            <title>
              {`${measuredValue(bin.start)} to ${measuredValue(bin.end)}: ${wholeNumber(bin.count)} sampled rows`}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

function TimeLine({ values }: { values: Array<number | null> }) {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (present.length < 2) {
    return (
      <div className="flex h-[34px] items-center text-[10px] text-muted-foreground">
        No line — fewer than two buckets carry a value.
      </div>
    );
  }
  const low = Math.min(...present);
  const high = Math.max(...present);
  const span = high - low || 1;
  const step = 100 / Math.max(1, values.length - 1);

  // A null breaks the line rather than being interpolated across.
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      if (current.length > 1) segments.push(current.join(" "));
      current = [];
      return;
    }
    current.push(`${(index * step).toFixed(2)},${(32 - ((value - low) / span) * 30).toFixed(2)}`);
  });
  if (current.length > 1) segments.push(current.join(" "));

  return (
    <svg viewBox="0 0 100 34" preserveAspectRatio="none" className="h-[34px] w-full" role="img"
      aria-label="Value through time">
      <title>
        {`The column's average in each of ${values.length} equal time buckets across the sampled rows, oldest on the left. The vertical scale runs from ${measuredValue(low)} at the bottom to ${measuredValue(high)} at the top. A gap is a bucket with no value.`}
      </title>
      {segments.map((points, index) => (
        <polyline
          key={index}
          points={points}
          fill="none"
          stroke={TIME_COLOR}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function Number8({ label, value }: { label: string; value: number | null }) {
  return (
    <div
      className="flex items-baseline justify-between gap-1"
      title={`${STATISTIC_COMPUTATIONS[label] ?? label} Computed over the sampled rows (the exact statements are in apps/api/data/profile.router.ts). Recorded value: ${value === null ? "none" : String(value)}.`}
    >
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="tnum text-[10px] text-foreground">{measuredValue(value)}</span>
    </div>
  );
}

function ColumnPanel({ profile }: { profile: ColumnProfile }) {
  const allNull = profile.nullFraction !== null && profile.nullFraction > 0.9999;

  return (
    <article
      className="rounded border border-border/60 bg-card/40 p-2"
      data-testid={`column-profile-${profile.name}`}
    >
      <header className="mb-1 flex items-baseline gap-1.5">
        <h4 className="truncate font-mono text-[11px] font-semibold text-foreground">{profile.name}</h4>
        <span className="shrink-0 text-[10px] text-muted-foreground">{profile.type}</span>
        {profile.forwardLooking && (
          <span
            className="shrink-0 rounded border border-[#D55E00]/50 px-1 text-[10px] text-[#D55E00]"
            title="Computed from bars after this one. It cannot be used as a feature."
          >
            forward-looking
          </span>
        )}
        <span
          className={cn(
            "ml-auto shrink-0 tnum text-[10px]",
            allNull ? "text-[--color-data-warn]" : "text-muted-foreground",
          )}
        >
          {profile.nullFraction === null
            ? "—"
            : profile.nullFraction > 0 && profile.nullFraction < 0.0005
              ? "under 0.1% null"
              : `${percentage(profile.nullFraction)} null`}
        </span>
      </header>

      {allNull ? (
        <p className="py-3 text-[10px] text-muted-foreground">
          Every sampled row is null here, so there is nothing to plot.
        </p>
      ) : !profile.numeric ? (
        <p className="py-3 text-[10px] text-muted-foreground">
          About {wholeNumber(profile.distinctApproximate)} distinct {profile.distinctApproximate === 1 ? "value" : "values"}.
          This column is {/TIME|DATE/i.test(profile.type) ? "a time" : /BOOL/i.test(profile.type) ? "true or false" : "text"}, not a
          number, so its values are counted rather than plotted.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                distribution
              </p>
              {profile.histogram.length > 0 ? (
                <Histogram bins={profile.histogram} />
              ) : (
                <div className="flex h-[34px] items-center text-[10px] text-muted-foreground">
                  One value only — no spread to bin.
                </div>
              )}
            </div>
            <div>
              <p className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                through time
              </p>
              <TimeLine values={profile.sparkline} />
            </div>
          </div>

          <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 border-t border-border/40 pt-1.5">
            <Number8 label="mean" value={profile.mean} />
            <Number8 label="median" value={profile.median} />
            <Number8 label="standard deviation" value={profile.standardDeviation} />
            <Number8 label="skewness" value={profile.skewness} />
            <Number8 label="kurtosis" value={profile.kurtosis} />
            <Number8 label="distinct values" value={profile.distinctApproximate} />
            <Number8 label="25th percentile" value={profile.percentile25} />
            <Number8 label="75th percentile" value={profile.percentile75} />
            <Number8 label="minimum" value={profile.minimum} />
            <Number8 label="maximum" value={profile.maximum} />
          </div>
        </>
      )}
    </article>
  );
}

export interface ColumnProfilesProps {
  objectName: string;
  /** Scopes the measurement; an unscoped profile of a billion-row table is minutes. */
  symbol: string;
  onSymbolChange: (symbol: string) => void;
}

export function ColumnProfiles({ objectName, symbol, onSymbolChange }: ColumnProfilesProps) {
  const [sort, setSort] = useState<SortKey>("position");
  const [filter, setFilter] = useState("");
  const [draftSymbol, setDraftSymbol] = useState(symbol);

  const profile = useQuery({
    queryKey: ["stores", "profile", objectName, symbol],
    queryFn: async ({ signal }) => {
      const parameters = new URLSearchParams({ sampleRows: "50000" });
      if (symbol) parameters.set("symbol", symbol);
      const response = await fetch(
        `/api/stores/profile/lake/${encodeURIComponent(objectName)}?${parameters}`,
        { signal },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? `${response.status}`);
      return body as ProfileResponse;
    },
    staleTime: 5 * 60_000,
  });

  const needle = filter.trim().toLowerCase();
  const all = profile.data?.columns ?? [];
  const columns = [...(needle ? all.filter((column) => column.name.toLowerCase().includes(needle)) : all)];
  if (sort === "name") columns.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "nulls") columns.sort((a, b) => (b.nullFraction ?? 0) - (a.nullFraction ?? 0));
  if (sort === "spread") {
    const spread = (column: ColumnProfile) =>
      column.standardDeviation === null || !Number.isFinite(column.standardDeviation)
        ? -1
        : Math.abs(column.standardDeviation);
    columns.sort((a, b) => spread(b) - spread(a));
  }

  return (
    <LensFrame
      title="Every column, seen"
      question="What does each column in this table actually look like — its shape, its drift, and how much of it is missing?"
      basis={
        profile.data
          ? `${profile.data.columns.length} columns · measured over ${profile.data.sampleRows.toLocaleString()} rows: ${profile.data.sampleDescription}`
          : undefined
      }
      unavailableReason={profile.error ? (profile.error as Error).message : undefined}
      className="h-full min-h-0"
      testId="column-profiles"
      fillBody
    >
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <ReadByNotebooks tables={[objectName]} />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="filter columns"
            className="h-7 w-44 text-xs"
            data-testid="column-profile-filter"
          />
          <div className="flex items-center gap-1">
            {(Object.keys(SORTS) as SortKey[]).map((key) => (
              <Button
                key={key}
                size="sm"
                variant={sort === key ? "secondary" : "ghost"}
                className="h-7 px-2 text-[11px]"
                onClick={() => setSort(key)}
              >
                {SORTS[key]}
              </Button>
            ))}
          </div>
          <form
            className="ml-auto flex items-center gap-1"
            onSubmit={(event) => {
              event.preventDefault();
              onSymbolChange(draftSymbol.trim());
            }}
          >
            <label className="text-[10px] text-muted-foreground" htmlFor="profile-symbol">
              symbol
            </label>
            <Input
              id="profile-symbol"
              value={draftSymbol}
              onChange={(event) => setDraftSymbol(event.target.value)}
              className="h-7 w-24 font-mono text-xs"
              data-testid="column-profile-symbol"
            />
            <Button size="sm" variant="outline" className="h-7 px-2 text-[11px]" type="submit">
              measure
            </Button>
          </form>
        </div>

        {profile.isFetching && (
          <p className="text-[11px] text-muted-foreground">
            Measuring {objectName} in DuckDB…
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-auto">
          {profile.data && profile.data.sampleRows === 0 && !profile.isFetching && (
            <p className="rounded border border-[#E69F00]/60 p-3 text-xs text-foreground" data-testid="column-profile-empty-sample">
              ▲ No rows were measured
              {profile.data.symbolColumn && symbol
                ? `: no row of ${objectName} has ${profile.data.symbolColumn} = ${symbol}. Type a symbol this object holds and press measure, or clear the box to measure every symbol.`
                : `: ${objectName} returned no rows to sample.`}
            </p>
          )}
          <div className={cn("grid gap-2 sm:grid-cols-2 xl:grid-cols-3", profile.data?.sampleRows === 0 && "hidden")}>
            {columns.map((column) => (
              <ColumnPanel key={column.name} profile={column} />
            ))}
          </div>
          {!profile.isFetching && columns.length === 0 && (
            <p className="py-4 text-center text-[11px] text-muted-foreground">
              {profile.data ? `No column matches “${filter}”.` : "Choose a table to profile."}
            </p>
          )}
        </div>
      </div>
    </LensFrame>
  );
}
