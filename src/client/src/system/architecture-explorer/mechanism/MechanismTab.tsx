/**
 * The Mechanism tab.
 *
 * Picker -> researched spec -> archetype engine, over real bars. The shell owns
 * transport state and layout; it never does mechanism math and never fetches
 * inside a component body.
 *
 * Refusals are explicit and layered:
 *   - a catalog key with no researched entry renders its stated reason;
 *   - a researched entry whose archetype has no engine says so;
 *   - a researched entry whose own kernel is not built says so.
 * None of them ever falls back to another model's animation.
 */

import { Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play, Pause, SkipForward, RotateCcw } from 'lucide-react';
import { resolveMechanism, allMechanisms } from './registry';
import { resolveEngine, hasLiveKernel, type ArchetypeProgress } from './archetypes';
import { useMechanismBars } from './data/useMechanismBars';
import { ProvenancePanel } from './ProvenancePanel';
import { RepoRunnerBanner } from './RepoRunnerBanner';
import { minutesToLabel } from '@/market/lib/timeframes';
import { cn } from '@/shared/utils/utils';

const TIMEFRAMES = [1, 5, 15, 60, 1440] as const;
const SYMBOLS = ['MNQ', 'ES', 'EURUSD'] as const;

interface CatalogRow {
  name?: string;
  category?: string;
}

/** The real catalog, so the picker shows the true surface, not a filtered one. */
function useCatalogRows() {
  return useQuery<Record<string, CatalogRow>>({
    queryKey: ['/api/model-catalog/trainable', 'mechanism-picker'],
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/model-catalog/trainable', { signal });
      if (!res.ok) throw new Error(`catalog ${res.status}`);
      return (await res.json()) as Record<string, CatalogRow>;
    },
    staleTime: 30 * 60 * 1000,
  });
}

export interface MechanismTabProps {
  /** Test/deep-link seam. Defaults to the first animated model. */
  initialCatalogKey?: string;
}

