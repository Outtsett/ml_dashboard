/**
 * LineageCard — Full provenance card for a single model_versions row.
 *
 * W7.e of `docs/plans/2026-05-09-ml-studio-workshop-integration-frontend.md`.
 * Reads `GET /api/model-versions/:id` via TanStack Query (signal-threaded).
 * Renders sections per plan §7 in scroll order:
 *
 *   - Catalog spec (link)
 *   - Data (symbol/timeframe/date range/data hash)
 *   - Feature pipeline + feature categories
 *   - Label config (strategy + params)
 *   - Hyperparameters
 *   - Walk-forward config (folds, fold months, purge bars, embargo)
 *   - HPO study (link if optunaStudyName present)
 *   - Train metadata (date, duration, GPU, n_bars_train/val)
 *   - Eval metrics (Sharpe, profit factor, win rate, max DD, ECE, mean trade PnL)
 *   - Calibration curve summary (ECE per bin or summary scalar)
 *   - Code path (clickable — opens via Electron shell when embedded)
 *   - Parent_version_id chain (recursive — renders as breadcrumb-style links
 *     that re-select that version when clicked)
 *
 * The card is meant to render *inside* the `Sheet` drawer assembled by
 * PromoteStage. It owns its own loading/error state so the drawer chrome
 * stays simple.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Loader2,
  Tag,
  Database,
  Layers,
  Sparkles,
  GitBranch,
  Clock,
  ExternalLink,
  Code2,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/shared/utils/utils";
import { Badge } from "@/shared/ui/badge";
import { useMLStudio } from "../../MLStudioContext";

// ─── Types (mirror server `/api/model-versions/:id` response) ────────────────

export interface LineageEvalMetric {
  name: string;
  value: number | null;
}

export interface LineageDetail {
  id: number;
  versionId: string;
  catalogId: string;
  modelId: string | null;
  status: string;
  symbol: string;
  timeframe: string;
  dataHash: string | null;
  dataStart: string | null;
  dataEnd: string | null;
  featurePipelineId: string | null;
  featureCategories: string[];
  labelStrategy: string | null;
  labelParams: Record<string, number | string | boolean> | null;
  hyperparameters: Record<string, number | string | boolean> | null;
  walkForward: {
    folds: number | null;
    foldMonths: number | null;
    trainMonths: number | null;
    testMonths: number | null;
    purgeBars: number | null;
    embargoBars: number | null;
  } | null;
  optunaStudyName: string | null;
  optunaTrialNumber: number | null;
  trainStartedAt: string | null;
  trainCompletedAt: string | null;
  trainingDurationSec: number | null;
  trainGpu: string | null;
  nBarsTrain: number | null;
  nBarsVal: number | null;
  evalMetrics: LineageEvalMetric[];
  calibrationEce: number | null;
  calibrationBins: { binIndex: number; meanPredicted: number; meanObserved: number; n: number }[];
  codePath: string | null;
  parentVersionId: number | null;
  parentChain: { id: number; versionId: string; status: string }[];
  createdAt: string;
  promotedAt: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const LINEAGE_QUERY_KEY = ["/api/model-versions"] as const;

export function useModelVersionDetail(id: number | null) {
  return useQuery<LineageDetail>({
    queryKey: [...LINEAGE_QUERY_KEY, id, "detail"],
    enabled: id != null,
    queryFn: async ({ signal }) => {
      if (id == null) throw new Error("missing id");
      const res = await fetch(`/api/model-versions/${id}`, {
        signal,
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status}: ${text || res.statusText}`);
      }
      return (await res.json()) as LineageDetail;
    },
    staleTime: 60_000,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(s: string | null): string {
  if (!s) return "—";
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return "—";
  return new Date(ms).toLocaleString();
}

function fmtDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function fmtMetric(value: number | null, digits = 3): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

function fmtParam(v: number | string | boolean | null | undefined): string {
  if (v == null) return "—";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return String(v);
    return v.toPrecision(4);
  }
  return String(v);
}

// ─── Subcomponents ───────────────────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Tag;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5">
      <header className="flex items-center gap-2 mb-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <h4 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {title}
        </h4>
      </header>
      {children}
    </section>
  );
}

function KeyValue({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
        {label}
      </span>
      <span
        className={cn(
          "text-xs text-foreground text-right",
          mono && "font-mono",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function ParamGrid({ params }: { params: Record<string, number | string | boolean> | null }) {
  const entries = useMemo(
    () => (params ? Object.entries(params).sort(([a], [b]) => a.localeCompare(b)) : []),
    [params],
  );
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground/70">No parameters recorded.</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-2">
          <code className="text-[10px] text-muted-foreground/80 truncate">{k}</code>
          <span className="font-mono text-[11px] text-foreground">
            {fmtParam(v)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export interface LineageCardProps {
  versionId: number;
  /** Override fetched detail (testing hook). */
  detail?: LineageDetail;
}

