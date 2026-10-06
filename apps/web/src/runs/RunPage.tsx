/**
 * The run page (`/training`): launch a model, then read one run on one screen.
 *
 *   left    launch form and every run, live first
 *   middle  the verdict, then five fixed sections of charts and numbers
 *   right   the run's terminal, always beside the charts
 *
 * A run is launched from here or from anywhere that can POST to `/api/runs`
 * (a Claude session, curl); the list is polled, so a new run opens itself.
 */
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "wouter";
import { Square } from "lucide-react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/shared/ui/resizable";
import { RUN_CATEGORIES, RUN_CATEGORY_LABELS, RUN_CATEGORY_QUESTIONS, type RunCategory, type RunView } from "@shared/runs/types";
import { useRun, useRunList, useStopRun } from "@/runs/api";
import { formatDuration, formatStarted, shortModelType, SEVERITY_STYLE, STATUS_STYLE } from "@/runs/format";
import { RunSidebar } from "@/runs/RunSidebar";
import { RunTerminal } from "@/runs/RunTerminal";
import { Verdicts } from "@/runs/Verdicts";
import { Tiles } from "@/runs/Tiles";
import { CalibrationChart, ConfusionGrid, EquityChart, FoldsChart, LossChart, TrialsChart } from "@/runs/charts";

function Section({ category, findings, children }: { category: RunCategory; findings: RunView["verdicts"]; children: React.ReactNode }) {
  const critical = findings.filter((verdict) => verdict.severity === "critical").length;
  const warning = findings.filter((verdict) => verdict.severity === "warning").length;
  return (
    <section id={`run-section-${category}`} className="scroll-mt-10 space-y-2" data-testid={`section-${category}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 border-b border-border pb-1">
        <h2 className="font-mono text-[13px] font-bold uppercase tracking-wide text-foreground">{RUN_CATEGORY_LABELS[category]}</h2>
        <span className="text-[12px] text-muted-foreground">{RUN_CATEGORY_QUESTIONS[category]}</span>
        {category !== "verdict" && critical + warning > 0 && (
          <span className="ml-auto font-mono text-[10px] font-bold">
            {critical > 0 && <span style={{ color: SEVERITY_STYLE.critical.color }}>{SEVERITY_STYLE.critical.glyph} {critical} critical </span>}
            {warning > 0 && <span style={{ color: SEVERITY_STYLE.warning.color }}>{SEVERITY_STYLE.warning.glyph} {warning} warning</span>}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function RunHeader({ run, onStop, stopping }: { run: RunView; onStop: () => void; stopping: boolean }) {
  const status = STATUS_STYLE[run.status];
  const setup = run.setup;
  const progress = run.progress;
  const elapsed = run.finishedAt ? (run.finishedAt - run.startedAt) / 1000 : progress?.elapsedSeconds ?? (Date.now() - run.startedAt) / 1000;
  const fraction = run.status === "running" ? progress?.overallFraction ?? 0 : 1;
  const facts = setup
    ? [
        `${setup.symbol} ${setup.timeframe}`,
        `${setup.barCount.toLocaleString("en-US")} bars`,
        `${setup.featureCount} features`,
        `${setup.foldCount} folds`,
        `label ${setup.labelHorizonBars} bars ahead`,
        setup.tuningTrialCount > 0 ? `${setup.tuningTrialCount} trials per fold` : "no search",
        setup.device,
      ]
    : [];
  return (
    <header className="shrink-0 border-b border-border bg-card/40 px-3 py-2" data-testid="run-header">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="font-mono text-[15px] font-bold text-foreground">{setup?.modelLabel ?? shortModelType(run.modelType)}</h1>
        <span className="rounded border px-1.5 py-0.5 font-mono text-[11px] font-bold" style={{ color: status.color, borderColor: status.color }}>
          {status.glyph} {status.label}
        </span>
        {run.status === "running" && progress && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {progress.phase}
            {progress.foldIndex !== null ? ` · fold ${progress.foldIndex + 1} of ${progress.foldCount}` : ""}
            {progress.trial !== null && progress.trialCount ? ` · trial ${progress.trial + 1} of ${progress.trialCount}` : ""}
          </span>
        )}
        <span className="font-mono text-[11px] text-muted-foreground">
          {formatStarted(run.startedAt)} · {formatDuration(elapsed)}
        </span>
        {run.status === "running" && (
          <button
            type="button"
            onClick={onStop}
            disabled={stopping}
            className="ml-auto flex cursor-pointer items-center gap-1 rounded border border-[#D55E00] px-2 py-0.5 font-mono text-[11px] font-bold text-[#D55E00] disabled:opacity-50"
          >
            <Square className="h-3 w-3" /> {stopping ? "Stopping" : "Stop"}
          </button>
        )}
      </div>
      <div className="mt-1 font-mono text-[10px] text-muted-foreground">{facts.join(" · ") || run.id}</div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-border/60">
        <div className="h-full" style={{ width: `${Math.round(fraction * 100)}%`, backgroundColor: status.color }} />
      </div>
    </header>
  );
}

function RunBody({ run }: { run: RunView }) {
  const of = (category: RunCategory) => run.verdicts.filter((verdict) => verdict.category === category);
  const tilesOf = (category: RunCategory) => run.tiles.filter((tile) => tile.category === category);
  const scope = run.scoreScope === "running" ? `Numbers so far: ${run.barsEvaluated.toLocaleString("en-US")} test bars walked.` : null;
  return (
    <div className="h-full overflow-y-auto" data-testid="run-body">
      <nav className="sticky top-0 z-10 flex flex-wrap gap-1 border-b border-border bg-background/95 px-3 py-1.5 backdrop-blur">
        {RUN_CATEGORIES.map((category) => (
          <a
            key={category}
            href={`#run-section-${category}`}
            onClick={(event) => {
              event.preventDefault();
              document.getElementById(`run-section-${category}`)?.scrollIntoView({ behavior: "auto", block: "start" });
            }}
            className="rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
          >
            {RUN_CATEGORY_LABELS[category]}
          </a>
        ))}
        {scope && <span className="ml-auto font-mono text-[10px] text-[#E69F00]">{scope}</span>}
      </nav>
      <div className="space-y-6 p-3">
        <Section category="verdict" findings={run.verdicts}>
          <Verdicts status={run.status} verdicts={run.verdicts} />
        </Section>
        <Section category="learning" findings={of("learning")}>
          <LossChart epochs={run.epochs} />
        </Section>
        <Section category="prediction" findings={of("prediction")}>
          <Tiles tiles={tilesOf("prediction")} />
          <div className="grid gap-2 xl:grid-cols-2">
            <CalibrationChart bins={run.calibration} />
            <ConfusionGrid cells={run.confusion} />
          </div>
        </Section>
        <Section category="trading" findings={of("trading")}>
          <Tiles tiles={tilesOf("trading")} />
          <EquityChart daily={run.daily} />
        </Section>
        <Section category="tuning" findings={of("tuning")}>
          <TrialsChart trials={run.trials} />
        </Section>
        <Section category="folds" findings={of("folds")}>
          <FoldsChart folds={run.folds} />
        </Section>
      </div>
    </div>
  );
}

