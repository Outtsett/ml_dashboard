/**
 * §10 · Multi-timeframe support/resistance and conditional strategies (derived_ta_conditional_strategies_600_ticks_*):
 * do the levels hold price better than chance, what one session's zones looked like, the Optuna-tuned
 * templates fold by fold, one template's equity against matched random entries, and the pre-registered
 * confirmation.
 */

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import {
  AXIS, ColumnGrid, ControlBar, Empty, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, StudyNotes, StudyState,
  SwitchControl, TOOLTIP, fmt, fmtInt,
} from "@/studies/kit";
import type { ConditionalBody, ConditionalRoundBody, ConditionalSessionBody, ConditionalTemplateBody, Row } from "@shared/studies/ta-strategy-600-ticks";
import {
  BLACK, ChipSelect, DataTable, GlyphMark, GroupedBars, HBarChart, Key, ProfileGrid, SeriesLines, SessionChart, SubHeading, asNumber, colourAt, dashAt,
  splitList, useTa, type Band, type Glyph, type Segment,
} from "./common";
import type { TabProps } from "./controls";

const MEASURES = [
  { key: "held_rate_lift_over_null", label: "vs distance-matched random levels", colour: OKABE.sky },
  { key: "shuffled_lift_over_null", label: "the same in a shuffled world", colour: BLACK },
  { key: "lift_net_of_mechanics", label: "what is left: the real edge", colour: OKABE.vermillion },
];
const REVIEW_COLUMNS = ["round", "rank", "title", "category", "evidence", "expected_ticks_per_day_low", "expected_ticks_per_day_high", "confidence", "verified", "survived_verification", "verifier_reason"];

export function ConditionalTab({ controls, set, overview }: TabProps) {
  const baseQuery = useTa<ConditionalBody>("conditional");
  const base = baseQuery.data?.data;
  const rounds = base?.rounds ?? [];
  const recipe = controls.conditionalRound || String(rounds[rounds.length - 1]?.recipe ?? "");
  const roundQuery = useTa<ConditionalRoundBody>("conditional_round", { recipe, qualitySource: controls.qualitySource }, recipe !== "");
  const round = roundQuery.data?.data;
  const pickedRound = rounds.find((row) => row.recipe === recipe);

  return (
    <div className="space-y-3">
      <StudyState isLoading={baseQuery.isLoading} error={baseQuery.error}>
        <StudyNotes notes={baseQuery.data?.notes ?? []} />
        <Section title="10 · Multi-timeframe support/resistance and conditional strategies"
          question="Every level is an event with the moment it became knowable: prior session / RTH / week high, low and close; the overnight range; the 15- and 30-minute opening ranges; round 100s and 50s; Williams fractals on 15m, 1h and 4h (known only at their confirmation bar); the 5m / 15m / 30m swings (rounds 12+); the session VWAP ±1/±2σ. At each 15m bar the active levels within 6 ATR merge into zones: the nearest below the close is support, the nearest above resistance; a zone's strength is how many distinct families it holds.">
          <ControlBar>
            <SelectControl label="Conditional round" value={recipe || "—"} options={(rounds.length ? rounds : [{ recipe: "—", round: "" }]).map((row) => ({ value: String(row.recipe), label: `round ${String(row.round)} · ${String(row.recipe)}` }))}
              onChange={(value) => set("conditionalRound", value)} />
          </ControlBar>
          {pickedRound && <Finding><b>Round {String(pickedRound.round)}:</b> {String(pickedRound.title)}. {String(pickedRound.hypothesis ?? "")}</Finding>}
          <DataTable rows={rounds} columns={["round", "recipe", "title", "best_template_by_excess", "best_excess_ticks_per_session_day", "best_excess_newey_west_t", "best_net_ticks_per_session_day",
            "reality_check_p_value_across_templates", "level_family_count", "level_families_holding_better_than_chance_net_of_mechanics", "distinct_feasible_trials", "total_optuna_trials", "finished_at"]} pageSize={6} />
        </Section>

        <StudyState isLoading={roundQuery.isLoading} error={roundQuery.error}>
          <StudyNotes notes={roundQuery.data?.notes ?? []} />
          <LevelQuality rows={round?.levelQuality ?? []} source={round?.levelQualitySource ?? ""} recipe={recipe} controls={controls} set={set} />
          <SessionZones recipe={recipe} days={round?.sessionDays ?? []} families={round?.families ?? []} controls={controls} set={set} />
          <Templates recipe={recipe} templates={round?.templates ?? []} folds={round?.folds ?? []} controls={controls} set={set} overview={overview} />
        </StudyState>

        <Confirmation body={base} />

        <Section title="Reviews of the conditional rounds" question="Landed with each round: what to change next and whether it survived verification.">
          <DataTable rows={base?.reviews ?? []} columns={REVIEW_COLUMNS} pageSize={8} />
        </Section>
      </StudyState>
    </div>
  );
}

