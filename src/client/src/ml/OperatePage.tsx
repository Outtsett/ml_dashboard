import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Database, ChevronRight, Play, Shield, BrainCircuit, Table } from "lucide-react";
import { format } from "date-fns";
import { paletteColorDark } from "@/shared/theme/dataColors";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface Experiment {
  id: number;
  experimentId: string;
  model: string;
  reward: number;
  valScore: number;
  status: string;
  description: string;
  createdAt: string;
}

interface Metric {
  id: number;
  experimentId: string;
  reward: number;
  loss: number;
  kl: number;
  entropy: number;
  timestamp: string;
}

export default function OperatePage() {
  const [selectedExpId, setSelectedExpId] = useState<string | null>(null);
  const [isTrading, setIsTrading] = useState(false);

  const { data: experiments, isLoading: isLoadingExps } = useQuery<Experiment[]>({
    queryKey: ["experiments"],
    queryFn: async () => {
      const res = await fetch("/api/ml/experiments");
      if (!res.ok) throw new Error("Failed to fetch experiments");
      return res.json();
    },
    refetchInterval: 5000,
  });

  const { data: metrics, isLoading: isLoadingMetrics } = useQuery<Metric[]>({
    queryKey: ["metrics", selectedExpId],
    queryFn: async () => {
      if (!selectedExpId) return [];
      const res = await fetch(`/api/ml/experiments/${selectedExpId}/metrics`);
      if (!res.ok) throw new Error("Failed to fetch metrics");
      const raw = await res.json();
      return raw.reverse();
    },
    enabled: !!selectedExpId,
  });

  // Automatically select the latest completed experiment if none is selected
  if (!selectedExpId && experiments && experiments.length > 0) {
    const latest = experiments.find(e => e.status.toLowerCase() === "completed") || experiments[0];
    if (latest) setSelectedExpId(latest.experimentId);
  }

  const selectedExp = experiments?.find(e => e.experimentId === selectedExpId);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0a] text-neutral-300 p-4 font-sans">
      <header className="flex items-center justify-between shrink-0 mb-4 pb-4 border-b border-neutral-800">
        <div>
          <h1 className="text-xl font-bold text-neutral-100 tracking-tight flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-(--color-accent)" />
            Operate & Leaderboard
          </h1>
          <p className="text-xs text-neutral-500 mt-1 uppercase tracking-widest font-mono">
            Model Registry / Production Inference
          </p>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0">
        
        {/* Left Column: Rich Table Leaderboard */}
        <div className="lg:col-span-6 flex flex-col min-h-0 bg-[#111] border border-neutral-800 rounded-xl overflow-hidden">
          <div className="bg-[#0a0a0a] px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
              <Table className="w-4 h-4 text-(--color-accent)" />
              Experiment Leaderboard
            </h2>
            <div className="text-[10px] uppercase font-mono text-neutral-500">
              {experiments?.length || 0} Models
            </div>
          </div>
          
          <div className="flex-1 overflow-auto p-0">
            {isLoadingExps ? (
              <div className="p-8 text-sm text-neutral-500 flex items-center justify-center gap-2">
                <Activity className="w-4 h-4 animate-spin" /> Fetching Postgres records...
              </div>
            ) : experiments?.length === 0 ? (
              <div className="p-8 text-sm text-neutral-500 text-center">Registry is empty.</div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="bg-[#0a0a0a] sticky top-0 z-10 border-b border-neutral-800">
                  <tr>
                    <th className="px-4 py-3 text-[10px] font-mono text-neutral-500 uppercase tracking-widest font-medium">Model</th>
                    <th className="px-4 py-3 text-[10px] font-mono text-neutral-500 uppercase tracking-widest font-medium">Status</th>
                    <th className="px-4 py-3 text-[10px] font-mono text-neutral-500 uppercase tracking-widest font-medium">Reward</th>
                    <th className="px-4 py-3 text-[10px] font-mono text-neutral-500 uppercase tracking-widest font-medium">Val Score</th>
                    <th className="px-4 py-3 text-[10px] font-mono text-neutral-500 uppercase tracking-widest font-medium">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/50">
                  {experiments?.map((exp) => (
                    <tr 
                      key={exp.id}
                      onClick={() => setSelectedExpId(exp.experimentId)}
                      className={`cursor-pointer transition-colors ${
                        selectedExpId === exp.experimentId 
                          ? "bg-neutral-800/40" 
                          : "hover:bg-neutral-900/40"
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-neutral-200 text-xs">{exp.model}</div>
                        <div className="text-[10px] text-neutral-500 font-mono mt-0.5">{exp.experimentId.substring(0,8)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[9px] px-2 py-0.5 rounded-full uppercase tracking-wider font-mono inline-block ${
                          exp.status.toLowerCase() === 'running' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' :
                          exp.status.toLowerCase() === 'completed' ? 'bg-[hsl(var(--data-pos)/0.1)] text-(--color-data-pos) border border-[hsl(var(--data-pos)/0.25)]' :
                          'bg-neutral-800 text-neutral-400 border border-neutral-700'
                        }`}>
                          {exp.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-(--color-data-pos)">{exp.reward.toFixed(4)}</td>
                      <td className="px-4 py-3 text-xs font-mono text-blue-400/90">{exp.valScore.toFixed(4)}</td>
                      <td className="px-4 py-3 text-[10px] text-neutral-500 font-mono">
                        {format(new Date(exp.createdAt), "MM/dd HH:mm")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right Column: Run Details & Live Trading */}
        <div className="lg:col-span-6 flex flex-col min-h-0 gap-4">
          
          {/* Operations Panel */}
          <div className="bg-[#111] border border-neutral-800 rounded-xl overflow-hidden shrink-0">
            <div className="bg-[#0a0a0a] px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-500" />
                Live Trading Operations
              </h2>
            </div>
            <div className="p-5 flex items-center justify-between gap-6">
              <div className="flex-1 space-y-1">
                <div className="text-[10px] uppercase font-mono tracking-widest text-neutral-500">Selected Model</div>
                <div className="text-base text-neutral-200 font-medium">
                  {selectedExp ? selectedExp.model : "None Selected"}
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-[10px] uppercase font-mono tracking-widest text-neutral-500">Inference Status:</span>
                  {isTrading ? (
                    <span className="flex items-center gap-1.5 text-xs text-(--color-data-pos) font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-(--color-data-pos) animate-pulse shadow-[0_0_8px_hsl(var(--data-pos))]"></span>
                      ONLINE
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs text-neutral-500 font-mono">
                      <span className="w-1.5 h-1.5 rounded-full bg-neutral-600"></span>
                      OFFLINE
                    </span>
                  )}
                </div>
              </div>
              
              <button
                onClick={() => setIsTrading(!isTrading)}
                disabled={!selectedExp}
                className={`px-6 py-3 rounded-lg flex items-center gap-2 text-sm font-semibold transition-all ${
                  isTrading 
                    ? "bg-[hsl(var(--data-neg)/0.12)] text-(--color-data-neg) border border-[hsl(var(--data-neg)/0.35)] hover:bg-[hsl(var(--data-neg)/0.22)]" 
                    : "bg-[hsl(var(--data-pos)/0.12)] text-(--color-data-pos) border border-[hsl(var(--data-pos)/0.35)] hover:bg-[hsl(var(--data-pos)/0.22)]"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isTrading ? (
                  <>Stop Trading</>
                ) : (
                  <><Play className="w-4 h-4" /> Start Live Trading</>
                )}
              </button>
            </div>
          </div>

          {/* Metrics Panel */}
          <div className="flex-1 bg-[#111] border border-neutral-800 rounded-xl overflow-hidden flex flex-col min-h-0">
            {!selectedExpId ? (
              <div className="flex-1 flex items-center justify-center text-sm text-neutral-500 flex-col gap-3">
                <Database className="w-8 h-8 text-neutral-700" />
                Select a model to view telemetry
              </div>
            ) : (
              <>
                <div className="bg-[#0a0a0a] px-4 py-3 border-b border-neutral-800">
                  <div className="flex items-center gap-2 text-[10px] text-neutral-500 font-mono mb-1">
                    <span>Registry</span>
                    <ChevronRight className="w-3 h-3" />
                    <span className="text-(--color-accent) truncate">{selectedExpId}</span>
                  </div>
                  <h2 className="text-sm font-semibold text-neutral-200">
                    Training Telemetry (Reward vs Loss)
                  </h2>
                </div>
                
                <div className="flex-1 p-4 flex flex-col">
                  {isLoadingMetrics ? (
                    <div className="flex-1 flex items-center justify-center text-neutral-500">
                      <Activity className="w-5 h-5 animate-spin mr-2" /> Loading metrics...
                    </div>
                  ) : metrics && metrics.length > 0 ? (
                    <div className="flex-1 w-full min-h-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={metrics} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="colorReward" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={paletteColorDark(1)} stopOpacity={0.3}/>
                              <stop offset="95%" stopColor={paletteColorDark(1)} stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="colorLoss" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={paletteColorDark(0)} stopOpacity={0.3}/>
                              <stop offset="95%" stopColor={paletteColorDark(0)} stopOpacity={0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="#222" vertical={false} />
                          <XAxis 
                            dataKey="timestamp" 
                            stroke="#555" 
                            tick={{ fill: '#777', fontSize: 10 }}
                            tickFormatter={(val) => format(new Date(val), "HH:mm")}
                            minTickGap={30}
                          />
                          <YAxis 
                            yAxisId="left" 
                            stroke="#555" 
                            tick={{ fill: '#777', fontSize: 10 }}
                            domain={['auto', 'auto']}
                          />
                          <YAxis 
                            yAxisId="right" 
                            orientation="right" 
                            stroke="#555" 
                            tick={{ fill: '#777', fontSize: 10 }}
                            domain={['auto', 'auto']}
                          />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '4px' }}
                            itemStyle={{ fontSize: 12, fontFamily: 'monospace' }}
                            labelStyle={{ color: '#888', fontSize: 11, marginBottom: '4px' }}
                            labelFormatter={(val) => format(new Date(val), "MMM dd, HH:mm:ss")}
                          />
                          <Area 
                            yAxisId="left" 
                            type="monotone" 
                            dataKey="reward" 
                            stroke={paletteColorDark(1)} 
                            strokeWidth={2}
                            fillOpacity={1} 
                            fill="url(#colorReward)" 
                            isAnimationActive={false}
                          />
                          <Area 
                            yAxisId="right" 
                            type="monotone" 
                            dataKey="loss" 
                            stroke={paletteColorDark(0)} 
                            strokeWidth={2}
                            fillOpacity={1} 
                            fill="url(#colorLoss)" 
                            isAnimationActive={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-neutral-500 text-sm">
                      No metrics available for this run.
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
