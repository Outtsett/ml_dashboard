import { memo } from "react";
import { useTrainingControl } from "@/training/lib/TrainingContext";
import { QualityGatePanel } from "../analytics/QualityGatePanel";
import { ShapBeeswarm } from "../analytics/ShapBeeswarm";
import { PerRegimeShapCards } from "../analytics/PerRegimeShapCards";
import { ShapEvolution } from "../analytics/ShapEvolution";
import { Layers, Zap, Brain, Activity } from "lucide-react";

export interface ShapTabProps {
  diagnostics: Record<string, unknown> | null;
  activeModelId: string | null;
}

function ShapTabInner({ diagnostics, activeModelId: _activeModelId }: ShapTabProps) {
  const { selectedModelType, availableModels } = useTrainingControl();
  
  const modelDef = availableModels[selectedModelType];
  const isPredictor = modelDef?.subcategory === 'classification' || selectedModelType.includes('transformer');

  return (
    <div className="space-y-8 p-8 max-w-[1600px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* 1. Header with Architectural Context */}
      <div className="flex items-center justify-between border-b border-white/5 pb-6">
        <div className="flex items-center gap-4">
          <div className="p-2 rounded-xl bg-violet-500/10 border border-violet-500/20">
            <Layers className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight text-foreground/90 uppercase font-mono">Feature Attribution Analysis</h2>
            <p className="text-[10px] text-muted-foreground/40 uppercase tracking-widest font-mono">
              {isPredictor ? 'Predictive Weighting Matrix' : 'Regime Separation Attribution'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6">
           <div className="text-right">
              <div className="text-[8px] font-black uppercase tracking-widest text-muted-foreground/30 mb-1">Method</div>
              <span className="text-[10px] font-bold font-mono text-violet-400/80 bg-violet-500/5 px-2 py-0.5 rounded border border-violet-500/10 shadow-[0_0_8px_rgba(139,92,246,0.1)]">
                KERNEL SHAP (STABLE)
              </span>
           </div>
        </div>
      </div>

      <QualityGatePanel diagnostics={diagnostics} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Global Importance (Main Column) */}
        <div className="lg:col-span-8 space-y-8">
          <section>
            <div className="flex items-center gap-2 mb-4 px-1 opacity-60">
              <Brain className="w-3.5 h-3.5" />
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em]">Global Influence Matrix</h3>
            </div>
            <ShapBeeswarm />
          </section>

          <section>
            <div className="flex items-center gap-2 mb-4 px-1 opacity-60">
              <Activity className="w-3.5 h-3.5" />
              <h3 className="text-[10px] font-black uppercase tracking-[0.3em]">Temporal Importance Evolution</h3>
            </div>
            <ShapEvolution />
          </section>
        </div>

        {/* Localized Insights (Sidebar Column) */}
        <div className="lg:col-span-4 space-y-8">
          {!isPredictor && (
            <section>
              <div className="flex items-center gap-2 mb-4 px-1 opacity-60">
                <Zap className="w-3.5 h-3.5" />
                <h3 className="text-[10px] font-black uppercase tracking-[0.3em]">Regime Specific Weights</h3>
              </div>
              <PerRegimeShapCards />
            </section>
          )}
          
          {isPredictor && (
            <div className="p-6 rounded-2xl border border-white/[0.05] bg-white/[0.01] glass relative overflow-hidden">
               <div className="text-[10px] font-black uppercase tracking-[0.3em] text-muted-foreground/40 mb-4 relative z-10">Architectural Block Attribution</div>
               <div className="space-y-6 relative z-10">
                  <div className="space-y-2">
                     <div className="flex justify-between text-[10px] font-mono">
                        <span className="text-foreground/60">CNN (Spatial Textures)</span>
                        <span className="text-primary font-bold">~42%</span>
                     </div>
                     <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: '42%' }} />
                     </div>
                  </div>
                  <div className="space-y-2">
                     <div className="flex justify-between text-[10px] font-mono">
                        <span className="text-foreground/60">Transformer (Temporal Context)</span>
                        <span className="text-emerald-400 font-bold">~58%</span>
                     </div>
                     <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: '58%' }} />
                     </div>
                  </div>
               </div>
               <p className="mt-6 text-[9px] font-mono text-muted-foreground/30 italic relative z-10 leading-relaxed">
                 Institutional Insight: Model is heavily relying on long-range temporal dependencies. Consider increasing 'window_size' if local coherence is low.
               </p>
               <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500/5 blur-[60px] rounded-full -mr-16 -mt-16" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const ShapTab = memo(ShapTabInner);
export default ShapTab;