export function MechanismTab({ initialCatalogKey }: MechanismTabProps) {
  const researched = useMemo(
    () => allMechanisms().sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const firstAnimated = useMemo(
    () => researched.find((m) => m.kernelId !== null)?.catalogKey ?? '',
    [researched],
  );

  const [catalogKey, setCatalogKey] = useState(
    initialCatalogKey ?? firstAnimated,
  );
  const [symbol, setSymbol] = useState<string>('MNQ');
  const [tfMinutes, setTfMinutes] = useState<number>(1);
  const [playing, setPlaying] = useState(true);
  const [stepSignal, setStepSignal] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [activeBeat, setActiveBeat] = useState<string | null>(null);
  const [progress, setProgress] = useState<ArchetypeProgress | null>(null);

  const catalog = useCatalogRows();
  const resolution = resolveMechanism(catalogKey);
  const { data, isLoading, error } = useMechanismBars(symbol, tfMinutes);

  // Every researched spec resolves to an engine — bespoke where a kernel
  // reproduces the real algorithm, StageFlow otherwise.
  const Engine = resolution.researched ? resolveEngine(resolution.spec) : undefined;

  /** Every catalog key, grouped by how honestly we can show it. */
  const groups = useMemo(() => {
    const rows = catalog.data ? Object.entries(catalog.data) : [];
    const animated: [string, string][] = [];
    const researchedOnly: [string, string][] = [];
    const pending: [string, string][] = [];
    for (const [key, row] of rows) {
      const label = row.name ?? key;
      const r = resolveMechanism(key);
      if (r.researched && hasLiveKernel(r.spec)) animated.push([key, label]);
      else if (r.researched) researchedOnly.push([key, label]);
      else pending.push([key, label]);
    }
    const byLabel = (a: [string, string], b: [string, string]) =>
      a[1].localeCompare(b[1]);
    return {
      animated: animated.sort(byLabel),
      researchedOnly: researchedOnly.sort(byLabel),
      pending: pending.sort(byLabel),
    };
  }, [catalog.data]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <select
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          className="rounded border border-border/60 bg-card px-2 py-1"
          aria-label="Symbol"
        >
          {SYMBOLS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={tfMinutes}
          onChange={(e) => setTfMinutes(Number(e.target.value))}
          className="rounded border border-border/60 bg-card px-2 py-1"
          aria-label="Timeframe"
        >
          {TIMEFRAMES.map((m) => (
            <option key={m} value={m}>
              {minutesToLabel(m)}
            </option>
          ))}
        </select>

        <select
          value={catalogKey}
          onChange={(e) => {
            setCatalogKey(e.target.value);
            setActiveBeat(null);
            setProgress(null);
          }}
          className="min-w-[20rem] rounded border border-border/60 bg-card px-2 py-1"
          aria-label="Model"
        >
          {groups.animated.length === 0 &&
          groups.researchedOnly.length === 0 &&
          groups.pending.length === 0 ? (
            researched.map((m) => (
              <option key={m.catalogKey} value={m.catalogKey}>
                {m.name}
              </option>
            ))
          ) : (
            <>
              <optgroup
                label={`Animated · live computed values (${groups.animated.length})`}
              >
                {groups.animated.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </optgroup>
              <optgroup
                label={`Animated · information flow (${groups.researchedOnly.length})`}
              >
                {groups.researchedOnly.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </optgroup>
              <optgroup label={`Not yet researched (${groups.pending.length})`}>
                {groups.pending.map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </optgroup>
            </>
          )}
        </select>

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPlaying((v) => !v)}
            className="rounded border border-border/60 px-2 py-1 hover:bg-muted"
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setStepSignal((n) => n + 1);
            }}
            className="rounded border border-border/60 px-2 py-1 hover:bg-muted"
            aria-label="Step"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              setStepSignal(0);
              setPlaying(true);
            }}
            className="rounded border border-border/60 px-2 py-1 hover:bg-muted"
            aria-label="Reset"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
          <input
            type="range"
            min={0.25}
            max={4}
            step={0.25}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="ml-1 w-24"
            aria-label="Speed"
          />
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="relative min-h-0 flex-1 rounded-md border border-border/50 bg-card/30">
          {!resolution.researched ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
              {resolution.reason}
            </div>
          ) : !Engine ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
              {resolution.spec.name} is researched — its mechanism is{' '}
              <span className="mx-1 font-medium">{resolution.spec.archetype}</span>{' '}
              — but that engine is not built yet. Nothing is drawn rather than
              showing a different model&rsquo;s animation.
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-xs">
              Could not load bars: {error.message}
            </div>
          ) : isLoading || !data.ready ? (
            <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
              Loading real {symbol} bars — the causal z-score window needs{' '}
              {data.warmupNeeded} bars of history before the first point is
              complete.
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="p-8 text-xs text-muted-foreground">
                  Loading engine…
                </div>
              }
            >
              <Engine
                spec={resolution.spec}
                features={data.features}
                playing={playing}
                stepSignal={stepSignal}
                speed={speed}
                activeBeat={activeBeat}
                onProgress={setProgress}
              />
            </Suspense>
          )}
        </div>

        {/* Beats + provenance */}
        <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-auto">
          {resolution.researched ? (
            <>
              <div className="rounded-md border border-border/50 bg-card/40 p-3 text-xs">
                <p className="mb-2 font-medium text-muted-foreground">
                  What makes this {resolution.spec.name}
                </p>
                <ul className="space-y-1">
                  {resolution.spec.beats.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setActiveBeat(activeBeat === b.id ? null : b.id)
                        }
                        className={cn(
                          'w-full rounded px-1.5 py-1 text-left hover:bg-muted',
                          activeBeat === b.id && 'bg-muted font-medium',
                        )}
                      >
                        {b.label}
                      </button>
                      {activeBeat === b.id ? (
                        <p className="px-1.5 pb-1 pt-1 text-muted-foreground">
                          {b.detail}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-border/40 pt-2 text-muted-foreground">
                  {resolution.spec.analogy}
                </p>
              </div>

              <ProvenancePanel
                spec={resolution.spec}
                data={data}
                symbol={symbol}
                timeframeLabel={minutesToLabel(tfMinutes)}
                liveMetric={
                  progress
                    ? {
                        label: progress.metricLabel,
                        value: progress.metricValue.toFixed(3),
                      }
                    : null
                }
              />
            </>
          ) : null}
        </aside>
      </div>

      {resolution.researched ? <RepoRunnerBanner spec={resolution.spec} /> : null}
    </div>
  );
}

export default MechanismTab;
