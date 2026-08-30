import * as ScrollArea from "@radix-ui/react-scroll-area";
import { LineChart, Line, YAxis, ResponsiveContainer } from "recharts";
import { useWebSocketMetrics } from "@/hooks/useWebSocketMetrics";
import { trendTone, trendToneClass, trendToneColor, trendGlyph, trendLabel, paletteColorDark } from "@/shared/theme/dataColors";

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

  // Mock experiments for leaderboard
  const experiments = [
    { id: 12, model: "Transformer-L", reward: 0.82, valScore: 0.74 },
    { id: 11, model: "Transformer-M", reward: 0.75, valScore: 0.68 },
    { id: 10, model: "LSTM-Deep", reward: 0.45, valScore: 0.51 },
  ];

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
            <h3 className="text-sm font-bold text-neutral-300 uppercase tracking-wider mb-4">Experiment Leaderboard</h3>
            
            <div className="space-y-3">
              {experiments.map((exp) => (
                <div key={exp.id} className="bg-neutral-900 border border-neutral-800 rounded-lg p-3 hover:border-neutral-700 transition-colors cursor-pointer group">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-neutral-300 font-medium">Model #{exp.id}</span>
                    <span className="text-(--color-data-pos) text-sm">Reward +{exp.reward}</span>
                  </div>
                  <div className="text-xs text-neutral-500 mb-2">
                    {exp.model} | Val Score {exp.valScore}
                  </div>
                  {/* Fake sparkline for leaderboard */}
                  <div className="h-6 w-full opacity-50 group-hover:opacity-100 transition-opacity">
                     <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={[{v: Math.random()},{v: Math.random()},{v: Math.random()},{v: Math.random()}]}>
                          <Line type="monotone" dataKey="v" stroke={paletteColorDark(1)} strokeWidth={1.5} dot={false} />
                        </LineChart>
                     </ResponsiveContainer>
                  </div>
                </div>
              ))}
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
