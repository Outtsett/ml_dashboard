/**
 * ArchitectureExplorer — the /architecture page, restructured 2026-07-15 from
 * hardcoded educational cards into three tabs:
 *
 *   Network graph   — live layer diagrams derived from (algorithmId, hyper-
 *                     parameters) via deriveArchGraph; HP sliders re-derive
 *                     the diagram in place. Think of it as: an exploded-view
 *                     blueprint of the model that redraws itself as you turn
 *                     the tuning knobs.
 *   Trees & forests — REAL tree structure read from trained artifacts under
 *                     data/models via the /api/anatomy endpoints (forest
 *                     summary + per-tree drill-down).
 *   Concepts        — the original educational content (pipeline overview,
 *                     per-architecture deep dives, comparison matrix) kept
 *                     intact.
 *
 * NOTE: imports from ./graph and ./trees are contract imports — those
 * directories are delivered by parallel work streams and this file will not
 * typecheck until they land. Do not stub them locally.
 */

import { useState, lazy, Suspense, type ReactNode } from "react";
import { Card, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Slider } from "@/shared/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Combine,
  Eye,
  GitBranch,
  Network,
  Repeat,
  Share2,
  Workflow,
  Sparkles,
  Waves,
} from "lucide-react";
import { PageLoader } from "@/shared/layout/LoadingSkeletons";
import { useBreadcrumbs } from "@/shared/hooks/useBreadcrumbs";
import { PageShell, KpiStrip, type Kpi } from "@/backtest/components";
import { cn } from "@/shared/utils/utils";
import { fmtInt } from "@/shared/utils/format";
import {
  useTrainingConfig,
  type TrainingConfigResponse,
} from "@/training/lib/useTrainingConfig";
import type { HyperparameterDef } from "@shared/trainingTypes";

// Contract imports — delivered by parallel agents (see file header).
import {
  deriveArchGraph,
  TUNABLE_HPS,
  NetworkDiagram,
  NeuralCanvas,
  buildCatalogOptions,
  fallbackOptions,
  type CatalogGraphOption,
  type TunableHp,
  type ArchGraph,
  type NeuronModel,
  type NeuronLayer,
} from "@/system/architecture-explorer/graph";
import { useTrainableCatalog } from "@/ml/lib/useModelCatalog";
import {
  useAnatomyModels,
  useModelTrees,
  useForestSummary,
  TreeDiagram,
  ForestPanel,
} from "@/system/architecture-explorer/trees";

import { InputWindowChart, useForexSymbols } from "./InputWindowChart";
import { checkAlignment, type AlignState } from "./alignment";
import { TIMEFRAME_OPTIONS } from "@/market/lib/timeframes";

// Existing educational content — mounted unchanged under the Concepts tab.
import { PipelineOverview } from "./PipelineOverview";
import { LSTMDetail } from "./LSTMDetail";
import { TransformerDetail } from "./TransformerDetail";
import { XGBoostDetail } from "./XGBoostDetail";
import { HybridDetail } from "./HybridDetail";
import { ComparisonMatrix } from "./ComparisonMatrix";

const FourierTransform = lazy(
  () => import("@/ml/fourier-transform/FourierTransform"),
);

/** All 140 catalog models, animated by researched mechanism. See mechanism/. */
const MechanismTab = lazy(() =>
  import("./mechanism/MechanismTab").then((m) => ({ default: m.MechanismTab })),
);

const TAB_LABELS: Record<string, string> = {
  graph: "Network graph",
  trees: "Trees & forests",
  concepts: "Concepts",
  mechanism: "Mechanism",
};

