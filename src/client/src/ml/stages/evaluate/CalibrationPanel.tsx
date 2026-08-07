/**
 * CalibrationPanel — overlaid reliability curves with per-experiment ECE
 * callouts.
 *
 * Each experiment supplies a `diagnosticsPath` (set on `ExperimentRecord` by
 * the trainer); we hit `GET /api/training/diagnostics?path=…` to retrieve the
 * calibration buckets and render one polyline per experiment plus the y=x
 * reference line (perfect calibration).
 *
 * Buckets schema (read out of the trainer's diagnostics.json):
 *   {
 *     calibration: {
 *       buckets: [{ predicted: number; observed: number; n: number }],
 *       ece: number
 *     }
 *   }
 *
 * If no `diagnosticsPath` is set the calibration data is read directly from
 * the prop (caller can surface cached snapshots).
 */

import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity } from "lucide-react";
import { cn } from "@/shared/utils/utils";
import { paletteColor } from "./palette";

export interface CalibrationBucket {
  predicted: number;
  observed: number;
  n: number;
}

export interface CalibrationData {
  buckets: CalibrationBucket[];
  ece: number | null;
}

export interface CalibrationExperiment {
  id: string;
  label: string;
  /** Pre-loaded calibration data — when present, no fetch is issued. */
  data?: CalibrationData | null;
  /** Trainer-emitted diagnostics path — used for the lazy fetch path. */
  diagnosticsPath?: string | null;
}

export interface CalibrationPanelProps {
  experiments: CalibrationExperiment[];
  className?: string;
  height?: number;
}

interface DiagnosticsPayload {
  calibration?: { buckets?: CalibrationBucket[]; ece?: number | null } | null;
}

const DEFAULT_HEIGHT = 320;

async function fetchDiagnostics(path: string, signal?: AbortSignal): Promise<CalibrationData | null> {
  const params = new URLSearchParams({ path });
  const res = await fetch(`/api/training/diagnostics?${params.toString()}`, { signal });
  if (!res.ok) {
    throw new Error(`diagnostics ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  }
  const body = (await res.json()) as DiagnosticsPayload;
  if (!body.calibration?.buckets || body.calibration.buckets.length === 0) {
    return null;
  }
  return {
    buckets: body.calibration.buckets,
    ece: body.calibration.ece ?? null,
  };
}

export function CalibrationPanel({
  experiments,
  className,
  height = DEFAULT_HEIGHT,
}: CalibrationPanelProps) {
  // Issue one query per experiment that needs remote diagnostics; pre-loaded
  // data short-circuits via `enabled: false`.
  const queries = useQueries({
    queries: experiments.map((exp) => ({
      queryKey: ["calibration-diagnostics", exp.diagnosticsPath ?? "", exp.id] as const,
      queryFn: ({ signal }: { signal?: AbortSignal }) =>
        fetchDiagnostics(exp.diagnosticsPath as string, signal),
      enabled: exp.data == null && exp.diagnosticsPath != null,
      staleTime: 5 * 60 * 1000,
    })),
  });

  const resolved = useMemo(
    () =>
      experiments.map((exp, idx) => {
        const q = queries[idx];
        const data = exp.data ?? q?.data ?? null;
        return {
          id: exp.id,
          label: exp.label,
          color: paletteColor(idx),
          data,
          isLoading: !exp.data && q?.isPending,
          error: q?.error as Error | undefined,
        };
      }),
    [experiments, queries],
  );

  // Merge buckets across all experiments by predicted value (rounded to 2 dp).
  const merged = useMemo(() => {
    const byBin = new Map<number, Record<string, number | null> & { predicted: number }>();
    for (const exp of resolved) {
      if (!exp.data) continue;
      for (const b of exp.data.buckets) {
        const key = Math.round(b.predicted * 100) / 100;
        let row = byBin.get(key);
        if (!row) {
          row = { predicted: key };
          byBin.set(key, row);
        }
        row[exp.id] = b.observed;
      }
    }
    return [...byBin.values()].sort((a, b) => a.predicted - b.predicted);
  }, [resolved]);

  if (experiments.length === 0) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center text-sm text-muted-foreground",
          className,
        )}
        data-testid="calibration-empty"
      >
        Select experiments to view calibration curves.
      </div>
    );
  }

  return (
    <div
      className={cn("rounded-2xl border border-white/5 bg-white/[0.02] p-3 space-y-3", className)}
      data-testid="calibration-panel"
    >
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={merged} margin={{ top: 12, right: 24, bottom: 12, left: 8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
          <XAxis
            dataKey="predicted"
            type="number"
            domain={[0, 1]}
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }}
            label={{
              value: "Predicted probability",
              position: "insideBottom",
              offset: -2,
              fill: "rgba(255,255,255,0.5)",
              fontSize: 11,
            }}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
          />
          <YAxis
            type="number"
            domain={[0, 1]}
            tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }}
            label={{
              value: "Observed frequency",
              angle: -90,
              position: "insideLeft",
              fill: "rgba(255,255,255,0.5)",
              fontSize: 11,
            }}
            width={60}
            ticks={[0, 0.25, 0.5, 0.75, 1]}
          />
          <Tooltip
            contentStyle={{
              background: "rgba(0,0,0,0.85)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8,
              fontSize: 11,
            }}
            formatter={(value) =>
              typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "—"
            }
          />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
          <ReferenceLine
            segment={[
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ]}
            stroke="rgba(255,255,255,0.25)"
            strokeDasharray="4 4"
            label={{
              value: "Perfect calibration",
              fill: "rgba(255,255,255,0.4)",
              fontSize: 10,
              position: "insideTopLeft",
            }}
          />
          {resolved.map((exp) => (
            <Line
              key={exp.id}
              dataKey={exp.id}
              name={exp.label}
              type="monotone"
              stroke={exp.color}
              strokeWidth={2}
              dot={{ r: 3, fill: exp.color, strokeWidth: 0 }}
              isAnimationActive={false}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {resolved.map((exp) => (
          <div
            key={exp.id}
            className="flex items-center justify-between rounded-lg bg-black/30 border border-white/5 px-3 py-2"
            data-testid={`calibration-ece-${exp.id}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: exp.color }}
              />
              <span className="text-xs font-medium text-foreground truncate">
                {exp.label}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs">
              <Activity className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">ECE</span>
              <span
                className={cn(
                  "font-mono",
                  exp.data?.ece == null
                    ? "text-muted-foreground"
                    : exp.data.ece <= 0.05
                      ? "text-[hsl(var(--data-pos))]"
                      : exp.data.ece <= 0.1
                        ? "text-amber-400"
                        : "text-[hsl(var(--data-neg))]",
                )}
              >
                {exp.data?.ece != null ? exp.data.ece.toFixed(3) : exp.isLoading ? "…" : "—"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
