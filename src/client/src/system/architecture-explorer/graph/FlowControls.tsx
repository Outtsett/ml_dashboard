/**
 * FlowControls — transport bar for the data-flow animation.
 *
 * Play/pause, speed, and a layer-by-layer step control so one transform can be
 * watched at a time. The active-layer readout names the REAL derived layer the
 * pulse is inside (label + kind + its real output shape) — it reads straight
 * off the ArchNode, so it is architecture fact, not commentary.
 *
 * Under `prefers-reduced-motion: reduce` the play/speed controls are removed
 * entirely (there is nothing to play) and the stepper becomes the only
 * transport, with a written explanation of why.
 */

import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/utils/utils';
import type { ArchGraph } from './types';
import { LAYER_PALETTE } from './palette';
import type { FlowPlan } from './flow';
import { useActiveStage, type FlowClock } from './useFlowClock';

export const SPEEDS = [0.5, 1, 2, 4] as const;
export type FlowSpeed = (typeof SPEEDS)[number];

interface FlowControlsProps {
  graph: ArchGraph;
  plan: FlowPlan;
  clock: FlowClock;
  playing: boolean;
  onPlayingChange: (v: boolean) => void;
  speed: FlowSpeed;
  onSpeedChange: (v: FlowSpeed) => void;
  /** Current step index while paused. */
  step: number;
  onStepChange: (v: number) => void;
  showShapes: boolean;
  onShowShapesChange: (v: boolean) => void;
  /** True when the OS asked for reduced motion — hides the motion transport. */
  reducedMotion: boolean;
}

export function FlowControls({
  graph,
  plan,
  clock,
  playing,
  onPlayingChange,
  speed,
  onSpeedChange,
  step,
  onStepChange,
  showShapes,
  onShowShapesChange,
  reducedMotion,
}: FlowControlsProps) {
  const last = Math.max(0, plan.stageCount - 1);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-white/10 bg-white/[0.02] px-2.5 py-1.5">
      {!reducedMotion && (
        <>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-[10px]"
            onClick={() => onPlayingChange(!playing)}
            aria-label={playing ? 'Pause data flow' : 'Play data flow'}
            data-testid="arch-flow-play"
          >
            {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            {playing ? 'Pause' : 'Play'}
          </Button>

          <div className="flex items-center gap-0.5" role="group" aria-label="Flow speed">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSpeedChange(s)}
                aria-pressed={s === speed}
                className={cn(
                  'h-5 rounded-sm border px-1.5 font-mono text-[9px] transition-colors',
                  s === speed
                    ? 'border-primary/60 bg-white/[0.06] text-foreground'
                    : 'border-white/10 bg-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {`${s}×`}
              </button>
            ))}
          </div>

          <span className="h-4 w-px bg-white/10" aria-hidden />
        </>
      )}

      {/* Step transport — the only transport under reduced motion. */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => {
            onPlayingChange(false);
            onStepChange(Math.max(0, step - 1));
          }}
          disabled={step <= 0}
          aria-label="Previous layer"
          data-testid="arch-flow-step-prev"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <ActiveLayerReadout graph={graph} plan={plan} clock={clock} />
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => {
            onPlayingChange(false);
            onStepChange(Math.min(last, step + 1));
          }}
          disabled={step >= last}
          aria-label="Next layer"
          data-testid="arch-flow-step-next"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={() => {
            onPlayingChange(false);
            onStepChange(0);
          }}
          aria-label="Reset flow to the input layer"
          data-testid="arch-flow-reset"
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      </div>

      <span className="h-4 w-px bg-white/10" aria-hidden />

      <button
        type="button"
        onClick={() => onShowShapesChange(!showShapes)}
        aria-pressed={showShapes}
        className={cn(
          'h-5 rounded-sm border px-1.5 font-mono text-[9px] transition-colors',
          showShapes
            ? 'border-primary/60 bg-white/[0.06] text-foreground'
            : 'border-white/10 bg-transparent text-muted-foreground hover:text-foreground',
        )}
        data-testid="arch-flow-shapes-toggle"
      >
        shapes
      </button>

      {reducedMotion && (
        <span className="font-mono text-[9px] text-muted-foreground">
          reduced motion — step through layers manually
        </span>
      )}
    </div>
  );
}

/**
 * Names the layer the pulse is currently inside. Subscribes to the clock but
 * re-renders only when the integer stage changes (~once per beat), so the
 * 60fps loop stays render-free.
 */
function ActiveLayerReadout({
  graph,
  plan,
  clock,
}: {
  graph: ArchGraph;
  plan: FlowPlan;
  clock: FlowClock;
}) {
  const stage = useActiveStage(clock, Math.max(1, plan.stageCount));
  const ids = plan.stages[stage] ?? [];
  const nodes = ids
    .map((id) => graph.nodes.find((n) => n.id === id))
    .filter((n): n is NonNullable<typeof n> => n != null);

  const name =
    nodes.length === 0
      ? '—'
      : nodes.length === 1
        ? nodes[0]!.label
        : `${nodes.length} parallel layers`;
  const kinds = [...new Set(nodes.map((n) => LAYER_PALETTE[n.kind].label))].join(' + ');
  const outShape = nodes.length === 1 ? nodes[0]!.outShape : undefined;

  return (
    <span
      className="min-w-[190px] px-1 text-center font-mono text-[10px] leading-tight"
      data-testid="arch-flow-active-layer"
    >
      <span className="text-muted-foreground">{`${stage + 1}/${plan.stageCount} `}</span>
      <span className="text-foreground">{name}</span>
      {kinds && <span className="text-muted-foreground">{` · ${kinds}`}</span>}
      {outShape && <span className="text-muted-foreground">{` · ${outShape}`}</span>}
    </span>
  );
}
