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
import { PanelLeftClose, PanelLeftOpen, Square } from "lucide-react";

import { RUN_CATEGORIES, RUN_CATEGORY_LABELS, RUN_CATEGORY_QUESTIONS, type RunCategory, type RunView } from "@shared/runs/types";
import { useRun, useRunList, useRunnableModels, useStopRun } from "@/runs/api";
import { analyticsFamilyOf, FAMILY_LABELS, FAMILY_PANELS } from "@/runs/analytics/families";
import { formatDuration, formatStarted, shortModelType, SEVERITY_STYLE, STATUS_STYLE } from "@/runs/format";
import { RunSidebar } from "@/runs/RunSidebar";
import { RunTerminal } from "@/runs/RunTerminal";
import { RunBarsChart } from "@/runs/RunBarsChart";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/shared/ui/resizable";
import { useRunBars } from "@/runs/api";
import { Verdicts } from "@/runs/Verdicts";
import { Tiles } from "@/runs/Tiles";
import { CalibrationChart, ConfusionGrid, EquityChart, FoldsChart, LossChart, TrialsChart } from "@/runs/charts";
import { LearningGrid, LossSurfacePanel } from "@/runs/learning";
import { TrialParameterChart } from "@/runs/search";
import { MetricReadouts } from "@/runs/foldGrid";

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
        <h1 className="font-mono text-[15px] font-bold text-foreground">
          {run.name}
          <span className="font-normal text-muted-foreground"> · {setup?.modelLabel ?? shortModelType(run.modelType)}{run.version ? ` v${run.version}` : ""}</span>
        </h1>
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
      {setup && <div className="mt-1 text-[12px] text-foreground/90">{setup.purpose}</div>}
      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">{facts.join(" · ") || run.id}</div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-border/60">
        <div className="h-full" style={{ width: `${Math.round(fraction * 100)}%`, backgroundColor: status.color }} />
      </div>
    </header>
  );
}

function RunBody({ run }: { run: RunView }) {
  const of = (category: RunCategory) => run.verdicts.filter((verdict) => verdict.category === category);
  // which analytics this kind of model owns (`runs/analytics/families.ts`)
  const models = useRunnableModels();
  const modelKey = run.modelType.replace(/\+walk_forward_cycle$/, "");
  const kind = models.data?.find((entry) => entry.key === modelKey)?.kind ?? null;
  const family = analyticsFamilyOf(kind, modelKey);
  const panels = new Set(FAMILY_PANELS[family]);
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
          <div className="font-mono text-[10px] text-muted-foreground">Panels for a {FAMILY_LABELS[family].toLowerCase()}.</div>
          <LossChart epochs={run.epochs} />
          {panels.has("learning_curves") && <LearningGrid epochs={run.epochs} />}
          {panels.has("loss_surface") && <LossSurfacePanel surfaces={run.lossSurfaces} modelLabel={run.setup?.modelLabel ?? null} />}
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
          <TrialParameterChart trials={run.trials} />
        </Section>
        <Section category="folds" findings={of("folds")}>
          <FoldsChart folds={run.folds} />
          <MetricReadouts metrics={run.metrics} folds={run.folds} />
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
  // the terminal is a page of its own, not a pane beside the charts; the choice is remembered
  const [view, setViewState] = useState<"charts" | "terminal">(() => {
    try {
      return window.localStorage.getItem("run-page-view") === "terminal" ? "terminal" : "charts";
    } catch {
      return "charts";
    }
  });
  function setView(next: "charts" | "terminal") {
    setViewState(next);
    try {
      window.localStorage.setItem("run-page-view", next);
    } catch {
      // storage can be unavailable; the view still switches
    }
  }
  // the run list can be put away to give the charts the width; the choice is remembered
  const [sidebarOpen, setSidebarOpenState] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("run-page-sidebar") !== "closed";
    } catch {
      return true;
    }
  });
  function setSidebarOpen(next: boolean) {
    setSidebarOpenState(next);
    try {
      window.localStorage.setItem("run-page-sidebar", next ? "open" : "closed");
    } catch {
      // storage can be unavailable; the rail still toggles
    }
  }
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
  const live = run.data?.status === "running";
  const bars = useRunBars(view === "terminal" ? selectedId : null, live);
  // the bar a terminal line named (chart scrolls there) and the bar clicked on the chart (terminal scrolls there)
  const [focusTime, setFocusTime] = useState<number | null>(null);
  const [seekTime, setSeekTime] = useState<number | null>(null);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background" data-testid="run-page">
      {sidebarOpen && <RunSidebar runs={list} selectedId={selectedId} onSelect={select} onStarted={(response) => select(response.runId)} />}
      <main className="flex min-w-0 flex-1 flex-col">
        {run.data ? (
          <>
            <RunHeader run={run.data} onStop={() => stop.mutate(run.data.id)} stopping={stop.isPending} />
            <div className="flex shrink-0 items-center gap-1 border-b border-border bg-card/40 px-3 py-1">
              <button
                type="button"
                onClick={() => setSidebarOpen(!sidebarOpen)}
                title={sidebarOpen ? "Hide the run list" : "Show the run list"}
                aria-label={sidebarOpen ? "Hide the run list" : "Show the run list"}
                aria-pressed={sidebarOpen}
                className="mr-1 flex cursor-pointer items-center gap-1 rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                data-testid="toggle-sidebar"
              >
                {sidebarOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
                Runs
              </button>
              {(["charts", "terminal"] as const).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => setView(entry)}
                  className={`cursor-pointer rounded px-2.5 py-0.5 font-mono text-[11px] font-bold uppercase ${
                    view === entry ? "bg-[#E69F00] text-black" : "text-muted-foreground hover:text-foreground"
                  }`}
                  data-testid={`view-${entry}`}
                >
                  {entry === "charts" ? "Charts" : "Terminal"}
                </button>
              ))}
              {view === "charts" && run.data.status === "running" && (
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">{run.data.logs.length.toLocaleString("en-US")} terminal lines so far</span>
              )}
            </div>
            <div className="min-h-0 flex-1">
              {view === "charts" ? (
                <RunBody run={run.data} />
              ) : (
                <ResizablePanelGroup direction="vertical" autoSaveId="run-terminal-split" className="h-full">
                  <ResizablePanel defaultSize={50} minSize={20}>
                    <RunBarsChart
                      bars={bars.data?.bars ?? []}
                      trades={bars.data?.trades ?? []}
                      focusTime={focusTime}
                      onBarClick={(seconds) => {
                        setSeekTime(seconds);
                        setFocusTime(seconds);
                      }}
                    />
                  </ResizablePanel>
                  <ResizableHandle withHandle />
                  <ResizablePanel defaultSize={50} minSize={20}>
                    <RunTerminal lines={run.data.logs} live={live} onLocate={setFocusTime} seekTime={seekTime} />
                  </ResizablePanel>
                </ResizablePanelGroup>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
            {!sidebarOpen && (
              <button type="button" onClick={() => setSidebarOpen(true)} className="flex cursor-pointer items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[11px] hover:text-foreground">
                <PanelLeftOpen className="h-3.5 w-3.5" /> Show the run list
              </button>
            )}
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
