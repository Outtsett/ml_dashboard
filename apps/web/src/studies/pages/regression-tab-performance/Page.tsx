/**
 * Regression tab performance. The geometry and Y-axis controls re-query the
 * server (a DuckDB aggregate over the measurement tables); the budget, panel
 * count, cache state and frame controls only change what is drawn.
 */

import {
  ColumnGrid, ControlBar, Finding, FormulaCard, OKABE, Section, SegmentControl, SelectControl, SliderControl, Stat, StudyNotes, StudyState, SwitchControl,
  fmt, fmtInt, fmtPercent, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  EMPTY_BODY, FAITHFUL_SHAPE_ERROR, FRAME_MILLISECONDS, GRID_COLUMNS, GRID_ROWS, canvasMilliseconds, nearestLevel,
  type RegressionTabPerformanceBody,
} from "@shared/studies/regression-tab-performance";
import { BudgetCard, BudgetCharts, CanvasChart, ShapeDistribution } from "./RenderSection";
import { CacheOptions, ClientFit, LatencyCharts, LatencyTable } from "./LatencySection";
import { TotalVariationToy } from "./TotalVariationToy";

const FRAMES = [
  { value: "render", label: "render threshold" },
  { value: "canvas", label: "canvas draw" },
  { value: "latency", label: "latency layers" },
  { value: "fit", label: "client fit" },
] as const;

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    budget: 5000,
    geometry: "thumbnail@panel700",
    mode: "all",
    panels: 8,
    cacheState: "cold",
    busyRun: true,
    frame: "render",
  });
  const query = useStudyQuery<RegressionTabPerformanceBody>("regression-tab-performance", { geometry: controls.geometry, mode: controls.mode });
  const body = query.data?.data ?? EMPTY_BODY;
  const budgets = body.budgets;
  const budget = nearestLevel(budgets, controls.budget) ?? controls.budget;
  const budgetIndex = Math.max(0, budgets.indexOf(budget));

  const summary = body.byBudget.find((row) => row.requested_budget === budget);
  const cost = body.steadyMicrosecondsPerPoint === null ? null : canvasMilliseconds(body.steadyMicrosecondsPerPoint, budget, controls.panels);
  const hasData = body.renderRows.length > 0;

  const geometryOptions = (body.geometries.length > 0 ? body.geometries : [controls.geometry]).map((value) => ({ value, label: value }));
  const modeOptions = [{ value: "all", label: "all" }, ...body.modes.map((value) => ({ value, label: value }))];

  const frameRows = {
    render: body.renderRows,
    canvas: body.canvasDraw,
    latency: body.latencyRows,
    fit: body.clientFit,
  }[controls.frame as "render" | "canvas" | "latency" | "fit"] ?? body.renderRows;

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />

        {!hasData ? (
          <p className="rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-4 text-xs text-neutral-300">
            The five measurement tables (derived_regression_tab_performance_render_threshold, canvas_draw, latency_layers, client_fit, cache_option_reference) are not served yet, so there is nothing to draw. They were measured on
            2026-09-23 against MNQ bars and the live dashboard and landed at s3://derived/regression_tab_performance/recipe=measured_2026_09_23/.
          </p>
        ) : (
          <>
            <ControlBar onReset={reset}>
              <SliderControl
                label="Points drawn per panel (budget)"
                value={budgetIndex}
                min={0}
                max={Math.max(0, budgets.length - 1)}
                onChange={(index) => set("budget", budgets[index] ?? controls.budget)}
                format={() => budget.toLocaleString("en-US")}
                hint="Only the budgets that were measured"
              />
              <SelectControl label="Panel (surface @ side-panel width in pixels)" value={controls.geometry} options={geometryOptions} onChange={(value) => set("geometry", value)} />
              <SelectControl label="Y axis" value={controls.mode} options={modeOptions} onChange={(value) => set("mode", value)} />
              <SliderControl label="Panels on screen at once" value={controls.panels} min={1} max={16} onChange={(value) => set("panels", value)} />
              <SwitchControl label="Show run 1 (page was busy)" checked={controls.busyRun} onChange={(value) => set("busyRun", value)} hint="Canvas chart only; the per-point cost always uses the steady runs 2 and 3" />
            </ControlBar>

            <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
              <Stat label="Budget" value={`${budget.toLocaleString("en-US")} points`} hint="Points drawn per panel" />
              <Stat
                label="Median shape error"
                value={summary ? `${fmt(summary.median_shape_error, 4)} ${summary.median_shape_error !== null && summary.median_shape_error < FAITHFUL_SHAPE_ERROR ? "✓ reads true" : "✗ off"}` : "n/a"}
                tone={summary?.median_shape_error !== null && summary?.median_shape_error !== undefined && summary.median_shape_error < FAITHFUL_SHAPE_ERROR ? OKABE.orange : OKABE.blue}
                hint={`Under ${FAITHFUL_SHAPE_ERROR} the picture reads the same as all the data`}
              />
              <Stat label="Variables faithful" value={summary ? `${fmtPercent(summary.share_of_variables_faithful, 0)} of ${summary.series_count}` : "n/a"} hint="Share of series whose shape error is under 0.05" />
              <Stat
                label={`Canvas, ${controls.panels} panels`}
                value={cost ? `${fmt(cost.frame, 1)} ms ${cost.frame <= FRAME_MILLISECONDS ? "✓" : "✗"}` : "n/a"}
                tone={cost && cost.frame <= FRAME_MILLISECONDS ? OKABE.orange : OKABE.blue}
                hint={`One screen frame is ${FRAME_MILLISECONDS} ms`}
              />
            </div>

            <Section title="1. How many points to draw" question="Each panel is a photograph of a crowd: too few points and the photo shows a different crowd; the budget is the smallest crowd whose photo reads the same as all of it.">
              <div className="space-y-4">
                <BudgetCharts rows={body.renderRows} summaries={body.byBudget} budgets={budgets} budget={budget} />

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-neutral-200">Reading the shape error</h4>
                  <Finding>
                    Both all the bars and the drawn points are dropped into the same {GRID_COLUMNS} × {GRID_ROWS} grid of cells ({GRID_COLUMNS * GRID_ROWS} in all) and the two sets of shares are compared. Under {FAITHFUL_SHAPE_ERROR}, fewer than 5% of the cloud is out of place.
                  </Finding>
                  <FormulaCard
                    tex={"\\mathrm{TV} = \\tfrac{1}{2}\\sum_{i=1}^{600}\\left|\\,p_i - q_i\\,\\right|"}
                    caption={`At a budget of ${budget.toLocaleString("en-US")} the median series has TV = ${fmt(summary?.median_shape_error, 4)}.`}
                    symbols={[
                      { tex: "\\mathrm{TV}", name: "total-variation distance: the share of the cloud drawn in the wrong place (0 identical, 1 nothing in common)", value: fmt(summary?.median_shape_error, 4) },
                      { tex: "i", name: `cell index: one of the ${GRID_COLUMNS} × ${GRID_ROWS} = ${GRID_COLUMNS * GRID_ROWS} cells the plot is divided into`, value: `1 to ${GRID_COLUMNS * GRID_ROWS}` },
                      { tex: "p_i", name: "share of ALL bars in cell i", value: `${fmt(1 / (GRID_COLUMNS * GRID_ROWS), 4)} on average (shares sum to 1)` },
                      { tex: "q_i", name: "share of the DRAWN points in cell i (the thinned points on screen)", value: `${fmtInt(summary?.median_points_drawn)} points drawn` },
                      { tex: "\\sum", name: "sum over the 600 cells: add every cell's difference", value: "600 terms" },
                      { tex: "\\tfrac12", name: "one half: each misplaced point is counted twice, where it is missing and where it is extra", value: "0.5" },
                    ]}
                  />
                  <p className="text-[11px] text-neutral-400">Step through the sum on a toy grid of eight cells (the measurements above use 600):</p>
                  <TotalVariationToy />
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="min-w-0">
                    <BudgetCard summary={summary} budget={budget} panels={controls.panels} microsecondsPerPoint={body.steadyMicrosecondsPerPoint} />
                  </div>
                  <div className="min-w-0">
                    <h4 className="mb-1 text-xs font-semibold text-neutral-200">Canvas time against points drawn</h4>
                    <CanvasChart rows={body.canvasDraw} budget={budget} steadyRange={body.steadyRange} steadyMicrosecondsPerPoint={body.steadyMicrosecondsPerPoint} includeBusyRun={controls.busyRun} />
                  </div>
                </div>

                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-neutral-200">Shape error across the selected variables at a budget of {budget.toLocaleString("en-US")}</h4>
                  <ShapeDistribution rows={body.renderRows} budget={budget} />
                </div>
              </div>
            </Section>

            <Section title="2. Where the time goes, and where Redis would sit" question="Median read time of the regression tab's lake columns, cold (first read) and warm (repeat).">
              <div className="space-y-3">
                <ControlBar>
                  <SegmentControl label="Cache state" value={controls.cacheState} options={[{ value: "cold", label: "cold" }, { value: "warm", label: "warm" }]} onChange={(value) => set("cacheState", value)} />
                </ControlBar>
                <LatencyCharts byObject={body.latencyByObject} byRule={body.latencyByRule} cacheState={controls.cacheState} />
                <LatencyTable groups={body.latencyGroups} />
                <CacheOptions options={body.cacheOptions} />
              </div>
            </Section>

            <Section title="3. The other real cost: fitting on the page's own thread">
              <ClientFit rows={body.clientFit} />
            </Section>

            <Section title="4. Every column of every measurement table" question="Each numeric column as its own histogram with its eight numbers.">
              <div className="space-y-2">
                <ControlBar>
                  <SegmentControl label="Table" value={controls.frame} options={FRAMES.map((frame) => ({ value: frame.value, label: frame.label }))} onChange={(value) => set("frame", value)} />
                </ControlBar>
                <ColumnGrid key={controls.frame} rows={frameRows} title={FRAMES.find((frame) => frame.value === controls.frame)?.label ?? "Every column"} />
              </div>
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
