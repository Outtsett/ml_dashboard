/**
 * DeploymentLiveMetrics — W7.f
 *
 * Sparkline strip for every active deployment surfaced by the
 * `/api/events/deployments` SSE feed. Designed to be lazy-mounted by W7.e's
 * <PromoteStage> rewrite via React.lazy() so it only opens the EventSource
 * when the user is actually looking at the Promote stage — preventing the
 * "two windows = duplicate events" risk called out in §10 of the plan.
 *
 * Charts: per deployment we render three sparklines —
 *   1. pred/min — last 60 readings (one per ~1s) of the rolling-window count
 *   2. paper PnL — last 30 pnl_update events
 *   3. drift PSI — last 30 events; renders empty if PSI never seen
 *
 * Sparklines are inline SVG, deliberately avoiding Recharts: each chart is
 * 30-60 points and we only render 4-8 deployments simultaneously. Recharts
 * would add ~80KB and a Resize-observer per chart for no benefit.
 *
 * Connection status indicator follows the conventional dashboard semantics:
 *   green   — EventSource open, receiving events
 *   amber   — disconnected but reconnecting (backoff in flight)
 *   red     — exhausted retries (only reachable via maxReconnectAttempts;
 *             we don't currently cap, so this only appears on enabled=false)
 */

import { useEffect, useRef, useMemo } from 'react';
import {
  useDeploymentEvents,
  type DeploymentEventState,
  type DeploymentRunStatus,
} from "@/deployment/lib/useDeploymentEvents";

// ── Public component ────────────────────────────────────────────────────────

export interface DeploymentLiveMetricsProps {
  /** When provided, only deployments whose ids are in this list render. */
  deploymentIds?: number[];
  /** Optional label lookup for prettier headings (e.g. "MNQ 1m · live · v_004"). */
  deploymentLabels?: Record<number, string>;
  className?: string;
}

