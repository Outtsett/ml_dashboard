/**
 * Forecast — Standalone Chronos pre-trained forecast surface.
 *
 * Promoted out of the previous MLStudio Forecast tab on 2026-05-08 so it can
 * be reached directly via /forecast without paging through the studio shell.
 */

import ForecastVisualizer from "@/ml/components/ForecastVisualizer";
import { useBreadcrumbs } from "@/shared/hooks/useBreadcrumbs";
import { Wand2 } from "lucide-react";

export default function Forecast() {
  useBreadcrumbs([{ label: "Forecast", icon: Wand2 }]);
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-1 mb-3 shrink-0">
        <h1 className="text-4xl font-display font-bold text-foreground">Forecast</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Chronos zero-shot forecast — draw a line, model predicts forward, reveal actuals.
        </p>
      </div>
      <div className="flex-1 min-h-0 overflow-auto bg-card/10 rounded-xl border border-white/5">
        <ForecastVisualizer />
      </div>
    </div>
  );
}
