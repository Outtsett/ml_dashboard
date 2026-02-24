import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, ScanLine, Repeat } from "lucide-react";
import { LAYER_COLORS } from "./constants";
import { ShapeFlow, Insight, Traits, MiniGrid } from "./shared-components";

export function CNNDetail() {
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
            { shape: "60 × 31", label: "Input", sublabel: "bars × features", bg: LAYER_COLORS.input },
            { shape: "60 × 64", label: "Conv1D", sublabel: "k=3, ReLU", bg: LAYER_COLORS.conv },
            { shape: "30 × 64", label: "MaxPool", sublabel: "÷2", bg: LAYER_COLORS.pool },
            { shape: "30 × 128", label: "Conv1D", sublabel: "k=5, ReLU", bg: LAYER_COLORS.conv },
            { shape: "15 × 128", label: "MaxPool", sublabel: "÷2", bg: LAYER_COLORS.pool },
            { shape: "15 × 256", label: "Conv1D", sublabel: "k=3, ReLU", bg: LAYER_COLORS.conv },
            { shape: "7 × 256", label: "MaxPool", sublabel: "÷2", bg: LAYER_COLORS.pool },
            { shape: "256", label: "GlobalAvgPool", sublabel: "flatten", bg: LAYER_COLORS.norm },
            { shape: "64", label: "Dense", sublabel: "ReLU", bg: LAYER_COLORS.dense },
            { shape: "3", label: "Softmax", sublabel: "↑ ↓ ─", bg: LAYER_COLORS.dense },
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
