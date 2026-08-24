/**
 * BlockBootstrapCI — CI95 forest plot per experiment.
 *
 * Computes block-bootstrap confidence intervals via:
 *   - In-browser Web Worker (`workers/bootstrap.worker.ts`) when N trades ≤ 5000
 *   - Server fallback (`POST /api/eval/block-bootstrap`) when N > 5000
 *
 * Both paths return the same shape `{ point, ciLower, ciUpper, blockSize,
 * nResamples }` so this component renders without branching on transport.
 *
 * Render: simple SVG forest plot (one row per experiment) with a vertical
 * baseline reference line. Far cleaner than `<ScatterChart>` for the use
 * case — full control over error-bar geometry.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/shared/utils/utils";
import { Button } from "@/shared/ui/button";
import { paletteColor } from "./palette";
import {
  runBootstrap,
  type BootstrapResponse,
  type BootstrapStatistic,
} from "@/workers/bootstrap.worker";

export interface BootstrapExperimentInput {
  id: string;
  label: string;
  /** Per-trade returns (R-multiple, log-return, or unitless). */
  returns: number[];
  /** Per-trade PnL — required for `profit_factor` statistic. */
  pnl?: number[];
  /** Optional run id used for the server fallback path. */
  runId?: number | null;
}

export type BootstrapCiResult = BootstrapResponse;

export interface BlockBootstrapCIProps {
  experiments: BootstrapExperimentInput[];
  statistic?: BootstrapStatistic;
  /** Optional baseline value rendered as a vertical reference line. */
  baseline?: number | null;
  baselineLabel?: string;
  /** Resamples; defaults to 2000. Larger trade counts force server route. */
  nResamples?: number;
  /** Trade-count threshold above which the server route is used. */
  serverThreshold?: number;
  className?: string;
}

const DEFAULT_THRESHOLD = 5000;
const DEFAULT_RESAMPLES = 2000;
const ROW_HEIGHT = 36;
const PLOT_PADDING = { left: 160, right: 60, top: 24, bottom: 28 };

interface ResultEntry {
  expId: string;
  label: string;
  color: string;
  result?: BootstrapCiResult;
  error?: string;
  pending: boolean;
  source?: "worker" | "server";
}

