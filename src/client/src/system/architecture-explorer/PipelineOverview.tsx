import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { ArrowRight, Activity, Layers, Cpu, Target, Network, Zap } from "lucide-react";

export function PipelineOverview() {
  const stages = [
    { icon: <Activity className="h-5 w-5" />, label: "Raw OHLCV", detail: "759M+ bars from QuestDB", color: "text-blue-400" },
    { icon: <Zap className="h-5 w-5" />, label: "31 Features", detail: "Returns, RSI, ATR, z-scores...", color: "text-violet-400" },
    { icon: <Layers className="h-5 w-5" />, label: "60-Bar Windows", detail: "Sliding sequence windows", color: "text-amber-400" },
    { icon: <Cpu className="h-5 w-5" />, label: "Model", detail: "Architecture goes here", color: "text-cyan-400" },
    { icon: <Target className="h-5 w-5" />, label: "Prediction", detail: "Buy / Sell / Hold", color: "text-[hsl(var(--data-pos))]" },
  ];

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Network className="h-4 w-4 text-primary" />
          Your Data Pipeline
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          How raw market data becomes a trading signal — the model is the swappable piece
        </p>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-2 py-2">
          {stages.map((s, i) => (
            <React.Fragment key={i}>
              {i > 0 && (
                <div className="flex-1 flex items-center justify-center">
                  <div className="h-px flex-1 bg-linear-to-r from-transparent via-muted-foreground/20 to-transparent" />
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 mx-1 shrink-0" />
                  <div className="h-px flex-1 bg-linear-to-r from-transparent via-muted-foreground/20 to-transparent" />
                </div>
              )}
              <div className={`flex flex-col items-center text-center min-w-[90px] ${i === 3 ? 'relative' : ''}`}>
                <div className={`w-12 h-12 rounded-xl border ${i === 3 ? 'border-primary/40 bg-primary/10 animate-pulse' : 'border-border/50 bg-white/5'} flex items-center justify-center ${s.color}`}>
                  {s.icon}
                </div>
                <div className="text-xs font-medium mt-2">{s.label}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{s.detail}</div>
                {i === 3 && (
                  <Badge className="mt-1 text-[9px] bg-primary/10 text-primary border-primary/30">swappable</Badge>
                )}
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* Feature categories */}
        <div className="mt-4 pt-3 border-t border-border/30">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">31 Universal Features (instrument-agnostic)</div>
          <div className="flex flex-wrap gap-1.5">
            {[
              { cat: "Returns", count: 6, color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
              { cat: "Oscillators", count: 6, color: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
              { cat: "Volatility", count: 4, color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
              { cat: "Momentum", count: 5, color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
              { cat: "Position", count: 5, color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
              { cat: "Volume", count: 3, color: "bg-[hsl(var(--data-pos)/0.1)] text-[hsl(var(--data-pos))] border-[hsl(var(--data-pos)/0.2)]" },
              { cat: "Time", count: 2, color: "bg-pink-500/10 text-pink-400 border-pink-500/20" },
            ].map(f => (
              <Badge key={f.cat} variant="outline" className={`text-[10px] ${f.color}`}>
                {f.cat} ({f.count})
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
