/**
 * The side panel — live training metrics and the out-of-sample leaderboard.
 *
 * It is a drawer, not a column. It used to be a permanent 320px strip that took
 * width away from the chart on every page whether anything was training or not;
 * now it is closed by default, opens over the canvas so nothing reflows, and
 * each of its two sections collapses on its own.
 */

import { useCallback, useEffect, useState } from "react";
import * as ScrollArea from "@radix-ui/react-scroll-area";
import * as Collapsible from "@radix-ui/react-collapsible";
import { Link } from "wouter";
import { ChevronDown, X } from "lucide-react";
import { useLensModels } from "@/lens/api";
import { LineChart, Line, YAxis, ResponsiveContainer } from "recharts";
import { useWebSocketMetrics } from "@/hooks/useWebSocketMetrics";
import { trendTone, trendToneClass, trendToneColor, trendGlyph, trendLabel } from "@/shared/theme/dataColors";

const SECTION_STORAGE_KEY = "side-panel-sections-v1";

type SectionKey = "metrics" | "leaderboard";

function loadOpenSections(): Record<SectionKey, boolean> {
  const fallback: Record<SectionKey, boolean> = { metrics: true, leaderboard: true };
  try {
    const stored = localStorage.getItem(SECTION_STORAGE_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<Record<SectionKey, boolean>>;
    return {
      metrics: parsed.metrics ?? true,
      leaderboard: parsed.leaderboard ?? true,
    };
  } catch {
    return fallback;
  }
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const chartData = data.map((val, i) => ({ index: i, value: val }));
  const min = Math.min(...data);
  const max = Math.max(...data);

  return (
    <div className="h-12 w-full mt-2">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <YAxis domain={[min, max]} hide />
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Section({
  title,
  subtitle,
  open,
  onOpenChange,
  children,
  testId,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange} data-testid={testId}>
      <Collapsible.Trigger className="flex w-full items-center gap-1.5 py-1 text-left">
        <ChevronDown
          aria-hidden
          className={`h-3.5 w-3.5 shrink-0 text-neutral-500 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <h3 className="text-sm font-bold uppercase tracking-wider text-neutral-300">{title}</h3>
      </Collapsible.Trigger>
      {subtitle && open && <p className="mb-3 pl-5 text-[11px] text-neutral-500">{subtitle}</p>}
      <Collapsible.Content className="pl-5">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

export interface SidePanelProps {
  open: boolean;
  onClose: () => void;
}

export function RightSidebar({ open, onClose }: SidePanelProps) {
  const { metrics, history } = useWebSocketMetrics();
  const [openSections, setOpenSections] = useState<Record<SectionKey, boolean>>(loadOpenSections);

  // Real out-of-sample results, ranked by net PnL — the leaderboard used to be
  // three hardcoded models with Math.random() sparklines.
  const lens = useLensModels();
  const ranked = (lens.data?.models ?? [])
    // Each member of a byte-identical pair names the other, so keep the one
    // that sorts first rather than dropping both.
    .filter((m) => m.headline !== null && (m.duplicateOf === null || m.modelId < m.duplicateOf))
    .sort((a, b) => (b.headline?.totalNetUsd ?? 0) - (a.headline?.totalNetUsd ?? 0));

  const setSection = useCallback((key: SectionKey, value: boolean) => {
    setOpenSections((previous) => {
      const next = { ...previous, [key]: value };
      try {
        localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // A full quota must not stop the panel from opening.
      }
      return next;
    });
  }, []);

  // Escape closes it, the way every other drawer on the page behaves.
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside
      // Absolute, so opening it never resizes the chart underneath — a width
      // change forces lightweight-charts to re-measure and redraw every series.
      className="absolute inset-y-0 right-0 z-30 flex w-80 flex-col border-l border-neutral-800 bg-neutral-950/95 shadow-2xl backdrop-blur"
      id="side-panel"
      aria-label="Live metrics and leaderboard"
      data-testid="side-panel"
    >
      <div className="flex items-center justify-between border-b border-neutral-800 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-neutral-300">Side panel</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close side panel"
          className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
          data-testid="side-panel-close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ScrollArea.Root className="flex-1 overflow-hidden">
        <ScrollArea.Viewport className="h-full w-full p-4">
          <Section
            title="Live metrics"
            open={openSections.metrics}
            onOpenChange={(value) => setSection("metrics", value)}
            testId="section-live-metrics"
          >
            <div className="space-y-6 pt-2">
              {/* Reward */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-400">Reward Curve</span>
                  <span className={`font-mono ${trendToneClass(trendTone(metrics.reward))}`}>
                    <span aria-hidden="true">{trendGlyph(trendTone(metrics.reward))} </span>
                    {metrics.reward >= 0 ? "+" : ""}{metrics.reward.toFixed(4)}
                    <span className="sr-only"> {trendLabel(trendTone(metrics.reward))}</span>
                  </span>
                </div>
                <Sparkline
                  data={history.reward.length > 0 ? history.reward : [0, 0]}
                  color={trendToneColor(trendTone(metrics.reward))}
                />
              </div>

              {/* Loss */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-400">Loss Curve</span>
                  <span className="font-mono text-neutral-200">{metrics.loss.toFixed(4)}</span>
                </div>
                <Sparkline data={history.loss.length > 0 ? history.loss : [0, 0]} color="#0072B2" />
              </div>

              {/* KL */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-400">KL Divergence</span>
                  <span className="font-mono text-neutral-200">{metrics.kl.toFixed(4)}</span>
                </div>
                <Sparkline data={history.kl.length > 0 ? history.kl : [0, 0]} color="#CC79A7" />
              </div>

              {/* Entropy */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-400">Entropy</span>
                  <span className="font-mono text-neutral-200">{metrics.entropy.toFixed(4)}</span>
                </div>
                <Sparkline data={history.entropy.length > 0 ? history.entropy : [0, 0]} color="#E69F00" />
              </div>
            </div>
          </Section>

          <div className="mt-8 border-t border-neutral-800 pt-4">
            <Section
              title="Out-of-sample leaderboard"
              subtitle="Net of costs, from each model's lens. Click to inspect."
              open={openSections.leaderboard}
              onOpenChange={(value) => setSection("leaderboard", value)}
              testId="section-leaderboard"
            >
              {lens.isLoading && <p className="text-xs text-neutral-500">Loading models…</p>}
              {lens.error && (
                <p className="text-xs text-neutral-500">Model list unavailable: {lens.error.message}</p>
              )}
              {!lens.isLoading && !lens.error && ranked.length === 0 && (
                <p className="text-xs text-neutral-500">No model has a built lens yet.</p>
              )}

              <div className="space-y-3">
                {ranked.map((model) => {
                  const headline = model.headline!;
                  const tone = trendTone(headline.totalNetUsd);
                  return (
                    <Link
                      key={model.modelId}
                      href={`/lens?model=${encodeURIComponent(model.modelId)}`}
                      className="block rounded-lg border border-neutral-800 bg-neutral-900 p-3 transition-colors hover:border-neutral-600"
                    >
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        <span className="truncate font-mono text-xs text-neutral-200" title={model.modelId}>
                          {model.modelId}
                        </span>
                        <span className={`shrink-0 font-mono text-xs tnum ${trendToneClass(tone)}`}>
                          <span aria-hidden="true">{trendGlyph(tone)} </span>
                          {headline.totalNetUsd >= 0 ? "+" : "−"}${Math.abs(headline.totalNetUsd).toFixed(2)}
                          <span className="sr-only"> {trendLabel(tone)}</span>
                        </span>
                      </div>
                      <div className="text-[11px] tnum text-neutral-500">
                        {model.symbol} {model.timeframe} · {headline.tradeCount.toLocaleString()} trades · agrees
                        with its own label{" "}
                        {headline.hitRate.value === null
                          ? "n/a"
                          : `${(headline.hitRate.value * 100).toFixed(1)}%`}
                      </div>
                      {/* A high agreement rate beside a loss is the point of the lens, not a
                          contradiction to hide: say which way it cuts right here. */}
                      {headline.hitRate.value !== null &&
                        headline.hitRate.value > 0.6 &&
                        headline.totalNetUsd < 0 && (
                          <div className="mt-1 text-[10px] leading-snug text-neutral-500">
                            Agreeing with its label did not pay — open the lens to see what the label is.
                          </div>
                        )}
                    </Link>
                  );
                })}
              </div>
            </Section>
          </div>
        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar
          orientation="vertical"
          className="flex touch-none select-none bg-neutral-900/50 p-0.5 transition-colors duration-[160ms] ease-out hover:bg-neutral-900 data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:w-2.5"
        >
          <ScrollArea.Thumb className="relative flex-1 rounded-[10px] bg-neutral-700 before:absolute before:left-1/2 before:top-1/2 before:h-full before:min-h-[44px] before:w-full before:min-w-[44px] before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </aside>
  );
}