async function postServerBootstrap(payload: {
  runIds: number[];
  statistic: BootstrapStatistic;
  nResamples: number;
}): Promise<Record<string, BootstrapCiResult>> {
  const res = await fetch("/api/eval/block-bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`bootstrap ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  return (await res.json()) as Record<string, BootstrapCiResult>;
}

export function BlockBootstrapCI({
  experiments,
  statistic = "sharpe",
  baseline = null,
  baselineLabel = "baseline",
  nResamples = DEFAULT_RESAMPLES,
  serverThreshold = DEFAULT_THRESHOLD,
  className,
}: BlockBootstrapCIProps) {
  const [entries, setEntries] = useState<ResultEntry[]>(() =>
    experiments.map((exp, idx) => ({
      expId: exp.id,
      label: exp.label,
      color: paletteColor(idx),
      pending: true,
    })),
  );
  const workerRef = useRef<Worker | null>(null);
  const inflightRef = useRef<Map<string, string>>(new Map());

  // Lazily spin up the worker on first run; tear down on unmount.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const serverMutation = useMutation({
    mutationFn: postServerBootstrap,
  });

  // Reset entries whenever the experiment selection changes.
  useEffect(() => {
    setEntries(
      experiments.map((exp, idx) => ({
        expId: exp.id,
        label: exp.label,
        color: paletteColor(idx),
        pending: true,
      })),
    );
  }, [experiments]);

  // Kick off compute for any pending entry.
  useEffect(() => {
    let cancelled = false;
    const local = experiments.filter((e) => e.returns.length > 0 && e.returns.length <= serverThreshold);
    const remote = experiments.filter((e) => e.returns.length > serverThreshold && e.runId != null);

    // ─── Worker path ──────────────────────────────────────────────────────
    if (local.length > 0) {
      if (!workerRef.current) {
        try {
          workerRef.current = new Worker(
            new URL("../../../../workers/bootstrap.worker.ts", import.meta.url),
            { type: "module" },
          );
        } catch (err) {
          // Worker construction failed (e.g. test env). Fall back to inline.
          for (const exp of local) {
            try {
              const result = runBootstrap({
                id: exp.id,
                returns: exp.returns,
                pnl: exp.pnl,
                statistic,
                nResamples,
              });
              if (cancelled) return;
              setEntries((prev) =>
                prev.map((e) => (e.expId === exp.id ? { ...e, result, pending: false, source: "worker" } : e)),
              );
            } catch (e) {
              setEntries((prev) =>
                prev.map((row) =>
                  row.expId === exp.id ? { ...row, error: (e as Error).message, pending: false } : row,
                ),
              );
            }
          }
          // Continue to remote path even if worker construction failed
          void err;
        }
      }
      const w = workerRef.current;
      if (w) {
        const handler = (event: MessageEvent<BootstrapResponse | { id: string; error: string }>) => {
          if (cancelled) return;
          const data = event.data;
          inflightRef.current.delete(data.id);
          if ("error" in data) {
            setEntries((prev) =>
              prev.map((row) => (row.expId === data.id ? { ...row, error: data.error, pending: false } : row)),
            );
            return;
          }
          setEntries((prev) =>
            prev.map((row) =>
              row.expId === data.id ? { ...row, result: data, pending: false, source: "worker" } : row,
            ),
          );
        };
        w.addEventListener("message", handler);
        for (const exp of local) {
          inflightRef.current.set(exp.id, exp.id);
          w.postMessage({
            id: exp.id,
            returns: exp.returns,
            pnl: exp.pnl,
            statistic,
            nResamples,
          });
        }
        return () => {
          cancelled = true;
          w.removeEventListener("message", handler);
        };
      }
    }

    // ─── Server fallback ──────────────────────────────────────────────────
    if (remote.length > 0) {
      const runIds = remote.map((e) => e.runId as number);
      serverMutation.mutate(
        { runIds, statistic, nResamples },
        {
          onSuccess: (byExperimentId) => {
            if (cancelled) return;
            setEntries((prev) =>
              prev.map((row) => {
                const remoteResult = byExperimentId[row.expId];
                if (!remoteResult) return row;
                return { ...row, result: remoteResult, pending: false, source: "server" };
              }),
            );
          },
          onError: (err) => {
            if (cancelled) return;
            setEntries((prev) =>
              prev.map((row) => {
                if (!remote.some((e) => e.id === row.expId)) return row;
                return { ...row, error: (err as Error).message, pending: false };
              }),
            );
          },
        },
      );
    }

    return () => {
      cancelled = true;
    };
    // serverMutation reference is stable per render; safe to omit
  }, [experiments, statistic, nResamples, serverThreshold]);

  // ── Plot domain ─────────────────────────────────────────────────────────
  const finished = entries.filter((e) => e.result);
  const domain = useMemo(() => {
    let lo = baseline ?? 0;
    let hi = baseline ?? 0;
    for (const e of finished) {
      const r = e.result!;
      lo = Math.min(lo, r.ciLower, r.point);
      hi = Math.max(hi, r.ciUpper, r.point);
    }
    if (baseline != null) {
      lo = Math.min(lo, baseline);
      hi = Math.max(hi, baseline);
    }
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.1;
    return { lo: lo - pad, hi: hi + pad };
  }, [finished, baseline]);

  const width = 720;
  const innerWidth = width - PLOT_PADDING.left - PLOT_PADDING.right;
  const innerHeight = entries.length * ROW_HEIGHT;
  const totalHeight = innerHeight + PLOT_PADDING.top + PLOT_PADDING.bottom;

  const xScale = (v: number) =>
    PLOT_PADDING.left + ((v - domain.lo) / (domain.hi - domain.lo)) * innerWidth;

  if (experiments.length === 0) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center text-sm text-muted-foreground",
          className,
        )}
        data-testid="bootstrap-empty"
      >
        Select experiments to compute block-bootstrap CI95.
      </div>
    );
  }

  return (
    <div
      className={cn("rounded-2xl border border-white/5 bg-white/[0.02] p-3", className)}
      data-testid="bootstrap-ci"
    >
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Block-bootstrap CI95 — {statistic}
        </h4>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px]"
          onClick={() =>
            setEntries((prev) =>
              prev.map((e) => ({ ...e, pending: true, error: undefined, result: undefined })),
            )
          }
        >
          <RefreshCw className="h-3 w-3 mr-1" /> Recompute
        </Button>
      </div>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${totalHeight}`}
        role="img"
        aria-label="Block-bootstrap confidence intervals"
      >
        {/* x-axis */}
        <line
          x1={PLOT_PADDING.left}
          x2={PLOT_PADDING.left + innerWidth}
          y1={totalHeight - PLOT_PADDING.bottom}
          y2={totalHeight - PLOT_PADDING.bottom}
          stroke="rgba(255,255,255,0.25)"
        />
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const v = domain.lo + (domain.hi - domain.lo) * t;
          const x = xScale(v);
          return (
            <g key={t}>
              <line
                x1={x}
                x2={x}
                y1={PLOT_PADDING.top}
                y2={totalHeight - PLOT_PADDING.bottom}
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray="2 4"
              />
              <text
                x={x}
                y={totalHeight - PLOT_PADDING.bottom + 14}
                textAnchor="middle"
                fontSize={10}
                fill="rgba(255,255,255,0.5)"
              >
                {v.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* baseline reference */}
        {baseline != null && Number.isFinite(baseline) && (
          <g>
            <line
              x1={xScale(baseline)}
              x2={xScale(baseline)}
              y1={PLOT_PADDING.top}
              y2={totalHeight - PLOT_PADDING.bottom}
              stroke="#E69F00"
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
            <text
              x={xScale(baseline) + 4}
              y={PLOT_PADDING.top + 10}
              fontSize={10}
              fill="#E69F00"
            >
              {baselineLabel}
            </text>
          </g>
        )}

        {/* rows */}
        {entries.map((entry, idx) => {
          const y = PLOT_PADDING.top + idx * ROW_HEIGHT + ROW_HEIGHT / 2;
          return (
            <g key={entry.expId} data-testid={`bootstrap-row-${entry.expId}`}>
              <text
                x={PLOT_PADDING.left - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={11}
                fill="rgba(255,255,255,0.85)"
              >
                {entry.label}
              </text>
              {entry.error ? (
                <g>
                  <foreignObject
                    x={PLOT_PADDING.left}
                    y={y - 9}
                    width={innerWidth}
                    height={20}
                  >
                    <div className="flex items-center gap-1 text-[11px] text-amber-400">
                      <AlertTriangle className="h-3 w-3" />
                      {entry.error}
                    </div>
                  </foreignObject>
                </g>
              ) : entry.pending || !entry.result ? (
                <g>
                  <foreignObject
                    x={PLOT_PADDING.left}
                    y={y - 9}
                    width={innerWidth}
                    height={20}
                  >
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      computing
                    </div>
                  </foreignObject>
                </g>
              ) : (
                <g>
                  {/* CI bar */}
                  <line
                    x1={xScale(entry.result.ciLower)}
                    x2={xScale(entry.result.ciUpper)}
                    y1={y}
                    y2={y}
                    stroke={entry.color}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                  />
                  {/* lower whisker */}
                  <line
                    x1={xScale(entry.result.ciLower)}
                    x2={xScale(entry.result.ciLower)}
                    y1={y - 6}
                    y2={y + 6}
                    stroke={entry.color}
                    strokeWidth={1.5}
                  />
                  {/* upper whisker */}
                  <line
                    x1={xScale(entry.result.ciUpper)}
                    x2={xScale(entry.result.ciUpper)}
                    y1={y - 6}
                    y2={y + 6}
                    stroke={entry.color}
                    strokeWidth={1.5}
                  />
                  {/* point estimate */}
                  <circle
                    cx={xScale(entry.result.point)}
                    cy={y}
                    r={4.5}
                    fill={entry.color}
                    stroke="rgba(0,0,0,0.5)"
                    strokeWidth={0.75}
                  />
                  {/* numeric callout */}
                  <text
                    x={PLOT_PADDING.left + innerWidth + 6}
                    y={y}
                    fontSize={10}
                    dominantBaseline="middle"
                    fill="rgba(255,255,255,0.7)"
                    fontFamily="monospace"
                  >
                    {entry.result.point.toFixed(2)}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex items-center justify-end text-[10px] text-muted-foreground/70 gap-3">
        <span>n={nResamples} resamples</span>
        {entries.some((e) => e.source === "server") && <span>server fallback active</span>}
      </div>
    </div>
  );
}
