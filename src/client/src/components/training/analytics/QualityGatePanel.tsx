/**
 * QualityGatePanel — Horizontal row of quality gate status indicators.
 *
 * Compact row (~32px) showing each gate as colored dot + metric name + value.
 * Hover reveals recommendation via shadcn Tooltip.
 */

import { memo } from "react";
import { useTrainingModelState } from "@/contexts/TrainingModelStateCtx";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

const STATUS_COLORS: Record<string, string> = {
  pass: "#22c55e",
  warn: "#eab308",
  fail: "#ef4444",
};

const PLACEHOLDER_GATES = [
  "silhouette", "davies_bouldin", "n_regimes",
  "self_transition", "avg_dwell", "max_dominance",
];

function QualityGatePanelInner() {
  const { modelState } = useTrainingModelState();

  const gates = modelState?.snapshot?.quality_gates;
  const hasGates = gates && gates.length > 0;

  if (!hasGates) {
    return (
      <div className="flex items-center gap-3 h-8 px-3 overflow-x-auto">
        {PLACEHOLDER_GATES.map((name) => (
          <div key={name} className="flex items-center gap-1.5 shrink-0 cursor-default">
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: "#6b7280" }}
            />
            <span className="text-[10px] font-mono text-muted-foreground/30">
              {name}
            </span>
            <span className="text-[10px] font-mono font-medium text-muted-foreground/20">
              {"\u2014"}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 h-8 px-3 overflow-x-auto">
      {gates.map((gate) => {
        const color = STATUS_COLORS[gate.status] ?? STATUS_COLORS.fail;
        const trigger = (
          <div className="flex items-center gap-1.5 shrink-0 cursor-default">
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="text-[10px] font-mono text-muted-foreground/70">
              {gate.metric}
            </span>
            <span
              className="text-[10px] font-mono font-medium"
              style={{ color }}
            >
              {typeof gate.value === "number" ? gate.value.toFixed(3) : String(gate.value)}
            </span>
          </div>
        );

        if (!gate.recommendation) return <div key={gate.metric}>{trigger}</div>;

        return (
          <Tooltip key={gate.metric}>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent
              side="bottom"
              className="max-w-xs text-[10px] font-mono"
            >
              {gate.recommendation}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

export const QualityGatePanel = memo(QualityGatePanelInner);
export default QualityGatePanel;
