import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight, GitBranch, Timer } from "lucide-react";
import { Insight, Traits } from "./shared-components";

export function XGBoostDetail() {
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
