/**
 * Inside the model — neural networks. The explained bar flows left to right,
 * one column per stage (see `stages.ts`):
 *
 *   input window (time × feature) or input vector
 *   → each layer's activations (sequence layers time × units, dense layers a column of units)
 *   → head → logit → sigmoid → P(up)   (price role: the predicted move)
 *
 * Controls: step back / play / step forward through the stages (the current
 * stage is outlined and the caption says in plain words what that layer
 * does), the shape strip doubles as a jump-to-stage bar, a toggle between one
 * colour scale for every layer ("raw values") and each layer scaled to its
 * own range, and hover on any cell for the exact value. Attention networks
 * add "where the model looked" per head. Heatmaps are cividis, attention
 * viridis; up / down use the Okabe-Ito orange / blue with ▲ / ▼.
 */
import { Fragment, useEffect, useRef, useState } from "react";

import { formatTime } from "@/cycle/format";
import { cn } from "@/shared/utils/utils";

import type { InsideKindViewProps } from "../types";
import { AttentionBars } from "./AttentionBars";
import { CIVIDIS_RAMP, type ColorDomain, domainPosition, rampGradient } from "./colorScale";
import { Heatmap, type HeatmapHover, HOVER_OUTLINE } from "./Heatmap";
import { OutputChain } from "./OutputChain";
import { attentionLayers, buildNeuralStages, formatActivation, gridValue, type NeuralStage, sharedDomain } from "./stages";

/** Milliseconds each stage stays highlighted while playing. */
export const PLAY_STEP_MILLISECONDS = 1500;

type ScaleMode = "raw" | "layer";

interface StageHover extends HeatmapHover {
  stageIndex: number;
}

function hoverText(stage: NeuralStage, hover: StageHover, domain: ColorDomain, mode: ScaleMode): string {
  const grid = stage.grid;
  if (!grid) return "";
  const value = gridValue(grid, hover.time, hover.unit);
  const unitName = stage.unitLabels?.[hover.unit] ?? `${stage.unitNoun} ${hover.unit + 1} of ${grid.unitCount}`;
  let when = "";
  if (grid.timeCount > 1) {
    const stamp = stage.timestamps?.[hover.time];
    const position = `bar ${hover.time + 1} of ${grid.timeCount}${hover.time === grid.timeCount - 1 ? ", the bar being predicted" : ""}`;
    when = stamp !== undefined ? ` at ${formatTime(stamp)} (${position})` : ` at ${position}`;
  }
  const noun = stage.family === "input" ? "input (rolling z-score)" : "activation";
  const where =
    value === null ? "" : ` · ${Math.round(domainPosition(value, domain) * 100)}% of ${mode === "layer" ? "this layer's" : "the shared"} colour range`;
  return `${stage.title} · ${unitName}${when} · ${noun} ${formatActivation(value)}${where}`;
}