export default function ArchitectureExplorer() {
  const [activeTab, setActiveTab] = useState("graph");
  useBreadcrumbs([{ label: TAB_LABELS[activeTab] ?? activeTab }]);

  return (
    <PageShell
      title="Architecture"
      subtitle="Live network graphs derived from hyperparameters · real tree structure from trained artifacts"
      icon={Network}
      fillHeight
    >
      <div className="flex h-full min-h-0 w-full flex-col">
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="h-auto shrink-0 flex-wrap border border-border/50 bg-card/50 p-1">
            <TabsTrigger value="graph" className="gap-1.5 text-xs">
              <Share2 className="h-3.5 w-3.5" /> Network graph
            </TabsTrigger>
            <TabsTrigger value="trees" className="gap-1.5 text-xs">
              <GitBranch className="h-3.5 w-3.5" /> Trees &amp; forests
            </TabsTrigger>
            <TabsTrigger value="concepts" className="gap-1.5 text-xs">
              <BookOpen className="h-3.5 w-3.5" /> Concepts
            </TabsTrigger>
            <TabsTrigger value="mechanism" className="gap-1.5 text-xs">
              <Workflow className="h-3.5 w-3.5" /> Mechanism
            </TabsTrigger>
          </TabsList>

          {/* The graph tab fills and owns its own fit; the tall content tabs
              take the same slack but scroll inside it (PageShell's body is
              overflow-hidden under fillHeight). */}
          <TabsContent
            value="graph"
            className="mt-3 flex min-h-0 flex-1 flex-col"
          >
            <NetworkGraphTab />
          </TabsContent>
          <TabsContent value="trees" className="mt-3 min-h-0 flex-1 overflow-auto">
            <TreesTab />
          </TabsContent>
          <TabsContent
            value="concepts"
            className="mt-3 min-h-0 flex-1 overflow-auto"
          >
            <ConceptsTab />
          </TabsContent>
          {/* Fills like the graph tab — the p5 canvas owns its own height. */}
          <TabsContent
            value="mechanism"
            className="mt-3 flex min-h-0 flex-1 flex-col"
          >
            <Suspense fallback={<PageLoader />}>
              <MechanismTab />
            </Suspense>
          </TabsContent>
        </Tabs>
      </div>
    </PageShell>
  );
}

// ============================================================
// Tab 1 — Network graph
// ============================================================

function clampToDef(value: number, hp: TunableHp): number {
  const step = hp.step > 0 ? hp.step : 1;
  const snapped = hp.min + Math.round((value - hp.min) / step) * step;
  return Math.min(hp.max, Math.max(hp.min, snapped));
}

/** Resolve the runner defaultHyperparameters for an algorithm id — checks the
 *  composite `${alg}+${task}` runner keys first, then the composite models
 *  map, then a legacy direct model key. */
function runnerDefaultsFor(
  algorithmId: string,
  config: TrainingConfigResponse | undefined,
): Record<string, HyperparameterDef> | null {
  if (!config) return null;
  for (const [key, runner] of Object.entries(config.runners ?? {})) {
    if (key === algorithmId || key.startsWith(`${algorithmId}+`)) {
      return runner.defaultHyperparameters ?? null;
    }
  }
  for (const [key, model] of Object.entries(config.models ?? {})) {
    if (key === algorithmId || key.startsWith(`${algorithmId}+`)) {
      return model.defaultHyperparameters ?? null;
    }
  }
  return null;
}

/** Which renderer the graph tab is showing. */
type GraphView = "blocks" | "neurons";

