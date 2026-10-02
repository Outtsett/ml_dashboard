/**
 * Empirical source of truth: every study's findings in one ledger, and the systematic table of
 * "after a bar like this, what happens next" on MNQ, tested on 2021-2023 and confirmed on
 * 2024 - 2025-06 against the round-trip cost. Laid out introduction -> evidence -> rules.
 */

import { useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, ErrorBar, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AXIS, ControlBar, Finding, GRID, OKABE, Section, SegmentControl, SelectControl, Stat, StudyNotes, StudyState, SwitchControl,
  TOOLTIP, fmt, fmtInt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  EDGE_FAMILIES, EDGE_HORIZONS, EDGE_TIMEFRAMES, MODEL_USES, VERDICTS,
  type EdgeRow, type EdgeVerdict, type InsightRow, type LedgerBody, type Verdict,
} from "@shared/studies/empirical-source-of-truth";

const VERDICT_STYLE: Record<Verdict, { color: string; glyph: string; label: string }> = {
  edge: { color: OKABE.orange, glyph: "▲", label: "Edge" },
  "weak edge": { color: OKABE.yellow, glyph: "△", label: "Weak edge" },
  "no edge": { color: OKABE.grey, glyph: "○", label: "No edge" },
  "negative edge": { color: OKABE.blue, glyph: "▼", label: "Negative edge" },
  fact: { color: OKABE.sky, glyph: "■", label: "Fact" },
  "defect found": { color: OKABE.vermillion, glyph: "✕", label: "Defect found" },
  inconclusive: { color: OKABE.purple, glyph: "?", label: "Inconclusive" },
};

const EDGE_STYLE: Record<EdgeVerdict, { color: string; glyph: string }> = {
  "edge after costs": { color: OKABE.orange, glyph: "▲" },
  "real but smaller than costs": { color: OKABE.yellow, glyph: "△" },
  "not confirmed out of sample": { color: OKABE.purple, glyph: "?" },
  "no edge": { color: OKABE.grey, glyph: "○" },
  "too few events": { color: "#4a4a4a", glyph: "·" },
};

const ALL = "all";

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const style = VERDICT_STYLE[verdict] ?? VERDICT_STYLE.inconclusive;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px]" style={{ borderColor: style.color, color: style.color }}>
      <span aria-hidden="true">{style.glyph}</span>
      {style.label}
    </span>
  );
}

function VerificationMark({ row }: { row: InsightRow }) {
  const text = {
    confirmed: "✓ reproduced from source",
    corrected: "✓ corrected against source",
    "computed here": "✓ computed from the lake by this study",
    unverifiable: "? source could not be re-opened",
  }[row.verification_status];
  return <span className={row.verification_status === "unverifiable" ? "text-[#CC79A7]" : "text-neutral-500"}>{text}</span>;
}

