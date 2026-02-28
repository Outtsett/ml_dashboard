/**
 * Shared building blocks for analytics components.
 *
 * SRP: ChartCard = card chrome. EmptyState = no-data message. No business logic.
 * DIP: All analytics components depend on these, not raw shadcn/ui Card.
 */

import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

interface ChartCardProps {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Minimum height for the chart area */
  minHeight?: number;
}

export function ChartCard({ title, subtitle, badge, children, className, minHeight = 200 }: ChartCardProps) {
  return (
    <Card className={`bg-black/20 border-white/5 overflow-hidden ${className ?? ""}`}>
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <div>
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">{title}</h4>
          {subtitle && <p className="text-[9px] text-muted-foreground/40 mt-0.5">{subtitle}</p>}
        </div>
        {badge}
      </div>
      <div className="px-4 pb-3" style={{ minHeight }}>
        {children}
      </div>
    </Card>
  );
}

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
  hint?: string;
}

export function EmptyState({ icon, message, hint }: EmptyStateProps) {
  return (
    <div className="w-full h-full flex items-center justify-center text-muted-foreground min-h-[120px]">
      <div className="text-center">
        {icon && <div className="mx-auto mb-2 opacity-30">{icon}</div>}
        <p className="text-xs">{message}</p>
        {hint && <p className="text-[10px] opacity-60 mt-1">{hint}</p>}
      </div>
    </div>
  );
}