function LevelQuality({ rows, source, recipe, controls, set }: { rows: Row[]; source: string; recipe: string } & Pick<TabProps, "controls" | "set">) {
  const all = rows.filter((row) => row.year === "all").sort((a, b) => (asNumber(a.lift_net_of_mechanics) ?? 0) - (asNumber(b.lift_net_of_mechanics) ?? 0));
  const families = all.map((row) => String(row.family));
  const family = families.includes(controls.qualityFamily) ? controls.qualityFamily : (families[families.length - 1] ?? "");
  const picked = all.find((row) => row.family === family);
  const years = [...new Set(rows.filter((row) => row.year !== "all").map((row) => String(row.year)))].sort();
  const byYear = years.map((year) => {
    const out: Row = { year };
    for (const row of rows) if (row.year === year) out[String(row.family)] = asNumber(row.lift_net_of_mechanics);
    return out;
  });
  const held = asNumber(picked?.held_rate);
  const heldNull = asNumber(picked?.null_held_rate);
  const shuffled = asNumber(picked?.shuffled_held_rate);
  const shuffledNull = asNumber(picked?.shuffled_null_held_rate);
  const positive = all.filter((row) => (asNumber(row.lift_net_of_mechanics) ?? 0) > 0).length;
  return (
    <Section title="Do the levels hold price?" question="Held rate = the share of first tests where price moved 1×ATR away on the tested side before 1×ATR through the level. Null A puts the same level at the same ATR distance in a random other session; the shuffled world reruns everything on sessions whose minutes were shuffled (the bounce a level definition produces mechanically). Negative means price breaks through more often than chance.">
      <ControlBar>
        <SegmentControl label="Level-quality rows" value={controls.qualitySource}
          options={[{ value: "round", label: "this round" }, { value: "corrected", label: "corrected re-run (fractal window fixed)" }]} onChange={(value) => set("qualitySource", value)}
          hint="Rounds 1-2 ended the fractal quality window at the retirement bar; the round-3 re-run fixed it (derived_..._level_quality_fractal_window_fixed)" />
        <SelectControl label="Family in the formula" value={family || "—"} options={(families.length ? families : ["—"]).map((value) => ({ value, label: value }))} onChange={(value) => set("qualityFamily", value)} />
      </ControlBar>
      <p className="text-[10px] text-neutral-500">Source: {source}</p>
      {controls.qualitySource === "round" && /^round_[12]_/.test(recipe) && all.some((row) => String(row.family).startsWith("fractal")) && (
        <Finding>
          This is round {recipe.split("_")[1]}: its fractal rows end the quality window at the retirement bar, which the round-3 re-run fixed. The fractal numbers below are the
          pre-fix ones; switch "Level-quality rows" to the corrected re-run for the fixed numbers.
        </Finding>
      )}
      <FormulaCard
        tex={"\\text{edge} = (\\text{held} - \\text{held}_{A}) - (\\text{held}^{\\text{shuffled}} - \\text{held}^{\\text{shuffled}}_{A})"}
        caption={`${family}: ${fmtInt(asNumber(picked?.resolved_tests))} resolved first tests; z of the lift over null A ${fmt(asNumber(picked?.lift_z), 2)}.`}
        symbols={[
          { tex: "\\text{held}", name: "held rate at the real level", value: fmt(held, 4) },
          { tex: "\\text{held}_{A}", name: "held rate at null A: same ATR distance, random other session", value: fmt(heldNull, 4) },
          { tex: "\\text{held}^{\\text{shuffled}}", name: "held rate on minute-shuffled sessions", value: shuffled === null ? "not landed for this source" : fmt(shuffled, 4) },
          { tex: "\\text{held}^{\\text{shuffled}}_{A}", name: "null A on minute-shuffled sessions", value: shuffledNull === null ? "not landed for this source" : fmt(shuffledNull, 4) },
          { tex: "\\text{held} - \\text{held}_{A}", name: "lift over null A (held_rate_lift_over_null)", value: fmt(asNumber(picked?.held_rate_lift_over_null), 4) },
          { tex: "\\text{edge}", name: "lift net of mechanics", value: fmt(asNumber(picked?.lift_net_of_mechanics), 4) },
        ]}
      />
      <Finding>{positive} of {all.length} families hold price better than chance once the mechanical bounce is removed.</Finding>
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="min-w-0">
          <Key items={MEASURES.map((measure) => ({ label: `${measure.key}: ${measure.label}`, colour: measure.colour, glyph: "square" as const }))} />
          <HBarChart
            rows={all.map((row) => ({
              label: String(row.family),
              bars: MEASURES.map((measure) => ({ value: asNumber(row[measure.key]), colour: measure.colour, name: measure.key })),
              tooltip: `${String(row.family)}: ${MEASURES.map((measure) => `${measure.key} ${fmt(asNumber(row[measure.key]), 3)}`).join(" · ")} · ${fmtInt(asNumber(row.resolved_tests))} tests`,
            }))}
            references={[{ value: 0, colour: BLACK, label: "0" }]} xLabel="held-rate lift (share of first tests)" rowHeight={26} labelWidth={120}
          />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-neutral-400">Edge net of mechanics, year by year, one line per family (colour and dash both vary).</p>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={byYear} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="year" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 3)} />
              <Legend wrapperStyle={{ fontSize: 9 }} />
              <ReferenceLine y={0} stroke="#737373" />
              {families.map((name, index) => (
                <Line key={name} dataKey={name} stroke={colourAt(index)} strokeDasharray={index >= 8 ? "5 3" : undefined} dot={{ r: 2 }} isAnimationActive={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <DataTable rows={all} />
    </Section>
  );
}

function SessionZones({ recipe, days, families, controls, set }: { recipe: string; days: string[]; families: string[] } & Pick<TabProps, "controls" | "set">) {
  const index = controls.levelSession >= 0 && controls.levelSession < days.length ? controls.levelSession : Math.max(0, days.length - 20);
  const day = days[index] ?? "";
  const chosen = splitList(controls.levelFamilies).filter((family) => families.includes(family));
  const query = useTa<ConditionalSessionBody>("conditional_session", { recipe, day, families: chosen.join(",") }, recipe !== "" && day !== "");
  const bars = query.data?.data.bars ?? [];
  const width = 15 * 60_000;
  const bands: Band[] = [];
  for (const bar of bars) {
    const t = asNumber(bar.bar_timestamp) ?? 0;
    const supportLow = asNumber(bar.support_low);
    const supportHigh = asNumber(bar.support_high);
    const resistanceLow = asNumber(bar.resistance_low);
    const resistanceHigh = asNumber(bar.resistance_high);
    if (supportLow !== null && supportHigh !== null) {
      bands.push({ x0: t, x1: t + width, y0: supportLow, y1: supportHigh === supportLow ? supportLow + 0.5 : supportHigh, colour: OKABE.blue, opacity: 0.25,
        tooltip: `support ${fmt(supportLow, 2)}-${fmt(supportHigh, 2)} · strength ${fmt(asNumber(bar.support_strength), 0)} · ${String(bar.support_families ?? "")}` });
    }
    if (resistanceLow !== null && resistanceHigh !== null) {
      bands.push({ x0: t, x1: t + width, y0: resistanceLow, y1: resistanceHigh === resistanceLow ? resistanceLow + 0.5 : resistanceHigh, colour: OKABE.orange, opacity: 0.25,
        tooltip: `resistance ${fmt(resistanceLow, 2)}-${fmt(resistanceHigh, 2)} · strength ${fmt(asNumber(bar.resistance_strength), 0)} · ${String(bar.resistance_families ?? "")}` });
    }
  }
  const familyIndex = (family: string) => Math.max(0, families.indexOf(family));
  const segments: Segment[] = (query.data?.data.levels ?? []).map((level) => ({
    x0: asNumber(level.drawn_from) ?? 0, x1: asNumber(level.drawn_to) ?? 0, y: asNumber(level.price) ?? 0,
    colour: colourAt(familyIndex(String(level.family))), dash: dashAt(familyIndex(String(level.family))) || (familyIndex(String(level.family)) % 2 ? "5 3" : undefined), width: 2,
    tooltip: `${String(level.source)} ${fmt(asNumber(level.price), 2)} · known ${new Date(asNumber(level.known_from) ?? 0).toISOString().slice(0, 16)} · valid until ${new Date(asNumber(level.valid_until) ?? 0).toISOString().slice(0, 16)}`,
  }));
  return (
    <Section title={`Session ${day || "—"}: price, the nearest support zone and resistance zone at every 15m bar, and each active level`}
      question="Blue band = support, orange band = resistance; each level is drawn only while it was known and valid. Times are Pacific wall clock; the session is named by the date it ends (bar + 9 hours).">
      <ControlBar>
        <SliderControl label="Session" value={index} min={0} max={Math.max(0, days.length - 1)} onChange={(value) => set("levelSession", value)} format={(value) => days[value] ?? "—"} />
        <ChipSelect label="Level families" options={families} selected={chosen} onChange={(next) => set("levelFamilies", next.join(","))} />
      </ControlBar>
      <Key items={[
        { label: "support zone", colour: OKABE.blue, glyph: "square" },
        { label: "resistance zone", colour: OKABE.orange, glyph: "square" },
        { label: "close", colour: BLACK, dash: "" },
        ...chosen.map((family) => ({ label: family, colour: colourAt(familyIndex(family)), dash: dashAt(familyIndex(family)) || (familyIndex(family) % 2 ? "5 3" : "") })),
      ]} />
      <StudyState isLoading={query.isLoading} error={query.error}>
        <SessionChart line={bars.map((bar) => ({ t: asNumber(bar.bar_timestamp) ?? 0, v: asNumber(bar.close) ?? 0 }))} bands={bands} segments={segments} height={400} />
      </StudyState>
    </Section>
  );
}

function Templates({ recipe, templates, folds, controls, set, overview }: TabProps & { recipe: string; templates: Row[]; folds: Row[] }) {
  const names = templates.map((row) => String(row.template));
  const template = names.includes(controls.template) ? controls.template : (names[0] ?? "");
  const query = useTa<ConditionalTemplateBody>("conditional_template", { recipe, template, bins: controls.bins }, recipe !== "" && template !== "");
  const body = query.data?.data;
  let net = 0;
  let matched = 0;
  const equity = (body?.daily ?? []).map((row) => {
    net += asNumber(row.net_ticks) ?? 0;
    matched += asNumber(row.matched_null_net_ticks) ?? 0;
    return { session_date: row.session_date, cumulative_net_ticks: net, cumulative_matched_null_ticks: matched };
  });
  const years = [...new Set((body?.trials ?? []).map((row) => String(row.test_year)))].sort();
  const best = templates[0];
  const references = controls.goalOnAxis ? [{ value: overview.goalTicks, colour: OKABE.orange, label: "600" }, { value: 0, colour: "#737373", label: "" }] : [{ value: 0, colour: "#737373", label: "" }];
  return (
    <>
      <Section title="Conditional templates, tuned on prior years and tested on the next one"
        question="ANDed TA-Lib conditions with several exits (packages/config/ta_conditional_templates.json); Optuna tunes their parameters on the years before each test year. Blue bar: out-of-sample net ticks per day; purple tick: random entries matched on session window, hour and side with the same exits; orange line: 600.">
        <ControlBar>
          <SwitchControl label="Keep the 600 goal on the axis" checked={controls.goalOnAxis} onChange={(value) => set("goalOnAxis", value)} />
        </ControlBar>
        {best && <Finding>Best by excess over matched random: <b>{String(best.template)}</b>, {fmt(asNumber(best.excess_ticks_per_session_day), 1)} ticks/day (Newey-West t {fmt(asNumber(best.excess_newey_west_t), 2)}), net {fmt(asNumber(best.net_ticks_per_session_day), 1)} a day: {fmt(((asNumber(best.net_ticks_per_session_day) ?? 0) / overview.goalTicks) * 100, 1)}% of the goal.</Finding>}
        <HBarChart
          rows={templates.map((row) => ({
            label: String(row.template),
            bars: [{ value: asNumber(row.net_ticks_per_session_day), colour: OKABE.blue, name: "net ticks per session day" }],
            marks: [{ value: asNumber(row.matched_null_net_ticks_per_session_day), glyph: "tick", colour: OKABE.purple, name: "matched random entries" }],
            tooltip: `${String(row.template)}: net ${fmt(asNumber(row.net_ticks_per_session_day), 1)} · matched null ${fmt(asNumber(row.matched_null_net_ticks_per_session_day), 1)} · excess ${fmt(asNumber(row.excess_ticks_per_session_day), 1)} (Newey-West t ${fmt(asNumber(row.excess_newey_west_t), 2)}) · ${fmt(asNumber(row.trades_per_session_day), 2)} trades/day`,
          }))}
          references={references} xLabel="out-of-sample net ticks per session day" rowHeight={20} labelWidth={220}
        />
        <SubHeading>Excess over matched random, test year by test year (orange ▲ above, blue ▼ below)</SubHeading>
        <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          {names.map((name) => (
            <div key={name} className="min-w-0 rounded border border-neutral-800 p-1">
              <div className="truncate text-[10px] text-neutral-300" title={name}>{name}</div>
              <GroupedBars bars={folds.filter((row) => row.template === name).map((row) => ({
                category: String(row.test_year), group: "excess", value: asNumber(row.test_excess_ticks_per_session_day),
                tooltip: `${name} ${String(row.test_year)}: excess ${fmt(asNumber(row.test_excess_ticks_per_session_day), 1)} · net ${fmt(asNumber(row.test_net_ticks_per_session_day), 1)} · ${fmt(asNumber(row.test_trades_per_session_day), 2)} trades/day`,
              }))} groups={["excess"]} colourOf={() => OKABE.orange} signColoured yLabel="ticks/day" height={150} />
            </div>
          ))}
        </div>
        <DataTable rows={templates} caption="Templates (every column)." />
        <DataTable rows={folds} caption="Parameters Optuna chose for each test year (tuned only on the years before it)." pageSize={8} />
        <SubHeading>Templates table: every column</SubHeading>
        <ColumnGrid rows={templates} exclude={["round"]} />
      </Section>

      <Section title={`${template || "—"}: out-of-sample equity against matched random, every Optuna trial, exits, every column`}>
        <ControlBar>
          <SelectControl label="Template" value={template || "—"} options={(names.length ? names : ["—"]).map((value) => ({ value, label: value }))} onChange={(value) => set("template", value)} />
        </ControlBar>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <div className="grid gap-3 xl:grid-cols-2">
            <div className="min-w-0">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={equity} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis dataKey="session_date" {...AXIS} minTickGap={40} />
                  <YAxis {...AXIS} width={56} />
                  <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 1)} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Line dataKey="cumulative_net_ticks" name="cumulative net ticks, 1 contract" stroke={OKABE.purple} dot={false} isAnimationActive={false} />
                  <Line dataKey="cumulative_matched_null_ticks" name="cumulative matched random ticks" stroke={OKABE.blue} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="min-w-0">
              <Key items={years.map((year, index) => ({ label: `test year ${year}`, colour: colourAt(index), glyph: (["circle", "triangle-up", "square", "diamond", "triangle-down", "cross"] as const)[index % 6] }))} />
              <ResponsiveContainer width="100%" height={240}>
                <ScatterChart margin={{ top: 8, right: 12, left: 0, bottom: 14 }}>
                  <CartesianGrid {...GRID} />
                  <XAxis type="number" dataKey="trades_per_session_day" {...AXIS} label={{ value: "training trades per day", position: "insideBottom", offset: -8, fill: "#8a8a8a", fontSize: 10 }} />
                  <YAxis type="number" dataKey="objective_excess_sharpe_per_day" {...AXIS} label={{ value: "objective (excess Sharpe/day, penalised)", angle: -90, position: "insideLeft", fill: "#8a8a8a", fontSize: 9 }} />
                  <ZAxis range={[18, 18]} />
                  <Tooltip {...TOOLTIP} formatter={(value) => fmt(Number(value), 3)} />
                  {years.map((year, index) => (
                    <Scatter key={year} name={year} data={(body?.trials ?? []).filter((row) => String(row.test_year) === year)} isAnimationActive={false}
                      shape={(props: unknown) => {
                        const { cx, cy } = props as { cx?: number; cy?: number };
                        return typeof cx === "number" && typeof cy === "number"
                          ? <GlyphMark glyph={(["circle", "triangle-up", "square", "diamond", "triangle-down", "cross"] as const)[index % 6] as Glyph} x={cx} y={cy} size={3} colour={colourAt(index)} />
                          : <g />;
                      }} />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
          <DataTable rows={body?.exits ?? []} caption="Exits: trades, mean net ticks and mean net R by exit reason." />
          <ProfileGrid profiles={body?.tradeProfiles ?? []} title="Trades of this template" rowCount={body?.tradeCount} bins={controls.bins} onBins={(value) => set("bins", value)} />
        </StudyState>
      </Section>
    </>
  );
}

function Confirmation({ body }: { body: ConditionalBody | undefined }) {
  const confirmation = body?.confirmation;
  const rounds = confirmation?.rounds ?? [];
  const last = rounds[rounds.length - 1];
  if (!last || !confirmation) {
    return <Section title="Pre-registered confirmation"><Empty>Not landed yet.</Empty></Section>;
  }
  const pooled = confirmation.pooled;
  const pooledByDate = new Map(pooled.map((row) => [row.session_date, row.cumulative_pooled_excess_ticks]));
  const extra = { name: "pooled (mean across strategies)", colour: BLACK, values: confirmation.cumulativeExcess.dates.map((date) => pooledByDate.get(date) ?? null) };
  return (
    <Section title={`Pre-registered confirmation on ${String(last.symbol)} ${String(last.span_start)} to ${String(last.span_end)} (frozen before the run): ${last.confirmed ? "CONFIRMED" : "NOT CONFIRMED"}`}
      question={`Pooled excess ${fmt(asNumber(last.pooled_excess_ticks_per_session_day), 2)} ticks/day, t ${fmt(asNumber(last.pooled_excess_newey_west_t), 2)} (black line: pooled). The rule needs t ≥ 2, trimmed t ≥ 2 and 3 of 4 sub-periods positive.`}>
      <SeriesLines set={confirmation.cumulativeExcess} extra={extra} yLabel="cumulative excess over matched random (ticks, 1 contract)" height={300} />
      <DataTable rows={confirmation.strategies} columns={["name", "win_rate", "profit_factor", "net_ticks_per_session_day", "excess_ticks_per_session_day", "excess_newey_west_t",
        "meets_40_percent_win_rate_and_profit_factor_1_33", "trades_per_session_day"]} caption="Against the 40% / 1.33 target." />
      <DataTable rows={rounds} caption="Every confirmation round." />
      <DataTable rows={confirmation.strategies} caption="The confirmed strategies (every column)." />
    </Section>
  );
}
