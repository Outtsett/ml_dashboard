import { SpeedAuditContent } from "@/system/components/SpeedAuditPanel";
import type { SpeedMetrics } from "@/system/lib/useSpeedAudit";

interface PerformanceTabProps {
  metrics: SpeedMetrics;
}

export function PerformanceTab({ metrics }: PerformanceTabProps) {
  return <SpeedAuditContent metrics={metrics} />;
}