export function DeploymentLiveMetrics({
  deploymentIds,
  deploymentLabels,
  className,
}: DeploymentLiveMetricsProps) {
  const { byDeployment, connected, reconnectAttempt } = useDeploymentEvents();

  const ids = useMemo(() => {
    const all = Object.keys(byDeployment).map(Number).filter(Number.isFinite);
    if (!deploymentIds) return all.sort((a, b) => a - b);
    const allow = new Set(deploymentIds);
    return all.filter((id) => allow.has(id)).sort((a, b) => a - b);
  }, [byDeployment, deploymentIds]);

  return (
    <div
      className={[
        'rounded-2xl border border-white/5 bg-white/[0.02] p-4 space-y-3',
        className ?? '',
      ].join(' ')}
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground/90">Live deployment metrics</h3>
        <ConnectionDot connected={connected} reconnectAttempt={reconnectAttempt} />
      </header>

      {ids.length === 0 ? (
        <div className="text-xs text-muted-foreground py-3">
          {connected
            ? 'No deployments emitting events yet. Start a paper or live deployment to see sparklines here.'
            : 'Waiting for SSE channel…'}
        </div>
      ) : (
        <ul className="space-y-2">
          {ids.map((id) => (
            <DeploymentRow
              key={id}
              deploymentId={id}
              label={deploymentLabels?.[id]}
              state={byDeployment[id]!}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Per-deployment row ──────────────────────────────────────────────────────

interface DeploymentRowProps {
  deploymentId: number;
  label?: string;
  state: DeploymentEventState;
}

const PRED_HISTORY_LEN = 60;
const PNL_HISTORY_LEN = 30;
const PSI_HISTORY_LEN = 30;

function DeploymentRow({ deploymentId, label, state }: DeploymentRowProps) {
  // Per-row history rings — kept in refs so unrelated parent re-renders
  // don't reset them. We append on prop change and trim to the cap.
  const predRingRef = useRef<number[]>([]);
  const pnlRingRef = useRef<number[]>([]);
  const psiRingRef = useRef<number[]>([]);

  // ── Append on every new live snapshot ────────────────────────────────────
  // pred/min: append every render — even while no new prediction events
  // arrive, so the line decays toward 0 visually as the rolling window
  // ages out old timestamps server-side.
  useEffect(() => {
    const ring = predRingRef.current;
    ring.push(state.predPerMin);
    if (ring.length > PRED_HISTORY_LEN) ring.splice(0, ring.length - PRED_HISTORY_LEN);
  }, [state.predPerMin]);

  // PnL: append only when the value actually moves (pnl_update event landed).
  const lastPnlRef = useRef<number | null>(null);
  useEffect(() => {
    if (state.paperPnlTotal === null) return;
    if (state.paperPnlTotal === lastPnlRef.current) return;
    lastPnlRef.current = state.paperPnlTotal;
    const ring = pnlRingRef.current;
    ring.push(state.paperPnlTotal);
    if (ring.length > PNL_HISTORY_LEN) ring.splice(0, ring.length - PNL_HISTORY_LEN);
  }, [state.paperPnlTotal]);

  // PSI: same gating — only on real value changes.
  const lastPsiRef = useRef<number | null>(null);
  useEffect(() => {
    if (state.predDriftPsi === null) return;
    if (state.predDriftPsi === lastPsiRef.current) return;
    lastPsiRef.current = state.predDriftPsi;
    const ring = psiRingRef.current;
    ring.push(state.predDriftPsi);
    if (ring.length > PSI_HISTORY_LEN) ring.splice(0, ring.length - PSI_HISTORY_LEN);
  }, [state.predDriftPsi]);

  const heading = label ?? `Deployment #${deploymentId}`;

  return (
    <li className="rounded-xl border border-white/5 bg-white/[0.015] p-3" data-testid={`deployment-row-${deploymentId}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-mono text-foreground/90 truncate">{heading}</div>
          <div className="text-[10px] text-muted-foreground/70 mt-0.5">
            {state.predictionsEmitted.toLocaleString()} preds · status {state.status}
            {state.lastError ? ` · ${state.lastError}` : ''}
          </div>
        </div>
        <StatusPill status={state.status} />
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
        <SparklineCell
          label="pred/min"
          value={state.predPerMin.toFixed(0)}
          data={predRingRef.current}
          stroke="rgb(96 165 250)"   // tailwind blue-400
          fill="rgba(96, 165, 250, 0.15)"
        />
        <SparklineCell
          label="paper PnL"
          value={state.paperPnlTotal !== null ? `$${state.paperPnlTotal.toFixed(2)}` : '—'}
          data={pnlRingRef.current}
          stroke={
            state.paperPnlTotal !== null && state.paperPnlTotal < 0
              ? 'rgb(244 63 94)'    // rose-500
              : 'rgb(52 211 153)'   // emerald-400
          }
          fill={
            state.paperPnlTotal !== null && state.paperPnlTotal < 0
              ? 'rgba(244, 63, 94, 0.15)'
              : 'rgba(52, 211, 153, 0.15)'
          }
        />
        <SparklineCell
          label="drift PSI"
          value={state.predDriftPsi !== null ? state.predDriftPsi.toFixed(3) : '—'}
          data={psiRingRef.current}
          stroke="rgb(251 191 36)"  // amber-400
          fill="rgba(251, 191, 36, 0.15)"
        />
      </div>
    </li>
  );
}

// ── Sparkline (inline SVG; no chart library) ────────────────────────────────

interface SparklineCellProps {
  label: string;
  value: string;
  data: readonly number[];
  stroke: string;
  fill: string;
}

function SparklineCell({ label, value, data, stroke, fill }: SparklineCellProps) {
  return (
    <div className="rounded-lg bg-black/20 border border-white/5 p-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">{label}</span>
        <span className="text-xs font-mono text-foreground tabular-nums">{value}</span>
      </div>
      <div className="mt-1 h-8">
        <Sparkline data={data} stroke={stroke} fill={fill} />
      </div>
    </div>
  );
}

interface SparklineProps {
  data: readonly number[];
  stroke: string;
  fill: string;
  width?: number;
  height?: number;
}

/**
 * Pure inline-SVG sparkline. Uses a 0..100 viewBox + preserveAspectRatio=none
 * so the chart fills its container regardless of pixel size. Scaling math:
 *   x = i / (n-1) * 100
 *   y = 100 - ((v - min) / (max - min)) * 100   (inverted because SVG y grows down)
 * Edge cases:
 *   - empty data → render only the baseline
 *   - flat line (max == min) → midline at y=50
 */
function Sparkline({ data, stroke, fill, width = 100, height = 32 }: SparklineProps) {
  if (data.length === 0) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="w-full h-full"
        aria-hidden="true"
      >
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
      </svg>
    );
  }

  let min = data[0]!;
  let max = data[0]!;
  for (const v of data) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1; // avoid /0 on flat series

  const points: string[] = [];
  const n = data.length;
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? width / 2 : (i / (n - 1)) * width;
    const y = height - ((data[i]! - min) / span) * height;
    points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
  }
  const linePath = `M ${points.join(' L ')}`;
  const fillPath = `${linePath} L ${width},${height} L 0,${height} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="w-full h-full"
      aria-label={`sparkline (${n} points)`}
    >
      <path d={fillPath} fill={fill} stroke="none" />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth={1.25} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── Connection / status pills ───────────────────────────────────────────────

function ConnectionDot({ connected, reconnectAttempt }: { connected: boolean; reconnectAttempt: number }) {
  let tone: 'green' | 'amber' | 'red';
  let text: string;
  if (connected) {
    tone = 'green';
    text = 'connected';
  } else if (reconnectAttempt > 0) {
    tone = 'amber';
    text = `reconnecting (${reconnectAttempt})`;
  } else {
    tone = 'red';
    text = 'disconnected';
  }
  const dotColor =
    tone === 'green' ? 'bg-[hsl(var(--data-pos))]' : tone === 'amber' ? 'bg-amber-400' : 'bg-[hsl(var(--data-neg))]';
  return (
    <div className="flex items-center gap-1.5" data-testid="sse-connection-status" data-tone={tone}>
      <span className={`h-2 w-2 rounded-full ${dotColor} ${connected ? 'animate-pulse' : ''}`} />
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/80">{text}</span>
    </div>
  );
}

function StatusPill({ status }: { status: DeploymentRunStatus }) {
  const cfg: Record<DeploymentRunStatus, { label: string; cls: string }> = {
    running:  { label: 'running',  cls: 'border-[hsl(var(--data-pos)/0.3)] text-[hsl(var(--data-pos))] bg-[hsl(var(--data-pos)/0.05)]'  },
    paused:   { label: 'paused',   cls: 'border-amber-400/30 text-amber-300 bg-amber-400/5'        },
    stopped:  { label: 'stopped',  cls: 'border-zinc-400/30 text-zinc-300 bg-zinc-400/5'           },
    failed:   { label: 'failed',   cls: 'border-[hsl(var(--data-neg)/0.3)] text-[hsl(var(--data-neg))] bg-[hsl(var(--data-neg)/0.05)]'           },
  };
  const { label, cls } = cfg[status];
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded border ${cls}`}>{label}</span>
  );
}

export default DeploymentLiveMetrics;
