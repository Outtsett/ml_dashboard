/**
 * Embeddable mechanism animation.
 *
 * The full surface lives on /architecture -> Mechanism, but a model's animation
 * is most wanted where the model is being READ — the catalog detail view. This
 * is that same engine, same registry, same honesty contract, in a panel.
 *
 * The catalog browses 300 markdown specs while the mechanism registry covers
 * the 140 trainable keys, so a catalog model may legitimately have no entry.
 * That renders the stated reason, never a lookalike.
 */

import { Suspense, useState } from 'react';
import { Play, Pause, SkipForward } from 'lucide-react';
import { resolveMechanism } from './registry';
import { resolveEngine, hasLiveKernel, type ArchetypeProgress } from './archetypes';
import { useMechanismBars } from './data/useMechanismBars';
import { PROVENANCE_COPY } from './ProvenancePanel';
import { RepoRunnerBanner } from './RepoRunnerBanner';
import { cn } from '@/shared/utils/utils';

export interface MechanismPreviewProps {
  /** Catalog model id. Matches the mechanism registry's catalogKey. */
  catalogKey: string;
  /** Bars to animate over. Defaults to the instrument with the deepest history. */
  symbol?: string;
  timeframeMinutes?: number;
  className?: string;
}

export function MechanismPreview({
  catalogKey,
  symbol = 'MNQ',
  timeframeMinutes = 1,
  className,
}: MechanismPreviewProps) {
  const [playing, setPlaying] = useState(true);
  const [stepSignal, setStepSignal] = useState(0);
  const [activeBeat, setActiveBeat] = useState<string | null>(null);
  const [progress, setProgress] = useState<ArchetypeProgress | null>(null);

  const resolution = resolveMechanism(catalogKey);
  const { data, isLoading, error } = useMechanismBars(symbol, timeframeMinutes);

  if (!resolution.researched) {
    return (
      <div
        className={cn(
          'rounded-md border border-border/50 bg-card/30 p-4 text-xs text-muted-foreground',
          className,
        )}
      >
        <p className="mb-1 font-medium text-foreground">How this model processes information</p>
        <p>{resolution.reason}</p>
      </div>
    );
  }

  const spec = resolution.spec;
  const Engine = resolveEngine(spec);
  const copy = PROVENANCE_COPY[spec.provenance];
  // Only a live-kernel engine consumes bars; a flow-only model must not sit
  // behind a 13s cold OHLCV query it has no use for.
  const needsBars = hasLiveKernel(spec);

  return (
    <div className={cn('rounded-md border border-border/50 bg-card/30', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2">
        <p className="text-xs font-medium">How this model processes information</p>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium">
          {copy.label}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {spec.archetype} · {symbol} {timeframeMinutes}m
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPlaying((v) => !v)}
            className="rounded border border-border/60 px-1.5 py-0.5 hover:bg-muted"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setStepSignal((n) => n + 1);
            }}
            className="rounded border border-border/60 px-1.5 py-0.5 hover:bg-muted"
            aria-label="Step"
          >
            <SkipForward className="h-3 w-3" />
          </button>
        </div>
      </div>

      <div className="h-[300px] w-full">
        {error ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs">
            Could not load bars: {error.message}
          </div>
        ) : needsBars && (isLoading || !data.ready) ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
            Loading real {symbol} bars — the causal z-score window needs{' '}
            {data.warmupNeeded} bars before the first point is complete.
          </div>
        ) : (
          <Suspense
            fallback={
              <div className="p-4 text-xs text-muted-foreground">Loading engine…</div>
            }
          >
            <Engine
              spec={spec}
              features={data.features}
              playing={playing}
              stepSignal={stepSignal}
              speed={1}
              activeBeat={activeBeat}
              onProgress={setProgress}
            />
          </Suspense>
        )}
      </div>

      <div className="space-y-2 border-t border-border/40 px-3 py-2 text-xs">
        <div className="flex flex-wrap gap-1.5">
          {spec.beats.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setActiveBeat(activeBeat === b.id ? null : b.id)}
              className={cn(
                'rounded border border-border/60 px-1.5 py-0.5 hover:bg-muted',
                activeBeat === b.id && 'bg-muted font-medium',
              )}
            >
              {b.label}
            </button>
          ))}
        </div>
        {activeBeat ? (
          <p className="text-muted-foreground">
            {spec.beats.find((b) => b.id === activeBeat)?.detail}
          </p>
        ) : (
          <p className="text-muted-foreground">{spec.analogy}</p>
        )}
        <p className="text-muted-foreground">{copy.body}</p>
        {progress ? (
          <p className="tnum text-muted-foreground">
            {progress.metricLabel} {progress.metricValue.toFixed(3)}
          </p>
        ) : null}
        <p className="break-all text-[10px] text-muted-foreground">
          source: {spec.specPath} ·{' '}
          {spec.curation === 'curated'
            ? 'read end to end'
            : 'stages lifted from this spec’s own Principles / Algorithm sections'}
        </p>
        <RepoRunnerBanner spec={spec} />
      </div>
    </div>
  );
}

export default MechanismPreview;