export function NeuralView({ structure, bar, role, featureNames }: InsideKindViewProps) {
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<ScaleMode>("layer");
  const [hover, setHover] = useState<StageHover | null>(null);
  const [attentionLayer, setAttentionLayer] = useState<string | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);

  const stages = buildNeuralStages({ bar, structure, featureNames, role });
  const lastIndex = stages.length - 1;
  const index = Math.min(current, lastIndex);
  const active = stages[index];
  const shared = sharedDomain(stages);
  const attention = attentionLayers(bar);
  const inputStage = stages[0];

  useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => setCurrent((previous) => Math.min(previous + 1, lastIndex)), PLAY_STEP_MILLISECONDS);
    return () => window.clearInterval(timer);
  }, [playing, lastIndex]);

  // Stop at the last stage; follow the attention chart to the layer being shown.
  const activeId = stages[index]?.id;
  const activeHasAttention = attention.some((entry) => entry.layer === activeId);
  useEffect(() => {
    if (playing && index >= lastIndex) setPlaying(false);
  }, [playing, index, lastIndex]);
  useEffect(() => {
    if (activeHasAttention && activeId) setAttentionLayer(activeId);
  }, [activeHasAttention, activeId]);
  // Keep the highlighted stage on screen when the flow is wider than the panel.
  useEffect(() => {
    const element = flowRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    if (element && typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [index]);

  function goTo(next: number) {
    setCurrent(Math.max(0, Math.min(lastIndex, next)));
  }

  function togglePlay() {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (index >= lastIndex) setCurrent(0);
    setPlaying(true);
  }

  if (!bar.neural) {
    return <p className="text-xs text-neutral-400">This bar carries no layer activations, so there is nothing to draw inside the network.</p>;
  }

  if (!active || !inputStage) return null; // never: there is always an input and an output stage

  const domainFor = (stage: NeuralStage) => (mode === "raw" ? shared : stage.domain);
  const legendDomain = active.grid ? domainFor(active) : shared;
  const hoveredStage = hover ? stages[hover.stageIndex] : null;
  const selectedAttention = attentionLayer ?? attention[0]?.layer ?? "";

  return (
    <div data-testid="neural-view" className="space-y-3 text-xs text-neutral-300">
      {/* ─── controls ─── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1" role="group" aria-label="Step through the layers">
          <button
            type="button"
            data-testid="neural-step-back"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40"
          >
            ◀ Back
          </button>
          <button type="button" data-testid="neural-play" onClick={togglePlay} className="rounded border border-neutral-700 px-2 py-0.5" aria-pressed={playing}>
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <button
            type="button"
            data-testid="neural-step-forward"
            onClick={() => goTo(index + 1)}
            disabled={index === lastIndex}
            className="rounded border border-neutral-700 px-2 py-0.5 disabled:opacity-40"
          >
            Next ▶
          </button>
          <span data-testid="neural-step-counter" className="ml-1 text-neutral-400">
            Step {index + 1} of {stages.length}
          </span>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Colour scale">
          <button
            type="button"
            data-testid="neural-scale-raw"
            aria-pressed={mode === "raw"}
            onClick={() => setMode("raw")}
            className={cn("rounded border px-2 py-0.5", mode === "raw" ? "border-neutral-300 text-neutral-100" : "border-neutral-700 text-neutral-400")}
          >
            Raw values, one scale
          </button>
          <button
            type="button"
            data-testid="neural-scale-layer"
            aria-pressed={mode === "layer"}
            onClick={() => setMode("layer")}
            className={cn("rounded border px-2 py-0.5", mode === "layer" ? "border-neutral-300 text-neutral-100" : "border-neutral-700 text-neutral-400")}
          >
            Each layer scaled to its own range
          </button>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-neutral-400" data-testid="neural-legend">
          <span className="font-mono">{formatActivation(legendDomain.low)}</span>
          <span className="inline-block h-2.5 w-24 rounded-sm" style={{ backgroundImage: rampGradient(CIVIDIS_RAMP) }} />
          <span className="font-mono">{formatActivation(legendDomain.high)}</span>
          <span>{mode === "raw" ? "(every layer)" : `(${active.title})`}</span>
        </div>
      </div>

      {/* ─── shape strip: jump to a stage ─── */}
      <div className="flex flex-wrap items-center gap-1 text-[11px]" data-testid="neural-shape-strip">
        {stages.map((stage) => (
          <Fragment key={stage.index}>
            {stage.index > 0 && (
              <span aria-hidden className="text-neutral-500">
                →
              </span>
            )}
            <button
              type="button"
              data-testid={`neural-shape-${stage.index}`}
              onClick={() => goTo(stage.index)}
              className={cn("rounded border px-1.5 py-0.5 font-mono", stage.index === index ? "text-neutral-100" : "border-neutral-700 text-neutral-400")}
              style={stage.index === index ? { borderColor: HOVER_OUTLINE } : undefined}
            >
              {stage.title} {stage.shapeText}
            </button>
          </Fragment>
        ))}
      </div>

      {/* ─── caption of the current stage ─── */}
      <p data-testid="neural-caption" className="rounded border-l-2 pl-2 text-[12px] text-neutral-200" style={{ borderColor: HOVER_OUTLINE }}>
        <span className="font-medium">
          Step {index + 1} · {active.kindLabel}:
        </span>{" "}
        {active.caption}
      </p>

      {/* ─── the flow ─── */}
      <div ref={flowRef} className="flex items-start gap-2 overflow-x-auto pb-1">
        {stages.map((stage) => {
          const isActive = stage.index === index;
          return (
            <Fragment key={stage.index}>
              {stage.index > 0 && (
                <span aria-hidden className="self-center text-neutral-500">
                  →
                </span>
              )}
              <section
                data-testid={`neural-stage-${stage.index}`}
                data-stage-id={stage.id}
                data-active={isActive ? "true" : "false"}
                onClick={() => goTo(stage.index)}
                className={cn("shrink-0 cursor-pointer space-y-1 rounded border p-1.5 transition-opacity", isActive ? "opacity-100" : "border-neutral-800 opacity-60")}
                style={isActive ? { borderColor: HOVER_OUTLINE } : undefined}
              >
                <header className="leading-tight">
                  <div className="text-[11px] font-medium text-neutral-200">{stage.title}</div>
                  <div className="text-[10px] text-neutral-400">
                    {stage.kindLabel} · {stage.shapeText}
                  </div>
                </header>
                {stage.grid ? (
                  <>
                    <Heatmap
                      grid={stage.grid}
                      domain={domainFor(stage)}
                      label={`${stage.title} ${stage.family === "input" ? "inputs" : "activations"}`}
                      testId={`neural-heatmap-${stage.index}`}
                      rowLabels={stage.unitLabels}
                      hovered={hover && hover.stageIndex === stage.index ? hover : null}
                      onHover={(cell) => setHover(cell ? { ...cell, stageIndex: stage.index } : null)}
                    />
                    {stage.grid.timeCount > 1 && (
                      <div className="flex justify-between gap-2 text-[9px] text-neutral-500">
                        <span>{stage.timestamps ? formatTime(stage.timestamps[0]) : "oldest"}</span>
                        <span>{stage.timestamps ? `${formatTime(stage.timestamps[stage.timestamps.length - 1])} predicted ⇢` : "predicted bar ⇢"}</span>
                      </div>
                    )}
                  </>
                ) : stage.id === "output" ? (
                  <OutputChain bar={bar} role={role} />
                ) : (
                  <p className="max-w-[12rem] text-[10px] text-neutral-400">{stage.problem}</p>
                )}
              </section>
            </Fragment>
          );
        })}
      </div>

      {/* ─── hover readout ─── */}
      <p data-testid="neural-hover" className="min-h-[1rem] font-mono text-[11px] text-neutral-300">
        {hover && hoveredStage
          ? hoverText(hoveredStage, hover, domainFor(hoveredStage), mode)
          : `Hover any cell for its exact value. ${inputStage.grid && inputStage.grid.timeCount > 1 ? "Columns are bars, oldest on the left; rows are features or units." : "Rows are features or units."}`}
      </p>

      {attention.length > 0 && (
        <AttentionBars layers={attention} selectedLayer={selectedAttention} onSelectLayer={setAttentionLayer} timestamps={inputStage.timestamps} />
      )}
    </div>
  );
}
