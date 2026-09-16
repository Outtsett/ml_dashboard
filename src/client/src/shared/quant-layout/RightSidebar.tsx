import * as ScrollArea from "@radix-ui/react-scroll-area";
import { Link } from "wouter";
import { useLensModels } from "@/lens/api";
import { LineChart, Line, YAxis, ResponsiveContainer } from "recharts";
import { useWebSocketMetrics } from "@/hooks/useWebSocketMetrics";
import { trendTone, trendToneClass, trendToneColor, trendGlyph, trendLabel } from "@/shared/theme/dataColors";

function Sparkline({ data, color }: { data: number[], color: string }) {
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

export function RightSidebar() {
  const { metrics, history } = useWebSocketMetrics();
  // Real out-of-sample results, ranked by net PnL — the leaderboard used to be
  // three hardcoded models with Math.random() sparklines.
  const lens = useLensModels();
  const ranked = (lens.data?.models ?? [])
    // Each member of a byte-identical pair names the other, so keep the one
    // that sorts first rather than dropping both.
    .filter((m) => m.headline !== null && (m.duplicateOf === null || m.modelId < m.duplicateOf))
    .sort((a, b) => (b.headline?.totalNetUsd ?? 0) - (a.headline?.totalNetUsd ?? 0));

  return (
    <div className="w-80 h-full bg-neutral-950 border-l border-neutral-800 flex flex-col">
      <div className="p-4 border-b border-neutral-800">
        <h3 className="text-sm font-bold text-neutral-300 uppercase tracking-wider">Live Metrics</h3>
      </div>
      
      <ScrollArea.Root className="flex-1 overflow-hidden">
        <ScrollArea.Viewport className="w-full h-full p-4">
          
          <div className="space-y-6">
            {/* Reward */}
            <div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-neutral-400">Reward Curve</span>
                <span className={`font-mono ${trendToneClass(trendTone(metrics.reward))}`}>
                  <span aria-hidden="true">{trendGlyph(trendTone(metrics.reward))} </span>
                  {metrics.reward >= 0 ? "+" : ""}{metrics.reward.toFixed(4)}
                  <span className="sr-only"> {trendLabel(trendTone(metrics.reward))}</span>
                </span>
              </div>
              <Sparkline data={history.reward.length > 0 ? history.reward : [0,0]} color={trendToneColor(trendTone(metrics.reward))} />
            </div>

            {/* Loss */}
            <div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-neutral-400">Loss Curve</span>
                <span className="text-neutral-200 font-mono">{metrics.loss.toFixed(4)}</span>
              </div>
              <Sparkline data={history.loss.length > 0 ? history.loss : [0,0]} color="#3b82f6" />
            </div>

            {/* KL */}
            <div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-neutral-400">KL Divergence</span>
                <span className="text-neutral-200 font-mono">{metrics.kl.toFixed(4)}</span>
              </div>
              <Sparkline data={history.kl.length > 0 ? history.kl : [0,0]} color="#8b5cf6" />
            </div>
            
            {/* Entropy */}
            <div>
              <div className="flex justify-between items-center text-sm">
                <span className="text-neutral-400">Entropy</span>
                <span className="text-neutral-200 font-mono">{metrics.entropy.toFixed(4)}</span>
              </div>
              <Sparkline data={history.entropy.length > 0 ? history.entropy : [0,0]} color="#f59e0b" />
            </div>
          </div>

          <div className="mt-8 border-t border-neutral-800 pt-6">
            <h3 className="text-sm font-bold text-neutral-300 uppercase tracking-wider mb-1">Out-of-sample leaderboard</h3>
            <p className="mb-4 text-[11px] text-neutral-500">Net of costs, from each model&apos;s lens. Click to inspect.</p>

            {lens.isLoading && <p className="text-xs text-neutral-500">Loading models…</p>}
            {lens.error && <p className="text-xs text-neutral-500">Model list unavailable: {lens.error.message}</p>}
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
                    className="block bg-neutral-900 border border-neutral-800 rounded-lg p-3 hover:border-neutral-600 transition-colors"
                  >
                    <div className="flex justify-between items-baseline gap-2 mb-1">
                      <span className="truncate font-mono text-xs text-neutral-200" title={model.modelId}>{model.modelId}</span>
                      <span className={`shrink-0 font-mono text-xs tnum ${trendToneClass(tone)}`}>
                        <span aria-hidden="true">{trendGlyph(tone)} </span>
                        {headline.totalNetUsd >= 0 ? "+" : "−"}${Math.abs(headline.totalNetUsd).toFixed(2)}
                        <span className="sr-only"> {trendLabel(tone)}</span>
                      </span>
                    </div>
                    <div className="text-[11px] text-neutral-500 tnum">
                      {model.symbol} {model.timeframe} · {headline.tradeCount.toLocaleString()} trades · agrees with its
                      own label{" "}
                      {headline.hitRate.value === null ? "n/a" : `${(headline.hitRate.value * 100).toFixed(1)}%`}
                    </div>
                    {/* A high agreement rate beside a loss is the point of the lens, not a
                        contradiction to hide: say which way it cuts right here. */}
                    {headline.hitRate.value !== null && headline.hitRate.value > 0.6 && headline.totalNetUsd < 0 && (
                      <div className="mt-1 text-[10px] leading-snug text-neutral-500">
                        Agreeing with its label did not pay — open the lens to see what the label is.
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>

        </ScrollArea.Viewport>
        <ScrollArea.Scrollbar orientation="vertical" className="flex select-none touch-none p-0.5 bg-neutral-900/50 transition-colors duration-[160ms] ease-out hover:bg-neutral-900 data-[orientation=vertical]:w-2.5 data-[orientation=horizontal]:flex-col data-[orientation=horizontal]:h-2.5">
          <ScrollArea.Thumb className="flex-1 bg-neutral-700 rounded-[10px] relative before:content-[''] before:absolute before:top-1/2 before:left-1/2 before:-translate-x-1/2 before:-translate-y-1/2 before:w-full before:h-full before:min-w-[44px] before:min-h-[44px]" />
        </ScrollArea.Scrollbar>
      </ScrollArea.Root>
    </div>
  );
}
