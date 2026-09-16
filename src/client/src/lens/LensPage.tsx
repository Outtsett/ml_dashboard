/**
 * Model Lens — a trained model's out-of-sample record, made inspectable.
 *
 * The page owns selection and controls; every view is a pure function of the
 * evaluation (full record, recomputed server-side when a control moves) and
 * the bar window (the rows the price chart and playback are looking at).
 */

import { useEffect, useState } from "react";
import { Microscope, RefreshCw } from "lucide-react";
import { PageShell } from "@/backtest/components";
import { Button } from "@/shared/ui/button";
import { Slider } from "@/shared/ui/slider";
import { Switch } from "@/shared/ui/switch";
import { Label } from "@/shared/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";
import { useDebounce } from "@/shared/hooks/useDebounce";
import { useToast } from "@/shared/hooks/use-toast";
import {
  LENS_PARAM_BOUNDS,
  defaultLensParams,
  type LensEvaluationParams,
  type LensIntervalCoverage,
  type LensModelEntry,
  type LensRowWindow,
} from "@shared/lens/types";
import { useBuildLens, useLensBars, useLensEvaluation, useLensManifest, useLensModels } from "./api";
import { LensFrame } from "./Frame";
import { PriceLens, type LensPriceLayers } from "./charts/PriceLens";
import { EquityLens } from "./charts/EquityLens";
import { PlaybackPanel } from "./playback/PlaybackPanel";
import { HeadlineStrip } from "./panels/HeadlineStrip";
import { RollingPanel } from "./panels/RollingPanel";
import { ScatterPanel } from "./panels/ScatterPanel";
import { ConfusionPanel } from "./panels/ConfusionPanel";
import { AttributionPanel } from "./panels/AttributionPanel";
import { RegimePanel } from "./panels/RegimePanel";
import { DistributionPanel } from "./panels/DistributionPanel";
import { VerificationList } from "./panels/VerificationList";

const WINDOW_LENGTHS = [300, 600, 1500, 3000] as const;

const STATUS_TEXT: Record<LensModelEntry["status"], string> = {
  ready: "ready",
  stale: "stale — rebuild",
  not_built: "not built",
  refused: "not lens-ready",
  failed: "build failed",
};

function readModelFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("model");
}

function writeModelToUrl(modelId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set("model", modelId);
  window.history.replaceState(null, "", url);
}

interface ControlProps {
  label: string;
  value: string;
  min: number;
  max: number;
  step: number;
  current: number;
  onChange: (value: number) => void;
  hint: string;
}

function ParamSlider({ label, value, min, max, step, current, onChange, hint }: ControlProps) {
  return (
    <div className="flex min-w-[10rem] flex-1 flex-col gap-1" title={hint}>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
        <span className="font-mono text-xs tnum text-foreground">{value}</span>
      </div>
      <Slider min={min} max={max} step={step} value={[current]} onValueChange={([v]) => v !== undefined && onChange(v)} />
    </div>
  );
}

