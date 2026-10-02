/**
 * Section A: the scored headlines routed to the instrument in the window: the
 * table the notebook opened with, the score distribution and headlines per
 * hour by vendor, the eight numbers per vendor, and a graphic for every other
 * column of the routed frame (relevance, direction, tier).
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ColumnGrid, Finding, GRID, OKABE, Section, TOOLTIP, fmt, fmtInt, fmtTime } from "@/studies/kit";
import { eightNumbers, type FinbertBody, type NewsRoute } from "@shared/studies/finbert-sentiment";
import { EightTable, PagedTable, VendorLegend, vendorDefs, vendorFill, type PagedColumn } from "./parts";
import { VENDOR_COLORS, VENDOR_GLYPHS, countBy, hourlyCounts, scoreHistogram, strideSample, vendorsOf } from "./prep";

const ROUTE_COLUMNS: Array<PagedColumn<NewsRoute>> = [
  { key: "seen_utc", label: "seen_utc", cell: (row) => fmtTime(row.seenMs) },
  {
    key: "vendor",
    label: "vendor",
    cell: (row) => (
      <span style={{ color: VENDOR_COLORS[row.vendor] ?? "#8a8a8a" }}>
        {VENDOR_GLYPHS[row.vendor] ?? "■"} {row.vendor}
      </span>
    ),
  },
  { key: "tier", label: "tier", cell: (row) => row.tier },
  { key: "relevance", label: "relevance", align: "right", cell: (row) => fmt(row.relevance, 2) },
  { key: "direction", label: "direction", align: "right", cell: (row) => (row.direction > 0 ? "▲ +1" : "▼ -1") },
  {
    key: "score",
    label: "score",
    align: "right",
    cell: (row) => (
      <span style={{ color: row.score >= 0 ? OKABE.orange : OKABE.blue }}>
        {row.score >= 0 ? "▲" : "▼"} {fmt(row.score, 3)}
      </span>
    ),
  },
  { key: "title", label: "title", cell: (row) => <span className="whitespace-normal font-sans">{row.title}</span> },
];

function CountBars({ rows, title, color }: { rows: Array<{ key: string; count: number }>; title: string; color: string }) {
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 text-[11px] font-medium text-neutral-200">{title}</div>
      <ResponsiveContainer width="100%" height={Math.max(70, 22 * rows.length + 20)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 2, right: 12, left: 4, bottom: 0 }}>
          <XAxis type="number" {...AXIS} />
          <YAxis type="category" dataKey="key" width={96} {...AXIS} interval={0} />
          <Tooltip {...TOOLTIP} formatter={(value) => [fmtInt(Number(value)), "headlines"]} />
          <Bar dataKey="count" fill={color} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Headlines({ body, bins, coverageCount }: { body: FinbertBody; bins: number; coverageCount: number }) {
  const { headlines, routes } = body;
  if (headlines.length === 0) {
    return (
      <Section title={`A. ${body.root}: no scored headlines in the window`} question="Nothing the router sent to this root was scored in these days.">
        <Finding>
          Coverage spans when some source was collecting: {coverageCount}. A bar outside every span has UNKNOWN news, and the coverage column says so to the model. Widen the window or pick another root.
        </Finding>
      </Section>
    );
  }
  const vendors = vendorsOf(headlines);
  const histogram = scoreHistogram(headlines, bins, vendors);
  const { buckets, bucketHours } = hourlyCounts(headlines, vendors);
  const summaries = [
    ...vendors.map((vendor) => ({ name: vendor, summary: eightNumbers(headlines.filter((headline) => headline.vendor === vendor).map((headline) => headline.score)) })),
    { name: "all vendors", summary: eightNumbers(headlines.map((headline) => headline.score)) },
  ];
  const gridRows = strideSample(headlines, 20_000).map((headline) => ({ relevance: headline.relevance, score: headline.score, direction: headline.direction }));
  const tiers = countBy(headlines, (headline) => headline.tier);
  const directions = countBy(headlines, (headline) => (headline.direction > 0 ? "▲ +1 (base)" : "▼ -1 (quote)"));
  const tick = (value: number) => fmt(value, 2);

  return (
    <div className="space-y-3">
      <Section
        title={`A. ${body.root}: ${fmtInt(body.distinctHeadlineCount)} distinct scored headlines in the window, ${fmtInt(body.routeCount)} routes`}
        question="Every headline FinBERT scored that the router sent to this instrument, newest first. One headline can reach a root by several routes."
      >
        <Finding>
          Coverage spans (when some source was collecting): <strong>{coverageCount}</strong>. A bar outside every span has UNKNOWN news; the coverage flag column tells the model so.
          {body.truncated.routes && ` The table lists the newest ${fmtInt(routes.length)} routes.`}
          {body.truncated.headlines && ` Distributions use the first ${fmtInt(headlines.length)} headlines.`}
        </Finding>
        <PagedTable rows={routes} columns={ROUTE_COLUMNS} rowKey={(row, index) => `${row.articleId}|${index}`} />
      </Section>

      <div className="grid gap-3 xl:grid-cols-2">
        <Section title="Score distribution, one headline counted once" question="FinBERT score = p(positive) - p(negative), from -1 (clearly bad) to +1 (clearly good), stacked by vendor.">
          <VendorLegend vendors={vendors} />
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={histogram} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
              {vendorDefs(vendors)}
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="middle" type="number" domain={[-1, 1]} tickFormatter={tick} {...AXIS} />
              <YAxis {...AXIS} width={36} allowDecimals={false} />
              <Tooltip
                {...TOOLTIP}
                labelFormatter={(_label, payload) => {
                  const bin = payload?.[0]?.payload as { lower: number; upper: number } | undefined;
                  return bin ? `score ${fmt(bin.lower, 3)} to ${fmt(bin.upper, 3)}` : "";
                }}
                formatter={(value, name) => [fmtInt(Number(value)), String(name)]}
              />
              {vendors.map((vendor) => (
                <Bar key={vendor} dataKey={vendor} stackId="score" fill={vendorFill(vendor)} stroke={VENDOR_COLORS[vendor] ?? "#8a8a8a"} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Section>

        <Section title={`Headlines per ${bucketHours === 1 ? "hour" : `${bucketHours} hours`} (UTC)`} question="When each distinct headline was first seen, stacked by vendor.">
          <VendorLegend vendors={vendors} />
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={buckets} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={1}>
              {vendorDefs(vendors)}
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="startMs" tickFormatter={(value: number) => fmtTime(value).slice(5, 13)} minTickGap={36} {...AXIS} />
              <YAxis {...AXIS} width={36} allowDecimals={false} />
              <Tooltip {...TOOLTIP} labelFormatter={(value) => `${fmtTime(Number(value))} UTC`} formatter={(value, name) => [fmtInt(Number(value)), String(name)]} />
              {vendors.map((vendor) => (
                <Bar key={vendor} dataKey={vendor} stackId="hour" fill={vendorFill(vendor)} stroke={VENDOR_COLORS[vendor] ?? "#8a8a8a"} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Section>
      </div>

      <Section title="Eight numbers of the score, per vendor" question="Mean, median, standard deviation, skewness, kurtosis, the quartiles and the extremes, one headline counted once.">
        <EightTable rows={summaries} label="vendor" />
      </Section>

      <Section
        title="Every column of the routed frame"
        question="Relevance and score as histograms with their own numbers; direction and tier as counts. The vendor column is the stack above; the title and time columns are the table and the hourly bars."
      >
        <div className="grid gap-2 md:grid-cols-2">
          <CountBars rows={tiers} title="tier: which part of the router sent it here" color={OKABE.sky} />
          <CountBars rows={directions} title="direction: sign the story carries for this root" color={OKABE.purple} />
        </div>
        <ColumnGrid rows={gridRows} title="Routed headlines: numeric columns" />
      </Section>
    </div>
  );
}
