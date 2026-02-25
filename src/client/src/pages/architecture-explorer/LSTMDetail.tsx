import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Repeat } from "lucide-react";
import { LAYER_COLORS } from "./constants";
import { ShapeFlow, Insight, Traits } from "./shared-components";

export function LSTMDetail() {
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
            { shape: "60 × 31", label: "Input", sublabel: "bars × features", bg: LAYER_COLORS.input },
            { shape: "60 × 128", label: "LSTM", sublabel: "128 units", bg: LAYER_COLORS.recurrent },
            { shape: "128", label: "Last State", sublabel: "final hidden", bg: LAYER_COLORS.recurrent },
            { shape: "64", label: "Dense", sublabel: "ReLU", bg: LAYER_COLORS.dense },
            { shape: "3", label: "Softmax", sublabel: "↑ ↓ ─", bg: LAYER_COLORS.dense },
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