export default function LensPage() {
  const { toast } = useToast();
  const models = useLensModels();
  const [requestedModelId, setRequestedModelId] = useState<string | null>(readModelFromUrl);

  const entries = models.data?.models ?? [];
  const selected =
    entries.find((m) => m.modelId === requestedModelId) ?? entries.find((m) => m.status === "ready") ?? null;
  const modelId = selected?.modelId ?? null;
  const evaluable = selected?.status === "ready" || selected?.status === "stale";

  const manifest = useLensManifest(modelId, evaluable);
  const [params, setParams] = useState<LensEvaluationParams | null>(null);
  const [windowLength, setWindowLength] = useState<number>(600);
  const [windowStart, setWindowStart] = useState(0);
  const [cursorIndex, setCursorIndex] = useState(0);
  const [layers, setLayers] = useState<LensPriceLayers>({ interval: true, trades: true, regimes: true, probability: true });

  const manifestModelId = manifest.data?.modelId;
  useEffect(() => {
    if (!manifest.data) return;
    setParams(defaultLensParams(manifest.data));
    setWindowStart(0);
    setCursorIndex(0);
    // Reset only when the model changes, not on every manifest refetch.
     
  }, [manifestModelId]);

  const debouncedParams = useDebounce(params, 180);
  const evaluation = useLensEvaluation(evaluable ? modelId : null, debouncedParams);

  const barCount = manifest.data?.barCount ?? 0;
  const effectiveLength = Math.min(windowLength, Math.max(1, barCount));
  const maxStart = Math.max(0, barCount - effectiveLength);
  const clampedStart = Math.min(windowStart, maxStart);
  const rowWindow: LensRowWindow | null = barCount > 0
    ? { startRowIndex: clampedStart, endRowIndex: clampedStart + effectiveLength - 1 }
    : null;
  const debouncedWindow = useDebounce(rowWindow, 120);
  const bars = useLensBars(evaluable ? modelId : null, debouncedParams, debouncedWindow);

  const build = useBuildLens();

  const selectModel = (id: string) => {
    setRequestedModelId(id);
    writeModelToUrl(id);
  };

  const runBuild = () => {
    if (!modelId) return;
    build.mutate(modelId, {
      onError: (error) => toast({ title: "Lens build failed", description: error.message, variant: "destructive" }),
      onSuccess: () => toast({ title: "Lens built", description: modelId }),
    });
  };

  const update = <K extends keyof LensEvaluationParams>(key: K, value: LensEvaluationParams[K]) =>
    setParams((prev) => (prev ? { ...prev, [key]: value } : prev));

  const windowBars = bars.data?.bars ?? [];
  const cursorBar = windowBars[Math.min(cursorIndex, Math.max(0, windowBars.length - 1))] ?? null;
  const b = LENS_PARAM_BOUNDS;
  const unready = entries.filter((m) => m.status === "refused" || m.status === "failed");

  return (
    <PageShell
      title="Model Lens"
      subtitle="A trained model's out-of-sample record — predictions, trades, stability, attribution — made inspectable"
      icon={Microscope}
    >
      <div className="flex flex-col gap-3" data-testid="lens-page">
        {/* ── Model selection ─────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3">
          <Select value={modelId ?? undefined} onValueChange={selectModel}>
            <SelectTrigger className="w-[26rem]" data-testid="lens-model-select">
              <SelectValue placeholder={models.isLoading ? "Loading models…" : "Choose a model"} />
            </SelectTrigger>
            <SelectContent>
              {entries.map((m) => (
                <SelectItem key={m.modelId} value={m.modelId} disabled={m.status === "refused"}>
                  <span className="font-mono text-xs">{m.modelId}</span>
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    {m.symbol ?? ""} {m.timeframe ?? ""} · {STATUS_TEXT[m.status]}
                    {m.barCount ? ` · ${m.barCount.toLocaleString()} bars` : ""}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && (selected.status === "not_built" || selected.status === "stale" || selected.status === "failed") && (
            <Button size="sm" onClick={runBuild} disabled={build.isPending} data-testid="lens-build">
              <RefreshCw className={build.isPending ? "mr-1 h-3.5 w-3.5 animate-spin" : "mr-1 h-3.5 w-3.5"} />
              {build.isPending ? "Building…" : selected.status === "stale" ? "Rebuild lens" : "Build lens"}
            </Button>
          )}
          {selected?.duplicateOf && (
            <span className="text-xs text-muted-foreground">
              Predictions are byte-identical to <span className="font-mono">{selected.duplicateOf}</span>.
            </span>
          )}
          {models.error && <span className="text-xs text-destructive">Model list failed: {models.error.message}</span>}
        </div>

        {selected?.notes && selected.notes.length > 0 && (
          <ul className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {selected.notes.map((note) => (
              <li key={note}>• {note}</li>
            ))}
          </ul>
        )}

        {!evaluable && selected && (
          <LensFrame title={selected.modelId} unavailableReason={selected.reason ?? STATUS_TEXT[selected.status]} />
        )}

        {evaluable && manifest.error && (
          <LensFrame title="Manifest" unavailableReason={manifest.error.message} />
        )}

        {evaluable && manifest.data && params && (
          <>
            {evaluation.data ? (
              <HeadlineStrip headline={evaluation.data.headline} manifest={manifest.data} />
            ) : (
              <LensFrame
                title="Evaluating"
                unavailableReason={evaluation.error ? evaluation.error.message : "computing the record…"}
              />
            )}

            {/* ── Controls ────────────────────────────────────────────── */}
            <div
              className="sticky top-0 z-10 flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card/95 px-3 py-2 backdrop-blur"
              data-testid="lens-controls"
            >
              <ParamSlider
                label="Entry threshold"
                value={`long ≥ ${params.threshold.toFixed(3)} · short ≤ ${(1 - params.threshold).toFixed(3)}`}
                {...b.threshold}
                current={params.threshold}
                onChange={(v) => update("threshold", v)}
                hint="Trade only when the probability of up clears this level (or its mirror for shorts)."
              />
              <ParamSlider
                label="Cost"
                value={`${params.costMultiplier.toFixed(2)}× · $${(manifest.data.cost.roundTripPoints * manifest.data.cost.pointValueUsd * params.costMultiplier).toFixed(2)} round trip`}
                {...b.costMultiplier}
                current={params.costMultiplier}
                onChange={(v) => update("costMultiplier", v)}
                hint="Scales commission + slippage per round trip."
              />
              <ParamSlider
                label="Rolling window"
                value={`${params.rollingWindowBars} bars · n_eff ${Math.floor(params.rollingWindowBars / manifest.data.horizonBars)}`}
                min={b.rollingWindowBars.min}
                max={Math.min(b.rollingWindowBars.max, Math.max(b.rollingWindowBars.min, Math.floor(barCount / 2)))}
                step={b.rollingWindowBars.step}
                current={params.rollingWindowBars}
                onChange={(v) => update("rollingWindowBars", v)}
                hint="Rows per rolling hit-rate / Brier window. n_eff divides by the forecast horizon because labels overlap."
              />
              <ParamSlider
                label="Trade window"
                value={`${params.rollingWindowTrades} trades`}
                {...b.rollingWindowTrades}
                current={params.rollingWindowTrades}
                onChange={(v) => update("rollingWindowTrades", v)}
                hint="Trades per rolling PnL / win-rate window."
              />
              <ParamSlider
                label="Regime lookback"
                value={`${params.regimeLookbackBars} bars`}
                {...b.regimeLookbackBars}
                current={params.regimeLookbackBars}
                onChange={(v) => update("regimeLookbackBars", v)}
                hint="Bars of trailing return and volatility that classify bull / bear / sideways."
              />
              <ParamSlider
                label="Regime threshold"
                value={`${params.regimeThreshold.toFixed(2)} σ`}
                {...b.regimeThreshold}
                current={params.regimeThreshold}
                onChange={(v) => update("regimeThreshold", v)}
                hint="How many trailing standard deviations the trailing return must move to count as a trend."
              />
              <div className="flex flex-col gap-1">
                <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">Interval</Label>
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={String(params.intervalCoverage)}
                  onValueChange={(v) => v && update("intervalCoverage", Number(v) as LensIntervalCoverage)}
                >
                  <ToggleGroupItem value="0.5">50%</ToggleGroupItem>
                  <ToggleGroupItem value="0.8">80%</ToggleGroupItem>
                  <ToggleGroupItem value="0.9">90%</ToggleGroupItem>
                </ToggleGroup>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setParams(defaultLensParams(manifest.data!))}
                data-testid="lens-reset"
              >
                Reset
              </Button>
              {evaluation.isFetching && <span className="text-[11px] text-muted-foreground">recomputing…</span>}
            </div>

            {/* ── Price + window navigation ───────────────────────────── */}
            <LensFrame
              title="Prediction on price"
              question="Where did the model expect price to go, how sure was it, what did it trade, and in which regime?"
              basis={
                bars.data
                  ? `rows ${bars.data.rowWindow.startRowIndex.toLocaleString()}–${bars.data.rowWindow.endRowIndex.toLocaleString()} of ${barCount.toLocaleString()} · interval ${Math.round(params.intervalCoverage * 100)}% for row + ${manifest.data.horizonBars} · ${manifest.data.interval.method}`
                  : undefined
              }
              actions={
                <div className="flex flex-wrap items-center gap-3">
                  {(Object.keys(layers) as Array<keyof LensPriceLayers>).map((key) => (
                    <label key={key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Switch
                        checked={layers[key]}
                        onCheckedChange={(checked) => setLayers((prev) => ({ ...prev, [key]: checked }))}
                      />
                      {key}
                    </label>
                  ))}
                </div>
              }
            >
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <ToggleGroup
                  type="single"
                  size="sm"
                  value={String(windowLength)}
                  onValueChange={(v) => v && setWindowLength(Number(v))}
                >
                  {WINDOW_LENGTHS.map((n) => (
                    <ToggleGroupItem key={n} value={String(n)}>
                      {n} bars
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <div className="flex min-w-[16rem] flex-1 items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">window start</span>
                  <Slider
                    min={0}
                    max={maxStart}
                    step={Math.max(1, Math.floor(effectiveLength / 10))}
                    value={[clampedStart]}
                    onValueChange={([v]) => {
                      if (v === undefined) return;
                      setWindowStart(v);
                      setCursorIndex(0);
                    }}
                    disabled={maxStart === 0}
                  />
                </div>
              </div>
              {bars.data && evaluation.data ? (
                <PriceLens
                  window={bars.data}
                  trades={evaluation.data.trades}
                  regimes={evaluation.data.regimes}
                  manifest={manifest.data}
                  layers={layers}
                  cursorRowIndex={cursorBar?.rowIndex ?? null}
                  onCursorChange={(rowIndex) => {
                    const index = windowBars.findIndex((bar) => bar.rowIndex === rowIndex);
                    if (index >= 0) setCursorIndex(index);
                  }}
                  height={440}
                />
              ) : (
                <p className="text-sm text-muted-foreground">{bars.error ? bars.error.message : "Loading bars…"}</p>
              )}
            </LensFrame>

            {evaluation.data && (
              <EquityLens
                equity={evaluation.data.equity}
                headline={evaluation.data.headline}
                cursorTimestampSeconds={cursorBar?.timestampSeconds ?? null}
                height={260}
              />
            )}

            {bars.data && (
              <PlaybackPanel
                window={bars.data}
                manifest={manifest.data}
                cursorIndex={Math.min(cursorIndex, Math.max(0, windowBars.length - 1))}
                onCursorIndexChange={setCursorIndex}
                hasMoreAfterWindow={clampedStart + effectiveLength < barCount}
                onReachWindowEnd={() => {
                  setWindowStart(Math.min(maxStart, clampedStart + effectiveLength));
                  setCursorIndex(0);
                }}
              />
            )}

            {evaluation.data && (
              <>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
                  <div className="xl:col-span-8">
                    <RollingPanel rolling={evaluation.data.rolling} horizonBars={manifest.data.horizonBars} />
                  </div>
                  <div className="xl:col-span-4">
                    <ConfusionPanel confusion={evaluation.data.confusion} threshold={params.threshold} />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                  <ScatterPanel scatter={evaluation.data.scatter} />
                  <DistributionPanel distribution={evaluation.data.distribution} />
                </div>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
                  <div className="xl:col-span-8">
                    <AttributionPanel attribution={evaluation.data.attribution} />
                  </div>
                  <div className="xl:col-span-4">
                    <RegimePanel regimes={evaluation.data.regimes} />
                  </div>
                </div>
                <VerificationList checks={[...manifest.data.verification, ...evaluation.data.verification]} />
              </>
            )}
          </>
        )}

        {unready.length > 0 && (
          <LensFrame
            title="Models the lens cannot read"
            question="Why a trained model is missing from the picker."
            testId="lens-refused"
          >
            <ul className="space-y-1 text-xs">
              {unready.map((m) => (
                <li key={m.modelId}>
                  <span className="font-mono">{m.modelId}</span>
                  <span className="text-muted-foreground"> — {m.reason ?? STATUS_TEXT[m.status]}</span>
                </li>
              ))}
            </ul>
          </LensFrame>
        )}
      </div>
    </PageShell>
  );
}
