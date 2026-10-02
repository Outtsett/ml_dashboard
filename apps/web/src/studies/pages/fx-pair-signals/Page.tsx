/**
 * Forex pairs: cost, correlation and which features survive. Replaced
 * Trading/forexmodel/notebooks/19_pair_signals.py. The screen controls are
 * sent to the server (it filters 5,400 tests in SQL); every other control
 * re-cuts the small tables already on the page.
 */

import {
  ColumnGrid, ControlBar, Empty, OKABE, Section, SelectControl, Stat, StudyNotes, StudyState, fmt, fmtInt, fmtPercent,
  useStudyControls, useStudyQuery,
} from "@/studies/kit";
import { EMPTY_BODY, decodeBody, hourRatio, type FxPairSignalsBody, type FxPairSignalsWire } from "@shared/studies/fx-pair-signals";
import { CostSection } from "./cost";
import { CorrelationSection } from "./correlation";
import { ScreenSection } from "./screen";
import { DEFAULTS, serverControls, type SetControl } from "./controls";

const FRAMES: Array<{ value: string; label: string }> = [
  { value: "pair_inventory", label: "pair inventory (18 rows)" },
  { value: "pair_spread", label: "spread per pair (18 rows)" },
  { value: "pair_spread_hour", label: "spread per pair and hour (432 rows)" },
  { value: "pair_tradability", label: "tradability ladder (126 rows)" },
  { value: "pair_correlation", label: "pair correlation (459 rows)" },
  { value: "correlation_eigen", label: "eigen spectrum (108 rows)" },
  { value: "structure_screen", label: "feature screen, filtered" },
  { value: "structure_redundancy", label: "feature redundancy (1,225 rows)" },
];

function frameRows(body: FxPairSignalsBody, frame: string): ReadonlyArray<Record<string, unknown>> {
  const rows: Record<string, ReadonlyArray<unknown>> = {
    pair_inventory: body.inventory,
    pair_spread: body.spread,
    pair_spread_hour: body.spreadHour,
    pair_tradability: body.tradability,
    pair_correlation: body.correlation,
    correlation_eigen: body.eigen,
    structure_screen: body.screenProfile.map((row) => ({ ...row, absolute_spearman_correlation: Math.abs(row.spearman_correlation) })),
    structure_redundancy: body.redundancy,
  };
  return (rows[frame] ?? []) as ReadonlyArray<Record<string, unknown>>;
}

const TIMESTAMP_COLUMNS = ["first_bar_timestamp", "last_bar_timestamp", "first_quote_timestamp", "last_quote_timestamp"];

export default function Page() {
  const [controls, setControl, reset] = useStudyControls(DEFAULTS);
  const set = setControl as SetControl;
  const query = useStudyQuery<FxPairSignalsWire>("fx-pair-signals", serverControls(controls));
  const body = query.data ? decodeBody(query.data.data) : EMPTY_BODY;
  const landed = body.inventory.length > 0;

  const rollover = hourRatio(body.hourAcrossPairs.map((row) => ({ hour_utc: row.hour_utc, value: row.median_basis_points })));
  const participation = (matrix: string) => body.participation.find((row) => row.timeframe === "1d" && row.matrix === matrix)?.participation_ratio ?? null;
  const survived = body.survival.reduce((sum, row) => sum + row.survived, 0);
  const tests = body.survival.reduce((sum, row) => sum + row.tests, 0);

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!landed ? (
          <Empty>
            The pair research tables are not in the lake yet. Land them with
            <span className="mx-1 font-mono">packages/ml-engine/src/studies/fx_pair_signals/build.py</span>
            (reads forexmodel/results 95-105), then refresh the derived views.
          </Empty>
        ) : (
          <>
            <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
              <Stat label="Pairs" value={fmtInt(body.inventory.length)} hint={`recipe ${body.recipe}`} />
              <Stat label="21:00 UTC spread vs ordinary hours" value={`${fmt(rollover.ratio, 1)}x`} tone={OKABE.orange} hint="median across pairs, hour 21 against the median of hours 0-19" />
              <Stat label="Independent directions at 1d" value={`${fmt(participation("raw"), 2)} → ${fmt(participation("residual"), 2)}`} hint="participation ratio, raw returns → currency-leg residuals" />
              <Stat label="Tests beating the null" value={`${fmtInt(survived)} of ${fmtInt(tests)}`} hint={`${fmtPercent(tests ? survived / tests : null)} under the screen filters`} />
            </div>

            <CostSection body={body} controls={controls} set={set} />
            <CorrelationSection body={body} controls={controls} set={set} />
            <ScreenSection body={body} controls={controls} set={set} fetching={query.isFetching} />

            <Section title="Every column" question="Each numeric column of the chosen frame as its own histogram with its eight numbers.">
              <ControlBar onReset={reset}>
                <SelectControl label="Frame" value={controls.profileFrame} options={FRAMES} onChange={(v) => set("profileFrame", v)} />
              </ControlBar>
              <div className="mt-2">
                <ColumnGrid
                  rows={frameRows(body, controls.profileFrame)}
                  exclude={TIMESTAMP_COLUMNS}
                  title={FRAMES.find((frame) => frame.value === controls.profileFrame)?.label ?? controls.profileFrame}
                />
              </div>
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
