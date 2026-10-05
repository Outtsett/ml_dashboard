/**
 * XAITab — Method selector, feature importance bars.
 */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { ProgressFill } from "@/shared/ui/progress-fill";
import { Crosshair } from "lucide-react";
import type { XAITabProps } from "@/system/components/ml-workflow/types";

export function XAITab({ xaiMethod, setXaiMethod, xaiResult, activeModelName }: XAITabProps) {
  return (
    <div className="p-3 space-y-3">
      {/* Method selector */}
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground">Method</label>
        <Select value={xaiMethod} onValueChange={setXaiMethod}>
          <SelectTrigger className="h-7 text-[10px] bg-black/30 border-white/10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="permutation" className="text-xs">Permutation Importance</SelectItem>
            <SelectItem value="shap" className="text-xs">SHAP</SelectItem>
            <SelectItem value="lime" className="text-xs">LIME</SelectItem>
            <SelectItem value="gradcam" className="text-xs">GradCAM</SelectItem>
            <SelectItem value="saliency" className="text-xs">Saliency Maps</SelectItem>
            <SelectItem value="integrated_gradients" className="text-xs">Integrated Gradients</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Active model */}
      <div className="p-2 rounded-lg bg-white/5">
        <p className="text-[10px] text-muted-foreground">Analyzing</p>
        <p className="font-mono text-xs text-primary">{activeModelName}</p>
      </div>

      {/* Feature importance bars */}
      {xaiResult?.features && xaiResult.features.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[10px] text-muted-foreground font-medium">Feature Importance</p>
          <div className="space-y-1">
            {xaiResult.features.slice(0, 15).map((f, i) => {
              const maxImp = Math.max(...xaiResult.features.map(x => Math.abs(x.importance)));
              const pct = maxImp > 0 ? (Math.abs(f.importance) / maxImp) * 100 : 0;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[9px] text-muted-foreground w-20 truncate" title={f.name}>{f.name}</span>
                  <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <ProgressFill
                      value={pct}
                      className={f.importance >= 0 ? 'bg-cyan-500' : 'bg-[hsl(var(--data-neg))]'}
                    />
                  </div>
                  <span className="text-[9px] font-mono text-foreground w-10 text-right">
                    {(f.importance * 100).toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
          <Crosshair className="h-8 w-8 mb-2 opacity-20" />
          <p className="text-xs">Train a model first</p>
          <p className="text-[10px] text-muted-foreground/60">XAI analysis requires a trained model</p>
        </div>
      )}
    </div>
  );
}
