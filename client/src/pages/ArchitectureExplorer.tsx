import React, { useState, memo, lazy, Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  ArrowRight, Layers, ScanLine, Repeat, LayoutGrid,
  GitBranch, Sparkles, Zap, Timer, Eye, Target,
  TrendingUp, ChevronRight, Activity, Network, Cpu,
  Box, Combine, Waves
} from "lucide-react";
import { PageLoader } from "@/components/LoadingSkeletons";

const FourierTransform = lazy(() => import("@/pages/FourierTransform"));
import { useBreadcrumbs } from "@/hooks/useBreadcrumbs";

// ═══════════════════════════════════════════════════════════════════════════
// REUSABLE VISUAL COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

/** A colored block showing data shape at a model layer */
const ShapeBlock = memo(({ shape, label, sublabel, bg }: {
  shape: string; label: string; sublabel?: string; bg: string;
}) => (
  <div className={`rounded-xl border px-3 py-2 text-center min-w-[72px] ${bg}`}>
    <div className="font-mono text-[11px] font-bold whitespace-nowrap">{shape}</div>
    <div className="text-[10px] font-medium mt-0.5 opacity-80">{label}</div>
    {sublabel && <div className="text-[9px] opacity-50 mt-px">{sublabel}</div>}
  </div>
));

/** Arrow between shape blocks */
const FlowArrow = memo(() => (
  <div className="flex items-center shrink-0 px-0.5">
    <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
  </div>
));