/** Verdict counts per category, the first thing on the page: where the evidence points. */
function EvidenceByCategory({ rows, onPick, picked }: { rows: InsightRow[]; onPick: (category: string) => void; picked: string }) {
  const data = useMemo(() => {
    const byCategory = new Map<string, Record<string, number | string>>();
    for (const row of rows) {
      const entry = byCategory.get(row.category) ?? { category: row.category, total: 0 };
      entry[row.verdict] = (Number(entry[row.verdict]) || 0) + 1;
      entry.total = Number(entry.total) + 1;
      byCategory.set(row.category, entry);
    }
    return [...byCategory.values()].sort((a, b) => Number(b.total) - Number(a.total));
  }, [rows]);
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 26 + 50)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}
        onClick={(state) => { const label = state?.activeLabel; if (typeof label === "string") onPick(label === picked ? ALL : label); }}>
        <CartesianGrid {...GRID} horizontal={false} />
        <XAxis type="number" {...AXIS} allowDecimals={false} label={{ value: "findings", position: "insideBottom", offset: -2, fill: "#8a8a8a", fontSize: 10 }} />
        <YAxis type="category" dataKey="category" width={170} {...AXIS} tick={{ fontSize: 10, fill: "#bdbdbd" }} />
        <Tooltip {...TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        {VERDICTS.map((verdict) => (
          <Bar key={verdict} dataKey={verdict} stackId="v" name={`${VERDICT_STYLE[verdict].glyph} ${VERDICT_STYLE[verdict].label}`}
            fill={VERDICT_STYLE[verdict].color} isAnimationActive={false} cursor="pointer" />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function LedgerTable({ rows }: { rows: InsightRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="max-h-[70vh] overflow-auto rounded border border-neutral-800">
      <table className="w-full text-left text-[11px]">
        <thead className="sticky top-0 z-10 bg-neutral-900 text-neutral-400">
          <tr>
            <th className="p-2">Condition → what was measured</th>
            <th className="p-2 text-right">Value</th>
            <th className="p-2">Baseline it must beat</th>
            <th className="p-2 text-right">Sample</th>
            <th className="p-2">Verdict</th>
            <th className="p-2">What it tells us</th>
            <th className="p-2">How a model uses it</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800 text-neutral-300">
          {rows.map((row) => (
            <>
              <tr key={row.insight_id} className="cursor-pointer align-top hover:bg-neutral-800/40" onClick={() => setOpen(open === row.insight_id ? null : row.insight_id)}>
                <td className="p-2">
                  <div className="font-medium text-neutral-100">{row.condition}</div>
                  <div className="text-neutral-500">{row.measured_quantity}</div>
                  <div className="text-[10px] text-neutral-600">{[row.category, row.instrument, row.timeframe, row.sample_window].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="p-2 text-right font-mono tnum text-neutral-100">
                  {row.value_text}
                  {row.confidence_interval_text && <div className="text-[10px] text-neutral-500">{row.confidence_interval_text}</div>}
                </td>
                <td className="p-2 text-neutral-400">{row.baseline_description || "—"}</td>
                <td className="p-2 text-right font-mono tnum">{fmtInt(row.sample_count)}</td>
                <td className="p-2"><VerdictBadge verdict={row.verdict} /></td>
                <td className="p-2 max-w-[22rem]">{row.interpretation}</td>
                <td className="p-2 max-w-[22rem]">
                  <div className="text-[10px] uppercase tracking-wider text-neutral-500">{row.model_use}</div>
                  {row.model_rule}
                </td>
              </tr>
              {open === row.insight_id && (
                <tr key={`${row.insight_id}-source`} className="bg-neutral-900/60">
                  <td colSpan={7} className="p-2 text-[10px] text-neutral-400">
                    <div><span className="text-neutral-500">Source ({row.evidence_kind}):</span> <span className="font-mono">{row.evidence_source}</span></div>
                    <div><VerificationMark row={row} />{row.verification_note ? ` — ${row.verification_note}` : ""}</div>
                    {row.study_link && <a className="text-[#56B4E9] hover:underline" href={row.study_link}>Open the study →</a>}
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="p-3 text-xs text-neutral-500">No finding matches these filters.</p>}
    </div>
  );
}

function liftData(edges: EdgeRow[], family: string, showAll: boolean) {
  return edges
    .filter((e) => e.family === family && e.verdict !== "too few events" && (showAll || e.verdict !== "no edge"))
    .map((e) => {
      const base = e.confirmation_base_up_share_percent ?? 0;
      const lift = (e.confirmation_up_share_percent ?? base) - base;
      return {
        condition: e.condition,
        lift,
        error: [lift - ((e.confirmation_up_share_low_percent ?? base) - base), ((e.confirmation_up_share_high_percent ?? base) - base) - lift],
        gross: e.confirmation_gross_ticks_per_trade,
        verdict: e.verdict,
        events: e.confirmation_moved_count,
      };
    })
    .sort((a, b) => b.lift - a.lift)
    .slice(0, 40);
}

function ConditionalEdges({ data, controls, set }: {
  data: LedgerBody; controls: { timeframe: string; horizon: number; family: string; showAll: boolean };
  set: (key: "timeframe" | "horizon" | "family" | "showAll", value: never) => void;
}) {
  const rows = useMemo(() => liftData(data.edges, controls.family, controls.showAll), [data.edges, controls.family, controls.showAll]);
  const base = data.baselines.find((b) => b.timeframe === controls.timeframe && b.horizon_bars === controls.horizon && b.split === "confirmation");
  const cost = data.edges[0]?.round_trip_cost_ticks ?? 5.56;
  const counts = data.edgeVerdicts.filter((c) => c.timeframe === controls.timeframe && c.horizon_bars === controls.horizon);
  const count = (v: EdgeVerdict) => counts.find((c) => c.verdict === v)?.cell_count ?? 0;
  const allCounts = (v: EdgeVerdict) => data.edgeVerdicts.filter((c) => c.verdict === v).reduce((s, c) => s + c.cell_count, 0);
  const bestGross = Math.max(...data.edges.map((e) => e.confirmation_gross_ticks_per_trade ?? -Infinity));
  return (
    <Section title="After a bar like this, what happens next? (MNQ, every condition tested)"
      question="Each bar is described by its volume and range against the 20 bars before it, its shape, direction and session. Is the next move up more often than usual, and is it big enough to pay for the trade?">
      <ControlBar onReset={() => { set("timeframe", "1m" as never); set("horizon", 1 as never); set("family", "relative volume x shape x direction" as never); }}>
        <SegmentControl label="Bar size" value={controls.timeframe} options={EDGE_TIMEFRAMES.map((t) => ({ value: t, label: t }))} onChange={(v) => set("timeframe", v as never)} />
        <SegmentControl label="Look ahead (bars)" value={controls.horizon} options={EDGE_HORIZONS.map((h) => ({ value: h, label: String(h) }))} onChange={(v) => set("horizon", v as never)} />
        <SelectControl label="Condition family" value={controls.family} options={EDGE_FAMILIES.map((f) => ({ value: f, label: f }))} onChange={(v) => set("family", v as never)} />
        <SwitchControl label="Show 'no edge' cells too" checked={controls.showAll} onChange={(v) => set("showAll", v as never)} />
      </ControlBar>
      <div className="my-3 grid grid-cols-2 gap-2 md:grid-cols-5">
        <Stat label="Base rate: next move up" value={`${fmt(base?.base_up_share_percent, 2)}%`} hint="All bars of this size and look-ahead, 2024 - 2025-06, flat moves left out" />
        <Stat label="Edge after costs" value={fmtInt(count("edge after costs"))} tone={OKABE.orange} hint="Confirmed out of sample AND pays the round trip" />
        <Stat label="Real, smaller than costs" value={fmtInt(count("real but smaller than costs"))} tone={OKABE.yellow} />
        <Stat label="Not confirmed later" value={fmtInt(count("not confirmed out of sample"))} tone={OKABE.purple} />
        <Stat label="No edge" value={fmtInt(count("no edge"))} />
      </div>
      <Finding>
        <strong>How to read the chart.</strong> Each bar is one condition. Its length is how many percentage points more (right)
        or less (left) often the next move was up than the base rate, measured only on 2024 - 2025-06, after the condition was
        chosen on 2021-2023; the whisker is the 95 % interval. Colour and glyph give the verdict: ▲ pays its costs, △ real but
        too small to trade alone, ? found in 2021-2023 but gone later. The second chart is what each trade would make before
        costs; the dashed line is the {fmt(cost, 2)}-tick round trip it has to clear.
      </Finding>
      <div className="mt-2 grid gap-3 xl:grid-cols-2">
        <ResponsiveContainer width="100%" height={Math.max(260, rows.length * 18 + 60)}>
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis type="number" {...AXIS} label={{ value: "percentage points vs base rate (up share)", position: "insideBottom", offset: -2, fill: "#8a8a8a", fontSize: 10 }} />
            <YAxis type="category" dataKey="condition" width={260} {...AXIS} tick={{ fontSize: 9, fill: "#bdbdbd" }} />
            <ReferenceLine x={0} stroke="#8a8a8a" />
            <Tooltip {...TOOLTIP} formatter={(value: number, name: string) => [name === "lift" ? `${fmt(value, 2)} points` : value, name]} />
            <Bar dataKey="lift" isAnimationActive={false}>
              {rows.map((r) => <Cell key={r.condition} fill={EDGE_STYLE[r.verdict].color} />)}
              <ErrorBar dataKey="error" width={3} stroke="#d4d4d4" direction="x" />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        <ResponsiveContainer width="100%" height={Math.max(260, rows.length * 18 + 60)}>
          <BarChart data={rows} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid {...GRID} horizontal={false} />
            <XAxis type="number" {...AXIS} domain={[(min: number) => Math.min(min, -1), (max: number) => Math.max(max, cost + 0.5)]}
              label={{ value: "ticks per trade before costs, trading the found direction", position: "insideBottom", offset: -2, fill: "#8a8a8a", fontSize: 10 }} />
            <YAxis type="category" dataKey="condition" width={260} {...AXIS} tick={{ fontSize: 9, fill: "#bdbdbd" }} />
            <ReferenceLine x={cost} stroke={OKABE.orange} strokeDasharray="4 3" label={{ value: `round trip ${fmt(cost, 2)}`, fill: OKABE.orange, fontSize: 10, position: "top" }} />
            <ReferenceLine x={0} stroke="#8a8a8a" />
            <Tooltip {...TOOLTIP} formatter={(value: number) => [`${fmt(value, 2)} ticks`, "before costs"]} />
            <Bar dataKey="gross" isAnimationActive={false}>
              {rows.map((r) => <Cell key={r.condition} fill={EDGE_STYLE[r.verdict].color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <Finding>
        <strong>Central point.</strong> Across all {fmtInt(data.edgeVerdicts.reduce((s, c) => s + c.cell_count, 0))} cells (3 bar sizes × 3 look-aheads),{" "}
        {fmtInt(allCounts("edge after costs"))} pay the round trip; {fmtInt(allCounts("real but smaller than costs"))} are real
        and repeat out of sample but are far too small, and the best cell makes {fmt(bestGross, 2)} ticks a trade before a{" "}
        {fmt(cost, 2)}-tick cost. <strong>Why it matters:</strong> a bar's volume, size, shape or direction can tilt a model's
        probabilities by a point or three (a feature), but none of them is a trade by itself.
      </Finding>
    </Section>
  );
}

const USE_ORDER = ["use as feature", "use as filter", "use as veto", "target or label design", "evaluation rule", "cost rule", "needs more data", "reject"] as const;

function RulesByUse({ rows }: { rows: InsightRow[] }) {
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {USE_ORDER.map((use) => {
        const items = rows.filter((r) => r.model_use === use);
        if (items.length === 0) return null;
        return (
          <div key={use} className="rounded border border-neutral-800 p-2">
            <h4 className="mb-1 text-xs font-semibold capitalize text-neutral-100">{use} <span className="text-neutral-500">({items.length})</span></h4>
            <ul className="space-y-1 text-[11px] text-neutral-300">
              {items.map((r) => (
                <li key={r.insight_id} className="flex gap-2">
                  <span style={{ color: VERDICT_STYLE[r.verdict]?.color }} aria-hidden="true">{VERDICT_STYLE[r.verdict]?.glyph}</span>
                  <span><span className="text-neutral-500">{r.condition}:</span> {r.model_rule}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export default function EmpiricalSourceOfTruthPage() {
  const [controls, set] = useStudyControls({ timeframe: "1m", horizon: 1, family: "relative volume x shape x direction", showAll: false });
  const query = useStudyQuery<LedgerBody>("empirical-source-of-truth", { timeframe: controls.timeframe, horizon: controls.horizon });
  const [category, setCategory] = useState<string>(ALL);
  const [verdict, setVerdict] = useState<string>(ALL);
  const [use, setUse] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [tradingOnly, setTradingOnly] = useState(false);
  const data = query.data?.data;
  const insights = useMemo(() => data?.insights ?? [], [data]);
  const categories = useMemo(() => [...new Set(insights.map((r) => r.category))].sort(), [insights]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return insights.filter((r) =>
      (category === ALL || r.category === category) && (verdict === ALL || r.verdict === verdict) && (use === ALL || r.model_use === use)
      && (!tradingOnly || r.model_use !== "infrastructure fact")
      && (!needle || `${r.condition} ${r.measured_quantity} ${r.interpretation} ${r.model_rule} ${r.study_slug}`.toLowerCase().includes(needle)));
  }, [insights, category, verdict, use, search, tradingOnly]);
  const count = (v: Verdict) => insights.filter((r) => r.verdict === v).length;
  const studies = new Set(insights.map((r) => r.study_slug)).size;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-neutral-800 px-6 py-3">
        <h1 className="text-base font-semibold text-neutral-50">Empirical source of truth — every finding, and what a model may do with it</h1>
        <p className="mt-1 max-w-4xl text-xs text-neutral-400">
          <strong className="text-neutral-200">Problem.</strong> Dozens of studies each answered one question, on their own page.
          To build a trading model we need one place that says, for every finding: the exact condition, the number, what it had
          to beat, how many cases stand behind it, whether it held up out of sample, and what a model should therefore do with
          it. Every number below is read from the lake and was re-derived from its source by an independent check.
        </p>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
        <StudyState isLoading={query.isLoading} error={query.error}>
          {query.data && <StudyNotes notes={query.data.notes} />}
          {data && (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <Stat label="Findings" value={fmtInt(insights.length)} hint={`from ${studies} studies and rounds`} />
                <Stat label="▲ Edge" value={fmtInt(count("edge"))} tone={OKABE.orange} hint="Beats its baseline out of sample with an interval clear of zero" />
                <Stat label="△ Weak edge" value={fmtInt(count("weak edge"))} tone={OKABE.yellow} hint="In-sample only, best-of-many, or smaller than costs" />
                <Stat label="○ No edge" value={fmtInt(count("no edge") + count("negative edge"))} />
                <Stat label="■ Facts" value={fmtInt(count("fact"))} tone={OKABE.sky} hint="Data, cost and infrastructure facts a model must respect" />
                <Stat label="✕ Defects" value={fmtInt(count("defect found"))} tone={OKABE.vermillion} />
              </div>

              <Section title="Where the evidence points" question="Findings per area, coloured by verdict. Click an area to filter the ledger below.">
                <EvidenceByCategory rows={insights} onPick={setCategory} picked={category} />
                <Finding>
                  Read across a row: the more orange (▲) the more a model can lean on that area; grey (○) and blue (▼) mean the idea
                  was tested and failed; sky (■) are constraints rather than signals — costs, labels, data meaning.
                </Finding>
              </Section>

              <Section title="The ledger" question="One row per finding. Click a row for its source and how it was checked.">
                <ControlBar onReset={() => { setCategory(ALL); setVerdict(ALL); setUse(ALL); setSearch(""); setTradingOnly(false); }}>
                  <SelectControl label="Area" value={category} options={[{ value: ALL, label: "every area" }, ...categories.map((c) => ({ value: c, label: c }))]} onChange={setCategory} />
                  <SelectControl label="Verdict" value={verdict} options={[{ value: ALL, label: "every verdict" }, ...VERDICTS.map((v) => ({ value: v, label: `${VERDICT_STYLE[v].glyph} ${VERDICT_STYLE[v].label}` }))]} onChange={setVerdict} />
                  <SelectControl label="Model use" value={use} options={[{ value: ALL, label: "every use" }, ...MODEL_USES.map((u) => ({ value: u, label: u }))]} onChange={setUse} />
                  <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wider text-neutral-500">
                    Search
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="wick, volume, zone…" className="h-7 w-48 rounded border border-neutral-700 bg-neutral-900 px-2 text-xs normal-case text-neutral-200" />
                  </label>
                  <SwitchControl label="Trading findings only" checked={tradingOnly} onChange={setTradingOnly} hint="Hide infrastructure facts" />
                </ControlBar>
                <p className="my-2 text-[11px] text-neutral-500">{fmtInt(filtered.length)} of {fmtInt(insights.length)} findings</p>
                <LedgerTable rows={filtered} />
              </Section>

              <ConditionalEdges data={data} controls={controls} set={set as never} />

              <Section title="Conclusions: what to build, what to drop" question="Every finding's model rule, grouped by what it does in a model. Filters above apply.">
                <RulesByUse rows={filtered} />
              </Section>
            </>
          )}
        </StudyState>
      </div>
    </div>
  );
}
