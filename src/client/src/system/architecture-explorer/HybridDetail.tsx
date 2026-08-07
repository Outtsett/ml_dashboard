import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { ArrowRight, Combine } from "lucide-react";
import { LAYER_COLORS } from "./constants";
import { ShapeFlow, Insight, Traits, MiniGrid } from "./shared-components";

export function HybridDetail() {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-[hsl(var(--data-pos)/0.15)] border border-[hsl(var(--data-pos)/0.3)] flex items-center justify-center shrink-0">
          <Combine className="h-6 w-6 text-[hsl(var(--data-pos))]" />
        </div>
        <div>
          <h3 className="font-semibold text-lg">Hybrid CNN + LSTM</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            CNN extracts local patterns, LSTM reads them in temporal order
          </p>
        </div>
      </div>

      <Card className="bg-[hsl(var(--data-pos)/0.05)] border-[hsl(var(--data-pos)/0.2)]">
        <CardContent className="p-4">
          <div className="text-xs font-semibold text-[hsl(var(--data-pos))] uppercase tracking-wider mb-1">Think of it as...</div>
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
              <div className="h-6 border-l border-dashed border-[hsl(var(--data-pos)/0.3)]" />
              <span className="text-[9px] text-[hsl(var(--data-pos))]">patterns fed in sequence ↓</span>
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
                <div className="px-2 py-1 rounded bg-[hsl(var(--data-pos)/0.15)] border border-[hsl(var(--data-pos)/0.3)] text-[10px] text-[hsl(var(--data-pos))]">
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
            { shape: "60 × 31", label: "Input", sublabel: "bars × features", bg: LAYER_COLORS.input },
            { shape: "60 × 64", label: "Conv1D", sublabel: "k=3, ReLU", bg: LAYER_COLORS.conv },
            { shape: "30 × 64", label: "MaxPool", sublabel: "÷2", bg: LAYER_COLORS.pool },
            { shape: "30 × 128", label: "Conv1D", sublabel: "k=5, ReLU", bg: LAYER_COLORS.conv },
            { shape: "30 × 128", label: "→ LSTM", sublabel: "64 units", bg: LAYER_COLORS.recurrent },
            { shape: "64", label: "Last State", sublabel: "final hidden", bg: LAYER_COLORS.recurrent },
            { shape: "3", label: "Softmax", sublabel: "↑ ↓ ─", bg: LAYER_COLORS.dense },
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
