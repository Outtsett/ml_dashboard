import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Eye } from "lucide-react";
import { LAYER_COLORS } from "./constants";
import { ShapeFlow, Insight, Traits } from "./shared-components";

export function TransformerDetail() {
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
            { shape: "60 × 31", label: "Input", sublabel: "bars × features", bg: LAYER_COLORS.input },
            { shape: "60 × 64", label: "Project", sublabel: "linear", bg: LAYER_COLORS.norm },
            { shape: "60 × 64", label: "+ PosEnc", sublabel: "position info", bg: LAYER_COLORS.norm },
            { shape: "60 × 64", label: "Self-Attn", sublabel: "4 heads", bg: LAYER_COLORS.attention },
            { shape: "60 × 64", label: "FFN", sublabel: "128→64", bg: LAYER_COLORS.ffn },
            { shape: "60 × 64", label: "Self-Attn", sublabel: "layer 2", bg: LAYER_COLORS.attention },
            { shape: "60 × 64", label: "FFN", sublabel: "layer 2", bg: LAYER_COLORS.ffn },
            { shape: "64", label: "GlobalAvg", sublabel: "pool", bg: LAYER_COLORS.norm },
            { shape: "3", label: "Softmax", sublabel: "↑ ↓ ─", bg: LAYER_COLORS.dense },
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