export default function RunPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const runs = useRunList();
  const list = runs.data ?? [];
  const requested = searchParams.get("run");
  const [selectedId, setSelectedId] = useState<string | null>(requested);
  const known = useRef<Set<string> | null>(null);
  const stop = useStopRun();

  function select(runId: string) {
    setSelectedId(runId);
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set("run", runId);
      return next;
    }, { replace: true });
  }

  // A run that starts while the page is open (from this page or from the API) opens itself;
  // with nothing chosen, the newest run is shown.
  useEffect(() => {
    if (!runs.data) return;
    const ids = new Set(runs.data.map((run) => run.id));
    const before = known.current;
    known.current = ids;
    const fresh = before ? runs.data.find((run) => run.status === "running" && !before.has(run.id)) : undefined;
    if (fresh) select(fresh.id);
    else if (selectedId === null && runs.data.length > 0) select(runs.data[0]!.id);
    // `select` only writes state and the URL
     
  }, [runs.data]);

  const run = useRun(selectedId);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background" data-testid="run-page">
      <RunSidebar runs={list} selectedId={selectedId} onSelect={select} onStarted={(response) => select(response.runId)} />
      <main className="flex min-w-0 flex-1 flex-col">
        {run.data ? (
          <>
            <RunHeader run={run.data} onStop={() => stop.mutate(run.data.id)} stopping={stop.isPending} />
            <ResizablePanelGroup direction="horizontal" autoSaveId="run-page-split" className="min-h-0 flex-1">
              <ResizablePanel defaultSize={62} minSize={35}>
                <RunBody run={run.data} />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={38} minSize={20}>
                <RunTerminal lines={run.data.logs} live={run.data.status === "running"} />
              </ResizablePanel>
            </ResizablePanelGroup>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
            {selectedId === null
              ? runs.isLoading
                ? "Loading runs."
                : "No runs yet. Pick a model on the left and press Run, or tell Claude to run one."
              : run.isError
              ? `This run could not be read: ${run.error instanceof Error ? run.error.message : String(run.error)}`
              : "Loading the run."}
          </div>
        )}
      </main>
    </div>
  );
}
