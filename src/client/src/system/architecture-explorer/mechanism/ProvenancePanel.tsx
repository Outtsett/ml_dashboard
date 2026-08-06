/**
 * The honesty block. Non-dismissible, always populated from real values.
 *
 * States three things a viewer cannot otherwise know:
 *   1. what data is on screen (real symbol, timeframe, bar count, span)
 *   2. where the numbers come from (provenance tier, in plain words)
 *   3. what this account was researched from (the cited spec file)
 */

import type { MechanismSpec, Provenance } from './registry';
import type { MechanismData } from './data/useMechanismBars';

export const PROVENANCE_COPY: Record<Provenance, { label: string; body: string }> = {
  analytic: {
    label: 'analytic',
    body:
      'The mathematics is fully determined by the data — no trained weights are ' +
      'involved, so this result is genuinely correct for these bars.',
  },
  'trained-live': {
    label: 'trained live',
    body:
      'Really optimized in your browser on these bars. Small, but honestly ' +
      'trained — the step count and loss below are the actual optimizer state.',
  },
  seeded: {
    label: 'seeded',
    body:
      'The arithmetic is real and runs on your bars, but the weights are seeded, ' +
      'not learned. The output is not a prediction.',
  },
};

/**
 * `/api/charts/ohlcv` returns MILLISECOND epochs, while the parquet-derived
 * fixtures use seconds. Rather than assume a unit and silently render a date
 * decades off, detect it: anything past ~2001 in milliseconds is already ms.
 */
function fmtDate(ts: number | null): string {
  if (ts == null) return '—';
  const ms = Math.abs(ts) > 1e11 ? ts : ts * 1000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export interface ProvenancePanelProps {
  spec: MechanismSpec;
  data: MechanismData;
  symbol: string;
  timeframeLabel: string;
  /** Live optimizer/iteration readout, when the archetype reports one. */
  liveMetric?: { label: string; value: string } | null;
}

export function ProvenancePanel({
  spec,
  data,
  symbol,
  timeframeLabel,
  liveMetric,
}: ProvenancePanelProps) {
  const copy = PROVENANCE_COPY[spec.provenance];
  return (
    <div className="rounded-md border border-border/50 bg-card/40 p-3 text-xs">
      <dl className="space-y-2.5">
        <div>
          <dt className="font-medium text-muted-foreground">data</dt>
          <dd className="tnum">
            {symbol} · {timeframeLabel} · {data.barCount} real bars from QuestDB
          </dd>
          <dd className="tnum text-muted-foreground">
            {fmtDate(data.firstTimestamp)} → {fmtDate(data.lastTimestamp)}
          </dd>
          <dd className="text-muted-foreground">
            {data.features.warmup} bars held back by the {data.warmupNeeded}-bar
            causal warmup; {data.features.rows.length} complete feature rows in play.
          </dd>
        </div>

        <div>
          <dt className="font-medium text-muted-foreground">weights</dt>
          <dd>
            <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
              {copy.label}
            </span>
          </dd>
          <dd className="text-muted-foreground">{copy.body}</dd>
          {liveMetric ? (
            <dd className="tnum pt-0.5">
              {liveMetric.label} {liveMetric.value}
            </dd>
          ) : null}
        </div>

        <div>
          <dt className="font-medium text-muted-foreground">source</dt>
          <dd className="break-all text-muted-foreground">{spec.specPath}</dd>
        </div>
      </dl>
    </div>
  );
}

export default ProvenancePanel;