export function LineageCard({ versionId, detail: detailOverride }: LineageCardProps) {
  const { dispatch } = useMLStudio();
  const enabled = detailOverride === undefined;
  const query = useModelVersionDetail(enabled ? versionId : null);
  const detail = detailOverride ?? query.data;

  if (enabled && query.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        Loading lineage…
      </div>
    );
  }

  if (enabled && query.isError) {
    return (
      <div className="rounded-lg border border-[hsl(var(--data-neg)/0.3)] bg-[hsl(var(--data-neg)/0.05)] p-4 text-xs text-[hsl(var(--data-neg))] flex items-start gap-2">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <div>
          <p className="font-medium">Failed to load model version</p>
          <p className="mt-1 font-mono text-[10px] text-[hsl(var(--data-neg)/0.8)]">
            {(query.error as Error)?.message}
          </p>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="text-xs text-muted-foreground py-12 text-center">
        Pick a version to see its lineage.
      </div>
    );
  }

  const handleParentClick = (parentId: number) => {
    dispatch({ type: "setSelectedVersion", versionId: parentId, mode: "lineage" });
  };

  return (
    <div className="space-y-3">
      {/* Catalog */}
      <Section icon={Tag} title="Catalog">
        <KeyValue label="Catalog ID" value={<span className="font-mono">{detail.catalogId}</span>} />
        <KeyValue
          label="Model ID"
          value={
            <span className="font-mono">{detail.modelId ?? "—"}</span>
          }
        />
        <KeyValue
          label="Version ID"
          value={<span className="font-mono">{detail.versionId}</span>}
        />
        <KeyValue
          label="Status"
          value={
            <Badge
              variant="outline"
              className="h-4 px-1.5 text-[9px] font-medium uppercase"
            >
              {detail.status}
            </Badge>
          }
        />
      </Section>

      {/* Data */}
      <Section icon={Database} title="Data">
        <KeyValue label="Symbol" value={detail.symbol} mono />
        <KeyValue label="Timeframe" value={detail.timeframe} mono />
        <KeyValue
          label="Range"
          value={
            <span className="font-mono text-[10px]">
              {detail.dataStart ? detail.dataStart.slice(0, 10) : "—"} →{" "}
              {detail.dataEnd ? detail.dataEnd.slice(0, 10) : "—"}
            </span>
          }
        />
        <KeyValue
          label="Data hash"
          value={
            <span className="font-mono text-[10px]" title={detail.dataHash ?? ""}>
              {detail.dataHash ? `${detail.dataHash.slice(0, 12)}…` : "—"}
            </span>
          }
        />
      </Section>

      {/* Feature pipeline */}
      <Section icon={Layers} title="Feature pipeline">
        <KeyValue
          label="Pipeline"
          value={<span className="font-mono">{detail.featurePipelineId ?? "—"}</span>}
        />
        <div className="mt-1 flex flex-wrap gap-1">
          {detail.featureCategories.length > 0 ? (
            detail.featureCategories.map((c) => (
              <Badge
                key={c}
                variant="outline"
                className="h-4 px-1.5 text-[9px] border-cyan-500/30 text-cyan-300 bg-cyan-500/10"
              >
                {c}
              </Badge>
            ))
          ) : (
            <span className="text-[10px] text-muted-foreground/70">
              No categories tagged
            </span>
          )}
        </div>
      </Section>

      {/* Labels */}
      <Section icon={Tag} title="Labels">
        <KeyValue
          label="Strategy"
          value={<span className="font-mono">{detail.labelStrategy ?? "—"}</span>}
        />
        <ParamGrid params={detail.labelParams} />
      </Section>

      {/* Hyperparameters */}
      <Section icon={Sparkles} title="Hyperparameters">
        <ParamGrid params={detail.hyperparameters} />
      </Section>

      {/* Walk-forward */}
      <Section icon={GitBranch} title="Walk-forward">
        {detail.walkForward ? (
          <>
            <KeyValue label="Folds" value={detail.walkForward.folds ?? "—"} mono />
            <KeyValue
              label="Fold months"
              value={detail.walkForward.foldMonths ?? "—"}
              mono
            />
            <KeyValue
              label="Train / test mo"
              value={
                <span className="font-mono">
                  {detail.walkForward.trainMonths ?? "—"} /{" "}
                  {detail.walkForward.testMonths ?? "—"}
                </span>
              }
            />
            <KeyValue label="Purge bars" value={detail.walkForward.purgeBars ?? "—"} mono />
            <KeyValue
              label="Embargo bars"
              value={detail.walkForward.embargoBars ?? "—"}
              mono
            />
          </>
        ) : (
          <p className="text-xs text-muted-foreground/70">
            No walk-forward config recorded.
          </p>
        )}
      </Section>

      {/* HPO study */}
      <Section icon={Sparkles} title="HPO study">
        {detail.optunaStudyName ? (
          <>
            <KeyValue
              label="Optuna study"
              value={<span className="font-mono">{detail.optunaStudyName}</span>}
            />
            <KeyValue
              label="Trial #"
              value={detail.optunaTrialNumber ?? "—"}
              mono
            />
          </>
        ) : (
          <p className="text-xs text-muted-foreground/70">
            Not produced by an Optuna study.
          </p>
        )}
      </Section>

      {/* Train */}
      <Section icon={Clock} title="Training">
        <KeyValue label="Started" value={fmtDate(detail.trainStartedAt)} />
        <KeyValue label="Completed" value={fmtDate(detail.trainCompletedAt)} />
        <KeyValue label="Duration" value={fmtDuration(detail.trainingDurationSec)} />
        <KeyValue label="GPU" value={detail.trainGpu ?? "—"} mono />
        <KeyValue
          label="Bars train / val"
          value={
            <span className="font-mono">
              {detail.nBarsTrain?.toLocaleString() ?? "—"} /{" "}
              {detail.nBarsVal?.toLocaleString() ?? "—"}
            </span>
          }
        />
      </Section>

      {/* Eval metrics */}
      <Section icon={TrendingUp} title="Eval metrics">
        {detail.evalMetrics.length === 0 ? (
          <p className="text-xs text-muted-foreground/70">No eval metrics recorded.</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {detail.evalMetrics.map((m) => (
              <div
                key={m.name}
                className="flex items-baseline justify-between gap-2"
              >
                <span className="text-[10px] text-muted-foreground/80 truncate">
                  {m.name}
                </span>
                <span className="font-mono text-[11px] text-foreground">
                  {fmtMetric(m.value, 3)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Calibration */}
      <Section icon={TrendingUp} title="Calibration">
        <KeyValue
          label="ECE"
          value={fmtMetric(detail.calibrationEce, 4)}
          mono
        />
        <KeyValue
          label="Bins"
          value={detail.calibrationBins.length || "—"}
          mono
        />
      </Section>

      {/* Code path */}
      <Section icon={Code2} title="Code path">
        {detail.codePath ? (
          <a
            href={`file://${detail.codePath}`}
            className="font-mono text-[11px] text-primary underline-offset-2 hover:underline inline-flex items-center gap-1 break-all"
          >
            <ExternalLink className="h-3 w-3 shrink-0" />
            {detail.codePath}
          </a>
        ) : (
          <p className="text-xs text-muted-foreground/70">
            Source path not recorded.
          </p>
        )}
      </Section>

      {/* Parent chain */}
      <Section icon={GitBranch} title="Parent chain">
        {detail.parentChain.length === 0 ? (
          <p className="text-xs text-muted-foreground/70">
            Root version (no parent).
          </p>
        ) : (
          <ol className="space-y-1">
            {detail.parentChain.map((p, idx) => (
              <li key={p.id} className="flex items-center gap-2 text-[11px]">
                <span className="text-muted-foreground/60 w-4 text-right">
                  {detail.parentChain.length - idx}
                </span>
                <button
                  type="button"
                  onClick={() => handleParentClick(p.id)}
                  className="font-mono text-primary hover:underline underline-offset-2"
                  data-testid={`lineage-parent-${p.id}`}
                >
                  {p.versionId}
                </button>
                <Badge
                  variant="outline"
                  className="h-4 px-1 text-[9px] uppercase"
                >
                  {p.status}
                </Badge>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* Footer timestamps */}
      <div className="text-[10px] text-muted-foreground/60 text-right pt-1">
        Created {fmtDate(detail.createdAt)} · Promoted{" "}
        {fmtDate(detail.promotedAt)}
      </div>
    </div>
  );
}
