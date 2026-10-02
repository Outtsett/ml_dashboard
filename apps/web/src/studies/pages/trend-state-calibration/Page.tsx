/**
 * TrendState calibration. One request per (recipe, Globex day) brings every table
 * of the run from the lake; the τ interpolation, the flag replay and the ring-buffer
 * stepper recompute in the browser as the controls move.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  ColumnGrid, ControlBar, Section, SelectControl, StudyNotes, StudyState, fmt, fmtTime, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import type { TrendStateCalibrationBody } from "@shared/studies/trend-state-calibration";
import { Acceptance } from "./Acceptance";
import { Calibration } from "./Calibration";
import { DataTable, SESSION_LABEL, rungStyle } from "./common";
import { Explainer } from "./Explainer";
import { LiveDay } from "./LiveDay";
import { RunHeader } from "./RunHeader";

const TABS = [
  { value: "calibration", label: "Calibration" },
  { value: "acceptance", label: "Acceptance" },
  { value: "live", label: "Live day" },
  { value: "explainer", label: "Explainer" },
  { value: "episodes", label: "Episodes" },
] as const;

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    tab: "calibration",
    recipe: "",
    session: "regular_trading_hours",
    entryStep: 3,
    hiddenSchemes: "",
    day: "",
    tauMultiplier: 1,
    etaMultiplier: 1,
    levelRung: "",
    barsAdmitted: 8,
    bins: 40,
  });
  const query = useStudyQuery<TrendStateCalibrationBody>("trend-state-calibration", {
    recipe: controls.recipe || undefined,
    day: controls.day || undefined,
  });
  const body = query.data?.data;
  const rungs = body?.rungs ?? [];

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!body || body.recipes.length === 0 ? (
          <p className="rounded-md border border-neutral-800 px-3 py-4 text-xs text-neutral-400">
            No TrendState calibration run is in the lake. Run <span className="font-mono">python -m trend.calibrate</span> in Trading/quant/analytics, land it with
            {" "}<span className="font-mono">scripts/land_trend_state_calibration.py</span>, then refresh the derived views.
          </p>
        ) : (
          <>
            <ControlBar onReset={reset}>
              <SelectControl
                label="Calibration run (recipe)"
                value={body.recipe}
                options={body.recipes.map((recipe) => ({ value: recipe, label: recipe }))}
                onChange={(value) => set("recipe", value)}
              />
            </ControlBar>
            <RunHeader settings={body.settings} thresholds={body.thresholds} rungs={rungs} />

            <Tabs value={controls.tab} onValueChange={(value) => set("tab", value)}>
              <TabsList className="flex-wrap">
                {TABS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value} className="text-xs">
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value="calibration" className="mt-3">
                <Calibration
                  controls={{ session: controls.session, entryStep: controls.entryStep, hiddenSchemes: controls.hiddenSchemes }}
                  set={(key, value) => set(key, value as (typeof controls)[typeof key])}
                  rungs={rungs}
                  nullQuantiles={body.nullQuantiles}
                  thresholds={body.thresholds}
                  thresholdGrid={body.thresholdGrid}
                  settings={body.settings}
                />
              </TabsContent>

              <TabsContent value="acceptance" className="mt-3">
                <Acceptance
                  metrics={body.metrics}
                  episodes={body.episodes}
                  distributions={body.distributions}
                  overfitting={body.overfitting}
                  rungs={rungs}
                  settings={body.settings}
                  bins={controls.bins}
                  setBins={(value) => set("bins", value)}
                />
              </TabsContent>

              <TabsContent value="live" className="mt-3">
                <LiveDay
                  controls={{ day: body.day, tauMultiplier: controls.tauMultiplier, etaMultiplier: controls.etaMultiplier, levelRung: controls.levelRung || (rungs[0] ?? "") }}
                  set={(key, value) => set(key, value as (typeof controls)[typeof key])}
                  bars={body.bars}
                  days={body.days}
                  day={body.day}
                  rungs={rungs}
                  thresholds={body.thresholds}
                />
              </TabsContent>

              <TabsContent value="explainer" className="mt-3">
                <Explainer admitted={controls.barsAdmitted} setAdmitted={(value) => set("barsAdmitted", value)} thresholds={body.thresholds} rungs={rungs} />
              </TabsContent>

              <TabsContent value="episodes" className="mt-3 space-y-3">
                <Section title={`Every real episode (${body.episodes.length})`} question="Entry and exit on the Eastern clock as stamped; side ▲ long / ▼ short; net points after the round trip.">
                  <DataTable
                    rows={body.episodes as unknown as Array<Record<string, unknown>>}
                    maxHeight={480}
                    rowKey={(row) => `${String(row.entry_time)}-${String(row.side)}`}
                    columns={[
                      { key: "entry_time", label: "entry time", align: "left", render: (row) => fmtTime(row.entry_time as number) },
                      { key: "exit_time", label: "exit time", align: "left", render: (row) => fmtTime(row.exit_time as number) },
                      { key: "side", label: "side", align: "left", render: (row) => (Number(row.side) > 0 ? <span className="text-[#E69F00]">▲ long</span> : <span className="text-[#0072B2]">▼ short</span>) },
                      { key: "bars", label: "bars" },
                      { key: "session_type", label: "session type", align: "left", render: (row) => SESSION_LABEL[String(row.session_type)] ?? String(row.session_type) },
                      { key: "month", label: "month", align: "left" },
                      { key: "winning_rung", label: "winning rung", align: "left", render: (row) => { const style = rungStyle(rungs.indexOf(String(row.winning_rung))); return <span style={{ color: style.color }}>{style.glyph} {String(row.winning_rung)}</span>; } },
                      { key: "entry_scaled_t", label: "entry scaled t" },
                      { key: "label_at_entry", label: "label at entry" },
                      { key: "label_horizon_bars", label: "label horizon bars" },
                      { key: "agrees_with_label", label: "agrees with label" },
                      { key: "gross_points", label: "gross points", render: (row) => fmt(row.gross_points as number, 2) },
                      { key: "net_points", label: "net points", render: (row) => fmt(row.net_points as number, 2) },
                      { key: "forward_log_return_at_label_horizon", label: "forward log return at label horizon", render: (row) => fmt(row.forward_log_return_at_label_horizon as number, 5) },
                    ]}
                  />
                </Section>
                <Section title="Every column of the episodes" question="One histogram and eight numbers per numeric column.">
                  <ColumnGrid rows={body.episodes as unknown as Array<Record<string, unknown>>} exclude={["entry_time", "exit_time"]} />
                </Section>
              </TabsContent>
            </Tabs>
          </>
        )}
      </StudyState>
    </div>
  );
}
