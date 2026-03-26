import { SpeedAuditContent } from "@/components/SpeedAuditPanel";

interface PerformanceTabProps {
  metrics: any;
}

export function PerformanceTab({ metrics }: PerformanceTabProps) {
  return <SpeedAuditContent metrics={metrics} />;
}