/** Horizontal chain of shape blocks with arrows */
function ShapeFlow({ steps }: { steps: { shape: string; label: string; sublabel?: string; bg: string }[] }) {
  return (
    <ScrollArea className="w-full">
      <div className="flex items-center py-3 px-1 min-w-max">
        {steps.map((s, i) => (
          <React.Fragment key={i}>
            {i > 0 && <FlowArrow />}
            <ShapeBlock {...s} />
          </React.Fragment>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

/** Highlighted insight callout */
function Insight({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">{title}</span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

/** Strength/weakness badge list */
function Traits({ strengths, weaknesses, bestFor }: {
  strengths: string[]; weaknesses: string[]; bestFor: string;
}) {
  return (
    <div className="space-y-2 mt-4">
      <div className="flex flex-wrap gap-1.5">
        {strengths.map(s => (
          <Badge key={s} variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400 bg-emerald-500/5">
            ✓ {s}
          </Badge>
        ))}
        {weaknesses.map(w => (
          <Badge key={w} variant="outline" className="text-[10px] border-rose-500/30 text-rose-400 bg-rose-500/5">
            ✗ {w}
          </Badge>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Target className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-xs text-amber-400 font-medium">Best for: {bestFor}</span>
      </div>
    </div>
  );
}

/** Mini data grid — simplified visual of an input matrix */
function MiniGrid({ rows, cols, highlightRows, label, highlightColor = "bg-violet-400/70", cellColor = "bg-white/10" }: {
  rows: number; cols: number; label?: string;
  highlightRows?: [number, number];
  highlightColor?: string; cellColor?: string;
}) {
  return (
    <div className="inline-block">
      {label && <div className="text-[9px] text-muted-foreground mb-1 font-mono">{label}</div>}
      <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: rows * cols }).map((_, i) => {
          const row = Math.floor(i / cols);
          const hl = highlightRows && row >= highlightRows[0] && row <= highlightRows[1];
          return (
            <div
              key={i}
              className={`w-2 h-2 rounded-sm ${hl ? highlightColor : cellColor}`}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─── Color constants for layer types ────────────────────────────────────────
const COLORS = {
  input: "bg-blue-500/15 border-blue-500/30 text-blue-300",
  conv: "bg-violet-500/15 border-violet-500/30 text-violet-300",
  pool: "bg-orange-500/15 border-orange-500/30 text-orange-300",
  recurrent: "bg-amber-500/15 border-amber-500/30 text-amber-300",
  attention: "bg-cyan-500/15 border-cyan-500/30 text-cyan-300",
  ffn: "bg-indigo-500/15 border-indigo-500/30 text-indigo-300",
  dense: "bg-emerald-500/15 border-emerald-500/30 text-emerald-300",
  norm: "bg-slate-500/15 border-slate-500/30 text-slate-300",
  tree: "bg-rose-500/15 border-rose-500/30 text-rose-300",
};

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE OVERVIEW
// ═══════════════════════════════════════════════════════════════════════════

function PipelineOverview() {
  const stages = [
    { icon: <Activity className="h-5 w-5" />, label: "Raw OHLCV", detail: "782M+ bars from DuckDB", color: "text-blue-400" },
    { icon: <Zap className="h-5 w-5" />, label: "31 Features", detail: "Returns, RSI, ATR, z-scores...", color: "text-violet-400" },
    { icon: <Layers className="h-5 w-5" />, label: "60-Bar Windows", detail: "Sliding sequence windows", color: "text-amber-400" },
    { icon: <Cpu className="h-5 w-5" />, label: "Model", detail: "Architecture goes here", color: "text-cyan-400" },
    { icon: <Target className="h-5 w-5" />, label: "Prediction", detail: "Buy / Sell / Hold", color: "text-emerald-400" },
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
              { cat: "Volume", count: 3, color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
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

// ═══════════════════════════════════════════════════════════════════════════
// ARCHITECTURE DETAILS
// ═══════════════════════════════════════════════════════════════════════════

// ─── CNN ─────────────────────────────────────────────────────────────────────

function CNNDetail() {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
          <ScanLine className="h-6 w-6 text-violet-400" />
        </div>
        <div>
          <h3 className="font-semibold text-lg">Convolutional Neural Network (1D)</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Stamps overlapping filter windows across your entire time series <strong>all at once</strong> — fully parallel, not sequential
          </p>
        </div>
      </div>

      {/* Trading analogy */}
      <Card className="bg-violet-500/5 border-violet-500/20">
        <CardContent className="p-4">
          <div className="text-xs font-semibold text-violet-400 uppercase tracking-wider mb-1">Think of it as...</div>
          <p className="text-sm text-muted-foreground">
            A <span className="text-violet-300 font-medium">photocopier with 58 identical magnifying glasses laid down at once</span>.
            Glass 1 covers bars 1–3, glass 2 covers bars 2–4, glass 3 covers bars 3–5… all 58 windows
            are read <strong>simultaneously in parallel</strong>. The "overlapping" describes the
            <em> pattern of coverage</em>, not the order of processing — there is no order.
            Each filter learns to spot a different local pattern (reversal, breakout, divergence),
            and deeper layers combine simple patterns into complex ones.
          </p>
        </CardContent>
      </Card>

      {/* Visual: How Conv1D works — parallel stamping */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            How Conv1D processes your data — ALL positions at once
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Parallel windows visual */}
          <div className="mb-4">
            <div className="text-[9px] text-violet-400 font-medium mb-2">58 overlapping windows stamped simultaneously (filter size = 3)</div>
            <div className="relative">
              {/* Bar timeline */}
              <div className="flex gap-[2px] mb-1">
                {Array.from({ length: 20 }).map((_, i) => (
                  <div key={i} className="w-4 text-center text-[7px] font-mono text-muted-foreground/50">
                    {i < 19 ? i + 1 : '...'}
                  </div>
                ))}
                <div className="w-4 text-center text-[7px] font-mono text-muted-foreground/50">60</div>
              </div>
              {/* Bars */}
              <div className="flex gap-[2px] mb-2">
                {Array.from({ length: 20 }).map((_, i) => (
                  <div key={i} className="w-4 h-6 rounded-sm bg-white/10" />
                ))}
                <div className="w-4 h-6 rounded-sm bg-white/10" />
              </div>
              {/* Overlapping filter windows — show 6 stacked */}
              {[0, 1, 2, 3, 4, 5].map((wi) => (
                <div key={wi} className="flex gap-[2px] mb-[2px]" style={{ paddingLeft: `${wi * 18}px` }}>
                  <div className="flex gap-[2px] border border-violet-400/40 rounded-sm px-px py-px bg-violet-500/10">
                    {[0, 1, 2].map(j => (
                      <div key={j} className="w-4 h-3 rounded-[1px] bg-violet-400/40" />
                    ))}
                  </div>
                  {wi === 0 && <span className="text-[7px] text-violet-300 ml-1 self-center">window 1</span>}
                  {wi === 1 && <span className="text-[7px] text-violet-300 ml-1 self-center">window 2</span>}
                  {wi === 2 && <span className="text-[7px] text-violet-300 ml-1 self-center">window 3</span>}
                  {wi === 5 && <span className="text-[7px] text-violet-300 ml-1 self-center">...window 58</span>}
                </div>
              ))}
              <div className="mt-2 flex items-center gap-2">
                <Badge variant="outline" className="text-[9px] border-violet-500/30 text-violet-300 bg-violet-500/5 animate-none">
                  ⚡ ALL windows computed in parallel — no sequential processing
                </Badge>
              </div>
            </div>
          </div>

          <div className="border-t border-border/20 pt-3">
            <div className="flex items-start gap-6 flex-wrap">
              {/* Input matrix */}
              <div className="flex flex-col items-center">
                <MiniGrid rows={12} cols={6} highlightRows={[2, 4]} label="Input (60×31)" />
                <div className="text-[9px] text-muted-foreground mt-1.5 text-center max-w-[80px]">
                  60 bars × 31 features
                </div>
              </div>

              <div className="flex flex-col items-center justify-center self-center">
                <ArrowRight className="h-4 w-4 text-violet-400/50" />
                <div className="text-[8px] text-violet-400 mt-0.5">all at once</div>
              </div>

              {/* Filter window */}
              <div className="flex flex-col items-center">
                <div className="border-2 border-violet-400/60 rounded-lg p-1.5 bg-violet-500/10">
                  <MiniGrid rows={3} cols={6} highlightRows={[0, 2]} highlightColor="bg-violet-400/50" label="" />
                </div>
                <div className="text-[9px] text-violet-300 mt-1.5 font-medium text-center">
                  Filter (3×31)
                </div>
                <div className="text-[8px] text-muted-foreground text-center max-w-[100px]">
                  Same filter stamped at every position
                </div>
              </div>

              <div className="flex flex-col items-center justify-center self-center">
                <ArrowRight className="h-4 w-4 text-violet-400/50" />
                <div className="text-[8px] text-violet-400 mt-0.5">detects</div>
              </div>

              {/* What it finds */}
              <div className="flex flex-col items-center">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <div className="w-8 h-2 rounded-full bg-violet-400/60" />
                    <span className="text-[8px] text-muted-foreground">reversal?</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-5 h-2 rounded-full bg-violet-400/35" />
                    <span className="text-[8px] text-muted-foreground">breakout?</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-10 h-2 rounded-full bg-violet-400/80" />
                    <span className="text-[8px] text-muted-foreground">divergence?</span>
                  </div>
                </div>
                <div className="text-[9px] text-violet-300 mt-1.5 font-medium text-center">
                  64 patterns
                </div>
                <div className="text-[8px] text-muted-foreground text-center">
                  Each filter finds a different pattern
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CNN vs LSTM: Parallel vs Sequential */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Parallel vs Sequential — CNN is NOT sequential
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            {/* CNN side */}
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3">
              <div className="text-xs font-semibold text-violet-300 mb-2 flex items-center gap-1.5">
                <ScanLine className="h-3.5 w-3.5" /> CNN — Parallel
              </div>
              <div className="text-[10px] text-muted-foreground mb-2">
                Sees all bars at once, like viewing an entire chart screenshot
              </div>
              {/* All bars highlighted simultaneously */}
              <div className="flex gap-[3px] items-end">
                {[4, 6, 5, 7, 8, 6, 5, 4, 6, 7, 8, 9].map((h, i) => (
                  <div key={i} className="w-3 rounded-t-sm bg-violet-400/50" style={{ height: `${h * 3}px` }} />
                ))}
              </div>
              <div className="flex gap-[3px] mt-1">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="w-3 h-0.5 bg-violet-400/60 rounded-full" />
                ))}
              </div>
              <div className="text-[8px] text-violet-300 mt-1.5 text-center">All bars processed simultaneously ⚡</div>
            </div>

            {/* LSTM side */}
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="text-xs font-semibold text-amber-300 mb-2 flex items-center gap-1.5">
                <Repeat className="h-3.5 w-3.5" /> LSTM — Sequential
              </div>
              <div className="text-[10px] text-muted-foreground mb-2">
                Reads bar by bar, left to right, updating memory each step
              </div>
              {/* Bars with only first few highlighted */}
              <div className="flex gap-[3px] items-end">
                {[4, 6, 5, 7, 8, 6, 5, 4, 6, 7, 8, 9].map((h, i) => (
                  <div key={i} className={`w-3 rounded-t-sm ${i < 4 ? 'bg-amber-400/60' : 'bg-white/10'}`} style={{ height: `${h * 3}px` }} />
                ))}
              </div>
              <div className="flex gap-[3px] mt-1">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className={`w-3 h-0.5 rounded-full ${i < 4 ? 'bg-amber-400/60' : 'bg-white/10'}`} />
                ))}
              </div>
              <div className="text-[8px] text-amber-300 mt-1.5 text-center">Bar 1 → Bar 2 → Bar 3 → ... one at a time 🐢</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Layer flow */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Data shape through each layer
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ShapeFlow steps={[
            { shape: "60 × 31", label: "Input", sublabel: "bars × features", bg: COLORS.input },
            { shape: "60 × 64", label: "Conv1D", sublabel: "k=3, ReLU", bg: COLORS.conv },
            { shape: "30 × 64", label: "MaxPool", sublabel: "÷2", bg: COLORS.pool },
            { shape: "30 × 128", label: "Conv1D", sublabel: "k=5, ReLU", bg: COLORS.conv },
            { shape: "15 × 128", label: "MaxPool", sublabel: "÷2", bg: COLORS.pool },
            { shape: "15 × 256", label: "Conv1D", sublabel: "k=3, ReLU", bg: COLORS.conv },
            { shape: "7 × 256", label: "MaxPool", sublabel: "÷2", bg: COLORS.pool },
            { shape: "256", label: "GlobalAvgPool", sublabel: "flatten", bg: COLORS.norm },
            { shape: "64", label: "Dense", sublabel: "ReLU", bg: COLORS.dense },
            { shape: "3", label: "Softmax", sublabel: "↑ ↓ ─", bg: COLORS.dense },
          ]} />
          <div className="flex items-start gap-4 mt-3 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-violet-500/30 border border-violet-500/40" />
              <span>Convolution (pattern detection)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-orange-500/30 border border-orange-500/40" />
              <span>Pooling (compress)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500/30 border border-emerald-500/40" />
              <span>Dense (decide)</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Insight title="Key Insight">
        The CNN is <strong>fully parallel</strong> — it stamps all filter positions at once, not one after another.
        It doesn't care <em>where</em> a pattern appears in your 60-bar window — it finds the same
        pattern whether it's at bar 5 or bar 50 (translation invariance).
        Each deeper layer sees a wider time range: layer 1 sees 3 bars, layer 2 sees ~10 bars,
        layer 3 sees ~30 bars. So it builds up from tiny patterns to broad structure.
      </Insight>

      <Insight title="For your pipeline">
        Your 31 features × 60 bars already fits the CNN input shape perfectly. The current placeholder
        model in <code className="text-xs bg-white/5 px-1 rounded">cnn.ts</code> uses exactly this architecture with 3 conv layers
        (64→128→256 filters). Each filter processes ALL 31 features simultaneously, so it can detect
        patterns across returns + RSI + ATR + volume together.
      </Insight>

      <Traits
        strengths={[
          "Fast to train",
          "Local pattern detection",
          "Translation invariant",
          "Few parameters",
          "Good with limited data",
        ]}
        weaknesses={[
          "Fixed receptive field",
          "No explicit temporal memory",
          "Can miss long-range dependencies",
        ]}
        bestFor="Chart patterns, local setups, breakout/reversal detection within a fixed window"
      />
    </div>
  );
}

// ─── LSTM ─────────────────────────────────────────────────────────────────────

function LSTMDetail() {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center shrink-0">
          <Repeat className="h-6 w-6 text-amber-400" />
        </div>
        <div>
          <h3 className="font-semibold text-lg">Long Short-Term Memory (LSTM)</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Processes bars one at a time, learning what to remember and what to forget
          </p>
        </div>
      </div>

      <Card className="bg-amber-500/5 border-amber-500/20">
        <CardContent className="p-4">
          <div className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-1">Think of it as...</div>
          <p className="text-sm text-muted-foreground">
            A <span className="text-amber-300 font-medium">trader reading a chart bar by bar</span>, keeping a mental notepad.
            At each new bar, they decide: "Should I forget that early-session dip? (forget gate)
            Is this volume spike worth noting? (input gate) What's my current read on the market? (output gate)."
            By bar 60, they have a filtered memory of what actually mattered.
          </p>
        </CardContent>
      </Card>

      {/* Visual: LSTM sequential processing */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            How LSTM processes your data (sequential)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Memory lane */}
          <div className="mb-2">
            <div className="text-[9px] text-amber-400 font-medium mb-1">Memory Highway (cell state)</div>
            <div className="flex items-center gap-0">
              {Array.from({ length: 12 }).map((_, i) => (
                <React.Fragment key={i}>
                  <div
                    className="w-4 h-4 rounded-full border border-amber-400/40 shrink-0"
                    style={{ backgroundColor: `rgba(251, 191, 36, ${0.08 + (i / 12) * 0.55})` }}
                  />
                  {i < 11 && <div className="h-0.5 w-4 bg-amber-400/20 shrink-0" />}
                </React.Fragment>
              ))}
              <span className="text-[8px] text-amber-400 ml-2 whitespace-nowrap">
                Memory fills up →
              </span>
            </div>
          </div>

          {/* Gates at key positions */}
          <div className="flex items-end gap-0 mt-3">
            {Array.from({ length: 12 }).map((_, i) => {
              const isLabeled = i === 0 || i === 3 || i === 7 || i === 11;
              return (
                <div key={i} className="flex flex-col items-center min-w-[48px]">
                  {isLabeled && (
                    <div className="flex gap-0.5 mb-1">
                      <span className="px-1 py-0.5 rounded text-[7px] bg-rose-500/20 text-rose-300" title="Forget gate">F</span>
                      <span className="px-1 py-0.5 rounded text-[7px] bg-emerald-500/20 text-emerald-300" title="Input gate">I</span>
                      <span className="px-1 py-0.5 rounded text-[7px] bg-blue-500/20 text-blue-300" title="Output gate">O</span>
                    </div>
                  )}
                  <div className={`w-8 h-6 rounded border flex items-center justify-center text-[7px] font-mono ${
                    isLabeled ? 'bg-amber-500/15 border-amber-500/30 text-amber-300' : 'bg-white/5 border-border/30 text-muted-foreground/50'
                  }`}>
                    {i === 0 ? 't₀' : i === 11 ? 't₅₉' : `t${i * 5}`}
                  </div>
                  <div className="text-[7px] text-muted-foreground/50 mt-0.5">
                    {i === 0 ? '31f' : i === 11 ? '31f' : ''}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Gate legend */}
          <div className="flex gap-4 mt-3 pt-2 border-t border-border/20">
            <div className="flex items-center gap-1.5 text-[9px]">
              <span className="px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-medium">F</span>
              <span className="text-muted-foreground">Forget gate — what to erase from memory</span>
            </div>
            <div className="flex items-center gap-1.5 text-[9px]">
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-medium">I</span>
              <span className="text-muted-foreground">Input gate — what new info to store</span>
            </div>
            <div className="flex items-center gap-1.5 text-[9px]">
              <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-medium">O</span>
              <span className="text-muted-foreground">Output gate — what to expose as current state</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Layer flow */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Data shape through each layer
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ShapeFlow steps={[
            { shape: "60 × 31", label: "Input", sublabel: "bars × features", bg: COLORS.input },
            { shape: "60 × 128", label: "LSTM", sublabel: "128 units", bg: COLORS.recurrent },
            { shape: "128", label: "Last State", sublabel: "final hidden", bg: COLORS.recurrent },
            { shape: "64", label: "Dense", sublabel: "ReLU", bg: COLORS.dense },
            { shape: "3", label: "Softmax", sublabel: "↑ ↓ ─", bg: COLORS.dense },
          ]} />
          <p className="text-[10px] text-muted-foreground mt-2">
            At each of the 60 time steps, the LSTM outputs a 128-dim hidden state. Only the
            <strong> last</strong> hidden state (at t=59) carries the accumulated context of the entire sequence.
          </p>
        </CardContent>
      </Card>

      <Insight title="Key Insight">
        Unlike the CNN which sees all bars at once, the LSTM processes them <em>in order</em>.
        This means it naturally understands that bar 58 comes after bar 57. The forget gate
        is the secret weapon — it lets the network learn that "the dip at bar 10 doesn't matter
        anymore because the trend reversed at bar 30." It actively curates its memory.
      </Insight>

      <Insight title="For your pipeline">
        Your 31 features per bar would be fed into the LSTM one bar at a time, for 60 steps.
        The LSTM would learn temporal patterns like "RSI was oversold 20 bars ago AND volume
        just spiked AND price is crossing the SMA z-score threshold" — things that require
        understanding the <em>sequence</em> of events, not just local windows.
      </Insight>

      <Traits
        strengths={[
          "Full sequence modeling",
          "Learns what to remember/forget",
          "Variable-length memory",
          "Good at regime detection",
        ]}
        weaknesses={[
          "Sequential (slower to train)",
          "Vanishing gradients on very long sequences",
          "Harder to parallelize on GPU",
        ]}
        bestFor="Regime shifts, trend following, sequential dependencies, time-varying patterns"
      />
    </div>
  );
}

// ─── TRANSFORMER ─────────────────────────────────────────────────────────────

function TransformerDetail() {
  // Simplified attention heatmap
  const attentionWeights = [
    [1.0, 0.6, 0.2, 0.1, 0.1, 0.1, 0.3, 0.7],
    [0.5, 1.0, 0.7, 0.3, 0.1, 0.1, 0.1, 0.2],
    [0.2, 0.6, 1.0, 0.8, 0.4, 0.1, 0.1, 0.1],
    [0.1, 0.2, 0.7, 1.0, 0.6, 0.3, 0.1, 0.1],
    [0.1, 0.1, 0.3, 0.5, 1.0, 0.8, 0.4, 0.2],
    [0.1, 0.1, 0.1, 0.2, 0.7, 1.0, 0.7, 0.3],
    [0.3, 0.1, 0.1, 0.1, 0.3, 0.6, 1.0, 0.8],
    [0.8, 0.2, 0.1, 0.1, 0.1, 0.2, 0.7, 1.0],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center shrink-0">
          <Eye className="h-6 w-6 text-cyan-400" />
        </div>
        <div>
          <h3 className="font-semibold text-lg">Transformer (Self-Attention)</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every bar looks at every other bar simultaneously, learning what's relevant
          </p>
        </div>
      </div>

      <Card className="bg-cyan-500/5 border-cyan-500/20">
        <CardContent className="p-4">
          <div className="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-1">Think of it as...</div>
          <p className="text-sm text-muted-foreground">
            A <span className="text-cyan-300 font-medium">team of analysts, each examining the full chart simultaneously</span>.
            Head 1 might focus on trend structure, Head 2 on volatility clusters, Head 3 on volume
            anomalies, Head 4 on support/resistance. Each analyst draws connections between bars that
            matter to their specialty — even bars far apart. Then they combine their findings.
          </p>
        </CardContent>
      </Card>

      {/* Visual: Attention heatmap */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Self-Attention — "Which bars matter to each other?"
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-6 flex-wrap">
            {/* Attention matrix */}
            <div>
              <div className="flex items-center gap-1 mb-1">
                <div className="w-12" /> {/* spacer for row labels */}
                {['t₀', 't₈', 't₁₆', 't₂₄', 't₃₂', 't₄₀', 't₄₈', 't₅₉'].map(t => (
                  <div key={t} className="w-6 text-center text-[7px] font-mono text-muted-foreground/60">{t}</div>
                ))}
              </div>
              {attentionWeights.map((row, ri) => (
                <div key={ri} className="flex items-center gap-1">
                  <div className="w-12 text-right text-[7px] font-mono text-muted-foreground/60 pr-1">
                    {['t₀', 't₈', 't₁₆', 't₂₄', 't₃₂', 't₄₀', 't₄₈', 't₅₉'][ri]}
                  </div>
                  {row.map((w, ci) => (
                    <div
                      key={ci}
                      className="w-6 h-6 rounded-sm border border-cyan-500/10"
                      style={{ backgroundColor: `rgba(34, 211, 238, ${w * 0.6})` }}
                      title={`Attention: ${(w * 100).toFixed(0)}%`}
                    />
                  ))}
                </div>
              ))}
              <div className="flex items-center gap-2 mt-2">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(34, 211, 238, 0.06)' }} />
                  <span className="text-[8px] text-muted-foreground">weak</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(34, 211, 238, 0.6)' }} />
                  <span className="text-[8px] text-muted-foreground">strong attention</span>
                </div>
              </div>
            </div>

            {/* Interpretation */}
            <div className="flex-1 min-w-[200px] space-y-2">
              <div className="text-xs text-muted-foreground">
                <strong className="text-cyan-300">Diagonal</strong> = each bar attends to itself (always strong)
              </div>
              <div className="text-xs text-muted-foreground">
                <strong className="text-cyan-300">Near-diagonal</strong> = attending to nearby bars (local context)
              </div>
              <div className="text-xs text-muted-foreground">
                <strong className="text-cyan-300">Off-diagonal bright spots</strong> = bar 0 and bar 59 are connected!
                The model found a long-range dependency (e.g., opening price pattern predicts close)
              </div>
              <div className="mt-3 p-2 rounded-lg bg-cyan-500/5 border border-cyan-500/10">
                <div className="text-[9px] text-cyan-400 font-medium mb-1">Multi-Head = Multiple Perspectives</div>
                <div className="flex gap-1.5">
                  {['Trend', 'Volatility', 'Volume', 'S/R'].map((h, i) => (
                    <Badge key={h} variant="outline" className="text-[8px] border-cyan-500/20 text-cyan-300/80">
                      Head {i + 1}: {h}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Layer flow */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Data shape through each layer
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ShapeFlow steps={[
            { shape: "60 × 31", label: "Input", sublabel: "bars × features", bg: COLORS.input },
            { shape: "60 × 64", label: "Project", sublabel: "linear", bg: COLORS.norm },
            { shape: "60 × 64", label: "+ PosEnc", sublabel: "position info", bg: COLORS.norm },
            { shape: "60 × 64", label: "Self-Attn", sublabel: "4 heads", bg: COLORS.attention },
            { shape: "60 × 64", label: "FFN", sublabel: "128→64", bg: COLORS.ffn },
            { shape: "60 × 64", label: "Self-Attn", sublabel: "layer 2", bg: COLORS.attention },
            { shape: "60 × 64", label: "FFN", sublabel: "layer 2", bg: COLORS.ffn },
            { shape: "64", label: "GlobalAvg", sublabel: "pool", bg: COLORS.norm },
            { shape: "3", label: "Softmax", sublabel: "↑ ↓ ─", bg: COLORS.dense },
          ]} />
        </CardContent>
      </Card>

      <Insight title="Key Insight">
        The CNN is limited by its filter size (sees 3-5 bars at a time). The LSTM processes
        sequentially and can forget early bars. The Transformer has <em>direct access</em> to
        every bar simultaneously — bar 0 can directly inform bar 59's representation. This makes
        it exceptional at finding long-range patterns, like "the market structure from
        30 bars ago is setting up for what's happening now."
      </Insight>

      <Insight title="For your pipeline">
        Each of your 60 bars (with 31 features) would be projected to a 64-dim vector, then
        enriched with positional encoding (so the model knows bar order). Self-attention then
        computes pairwise relevance between ALL 60 bars. The attention weights themselves
        are interpretable — you can literally see which bars the model considered important
        for its prediction, which maps directly to the XAI visualization you already have.
      </Insight>

      <Traits
        strengths={[
          "Long-range dependencies",
          "Fully parallelizable (fast on GPU)",
          "Attention maps = built-in XAI",
          "State of the art in many domains",
        ]}
        weaknesses={[
          "O(n²) memory with sequence length",
          "Needs more training data",
          "No locality bias (must learn it)",
          "More parameters to tune",
        ]}
        bestFor="Multi-timeframe patterns, long-range structure, interpretable attention, large datasets"
      />
    </div>
  );
}

// ─── XGBOOST ─────────────────────────────────────────────────────────────────

function XGBoostDetail() {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center shrink-0">
          <GitBranch className="h-6 w-6 text-rose-400" />
        </div>
        <div>
          <h3 className="font-semibold text-lg">Gradient Boosted Trees (XGBoost / LightGBM)</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Ensemble of decision trees — each tree corrects the previous one's mistakes
          </p>
        </div>
      </div>

      <Card className="bg-rose-500/5 border-rose-500/20">
        <CardContent className="p-4">
          <div className="text-xs font-semibold text-rose-400 uppercase tracking-wider mb-1">Think of it as...</div>
          <p className="text-sm text-muted-foreground">
            A <span className="text-rose-300 font-medium">panel of simple experts voting</span>. Expert 1 makes a rough prediction
            based on a few rules ("RSI &gt; 70? ATR rising?"). Expert 2 only looks at where Expert 1
            was <em>wrong</em> and learns to fix those cases. Expert 3 fixes Expert 2's remaining errors.
            After 100-500 experts, the combined vote is remarkably accurate.
          </p>
        </CardContent>
      </Card>

      {/* Visual: Decision tree */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            How a single tree makes decisions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3">
            {/* Root */}
            <div className="px-4 py-2 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs font-mono text-rose-300">
              RSI_14 &gt; 0.65 ?
            </div>
            {/* Branch indicators */}
            <div className="flex items-center gap-16">
              <span className="text-[10px] text-emerald-400 font-medium">✓ Yes</span>
              <span className="text-[10px] text-rose-400 font-medium">✗ No</span>
            </div>
            {/* Level 2 */}
            <div className="flex gap-8">
              <div className="flex flex-col items-center gap-2">
                <div className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[10px] font-mono text-amber-300">
                  ATR_ratio &gt; 1.5 ?
                </div>
                <div className="flex gap-3">
                  <div className="px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-300 font-medium">
                    ↑ Buy
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg bg-slate-500/15 border border-slate-500/30 text-[10px] text-slate-300 font-medium">
                    ─ Hold
                  </div>
                </div>
              </div>
              <div className="flex flex-col items-center gap-2">
                <div className="px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[10px] font-mono text-amber-300">
                  Vol_zscore &lt; -0.5 ?
                </div>
                <div className="flex gap-3">
                  <div className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-[10px] text-rose-300 font-medium">
                    ↓ Sell
                  </div>
                  <div className="px-2.5 py-1.5 rounded-lg bg-slate-500/15 border border-slate-500/30 text-[10px] text-slate-300 font-medium">
                    ─ Hold
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sequential correction */}
          <div className="mt-6 pt-4 border-t border-border/20">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Boosting: Trees correct each other</div>
            <div className="flex items-center gap-2">
              {['Tree 1', 'Tree 2', 'Tree 3', '...', 'Tree N'].map((t, i) => (
                <React.Fragment key={i}>
                  {i > 0 && i < 4 && (
                    <div className="flex flex-col items-center text-[7px] text-muted-foreground/50">
                      <span>fixes</span>
                      <ArrowRight className="h-3 w-3" />
                      <span>errors</span>
                    </div>
                  )}
                  {t === '...' ? (
                    <span className="text-muted-foreground/30 text-xs px-2">···</span>
                  ) : (
                    <div className={`px-3 py-2 rounded-lg border text-[10px] font-medium ${
                      i === 0 ? 'bg-rose-500/15 border-rose-500/30 text-rose-300' :
                      i === 4 ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300' :
                      'bg-rose-500/10 border-rose-500/20 text-rose-300/70'
                    }`}>
                      {t}
                    </div>
                  )}
                </React.Fragment>
              ))}
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30" />
              <div className="px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-300 font-medium">
                Sum → Predict
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Important caveat */}
      <Card className="bg-card/50 border-amber-500/30 border">
        <CardContent className="p-4">
          <div className="flex items-start gap-2">
            <Timer className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <div>
              <div className="text-xs font-semibold text-amber-400 mb-1">Important: No Native Sequence Handling</div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Unlike CNN/LSTM/Transformer, XGBoost doesn't process sequences. It sees a <strong>flat row
                of features</strong>, not 60 ordered bars. You'd need to engineer temporal information into
                the features themselves: "RSI 5 bars ago", "slope of ATR over last 10 bars",
                "was there a volume spike in the last 20 bars?" Your universal pipeline's 31 features
                already capture some of this, but you'd lose the 60-bar sequential structure.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Insight title="Key Insight">
        XGBoost is the workhorse of tabular data. It dominates Kaggle competitions with
        structured features. The trade-off: it needs YOU to encode temporal patterns as features
        (which your pipeline partially does with multi-period returns, RSI, etc.). The upside:
        it gives you built-in feature importance — you see exactly which features drive predictions.
      </Insight>

      <Insight title="For your pipeline">
        Instead of feeding 60×31 sequences, you'd flatten to ~31 features per decision point
        (using the latest bar's features). You could enrich this by adding "lagged" features
        ("RSI 5 bars ago = 0.32") or aggregate features ("average ATR over 20 bars = 1.8").
        The model trains in seconds (no GPU needed), and feature importance directly maps to
        your existing feature importance visualization.
      </Insight>

      <Traits
        strengths={[
          "Fastest to train (seconds)",
          "No GPU required",
          "Built-in feature importance",
          "Handles missing data",
          "Excellent with tabular features",
          "Easy to tune",
        ]}
        weaknesses={[
          "No native sequence handling",
          "Requires feature engineering",
          "Can overfit on small datasets",
          "Loses multi-bar patterns",
        ]}
        bestFor="Tabular signal generation, feature-driven strategies, rapid prototyping, ensembling"
      />
    </div>
  );
}

// ─── HYBRID CNN+LSTM ─────────────────────────────────────────────────────────

function HybridDetail() {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
          <Combine className="h-6 w-6 text-emerald-400" />
        </div>
        <div>
          <h3 className="font-semibold text-lg">Hybrid CNN + LSTM</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            CNN extracts local patterns, LSTM reads them in temporal order
          </p>
        </div>
      </div>

      <Card className="bg-emerald-500/5 border-emerald-500/20">
        <CardContent className="p-4">
          <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1">Think of it as...</div>
          <p className="text-sm text-muted-foreground">
            First, a <span className="text-violet-300 font-medium">pattern scanner (CNN)</span> identifies micro-patterns
            in small windows: "3-bar reversal here, breakout setup there, RSI divergence over here."
            Then a <span className="text-amber-300 font-medium">sequential reader (LSTM)</span> reads these patterns
            in order: "Okay, there was a reversal at bar 10, then a breakout at bar 25, and now
            the divergence — given that <em>sequence</em>, the next move is likely..."
          </p>
        </CardContent>
      </Card>

      {/* Visual: Two-stage processing */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Two-stage processing
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Stage 1: CNN */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="text-[9px] border-violet-500/30 text-violet-300 bg-violet-500/5">Stage 1</Badge>
                <span className="text-xs text-violet-300 font-medium">CNN — Extract local patterns</span>
              </div>
              <div className="flex items-start gap-3">
                <MiniGrid rows={12} cols={6} highlightRows={[1, 3]} label="60×31" highlightColor="bg-violet-400/60" />
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 mt-6" />
                <div className="flex flex-col gap-1">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="flex gap-0.5">
                      {Array.from({ length: 4 }).map((_, j) => (
                        <div key={j} className="w-2 h-2 rounded-[1px] bg-violet-400" style={{ opacity: 0.2 + Math.random() * 0.6 }} />
                      ))}
                    </div>
                  ))}
                  <div className="text-[8px] text-violet-300 mt-0.5">30 × 128</div>
                  <div className="text-[8px] text-muted-foreground">pattern features</div>
                </div>
              </div>
            </div>

            {/* Connection */}
            <div className="flex items-center gap-2 pl-8">
              <div className="h-6 border-l border-dashed border-emerald-500/30" />
              <span className="text-[9px] text-emerald-400">patterns fed in sequence ↓</span>
            </div>

            {/* Stage 2: LSTM */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant="outline" className="text-[9px] border-amber-500/30 text-amber-300 bg-amber-500/5">Stage 2</Badge>
                <span className="text-xs text-amber-300 font-medium">LSTM — Read patterns in order</span>
              </div>
              <div className="flex items-center gap-2">
                {Array.from({ length: 8 }).map((_, i) => (
                  <React.Fragment key={i}>
                    <div className="w-5 h-5 rounded border border-amber-500/30 bg-amber-500/10" style={{ opacity: 0.4 + (i / 8) * 0.6 }} />
                    {i < 7 && <div className="h-0.5 w-2 bg-amber-400/20" />}
                  </React.Fragment>
                ))}
                <ArrowRight className="h-3 w-3 text-muted-foreground/30 ml-1" />
                <div className="px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/30 text-[10px] text-emerald-300">
                  ↑ ↓ ─
                </div>
              </div>
              <div className="text-[8px] text-muted-foreground mt-1">30 pattern vectors → LSTM → final prediction</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Layer flow */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Data shape through each layer
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ShapeFlow steps={[
            { shape: "60 × 31", label: "Input", sublabel: "bars × features", bg: COLORS.input },
            { shape: "60 × 64", label: "Conv1D", sublabel: "k=3, ReLU", bg: COLORS.conv },
            { shape: "30 × 64", label: "MaxPool", sublabel: "÷2", bg: COLORS.pool },
            { shape: "30 × 128", label: "Conv1D", sublabel: "k=5, ReLU", bg: COLORS.conv },
            { shape: "30 × 128", label: "→ LSTM", sublabel: "64 units", bg: COLORS.recurrent },
            { shape: "64", label: "Last State", sublabel: "final hidden", bg: COLORS.recurrent },
            { shape: "3", label: "Softmax", sublabel: "↑ ↓ ─", bg: COLORS.dense },
          ]} />
        </CardContent>
      </Card>

      <Insight title="Key Insight">
        The CNN reduces 60 bars to ~30 pattern vectors (via pooling), then the LSTM reads those
        30 vectors in order. This gives you the best of both: the CNN's ability to detect local
        chart patterns AND the LSTM's ability to understand their temporal sequence. The CNN output
        is a "compressed language" of patterns that the LSTM can reason about.
      </Insight>

      <Insight title="For your pipeline">
        This is a natural extension of your current CNN architecture. You'd keep the conv layers
        (which already work), replace the GlobalAvgPool → Dense with an LSTM layer, and let it
        learn the temporal ordering of conv features. Training time is moderate — slower than
        pure CNN but faster than pure LSTM since the CNN compresses the sequence first.
      </Insight>

      <Traits
        strengths={[
          "Local + temporal patterns",
          "CNN compresses before LSTM (efficient)",
          "Best of both architectures",
          "Proven in time-series domains",
        ]}
        weaknesses={[
          "More complex to tune",
          "Two architectures to debug",
          "Slower than pure CNN",
        ]}
        bestFor="Complex sequential patterns: pattern-then-trend, setup-then-trigger sequences"
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPARISON MATRIX
// ═══════════════════════════════════════════════════════════════════════════

const comparisonData = [
  {
    arch: "CNN",
    color: "text-violet-400",
    speed: 4,
    dataReq: 2,
    seqAware: 2,
    longRange: 1,
    interpret: 3,
    gpu: 2,
    params: "~200K",
  },
  {
    arch: "LSTM",
    color: "text-amber-400",
    speed: 2,
    dataReq: 3,
    seqAware: 5,
    longRange: 3,
    interpret: 2,
    gpu: 2,
    params: "~300K",
  },
  {
    arch: "Transformer",
    color: "text-cyan-400",
    speed: 3,
    dataReq: 4,
    seqAware: 5,
    longRange: 5,
    interpret: 4,
    gpu: 4,
    params: "~500K",
  },
  {
    arch: "XGBoost",
    color: "text-rose-400",
    speed: 5,
    dataReq: 1,
    seqAware: 0,
    longRange: 0,
    interpret: 5,
    gpu: 0,
    params: "N/A",
  },
  {
    arch: "CNN+LSTM",
    color: "text-emerald-400",
    speed: 2,
    dataReq: 3,
    seqAware: 4,
    longRange: 3,
    interpret: 3,
    gpu: 3,
    params: "~400K",
  },
];

function RatingDots({ value, max = 5, activeColor = "bg-primary" }: { value: number; max?: number; activeColor?: string }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`w-2 h-2 rounded-full ${i < value ? activeColor : 'bg-white/10'}`}
        />
      ))}
    </div>
  );
}

function ComparisonMatrix() {
  const axes = [
    { key: "speed", label: "Train Speed", desc: "How fast to train" },
    { key: "dataReq", label: "Data Hunger", desc: "How much data needed" },
    { key: "seqAware", label: "Sequence Aware", desc: "Understands bar order" },
    { key: "longRange", label: "Long Range", desc: "Connects distant bars" },
    { key: "interpret", label: "Interpretable", desc: "Explain its decisions" },
    { key: "gpu", label: "GPU Need", desc: "Compute requirement" },
  ];

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-primary" />
          Side-by-Side Comparison
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left py-2 pr-4 text-muted-foreground font-medium w-32">Axis</th>
                {comparisonData.map(d => (
                  <th key={d.arch} className={`text-center py-2 px-3 font-semibold ${d.color}`}>
                    {d.arch}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {axes.map(axis => (
                <tr key={axis.key} className="border-b border-border/10">
                  <td className="py-2.5 pr-4">
                    <div className="font-medium text-foreground/80">{axis.label}</div>
                    <div className="text-[9px] text-muted-foreground">{axis.desc}</div>
                  </td>
                  {comparisonData.map(d => {
                    const val = d[axis.key as keyof typeof d] as number;
                    return (
                      <td key={d.arch} className="text-center py-2.5 px-3">
                        {val === 0 ? (
                          <span className="text-muted-foreground/40 text-[10px]">N/A</span>
                        ) : (
                          <div className="flex justify-center">
                            <RatingDots value={val} activeColor={
                              d.arch === 'CNN' ? 'bg-violet-400' :
                              d.arch === 'LSTM' ? 'bg-amber-400' :
                              d.arch === 'Transformer' ? 'bg-cyan-400' :
                              d.arch === 'XGBoost' ? 'bg-rose-400' : 'bg-emerald-400'
                            } />
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* Params row */}
              <tr>
                <td className="py-2.5 pr-4">
                  <div className="font-medium text-foreground/80">Est. Params</div>
                  <div className="text-[9px] text-muted-foreground">Model size</div>
                </td>
                {comparisonData.map(d => (
                  <td key={d.arch} className="text-center py-2.5 px-3 font-mono text-[10px] text-muted-foreground">
                    {d.params}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════

export default function ArchitectureExplorer() {
  const [activeArch, setActiveArch] = useState("cnn");

  const archLabels: Record<string, string> = {
    cnn: "CNN", lstm: "LSTM", transformer: "Transformer",
    xgboost: "XGBoost", hybrid: "Hybrid", fourier: "Fourier",
  };
  useBreadcrumbs([{ label: archLabels[activeArch] ?? activeArch }]);

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-3">
          <Network className="h-7 w-7 text-primary" />
          Architecture Explorer
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Understand how different ML architectures process your market data — then pick the right one
        </p>
      </div>

      {/* Pipeline overview */}
      <PipelineOverview />

      {/* Architecture deep dives */}
      <Tabs value={activeArch} onValueChange={setActiveArch}>
        <TabsList className="bg-card/50 border border-border/50 p-1 h-auto flex-wrap">
          <TabsTrigger value="cnn" className="data-[state=active]:bg-violet-500/15 data-[state=active]:text-violet-300 gap-1.5 text-xs">
            <ScanLine className="h-3.5 w-3.5" /> CNN
          </TabsTrigger>
          <TabsTrigger value="lstm" className="data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-300 gap-1.5 text-xs">
            <Repeat className="h-3.5 w-3.5" /> LSTM
          </TabsTrigger>
          <TabsTrigger value="transformer" className="data-[state=active]:bg-cyan-500/15 data-[state=active]:text-cyan-300 gap-1.5 text-xs">
            <Eye className="h-3.5 w-3.5" /> Transformer
          </TabsTrigger>
          <TabsTrigger value="xgboost" className="data-[state=active]:bg-rose-500/15 data-[state=active]:text-rose-300 gap-1.5 text-xs">
            <GitBranch className="h-3.5 w-3.5" /> XGBoost
          </TabsTrigger>
          <TabsTrigger value="hybrid" className="data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-300 gap-1.5 text-xs">
            <Combine className="h-3.5 w-3.5" /> Hybrid
          </TabsTrigger>
          <TabsTrigger value="fourier" className="data-[state=active]:bg-blue-500/15 data-[state=active]:text-blue-300 gap-1.5 text-xs">
            <Waves className="h-3.5 w-3.5" /> Fourier
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cnn" className="mt-4">
          <CNNDetail />
        </TabsContent>
        <TabsContent value="lstm" className="mt-4">
          <LSTMDetail />
        </TabsContent>
        <TabsContent value="transformer" className="mt-4">
          <TransformerDetail />
        </TabsContent>
        <TabsContent value="xgboost" className="mt-4">
          <XGBoostDetail />
        </TabsContent>
        <TabsContent value="hybrid" className="mt-4">
          <HybridDetail />
        </TabsContent>
        <TabsContent value="fourier" className="mt-4">
          <Suspense fallback={<PageLoader />}>
            <FourierTransform />
          </Suspense>
        </TabsContent>
      </Tabs>

      {/* Comparison matrix */}
      <ComparisonMatrix />

      {/* Bottom recommendation */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="p-5">
          <div className="flex items-start gap-3">
            <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <div className="font-medium text-sm mb-1">What's Next?</div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Your universal pipeline already decouples features from the model — the architecture
                is the one swappable piece. Pick the approach that matches how you want your model
                to "think" about market data. You can always start with one and compare results.
                The training infrastructure supports any of these architectures.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <Badge variant="outline" className="text-[10px] border-violet-500/30 text-violet-300">
                  CNN — already built, start here to baseline
                </Badge>
                <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-300">
                  Hybrid — natural upgrade from CNN
                </Badge>
                <Badge variant="outline" className="text-[10px] border-cyan-500/30 text-cyan-300">
                  Transformer — if you value interpretability + long-range
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