function NetworkGraphTab() {
  const config = useTrainingConfig();
  const catalog = useTrainableCatalog();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [view, setView] = useState<GraphView>("neurons");
  /** HP sliders folded away by default so the chart + network own the space. */
  const [tuneOpen, setTuneOpen] = useState(false);
  /** User HP edits for the current algorithm — cleared on algorithm change. */
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  // The picker lists the REAL catalog (`GET /api/model-catalog/trainable` — the
  // merged registry + markdown-spec surface), not a hardcoded shortlist. Each
  // row carries its own honest graph state: derivable entries are selectable,
  // the rest stay visible but disabled with the concrete reason (see
  // graph/catalog.ts). On fetch failure we fall back to the raw derive.ts ids
  // rather than showing an empty picker.
  const catalogFailed = catalog.error != null;
  const options: CatalogGraphOption[] = catalogFailed
    ? fallbackOptions()
    : buildCatalogOptions(catalog.data);

  const graphable = options.filter((o) => o.support.graphable);

  // Default to an architecture that consumes a time window, so the page opens
  // showing the chart<->model link actually working. Sorting is alphabetical, so
  // the first graphable entry is the Adversarial Autoencoder — which takes a
  // flat feature vector (B x F, no time axis) and therefore has no window_size
  // to align against. Landing there makes the alignment check read "not linked"
  // on arrival, which looks broken when it is merely honest. Falls back to the
  // first graphable entry when nothing windowed is available.
  const firstWindowed = graphable.find((o) =>
    o.support.graphable
      ? (TUNABLE_HPS[o.support.algorithmId] ?? []).some(
          (hp) => hp.name === "window_size",
        )
      : false,
  );
  const selected =
    options.find((o) => o.key === selectedKey) ??
    firstWindowed ??
    graphable[0] ??
    null;
  const support = selected?.support ?? null;
  const algorithmId =
    support && support.graphable ? support.algorithmId : null;

  const hpDefs: TunableHp[] =
    algorithmId != null ? (TUNABLE_HPS[algorithmId] ?? []) : [];
  const defaults =
    algorithmId != null ? runnerDefaultsFor(algorithmId, config.data) : null;

  // Effective HP values: user override → runner default → midpoint of range,
  // always snapped to the HP's step grid and clamped to [min, max].
  const hpValues: Record<string, number> = {};
  for (const hp of hpDefs) {
    const override = overrides[hp.name];
    if (override != null && Number.isFinite(override)) {
      hpValues[hp.name] = clampToDef(override, hp);
      continue;
    }
    const d = defaults?.[hp.name]?.default;
    hpValues[hp.name] = clampToDef(
      typeof d === "number" && Number.isFinite(d)
        ? d
        : hp.min + (hp.max - hp.min) / 2,
      hp,
    );
  }

  const graph = algorithmId != null ? deriveArchGraph(algorithmId, hpValues) : null;

  const kpis: Kpi[] = graph
    ? [
        {
          label: "TOTAL PARAMS",
          value: fmtInt(graph.totalParams),
          hint: "Trainable parameters across every layer in the diagram",
        },
        {
          label: "NODES",
          value: fmtInt(graph.nodes.length),
          hint: "Layers / blocks in the derived graph",
        },
        {
          label: "DEPTH",
          value: fmtInt(graph.columns),
          hint: "Layout columns — data flows left to right",
        },
      ]
    : [];

  if (algorithmId == null) {
    return (
      <Placeholder>
        {options.length === 0
          ? "Catalog is empty — no models to derive a graph from."
          : `None of the ${options.length} catalog models have a source-derived graph yet.`}
      </Placeholder>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Controls — a slim one-line bar; the HP sliders fold behind a toggle so
          the chart and network get the vertical space. */}
      <div className="shrink-0 rounded-md border border-white/10 bg-white/[0.02]">
        <div className="flex flex-wrap items-center gap-2 px-2 py-1.5">
          <Select
            value={selected?.key}
            onValueChange={(v) => {
              setSelectedKey(v);
              setOverrides({});
            }}
          >
            <SelectTrigger
              className="h-7 w-56 text-xs"
              data-testid="arch-algorithm-select"
            >
              <SelectValue placeholder="Pick a model" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem
                  key={o.key}
                  value={o.key}
                  className="text-xs"
                  disabled={!o.support.graphable}
                >
                  <span className="flex flex-col items-start gap-0.5">
                    <span className="flex items-center gap-1.5">
                      {o.label}
                      {!o.support.graphable && (
                        <span className="rounded-sm bg-white/10 px-1 text-[9px] uppercase tracking-wide text-muted-foreground">
                          no graph
                        </span>
                      )}
                    </span>
                    {!o.support.graphable && (
                      <span className="text-[9px] leading-tight text-muted-foreground">
                        {o.support.reason}
                      </span>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* View switch */}
          <div className="flex items-center gap-1">
            {(
              [
                ["neurons", "Neurons"],
                ["blocks", "Blocks"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                aria-pressed={view === id}
                data-testid={`arch-view-${id}`}
                className={cn(
                  "rounded-sm border px-2 py-0.5 text-[10px] transition-colors",
                  view === id
                    ? "border-white/25 bg-white/10 text-foreground"
                    : "border-white/10 text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tune toggle — folds the HP sliders away by default. */}
          {hpDefs.length > 0 && (
            <button
              type="button"
              onClick={() => setTuneOpen((v) => !v)}
              aria-expanded={tuneOpen}
              data-testid="arch-tune-toggle"
              className="rounded-sm border border-white/10 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
            >
              {tuneOpen ? "Hide" : "Tune"} ({hpDefs.length})
            </button>
          )}

          <span className="ml-auto text-[10px] text-muted-foreground">
            {catalogFailed
              ? "catalog unavailable"
              : `${graphable.length}/${options.length} graphable`}
          </span>
        </div>

        {/* Sliders — only when expanded. */}
        {tuneOpen && hpDefs.length > 0 && (
          <div className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-white/10 px-3 py-2 sm:grid-cols-2 lg:grid-cols-4">
            {hpDefs.map((hp) => (
              <HpSlider
                key={`${algorithmId}:${hp.name}`}
                hp={hp}
                value={hpValues[hp.name] ?? hp.min}
                onChange={(v) =>
                  setOverrides((prev) => ({ ...prev, [hp.name]: v }))
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* KPI row — block view only. The neuron view folds these three numbers
          into its own transport bar: this page's height is fixed (PageShell
          fillHeight), and a full strip for three values was height the network
          could not spare. */}
      {kpis.length > 0 && view === "blocks" && (
        <KpiStrip kpis={kpis} dense className="shrink-0" />
      )}

      {/* Diagram — takes every pixel the controls and KPI row leave behind. */}
      {graph ? (
        view === "neurons" ? (
          <NeuronView
            graph={graph}
            // The chart's bar count IS this hyperparameter — dragging the
            // "Window (bars)" slider changes how many candles are shown. Models
            // without the HP (e.g. xgboost) pass null and the chart says so.
            windowSize={hpValues.window_size ?? null}
            kpis={kpis}
          />
        ) : (
          <NetworkDiagram graph={graph} />
        )
      ) : (
        <Placeholder>
          {selected && !selected.support.graphable
            ? `No derived diagram for "${selected.label}" — ${selected.support.reason}.`
            : "No derived diagram for this model yet."}
        </Placeholder>
      )}
    </div>
  );
}

/** Bars shown when the architecture exposes no `window_size` hyperparameter. */
const UNLINKED_BAR_COUNT = 64;

/**
 * The 2D neuron view: real input-window candles on top, p5 neuron canvas below,
 * plus transport and hover inspector.
 *
 * Transport drives the signal front. Step mode pins it to one layer so a single
 * transform can be read at rest. The inspector shows only real derive.ts config
 * for the hovered column — no activation values exist to show.
 *
 * The candles and the network are linked by exactly ONE thing: the bar COUNT,
 * taken from `window_size`. No data flows from the chart into the network, and
 * nothing the network "does" is drawn on the chart.
 */
function NeuronView({
  graph,
  windowSize,
  kpis,
}: {
  graph: ArchGraph;
  /** The architecture's real `window_size` HP, or null when it has none. */
  windowSize: number | null;
  /** Folded into the transport bar instead of taking their own strip. */
  kpis: Kpi[];
}) {
  // This view's entire purpose is the running machine, so it auto-plays — a
  // frozen network on load is the opposite of what it's for. The Pause button
  // is right there for anyone who wants it still.
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [step, setStep] = useState<number | null>(null);
  const [model, setModel] = useState<NeuronModel | null>(null);
  const [hovered, setHovered] = useState<NeuronLayer | null>(null);
  /** Bars the feed ACTUALLY returned — drives the alignment check. */
  const [barCount, setBarCount] = useState<number | null>(null);
  /** Each candle as { x, close } — positions the input tape and feeds the
   *  real close values into the network's data packet. */
  const [barNodes, setBarNodes] = useState<{ x: number; close: number }[]>([]);
  /** Chart collapsed → the network takes the whole pane. */
  const [showChart, setShowChart] = useState(true);
  const [symbol, setSymbol] = useState("AUDUSD");
  const [timeframeMinutes, setTimeframeMinutes] = useState(60);

  const symbolsQ = useForexSymbols();
  // Always keep the default visible so the picker never renders empty while the
  // real symbol list is in flight or unavailable.
  const symbols = symbolsQ.data?.length ? symbolsQ.data : [symbol];

  const layerCount = model?.layers.length ?? 0;
  const stepping = step != null;

  const nudge = (dir: 1 | -1) => {
    setPlaying(false);
    setStep((s) => {
      const next = (s ?? 0) + dir;
      if (next < 0) return 0;
      if (next > layerCount - 1) return layerCount - 1;
      return next;
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-md border border-white/10 bg-white/[0.02]">
      {/* Transport */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-1.5">
        <button
          type="button"
          data-testid="neuron-play"
          onClick={() => {
            setStep(null);
            setPlaying((v) => !v);
          }}
          className="rounded-sm border border-white/15 px-2 py-0.5 text-[10px] text-foreground hover:bg-white/10"
        >
          {playing && !stepping ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          data-testid="neuron-step-back"
          onClick={() => nudge(-1)}
          className="rounded-sm border border-white/15 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          ‹ Step
        </button>
        <button
          type="button"
          data-testid="neuron-step-fwd"
          onClick={() => nudge(1)}
          className="rounded-sm border border-white/15 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          Step ›
        </button>

        <label className="ml-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          Speed
          <input
            type="range"
            min={0.25}
            max={5}
            step={0.25}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="h-1 w-24 accent-white/60"
            aria-label="Signal speed, layers per second"
          />
          <span className="font-mono tabular-nums">{speed.toFixed(2)}×</span>
        </label>

        {/* Chart source picker — drives ONLY the candles above the network. */}
        <label className="ml-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          Bars
          <Select value={symbol} onValueChange={setSymbol}>
            <SelectTrigger
              className="h-6 w-[104px] text-[10px]"
              aria-label="Chart symbol"
              data-testid="arch-window-symbol"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {symbols.map((s) => (
                <SelectItem key={s} value={s} className="text-xs">
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Select
          value={String(timeframeMinutes)}
          onValueChange={(v) => setTimeframeMinutes(Number(v))}
        >
          <SelectTrigger
            className="h-6 w-[72px] text-[10px]"
            aria-label="Chart timeframe"
            data-testid="arch-window-timeframe"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEFRAME_OPTIONS.map((t) => (
              <SelectItem key={t.minutes} value={String(t.minutes)} className="text-xs">
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <button
          type="button"
          data-testid="neuron-toggle-chart"
          onClick={() => setShowChart((v) => !v)}
          aria-pressed={showChart}
          className="rounded-sm border border-white/15 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {showChart ? "Hide chart" : "Show chart"}
        </button>

        {/* The KPI strip's numbers, inline — same real values, no extra row. */}
        {kpis.map((k) => (
          <span key={k.label} className="flex items-baseline gap-1 text-[10px]">
            <span className="text-muted-foreground">{k.label.toLowerCase()}</span>
            <span className="font-mono tabular-nums text-foreground">
              {k.value}
            </span>
          </span>
        ))}

        <div className="ml-auto font-mono text-[10px] text-muted-foreground">
          {stepping
            ? `layer ${(step ?? 0) + 1} / ${layerCount}`
            : `${layerCount} layers`}
          {model && model.undecidedCount > 0 && (
            <span className="ml-2 text-muted-foreground">
              · {model.undecidedCount} width not derivable
            </span>
          )}
        </div>
      </div>

      {/* Real input-window candles — fixed height, above the network.
          Unmounting on collapse also clears the tape, since barXs stop being
          published — the network must not draw bar nodes for a chart that is
          not on screen to align them against. */}
      {showChart && (
        <>
          <InputWindowChart
            className="m-2 mb-0"
            symbol={symbol}
            timeframeMinutes={timeframeMinutes}
            limit={windowSize ?? UNLINKED_BAR_COUNT}
            linked={windowSize != null}
            onBarCount={setBarCount}
            onBarNodes={setBarNodes}
          />

          {/* Alignment check — does what the chart HAS match what the model TAKES? */}
          <AlignmentStrip
            graph={graph}
            barsReturned={barCount}
            windowSize={windowSize ?? null}
          />
        </>
      )}

      {/* min-h floor: 4 nodes per layer need little vertical room, so a smaller
          floor lets the chart AND the network fit together without scrolling —
          the token's real number stays visible on the node it lands on. */}
      <div className="relative flex min-h-[300px] flex-1">
        <NeuralCanvas
          graph={graph}
          playing={playing}
          speed={speed}
          stepIndex={step}
          onModel={setModel}
          onHoverLayer={setHovered}
          // Collapsed chart → no tape. Keeping the last-published nodes would
          // draw bars aligned to candles that are no longer on screen.
          barNodes={showChart ? barNodes : []}
        />

        {/* Inspector — real derived config only. */}
        {hovered && (
          <div className="pointer-events-none absolute right-2 top-2 w-56 rounded-md border border-white/15 bg-black/80 p-2 backdrop-blur">
            <div className="text-[11px] font-medium text-foreground">
              {hovered.label}
            </div>
            {hovered.sublabel && (
              <div className="mt-0.5 text-[9px] text-muted-foreground">
                {hovered.sublabel}
              </div>
            )}
            <dl className="mt-1.5 space-y-0.5">
              <Row
                k="width"
                v={hovered.units == null ? "not derivable" : `${hovered.units}`}
              />
              <Row k="params" v={fmtInt(hovered.params)} />
              {hovered.outShape && <Row k="out" v={hovered.outShape} />}
              {hovered.detail &&
                Object.entries(hovered.detail)
                  .slice(0, 6)
                  .map(([k, v]) => <Row key={k} k={k} v={String(v)} />)}
            </dl>
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-white/10 px-3 py-1.5 text-[10px] leading-tight text-muted-foreground">
        Structure, node counts and parameters are derived from the model source.
        Each node shows a REAL computed value — tanh of a weighted sum of the
        previous layer — so the numbers genuinely transform as they flow. The
        weights are seeded, not trained, so this shows the mechanism working, not
        a prediction: real arithmetic through an untrained network.
      </div>
    </div>
  );
}

/** Text verdict per state — never colour alone (deuteranopia-safe). */
const ALIGN_VERDICT: Record<AlignState, string> = {
  aligned: "matches",
  mismatch: "MISMATCH",
  unlinked: "not linked",
  pending: "checking",
};

const ALIGN_TONE: Record<AlignState, string> = {
  aligned: "text-foreground",
  mismatch: "text-[hsl(var(--data-neg))]",
  unlinked: "text-muted-foreground",
  pending: "text-muted-foreground",
};

/**
 * States, per axis, whether the chart and the architecture actually agree.
 * The window axis is the real link; batch is symbolic; features deliberately do
 * NOT align (engineered features vs drawn OHLC) and say so.
 */
function AlignmentStrip({
  graph,
  barsReturned,
  windowSize,
}: {
  graph: ArchGraph;
  barsReturned: number | null;
  windowSize: number | null;
}) {
  const report = checkAlignment(graph, barsReturned, windowSize);

  return (
    <div
      className="shrink-0 border-b border-white/10 bg-black/20 px-3 py-1.5"
      data-testid="alignment-strip"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
          chart ↔ model
        </span>
        {report.inputShape && (
          <span className="font-mono text-[9px] text-muted-foreground">
            input {report.inputShape}
          </span>
        )}
        {report.overall !== "unlinked" && barsReturned != null && (
          <span className="text-[9px] text-muted-foreground">
            each candle has a node on the tape below it
          </span>
        )}
        {report.axes.map((a) => (
          <span
            key={a.label}
            title={a.note}
            className="flex items-center gap-1 text-[9px]"
          >
            <span className="text-muted-foreground">{a.label}</span>
            <span className="font-mono text-foreground">{a.chart}</span>
            <span className="text-muted-foreground">vs</span>
            <span className="font-mono text-foreground">{a.model}</span>
            <span className={cn("font-medium", ALIGN_TONE[a.state])}>
              {ALIGN_VERDICT[a.state]}
            </span>
          </span>
        ))}
      </div>
      {/* The note for whichever axis most needs explaining, spelled out rather
          than hidden in a tooltip. */}
      <div className="mt-0.5 text-[9px] leading-tight text-muted-foreground">
        {(
          report.axes.find((a) => a.state === "mismatch") ??
          report.axes.find((a) => a.state === "unlinked") ??
          report.axes.find((a) => a.label === "window")
        )?.note}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[9px] text-muted-foreground">{k}</dt>
      <dd className="truncate font-mono text-[9px] text-foreground">{v}</dd>
    </div>
  );
}

interface HpSliderProps {
  hp: TunableHp;
  value: number;
  onChange: (value: number) => void;
}

function HpSlider({ hp, value, onChange }: HpSliderProps) {
  return (
    <div className="space-y-1.5" data-testid={`arch-hp-${hp.name}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">
          {hp.label}
        </span>
        <span className="font-mono text-[11px] text-foreground">
          {formatHpValue(value, hp)}
        </span>
      </div>
      <Slider
        value={[value]}
        min={hp.min}
        max={hp.max}
        step={hp.step}
        onValueChange={(vals) => {
          const v = vals[0];
          if (v != null && Number.isFinite(v)) onChange(v);
        }}
        aria-label={hp.label}
      />
      <div className="flex justify-between font-mono text-[9px] text-muted-foreground/60">
        <span>{formatHpValue(hp.min, hp)}</span>
        <span>{formatHpValue(hp.max, hp)}</span>
      </div>
    </div>
  );
}

function formatHpValue(v: number, hp: TunableHp): string {
  // Integer-stepped HPs display without decimals; fractional steps get enough
  // precision to distinguish adjacent grid points.
  if (Number.isInteger(hp.step) && Number.isInteger(hp.min)) {
    return fmtInt(v);
  }
  const decimals = Math.min(
    6,
    Math.max(0, -Math.floor(Math.log10(hp.step > 0 ? hp.step : 1))),
  );
  return v.toFixed(decimals);
}

// ============================================================
// Tab 2 — Trees & forests
// ============================================================

const TREE_STRIP_WINDOW = 9;

function TreesTab() {
  const modelsQ = useAnatomyModels();
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [treeIndex, setTreeIndex] = useState(0);

  const models = modelsQ.data ?? [];
  const modelId = selectedModelId ?? models[0]?.modelId ?? null;
  const activeMeta =
    models.find((m: { modelId: string }) => m.modelId === modelId) ?? null;

  const forestQ = useForestSummary(modelId);
  const nTrees = activeMeta?.nTrees ?? forestQ.data?.nTrees ?? 0;
  const safeIndex = nTrees > 0 ? Math.min(treeIndex, nTrees - 1) : 0;
  const treesQ = useModelTrees(modelId, safeIndex, 1);

  if (modelsQ.isLoading) {
    return (
      <Placeholder height={320}>
        Scanning data/models for tree-ensemble artifacts…
      </Placeholder>
    );
  }
  if (modelsQ.error != null) {
    return (
      <Placeholder height={320}>
        Failed to load model artifacts —{" "}
        {modelsQ.error instanceof Error ? modelsQ.error.message : "unknown error"}
      </Placeholder>
    );
  }
  if (models.length === 0) {
    return (
      <Placeholder height={320}>
        No tree-ensemble artifacts found under data/models — train an XGBoost
        model first
      </Placeholder>
    );
  }

  const stripStart = Math.max(
    0,
    Math.min(safeIndex - Math.floor(TREE_STRIP_WINDOW / 2), nTrees - TREE_STRIP_WINDOW),
  );
  const stripIndices = Array.from(
    { length: Math.min(TREE_STRIP_WINDOW, nTrees) },
    (_v, i) => stripStart + i,
  );

  const tree = treesQ.data?.trees?.[0];

  return (
    <div className="space-y-3">
      {/* Model picker + artifact meta */}
      <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
        <div className="flex flex-wrap items-end gap-4">
          <div className="w-80 shrink-0 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Trained artifact
            </div>
            <Select
              value={modelId ?? undefined}
              onValueChange={(v) => {
                setSelectedModelId(v);
                setTreeIndex(0);
              }}
            >
              <SelectTrigger className="h-8 text-xs" data-testid="arch-model-select">
                <SelectValue placeholder="Pick a trained model" />
              </SelectTrigger>
              <SelectContent>
                {models.map(
                  (m: { modelId: string; nTrees: number; learner: string }) => (
                    <SelectItem
                      key={m.modelId}
                      value={m.modelId}
                      className="text-xs"
                    >
                      {`${m.modelId} · ${m.nTrees} trees · ${m.learner}`}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
          {activeMeta && (
            <div className="pb-1 font-mono text-[10px] text-muted-foreground">
              {`${activeMeta.nFeatures} features · ${(activeMeta.sizeBytes / 1024).toFixed(0)} KB · modified ${activeMeta.modifiedAt.slice(0, 10)}`}
            </div>
          )}
        </div>
      </div>

      {/* Forest-level summary */}
      {forestQ.isLoading ? (
        <Placeholder height={220}>Loading forest summary…</Placeholder>
      ) : forestQ.error != null ? (
        <Placeholder height={220}>
          Failed to load forest summary —{" "}
          {forestQ.error instanceof Error ? forestQ.error.message : "unknown error"}
        </Placeholder>
      ) : forestQ.data ? (
        <ForestPanel summary={forestQ.data} />
      ) : null}

      {/* Tree navigator */}
      <div className="rounded-md border border-white/10 bg-white/[0.02] p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Tree navigator
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              disabled={safeIndex <= 0}
              onClick={() => setTreeIndex(Math.max(0, safeIndex - 1))}
              aria-label="Previous tree"
              data-testid="arch-tree-prev"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="font-mono text-[11px] text-foreground">
              {`tree ${safeIndex + 1} of ${nTrees}`}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              disabled={safeIndex >= nTrees - 1}
              onClick={() => setTreeIndex(Math.min(nTrees - 1, safeIndex + 1))}
              aria-label="Next tree"
              data-testid="arch-tree-next"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Windowed index strip around the current tree */}
        <div className="mb-3 flex flex-wrap items-center gap-1">
          {stripStart > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground/60">…</span>
          )}
          {stripIndices.map((i) => (
            <button
              key={i}
              type="button"
              onClick={() => setTreeIndex(i)}
              className={cn(
                "h-6 min-w-6 rounded-sm border px-1 font-mono text-[10px] transition-colors",
                i === safeIndex
                  ? "border-primary/60 bg-white/[0.06] text-foreground"
                  : "border-white/10 bg-white/[0.02] text-muted-foreground hover:text-foreground",
              )}
              aria-label={`Go to tree ${i}`}
              aria-current={i === safeIndex ? "true" : undefined}
            >
              {i}
            </button>
          ))}
          {stripStart + stripIndices.length < nTrees && (
            <span className="font-mono text-[10px] text-muted-foreground/60">…</span>
          )}
        </div>

        {/* Single-tree diagram */}
        {treesQ.isLoading ? (
          <Placeholder height={420}>{`Loading tree ${safeIndex}…`}</Placeholder>
        ) : treesQ.error != null ? (
          <Placeholder height={420}>
            Failed to load tree —{" "}
            {treesQ.error instanceof Error ? treesQ.error.message : "unknown error"}
          </Placeholder>
        ) : tree ? (
          <TreeDiagram
            tree={tree}
            features={treesQ.data?.features ?? activeMeta?.features ?? []}
            treeIndex={safeIndex}
          />
        ) : (
          <Placeholder height={420}>No tree data returned.</Placeholder>
        )}
      </div>
    </div>
  );
}

// ============================================================
// Tab 3 — Concepts (pre-existing educational content, unchanged)
// ============================================================

function ConceptsTab() {
  const [activeArch, setActiveArch] = useState("lstm");

  return (
    <div className="space-y-3">
      <PipelineOverview />

      <Tabs value={activeArch} onValueChange={setActiveArch}>
        <TabsList className="h-auto flex-wrap border border-border/50 bg-card/50 p-1">
          <TabsTrigger value="lstm" className="gap-1.5 text-xs data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-300">
            <Repeat className="h-3.5 w-3.5" /> LSTM
          </TabsTrigger>
          <TabsTrigger value="transformer" className="gap-1.5 text-xs data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-300">
            <Eye className="h-3.5 w-3.5" /> Transformer
          </TabsTrigger>
          <TabsTrigger value="xgboost" className="gap-1.5 text-xs data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-300">
            <GitBranch className="h-3.5 w-3.5" /> XGBoost
          </TabsTrigger>
          <TabsTrigger value="hybrid" className="gap-1.5 text-xs data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-300">
            <Combine className="h-3.5 w-3.5" /> Hybrid
          </TabsTrigger>
          <TabsTrigger value="fourier" className="gap-1.5 text-xs data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-300">
            <Waves className="h-3.5 w-3.5" /> Fourier
          </TabsTrigger>
        </TabsList>

        <TabsContent value="lstm" className="mt-4">
          <LSTMDetail />
        </TabsContent>
        <TabsContent value="transformer" className="mt-4">
          <TransformerDetail />
        </TabsContent>
        <TabsContent value="xgboost" className="mt-4">
          <XGBoostDetail />
        </TabsContent>
        <TabsContent value="hybrid" className="mt-4">
          <HybridDetail />
        </TabsContent>
        <TabsContent value="fourier" className="mt-4">
          <Suspense fallback={<PageLoader />}>
            <FourierTransform />
          </Suspense>
        </TabsContent>
      </Tabs>

      <ComparisonMatrix />

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <div className="mb-1 text-sm font-medium">What's Next?</div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Your universal pipeline already decouples features from the model — the architecture
                is the one swappable piece. Pick the approach that matches how you want your model
                to "think" about market data. You can always start with one and compare results.
                The training infrastructure supports any of these architectures.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline" className="border-emerald-500/30 text-[10px] text-emerald-300">
                  Hybrid — combine local + temporal patterns
                </Badge>
                <Badge variant="outline" className="border-cyan-500/30 text-[10px] text-cyan-300">
                  Transformer — if you value interpretability + long-range
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================
// Shared
// ============================================================

/** Empty/loading/error box. Pass `height` to pin it; omit to fill the flex
 *  slack of the surrounding column. */
function Placeholder({
  height,
  children,
}: {
  height?: number;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-md border border-dashed border-white/10 bg-white/[0.02] px-6 text-center text-[11px] text-muted-foreground",
        height == null && "min-h-0 flex-1",
      )}
      style={height == null ? undefined : { height }}
    >
      {children}
    </div>
  );
}
