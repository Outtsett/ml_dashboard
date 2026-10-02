/**
 * Process census. The snapshot (landed or sampled live) is fetched once; the
 * name filter, the memory floor, the stacked bars, the eight numbers and the
 * launch-strategy model all redraw in the browser from its rows. Every control
 * is kept in the URL.
 */

import { Camera, Loader2 } from "lucide-react";
import {
  ControlBar, Empty, Finding, SegmentControl, SelectControl, SliderControl, StudyNotes, StudyState, fmtInt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  PROCESS_NAME_OPTIONS, filterProcesses, emptyProcessCensusBody, type ProcessCensusBody,
} from "@shared/studies/process-census";
import { ChainSection } from "./ChainSection";
import { DistributionSection } from "./DistributionSection";
import { HeadlineSection } from "./HeadlineSection";
import { LaunchSection, type LaunchControls } from "./LaunchSection";
import { OwnerSection } from "./OwnerSection";
import { stamp } from "./format";

const LATEST = "latest";

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    source: "landed",
    snapshot: LATEST,
    processName: "node.exe",
    minimumMegabytes: 0,
    logMemory: false,
    launchMode: "npm_run_dev",
    chains: 1,
    mcpServers: 7,
    children: 3,
  });
  const live = controls.source === "live";
  const query = useStudyQuery<ProcessCensusBody>("process-census", { snapshot: live ? "live" : controls.snapshot });
  const body = query.data?.data ?? emptyProcessCensusBody(live ? "live" : "landed");
  const rows = body.rows;
  const shown = filterProcesses(rows, controls.processName, controls.minimumMegabytes);
  const scopeLabel = `${controls.processName === "all processes" ? "all processes" : controls.processName}${controls.minimumMegabytes > 0 ? `, at least ${controls.minimumMegabytes} MB` : ""}`;

  const takeSnapshot = () => {
    if (live) void query.refetch();
    else set("source", "live");
  };
  const setLaunch = (patch: Partial<LaunchControls>) => {
    if (patch.launchMode !== undefined) set("launchMode", patch.launchMode);
    if (patch.chains !== undefined) set("chains", patch.chains);
    if (patch.mcpServers !== undefined) set("mcpServers", patch.mcpServers);
    if (patch.children !== undefined) set("children", patch.children);
  };
  const snapshotOptions = [
    { value: LATEST, label: "latest" },
    ...[...body.snapshots].reverse().map((snapshot) => ({ value: String(snapshot.snapshotTime), label: stamp(snapshot.snapshotTime) })),
  ];

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />

        <ControlBar onReset={reset}>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-neutral-500">Snapshot</span>
            <button
              type="button"
              onClick={takeSnapshot}
              disabled={query.isFetching}
              className="flex h-7 items-center gap-1 rounded border border-neutral-700 px-2 text-[11px] text-neutral-200 hover:border-neutral-500 disabled:opacity-60"
              title="Sample every process on this machine now, as the notebook's button did"
            >
              {query.isFetching && live ? <Loader2 className="h-3 w-3 animate-spin" /> : <Camera className="h-3 w-3" />}
              Take a new snapshot
            </button>
          </div>
          <SegmentControl
            label="Source"
            value={controls.source}
            options={[{ value: "landed", label: "landed" }, { value: "live", label: "live now" }]}
            onChange={(value) => set("source", value)}
            hint="Landed snapshots come from the lake; live samples the machine now"
          />
          {!live && body.snapshots.length > 0 && (
            <SelectControl label="Landed snapshot" value={controls.snapshot} options={snapshotOptions} onChange={(value) => set("snapshot", value)} />
          )}
          <SelectControl
            label="Show processes named"
            value={controls.processName}
            options={PROCESS_NAME_OPTIONS.map((name) => ({ value: name, label: name }))}
            onChange={(value) => set("processName", value)}
          />
          <SliderControl label="Hide anything under (MB)" value={controls.minimumMegabytes} min={0} max={200} step={5} onChange={(value) => set("minimumMegabytes", value)} />
        </ControlBar>

        {rows.length === 0 ? (
          <Empty>
            {live
              ? "The live snapshot returned no processes."
              : "No process snapshot is landed yet. Run packages/ml-engine/src/studies/process_census/build.py with the datalake interpreter, refresh the derived views, or press Take a new snapshot to sample this machine now."}
          </Empty>
        ) : (
          <>
            <HeadlineSection body={body} rows={rows} />
            <OwnerSection rows={shown} scopeLabel={scopeLabel} />
            <ChainSection rows={rows} />
          </>
        )}

        <LaunchSection
          controls={{ launchMode: controls.launchMode, chains: controls.chains, mcpServers: controls.mcpServers, children: controls.children }}
          onChange={setLaunch}
          rows={rows}
        />

        {rows.length > 0 && (
          <>
            <DistributionSection rows={shown} logScale={controls.logMemory} onLogScale={(value) => set("logMemory", value)} />

            <section className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-3">
              <h3 className="text-sm font-semibold text-neutral-100">Collector output</h3>
              {body.collectorLog.length > 0 ? (
                <pre className="mt-2 overflow-x-auto rounded-md bg-neutral-900 p-2 font-mono text-[11px] text-neutral-300">{body.collectorLog.join("\n")}</pre>
              ) : (
                <Finding>
                  Landed snapshot of {stamp(body.snapshotTime)}: {fmtInt(rows.length)} processes read from recipe {body.recipe}. Press Take a new snapshot to sample the machine now.
                </Finding>
              )}
            </section>
          </>
        )}
      </StudyState>
    </div>
  );
}
