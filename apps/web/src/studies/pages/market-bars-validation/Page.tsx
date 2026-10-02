/**
 * Every column of market_bars validated against the lake. The page reads the
 * landed validation record once (GET /api/studies/market-bars-validation) and
 * every control filters or re-orders it in the browser. Controls live in the
 * URL, so a view is linkable.
 */

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ColumnGrid, GRID, OKABE, Section, Stat, StudyNotes, StudyState, TOOLTIP, Finding,
  fmt, fmtInt, fmtPercent, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import { EMPTY_BODY, type ValidationBody } from "@shared/studies/market-bars-validation";
import { ChecksTable, type CheckFilter } from "./ChecksTable";
import { Coverage, type CoverageOrder } from "./Coverage";
import { Distribution } from "./Distribution";
import { Fill, type FillMeasure, type FillOrder } from "./Fill";
import { Sums } from "./Sums";
import { outcomeLabel, stamp } from "./format";

/** What each tier proves, in the order of how hard it is to fool. `distinct` runs inside the exact tier. */
const TIER_EXPLAINER: Array<{ tier: string; proves: string }> = [
  { tier: "schema", proves: "24 columns, the rename mapping, every type pair." },
  { tier: "exact", proves: "Non-null count, minimum and maximum per column per slice, plus the row count and the set of distinct values of each text column. Order-independent, so a mismatch is a defect and never arithmetic noise." },
  { tier: "sum", proves: "Sums: integers exactly, floats to a relative 1e-9, because both engines accumulate float sums plainly and order-dependently." },
  { tier: "fingerprint", proves: "bit_xor over the raw IEEE-754 bits of every double: exact and order-independent, so it settles the floats rather than calling them close enough." },
  { tier: "invariant", proves: "What must be true of an OHLCV bar, run on both sides: a violation in both is vendor data, in only one a copy defect." },
  { tier: "bitexact", proves: "Whole days pulled from both sides and compared value by value, floats as their IEEE-754 bits." },
  { tier: "distribution", proves: "The eight numbers per column, as evidence to read rather than a gate." },
];

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    tierFilter: "all",
    columnFilter: "all",
    outcome: "all",
    search: "",
    coverageOrder: "alphabetical",
    fillMeasure: "percent",
    fillOrder: "rows",
    fillColumn: "bid_open",
    fillSlice: 1,
    sumColumn: "open",
    sumSlice: "futures 1s",
  });
  const query = useStudyQuery<ValidationBody>("market-bars-validation");
  const body = query.data?.data ?? EMPTY_BODY;
  const { kpis } = body;

  const tierNames = body.tiers.map((entry) => entry.tier).sort();
  const coverageTiers = TIER_EXPLAINER.map((entry) => entry.tier).filter((tier) => tierNames.includes(tier));
  const realColumns = [...new Set(body.checks.map((check) => check.column_name))].sort();
  const failures = body.checks.filter((check) => !check.matched);
  const distinctChecks = body.checks.filter((check) => check.tier === "exact" && check.check_name.startsWith("distinct"));
  const filter: CheckFilter = { tier: controls.tierFilter, column: controls.columnFilter, outcome: controls.outcome, search: controls.search };

  const tierChart = body.tiers.map((entry) => ({ tier: entry.tier, passed: entry.passed, failed: entry.failed, total: entry.total, last: entry.lastRecordedTimestamp }));

  const distributionFrame = body.distribution.map((row) => ({ column: row.column, ...row.statistics }));

  return (
    <div className="min-w-0 space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />

        {!body.available ? (
          <p className="rounded-md border border-neutral-800 bg-neutral-900/50 px-3 py-3 text-xs text-neutral-300">
            The validation record is not in the lake, so there is nothing to show. It is landed by
            <code className="mx-1 font-mono">packages/ml-engine/src/studies/market_bars_validation/build.py</code>
            from the validator's database; run it, then refresh the derived views.
          </p>
        ) : (
          <>
            <Finding>
              {fmtInt(body.lakeRowCount)} rows landed and the per-slice counts match. That says every row arrived; it says nothing about whether the values did. This is the column-level
              evidence for the copy into {body.measurement?.comparison_target ?? "PostgreSQL"}, recorded {stamp(body.measurement?.first_recorded_timestamp)} to {stamp(body.measurement?.last_recorded_timestamp)} (the validator's clock).
              Each check shows its most recent result, whenever its tier last ran: the tiers cost very different amounts and are run individually as often as together.
            </Finding>

            <div className="grid gap-2 grid-cols-2 xl:grid-cols-5">
              <Stat label="Checks run" value={fmtInt(kpis.checkCount)} hint={`latest result per check, across ${kpis.tierCount} tiers`} />
              <Stat label="Passed" value={fmtInt(kpis.passedCount)} tone={OKABE.blue} hint={`${fmtPercent(kpis.checkCount ? kpis.passedCount / kpis.checkCount : null)} of all checks`} />
              <Stat label="Failed" value={fmtInt(kpis.failedCount)} tone={kpis.failedCount > 0 ? OKABE.vermillion : undefined} hint={kpis.failedCount > 0 ? "every one is listed below" : "nothing to chase"} />
              <Stat label="Columns covered" value={`${kpis.columnsCovered}/${kpis.columnTotal}`} hint={kpis.uncoveredColumns.length === 0 ? "every column in the table" : `not covered: ${kpis.uncoveredColumns.join(", ")}`} />
              <Stat label="Earlier results replaced" value={fmtInt(body.supersededCount)} hint="a later run of the same check superseded them" />
            </div>
            {kpis.uncoveredColumns.length > 0 && <Finding>Not covered by any check: {kpis.uncoveredColumns.join(", ")}. An untested column is not a passing one.</Finding>}

            <div className="grid gap-3 xl:grid-cols-2">
              <Section title="Pass and fail by tier" question="A tier with no bar has not been run in this pass.">
                <p className="mb-1 text-[11px] text-neutral-400">
                  <span style={{ color: OKABE.blue }}>■ ✓ passed</span> · <span style={{ color: OKABE.vermillion }}>▨ ✕ failed</span>
                </p>
                <ResponsiveContainer width="100%" height={Math.max(180, 34 * tierChart.length)}>
                  <BarChart data={tierChart} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <defs>
                      <pattern id="failedHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                        <rect width="6" height="6" fill={OKABE.vermillion} />
                        <rect width="3" height="6" fill="#7a3200" />
                      </pattern>
                    </defs>
                    <CartesianGrid {...GRID} horizontal={false} />
                    <XAxis type="number" {...AXIS} />
                    <YAxis type="category" dataKey="tier" width={90} {...AXIS} interval={0} />
                    <Tooltip
                      {...TOOLTIP}
                      content={({ payload }) => {
                        const row = payload?.[0]?.payload as (typeof tierChart)[number] | undefined;
                        if (!row) return null;
                        return (
                          <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                            <div className="font-semibold">{row.tier}</div>
                            <div>✓ passed {fmtInt(row.passed)} · ✕ failed {fmtInt(row.failed)} · total {fmtInt(row.total)}</div>
                            <div>last recorded {stamp(row.last)}</div>
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="passed" name="✓ passed" stackId="outcome" fill={OKABE.blue} isAnimationActive={false} />
                    <Bar dataKey="failed" name="✕ failed" stackId="outcome" fill="url(#failedHatch)" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </Section>

              <Section title="What each tier proves" question="Ordered by how hard each is to fool.">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-neutral-500">
                      {["tier", "checks", "failed", "last run", "what it proves"].map((heading) => <th key={heading} className="px-2 py-1 font-normal">{heading}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {TIER_EXPLAINER.map((entry) => {
                      const outcome = body.tiers.find((tier) => tier.tier === entry.tier);
                      return (
                        <tr key={entry.tier} className="border-t border-neutral-900 align-top">
                          <td className="px-2 py-1 font-semibold text-neutral-200">{entry.tier}</td>
                          <td className="px-2 py-1 font-mono tnum text-neutral-200">{outcome ? fmtInt(outcome.total) : "not run"}</td>
                          <td className="px-2 py-1 font-mono tnum text-neutral-200">{outcome ? fmtInt(outcome.failed) : "—"}</td>
                          <td className="whitespace-nowrap px-2 py-1 font-mono text-neutral-500">{stamp(outcome?.lastRecordedTimestamp)}</td>
                          <td className="px-2 py-1 text-neutral-400">{entry.proves}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="mt-2 text-[11px] text-neutral-500">
                  The distinct-value checks ({fmtInt(distinctChecks.length)}) are recorded inside the exact tier; none of the tiers is named distinct.
                </p>
              </Section>
            </div>

            <Section title="Every failure" question="Listed in full, never summarised to a count.">
              {failures.length === 0 ? (
                <p className="text-xs text-neutral-300"><span style={{ color: OKABE.blue }}>✓</span> No failures in the most recent run: all {fmtInt(kpis.checkCount)} checks matched.</p>
              ) : (
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-neutral-500">
                      {["tier", "column", "check", "lake value", "PostgreSQL value", "outcome"].map((heading) => <th key={heading} className="px-2 py-1 font-normal">{heading}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {failures.map((check) => (
                      <tr key={`${check.tier}|${check.column_name}|${check.check_name}`} className="border-t border-neutral-900">
                        <td className="px-2 py-0.5 text-neutral-400">{check.tier}</td>
                        <td className="px-2 py-0.5 font-mono text-neutral-200">{check.column_name}</td>
                        <td className="px-2 py-0.5 text-neutral-300">{check.check_name}</td>
                        <td className="px-2 py-0.5 font-mono text-neutral-200">{check.lake_value ?? "—"}</td>
                        <td className="px-2 py-0.5 font-mono text-neutral-200">{check.postgres_value ?? "—"}</td>
                        <td className="px-2 py-0.5" style={{ color: OKABE.vermillion }}>{outcomeLabel(false)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>

            <div className="grid gap-3 xl:grid-cols-2">
              <Section title="Coverage per column" question={`Which of the ${kpis.columnTotal} columns each tier actually reached. A column with no mark in a tier was not tested by it.`}>
                <Coverage
                  cells={body.coverage}
                  tableColumns={body.tableColumns}
                  tiers={coverageTiers}
                  order={controls.coverageOrder as CoverageOrder}
                  onOrder={(value) => set("coverageOrder", value)}
                />
              </Section>

              <Section title="How full is each column?" question="The validation's own non-null counts, read as a data fact rather than a pass or fail.">
                <Fill
                  fill={body.fill}
                  checks={body.checks}
                  lakeRowCount={body.lakeRowCount}
                  measure={controls.fillMeasure as FillMeasure}
                  onMeasure={(value) => set("fillMeasure", value)}
                  order={controls.fillOrder as FillOrder}
                  onOrder={(value) => set("fillOrder", value)}
                  column={controls.fillColumn}
                  onColumn={(value) => set("fillColumn", value)}
                  sliceStep={controls.fillSlice}
                  onSliceStep={(value) => set("fillSlice", value)}
                />
              </Section>
            </div>

            <Section
              title="Invariants, both sides"
              question="Each rule runs against the lake and against PostgreSQL with the identical predicate. The two counts agreeing is the copy being faithful; a non-zero count is a statement about the vendor data, a separate question."
            >
              {body.invariants.length === 0 ? (
                <p className="text-xs text-neutral-500">The invariant tier has not been run in this pass.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="text-left text-neutral-500">
                        {["invariant", "why it matters", "lake violations", "PostgreSQL violations", "sides agree"].map((heading) => <th key={heading} className="px-2 py-1 font-normal">{heading}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {body.invariants.map((row) => (
                        <tr key={row.invariant} className="border-t border-neutral-900">
                          <td className="whitespace-nowrap px-2 py-0.5 font-mono text-neutral-200">{row.invariant}</td>
                          <td className="px-2 py-0.5 text-neutral-400">{row.whyItMatters}</td>
                          <td className="px-2 py-0.5 font-mono tnum text-neutral-200">{row.lakeViolations ?? "—"}</td>
                          <td className="px-2 py-0.5 font-mono tnum text-neutral-200">{row.postgresViolations ?? "—"}</td>
                          <td className="whitespace-nowrap px-2 py-0.5" style={{ color: row.sidesAgree ? OKABE.blue : OKABE.vermillion }}>{row.sidesAgree ? "✓ agree" : "✕ differ"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>

            <Section title="Sums and fingerprints" question="Float sums to a relative 1e-9; the IEEE-754 bit fingerprint settles the floats exactly.">
              <Sums
                sums={body.sums}
                fingerprints={body.fingerprints}
                checks={body.checks}
                column={controls.sumColumn}
                onColumn={(value) => set("sumColumn", value)}
                slice={controls.sumSlice}
                onSlice={(value) => set("sumSlice", value)}
              />
            </Section>

            <Section title="The eight numbers, per column" question="Mean and standard deviation describe a Gaussian and almost nothing here is one: the skewness and kurtosis show the fat tail a flattering mean hides, and the minimum and maximum show the single print driving it.">
              {body.distribution.length === 0 ? <p className="text-xs text-neutral-500">The distribution tier has not been run in this pass.</p> : <Distribution rows={body.distribution} />}
            </Section>

            <Section title="Every numeric column of the record" question="The distribution statistics across columns, the non-null counts and the sum differences, each as its own histogram.">
              <div className="space-y-4">
                <ColumnGrid rows={distributionFrame} title="Statistics across the 18 summarised columns" />
                <ColumnGrid rows={body.fill} title="Fill rate per column" />
                <ColumnGrid rows={body.sums} title="Sums compared" />
              </div>
            </Section>

            <Section title="Every check in the run" question={`${fmt(kpis.checkCount, 0)} latest results, filterable.`}>
              <ChecksTable
                checks={body.checks}
                tiers={tierNames}
                columns={realColumns}
                filter={filter}
                onFilter={(key, value) => {
                  if (key === "tier") set("tierFilter", value);
                  else if (key === "column") set("columnFilter", value);
                  else if (key === "outcome") set("outcome", value);
                  else set("search", value);
                }}
              />
            </Section>

            <button type="button" onClick={reset} className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200">
              Reset every control
            </button>
          </>
        )}
      </StudyState>
    </div>
  );
}
