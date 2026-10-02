/**
 * Chosen columns as lines over the whole bar set, one panel each, thinned to a
 * point budget, with a dashed vermillion rule at every contract roll. Hovering
 * one panel shows the same bar in all of them.
 */

import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Empty, Finding, GRID, OKABE, Section, SegmentControl, SliderControl, StudyNotes, StudyState,
  SwitchControl, TOOLTIP, fmtInt, fmtTime,
} from "@/studies/kit";
import {
  BAR_COLUMNS, MAXIMUM_DRAWN_COLUMNS, POINT_BUDGETS, thinningStride,
  type CatalogueBody, type SeriesBody, type Timeframe,
} from "@shared/studies/talib-indicator-catalogue";
import { asPointBudget, fmtValue, useLineSeries, type Controls, type SetControl } from "./shared";

const SUGGESTION_COUNT = 14;

function ColumnPicker({ drawn, available, onChange }: { drawn: string[]; available: string[]; onChange: (next: string[]) => void }) {
  const [search, setSearch] = useState("");
  const full = drawn.length >= MAXIMUM_DRAWN_COLUMNS;
  const needle = search.trim().toLowerCase();
  const matches = available.filter((name) => !drawn.includes(name) && name.toLowerCase().includes(needle));
  return (
    <div className="space-y-1 rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider text-neutral-500">Columns drawn ({drawn.length} of {MAXIMUM_DRAWN_COLUMNS})</span>
        {drawn.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onChange(drawn.filter((other) => other !== name))}
            className="rounded border border-[#E69F00]/60 px-1.5 py-0.5 font-mono text-[11px] text-neutral-100 hover:border-neutral-400"
            title={`Stop drawing ${name}`}
          >
            {name} ×
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="find a column to add"
          className="h-7 w-48 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
        />
        {matches.slice(0, SUGGESTION_COUNT).map((name) => (
          <button
            key={name}
            type="button"
            disabled={full}
            onClick={() => onChange([...drawn, name])}
            className="rounded border border-neutral-700 px-1.5 py-0.5 font-mono text-[11px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-100 disabled:opacity-40"
            title={full ? `At most ${MAXIMUM_DRAWN_COLUMNS} columns are drawn at once` : `Draw ${name}`}
          >
            + {name}
          </button>
        ))}
        {matches.length > SUGGESTION_COUNT && <span className="text-[10px] text-neutral-500">and {fmtInt(matches.length - SUGGESTION_COUNT)} more; type to narrow</span>}
      </div>
    </div>
  );
}

