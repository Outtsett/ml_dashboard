/**
 * Section 3: how redundant the indicators are with each other. The matrix is
 * read from the lake (every pair precomputed); click a cell to scatter the pair.
 */

import { useState } from "react";
import { ControlBar, Empty, Finding, Section, SegmentControl, StudyNotes, StudyState, fmt, fmtInt, fmtTime, useStudyQuery } from "@/studies/kit";
import type { CorrelationBody, PairBody } from "@shared/studies/indicator-study";
import { timeframeOf } from "./controls";
import type { TabProps } from "./Page";
import { CommitSlider, DataTable, MatrixCanvas, MultiPicker, Readout, ScatterCanvas, csv, divergingColor } from "./widgets";

function isCorrelation(data: unknown): data is CorrelationBody {
  return typeof data === "object" && data !== null && "correlations" in data;
}

function isPair(data: unknown): data is PairBody {
  return typeof data === "object" && data !== null && "points" in data;
}

export function CorrelationTab({ controls, set, overview }: TabProps) {
  const timeframe = timeframeOf(controls);
  const query = useStudyQuery<unknown>("indicator-study", { part: "correlation", timeframe, variant: controls.correlationVariant, method: controls.method });
  const body = isCorrelation(query.data?.data) ? query.data.data : null;
  const [hover, setHover] = useState<{ row: number; column: number } | null>(null);

  const allGroups = [...new Set((overview?.catalogue ?? []).filter((row) => row.excluded_reason === null).map((row) => row.talib_group))].sort();
  const hiddenGroups = new Set(csv(controls.correlationHiddenGroups));
  const groups = allGroups.filter((group) => !hiddenGroups.has(group));
  const size = body?.columns.length ?? 0;
  const positions = (body?.columns ?? [])
    .map((column, position) => ({ ...column, position }))
    .filter((column) => groups.includes(column.talib_group));
  if (controls.order !== "cluster") positions.sort((a, b) => a.talib_group.localeCompare(b.talib_group) || a.column_name.localeCompare(b.column_name));
  const valueAt = (a: number, b: number) => body?.correlations[a * size + b] ?? null;
  const countAt = (a: number, b: number) => body?.pairCounts[a * size + b] ?? null;

  const pairs: Array<{ column_a: string; column_b: string; correlation: number; pair_count: number | null }> = [];
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = 0; j < positions.length; j += 1) {
      const a = positions[i];
      const b = positions[j];
      if (!a || !b || a.column_name >= b.column_name) continue;
      const value = valueAt(a.position, b.position);
      if (value === null) continue;
      pairs.push({ column_a: a.column_name, column_b: b.column_name, correlation: value, pair_count: countAt(a.position, b.position) });
    }
  }
  pairs.sort((x, y) => Math.abs(y.correlation) - Math.abs(x.correlation));
  const strong = pairs.filter((pair) => Math.abs(pair.correlation) >= 0.9).length;
  const names = positions.map((column) => column.column_name);
  const pairA = names.includes(controls.pairA) ? controls.pairA : (pairs[0]?.column_a ?? "");
  const pairB = names.includes(controls.pairB) ? controls.pairB : (pairs[0]?.column_b ?? "");
  const selectedRow = names.indexOf(pairB);
  const selectedColumn = names.indexOf(pairA);

  const pairQuery = useStudyQuery<unknown>("indicator-study", { part: "pair", timeframe, variant: controls.correlationVariant, method: controls.method, columnA: pairA, columnB: pairB }, { enabled: pairA !== "" && pairB !== "" });
  const pair = isPair(pairQuery.data?.data) ? pairQuery.data.data : null;
  const hovered = hover ? { a: positions[hover.column], b: positions[hover.row] } : null;

  return (
    <Section
      title="3 · Correlation matrix"
      question="Transformed is the one to read: price-level lines as distance from the close, running totals as their change, so the matrix is not just 'everything moves with price'. Flip to raw to see that dominance. Clustered by average linkage on 1 − |ρ|."
    >
      <div className="space-y-2">
        <ControlBar>
          <SegmentControl label="Values" value={controls.correlationVariant} options={[{ value: "transformed", label: "transformed" }, { value: "raw", label: "raw" }]} onChange={(value) => set("correlationVariant", value)} />
          <SegmentControl label="Method" value={controls.method} options={[{ value: "spearman", label: "Spearman" }, { value: "pearson", label: "Pearson" }]} onChange={(value) => set("method", value)} />
          <SegmentControl label="Order" value={controls.order} options={[{ value: "cluster", label: "cluster" }, { value: "group", label: "group then name" }]} onChange={(value) => set("order", value)} />
          <CommitSlider label="Fade cells with |ρ| below" value={controls.floor} min={0} max={0.95} step={0.05} format={(value) => value.toFixed(2)} onCommit={(value) => set("floor", value)} />
          <MultiPicker label="TA-Lib groups" options={allGroups.map((group) => ({ value: group, label: group }))} selected={groups} onChange={(next) => set("correlationHiddenGroups", allGroups.filter((group) => !next.includes(group)).join(","))} />
        </ControlBar>
        <Finding>
          A correlation between two indicators says they are redundant with each other. It says nothing about whether either one predicts direction; that is section 5.
          {body && ` ${fmtInt(names.length)} indicators, ${controls.method}, ${controls.correlationVariant} values, ${timeframe}: ${fmtInt(strong)} of ${fmtInt(pairs.length)} pairs (${pairs.length ? ((strong / pairs.length) * 100).toFixed(1) : "0"}%) have |ρ| ≥ 0.9.`}
        </Finding>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={query.data?.notes ?? []} />
          {body && names.length > 0 ? (
            <div className="relative">
              <p className="text-[11px] text-neutral-400">
                colour: <span style={{ color: divergingColor(-1) }}>■ −1 (blue)</span> · <span style={{ color: divergingColor(0) }}>■ 0</span> ·{" "}
                <span style={{ color: divergingColor(1) }}>■ +1 (orange)</span>; faded = |ρ| below the floor; white outline = the pair scattered below. Click a cell to pick the pair.
              </p>
              <MatrixCanvas
                rowLabels={names}
                columnLabels={names}
                labelSpace={170}
                cell={(row, column) => {
                  const a = positions[column];
                  const b = positions[row];
                  const value = a && b ? valueAt(a.position, b.position) : null;
                  if (value === null) return { color: null };
                  return { color: divergingColor(value), opacity: Math.abs(value) >= controls.floor ? 1 : 0.12 };
                }}
                onHover={setHover}
                selected={selectedRow >= 0 && selectedColumn >= 0 ? { row: selectedRow, column: selectedColumn } : null}
                onSelect={({ row, column }) => {
                  const a = positions[column];
                  const b = positions[row];
                  if (!a || !b) return;
                  set("pairA", a.column_name);
                  set("pairB", b.column_name);
                }}
              />
              {hovered?.a && hovered.b && (
                <div className="absolute right-0 top-0 z-10">
                  <Readout
                    lines={[
                      `indicator A: ${hovered.a.column_name} (${hovered.a.talib_group})`,
                      `indicator B: ${hovered.b.column_name} (${hovered.b.talib_group})`,
                      `correlation ${fmt(valueAt(hovered.a.position, hovered.b.position), 3)}`,
                      `bars where both exist ${fmtInt(countAt(hovered.a.position, hovered.b.position))}`,
                      `clusters ${hovered.a.cluster_number} and ${hovered.b.cluster_number}`,
                    ]}
                  />
                </div>
              )}
            </div>
          ) : (
            <Empty>No indicator in the chosen groups.</Empty>
          )}
        </StudyState>
        <div className="grid gap-3 grid-cols-1 xl:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <p className="text-[11px] text-neutral-300">
              {pair
                ? `${pair.columnA} against ${pair.columnB}: correlation ${fmt(pair.correlation, 3)} (${pair.variant}); ${fmtInt(pair.finiteCount)} bars where both are finite${pair.sampled ? ", sampled to 20,000 points" : ""}.`
                : "Pick a cell to scatter the pair."}
            </p>
            <StudyState isLoading={pairQuery.isLoading} error={pairQuery.error}>
              {pair && pair.points.length > 0 && (
                <ScatterCanvas
                  points={pair.points}
                  xLabel={pair.columnA}
                  yLabel={pair.columnB}
                  describe={(point) => [`bar open ${fmtTime(point[2])} UTC`, `${pair.columnA} ${point[0].toPrecision(5)}`, `${pair.columnB} ${point[1].toPrecision(5)}`]}
                />
              )}
            </StudyState>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[11px] font-semibold text-neutral-200">Most correlated pairs in the current selection (top 200)</p>
            <DataTable
              rows={pairs.slice(0, 200)}
              rowKey={(row) => `${row.column_a}|${row.column_b}`}
              pageSize={15}
              columns={[
                { key: "column_a", label: "column_a", value: (row) => row.column_a },
                { key: "column_b", label: "column_b", value: (row) => row.column_b },
                { key: "correlation", label: "correlation", value: (row) => row.correlation, numeric: true, format: (value) => fmt(value as number, 4) },
                { key: "pair_count", label: "pair_count", value: (row) => row.pair_count, numeric: true },
              ]}
            />
          </div>
        </div>
      </div>
    </Section>
  );
}
