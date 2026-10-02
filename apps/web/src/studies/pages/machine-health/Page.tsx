/**
 * Machine health. The day window, the kind picker and the snapshot choice
 * are sent to the server (one aggregate each); the histogram bins, log
 * switches and the application and group counts redraw from what is already
 * in the browser. Every control is kept in the URL.
 */

import { Finding, OKABE, Stat, StudyNotes, StudyState, fmtInt, fmtTime, useStudyControls, useStudyQuery } from "@/studies/kit";
import { CRASH_KINDS, DEFAULT_HIDDEN_KINDS, type MachineHealthBody } from "@shared/studies/machine-health";
import { ConfigSection } from "./ConfigSection";
import { CoverageSection } from "./CoverageSection";
import { DumpSection } from "./DumpSection";
import { ProcessSection } from "./ProcessSection";
import { ShutdownSection } from "./ShutdownSection";
import { TimelineSection } from "./TimelineSection";

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    dayStart: 0,
    dayEnd: -1,
    hiddenKinds: DEFAULT_HIDDEN_KINDS,
    gapBins: 20,
    gapLog: false,
    applicationCount: 15,
    dumpLog: true,
    snapshotLabel: "",
    groupCount: 25,
    columnBins: 30,
    columnLog: true,
  });
  const query = useStudyQuery<MachineHealthBody>("machine-health", {
    dayStart: controls.dayStart,
    dayEnd: controls.dayEnd,
    hiddenKinds: controls.hiddenKinds,
    snapshotLabel: controls.snapshotLabel,
  });
  const body = query.data?.data;
  const landed = body && body.recipe !== null;

  const crashAndHang = body ? body.coverage.rows.reduce((sum, row) => sum + row.eventCount, 0) : 0;
  const lastRun = body?.indexRuns[body.indexRuns.length - 1];

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!landed || !body ? (
          <Finding>
            The crash indexer&apos;s tables are not in the lake yet. Run packages/ml-engine/src/studies/machine_health/build.py with the datalake interpreter, then refresh the derived views; this page fills in
            with the events, dumps, process snapshots and configuration changes.
          </Finding>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <Finding>
                Landed from the crash indexer&apos;s database, recipe {body.recipe}
                {lastRun ? `; the indexer last ran ${fmtTime(lastRun.runTime)} (Pacific) and added ${fmtInt(lastRun.eventsAdded)} events, ${fmtInt(lastRun.dumpFilesAdded)} dump files` : ""}.
                Every time on this page is Pacific wall clock.
              </Finding>
              <button type="button" onClick={reset} className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200">
                Reset controls
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
              <Stat label="Events logged" value={fmtInt(body.events.totalEventCount)} hint="Every row of the event table, all kinds" />
              <Stat label="Unclean shutdowns" value={fmtInt(body.shutdowns.uncleanShutdownCount)} tone={OKABE.vermillion} hint="Hard resets with and without a bugcheck" />
              <Stat label="Application crashes and hangs" value={fmtInt(crashAndHang)} hint={CRASH_KINDS.join(" and ")} />
              <Stat label="Dump files on disk" value={fmtInt(body.dumps.fileCount)} />
              <Stat label="Span" value={`${fmtInt(body.events.totalDays)} days`} hint={`${body.events.firstDay} to ${body.events.lastDay}`} />
            </div>

            <TimelineSection
              events={body.events}
              dayStart={controls.dayStart}
              dayEnd={controls.dayEnd}
              hiddenKinds={controls.hiddenKinds}
              onWindow={(start, end) => {
                set("dayStart", start);
                set("dayEnd", end);
              }}
              onHiddenKinds={(value) => set("hiddenKinds", value)}
            />
            <ShutdownSection
              shutdowns={body.shutdowns}
              gapBins={controls.gapBins}
              gapLog={controls.gapLog}
              onBins={(value) => set("gapBins", value)}
              onLog={(value) => set("gapLog", value)}
            />
            <CoverageSection coverage={body.coverage} applicationCount={controls.applicationCount} onApplicationCount={(value) => set("applicationCount", value)} />
            <DumpSection dumps={body.dumps} logSize={controls.dumpLog} onLogSize={(value) => set("dumpLog", value)} />
            <ProcessSection
              processes={body.processes}
              comparison={body.comparison}
              groupCount={controls.groupCount}
              columnBins={controls.columnBins}
              columnLog={controls.columnLog}
              onLabel={(label) => set("snapshotLabel", label)}
              onGroupCount={(value) => set("groupCount", value)}
              onColumnBins={(value) => set("columnBins", value)}
              onColumnLog={(value) => set("columnLog", value)}
            />
            <ConfigSection configuration={body.configuration} startup={body.startup} />
          </>
        )}
      </StudyState>
    </div>
  );
}