function LinePanel({
  column, body, points, zeroAxis, markRolls,
}: {
  column: string; body: SeriesBody; points: SeriesBody["points"]; zeroAxis: boolean; markRolls: boolean;
}) {
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="font-mono text-[11px] font-medium text-neutral-100">{column}</div>
      <ResponsiveContainer width="100%" height={190}>
        <LineChart data={points} syncId="talib-indicator-lines" margin={{ top: 14, right: 12, left: 0, bottom: 16 }}>
          <CartesianGrid {...GRID} />
          <XAxis
            dataKey="bar_index"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value: number) => fmtInt(value)}
            label={{ value: "bar index (traded bars, in time order)", position: "insideBottom", offset: -8, fontSize: 10, fill: "#a3a3a3" }}
            {...AXIS}
          />
          <YAxis
            width={68}
            domain={zeroAxis ? [(lowest: number) => Math.min(0, lowest), (highest: number) => Math.max(0, highest)] : ["auto", "auto"]}
            tickFormatter={(value: number) => fmtValue(value)}
            {...AXIS}
          />
          <Tooltip
            {...TOOLTIP}
            formatter={(value: number) => [fmtValue(value), column]}
            labelFormatter={(_label, payload) => {
              const point = payload?.[0]?.payload as Record<string, number | null> | undefined;
              return point ? `bar ${fmtInt(point.bar_index)} · ${fmtTime(point.timestamp)} (stamped clock)` : "";
            }}
          />
          {markRolls && body.rollContracts.map((roll) => (
            <ReferenceLine
              key={roll.barIndex}
              x={roll.barIndex}
              stroke={OKABE.vermillion}
              strokeDasharray="5 4"
              label={{ value: `roll ${roll.from ?? ""} → ${roll.to}`, position: "top", fontSize: 9, fill: OKABE.vermillion }}
            />
          ))}
          <Line dataKey={column} stroke={OKABE.orange} strokeWidth={1.1} dot={false} isAnimationActive={false} connectNulls={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Lines({ catalogue, timeframe, controls, set }: { catalogue: CatalogueBody; timeframe: Timeframe; controls: Controls; set: SetControl }) {
  const barCount = catalogue.summary?.barCount ?? 0;
  const available = [...BAR_COLUMNS, ...catalogue.columns.map((column) => column.column_name)];
  const drawn = controls.draw.split(",").map((piece) => piece.trim()).filter((name, index, all) => name !== "" && all.indexOf(name) === index).slice(0, MAXIMUM_DRAWN_COLUMNS);
  const pointBudget = asPointBudget(controls.points);
  const query = useLineSeries(timeframe, drawn.join(","), pointBudget, barCount > 0 && drawn.length > 0);
  const body = query.data?.data;

  const lastBar = Math.max(1, barCount - 1);
  const zoomStart = Math.min(Math.max(0, Math.round(controls.zoomStart)), lastBar - 1);
  const zoomEnd = controls.zoomEnd > zoomStart ? Math.min(Math.round(controls.zoomEnd), lastBar) : lastBar;
  const zoomStep = Math.max(1, Math.round(barCount / 400));
  const points = (body?.points ?? []).filter((point) => (point.bar_index ?? 0) >= zoomStart && (point.bar_index ?? 0) <= zoomEnd);
  const stride = body?.stride ?? thinningStride(barCount, pointBudget);
  const columns = (body?.columns ?? []).filter((name) => drawn.includes(name));
  const rolls = body?.rollContracts ?? [];

  return (
    <div className="space-y-3">
      <ColumnPicker drawn={drawn} available={available} onChange={(next) => set("draw", next.join(","))} />
      <ControlBar>
        <SegmentControl
          label="Points drawn per panel"
          value={pointBudget}
          options={POINT_BUDGETS.map((budget) => ({ value: budget, label: budget === 0 ? "every bar" : fmtInt(budget) }))}
          onChange={(value) => set("points", value)}
          hint="The bar set is thinned to every n-th bar to fit this many points; every bar is exact and slower"
        />
        <SliderControl label="First bar shown" value={zoomStart} min={0} max={lastBar - 1} step={zoomStep} onChange={(value) => set("zoomStart", Math.min(value, zoomEnd - 1))} format={(value) => fmtInt(value)} />
        <SliderControl label="Last bar shown" value={zoomEnd} min={1} max={lastBar} step={zoomStep} onChange={(value) => set("zoomEnd", Math.max(value, zoomStart + 1))} format={(value) => fmtInt(value)} />
        <SwitchControl label="Mark contract rolls" checked={controls.markRolls} onChange={(value) => set("markRolls", value)} />
        <SwitchControl label="Include zero on the value axis" checked={controls.zeroAxis} onChange={(value) => set("zeroAxis", value)} hint="Off: the axis fits the values, so small moves are visible. On: the distance from zero is to scale." />
      </ControlBar>

      {drawn.length === 0 ? (
        <Empty>Add a column above to draw it.</Empty>
      ) : (
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={query.data?.notes ?? []} />
          {!body || columns.length === 0 ? (
            <Empty>The bar set returned no points for these columns.</Empty>
          ) : (
            <Section
              title="The chosen columns as lines"
              question={`One panel per column, x = bar index over ${fmtInt(body.barCount)} traded bars (gaps between sessions are closed up), y = the column's own value. ${stride > 1 ? `Every ${fmtInt(stride)}th bar is drawn (${fmtInt(body.points.length)} points), so a spike between drawn bars is not shown.` : "Every bar is drawn."} Dashed vermillion rule: a contract roll.`}
            >
              <div className="grid gap-2 xl:grid-cols-2">
                {columns.map((column) => (
                  <LinePanel key={column} column={column} body={body} points={points} zeroAxis={controls.zeroAxis} markRolls={controls.markRolls} />
                ))}
              </div>
              <Finding>
                {rolls.length > 0
                  ? `The series is the unadjusted front month, so at ${rolls.map((roll) => `bar ${fmtInt(roll.barIndex)} (${roll.from ?? "start"} → ${roll.to})`).join(", ")} the price steps by the calendar spread. Every price-level column (close, a moving average, a band) carries that step, and an indicator with a lookback keeps it inside its window for that many bars afterwards; an oscillator such as rsi_14 absorbs it within its period.`
                  : "This bar set holds a single contract, so no roll is marked."}
                {" "}Read a level column across the rule only after adjusting for the roll.
              </Finding>
            </Section>
          )}
        </StudyState>
      )}
    </div>
  );
}
