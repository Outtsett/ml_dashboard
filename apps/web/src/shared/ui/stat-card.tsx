import React from "react";
import { cn } from "@/shared/utils/utils";
import { type LucideIcon } from "lucide-react";

interface StatCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon?: LucideIcon;
  trend?: {
    value: number | string;
    isPositive: boolean;
  };
  color?: "emerald" | "blue" | "amber" | "rose" | "violet" | "cyan" | "fuchsia" | "primary";
  className?: string;
  loading?: boolean;
}

const colorStyles = {
  emerald: {
    border: "border-[hsl(var(--data-pos)/0.2)]",
    bg: "from-[hsl(var(--data-pos)/0.1)] to-[hsl(var(--data-pos)/0.05)]",
    text: "text-[hsl(var(--data-pos))]",
    label: "text-[hsl(var(--data-pos)/0.7)]",
    iconBg: "bg-[hsl(var(--data-pos)/0.2)]",
    iconColor: "text-[hsl(var(--data-pos))]"
  },
  blue: {
    border: "border-blue-500/20",
    bg: "from-blue-500/10 to-blue-600/5",
    text: "text-blue-400",
    label: "text-blue-300/70",
    iconBg: "bg-blue-500/20",
    iconColor: "text-blue-400"
  },
  amber: {
    border: "border-amber-500/20",
    bg: "from-amber-500/10 to-amber-600/5",
    text: "text-amber-400",
    label: "text-amber-300/70",
    iconBg: "bg-amber-500/20",
    iconColor: "text-amber-400"
  },
  rose: {
    border: "border-[hsl(var(--data-neg)/0.2)]",
    bg: "from-[hsl(var(--data-neg)/0.1)] to-[hsl(var(--data-neg)/0.05)]",
    text: "text-[hsl(var(--data-neg))]",
    label: "text-[hsl(var(--data-neg)/0.7)]",
    iconBg: "bg-[hsl(var(--data-neg)/0.2)]",
    iconColor: "text-[hsl(var(--data-neg))]"
  },
  violet: {
    border: "border-violet-500/20",
    bg: "from-violet-500/10 to-violet-600/5",
    text: "text-violet-400",
    label: "text-violet-300/70",
    iconBg: "bg-violet-500/20",
    iconColor: "text-violet-400"
  },
  cyan: {
    border: "border-cyan-500/20",
    bg: "from-cyan-500/10 to-cyan-600/5",
    text: "text-cyan-400",
    label: "text-cyan-300/70",
    iconBg: "bg-cyan-500/20",
    iconColor: "text-cyan-400"
  },
  fuchsia: {
    border: "border-fuchsia-500/20",
    bg: "from-fuchsia-500/10 to-fuchsia-600/5",
    text: "text-fuchsia-400",
    label: "text-fuchsia-300/70",
    iconBg: "bg-fuchsia-500/20",
    iconColor: "text-fuchsia-400"
  },
  primary: {
    border: "border-primary/20",
    bg: "from-primary/10 to-primary/5",
    text: "text-primary",
    label: "text-primary/70",
    iconBg: "bg-primary/20",
    iconColor: "text-primary"
  }
};

export function StatCard({
  label,
  value,
  subValue,
  icon: Icon,
  trend,
  color = "primary",
  className,
  loading
}: StatCardProps) {
  const style = colorStyles[color];

  return (
    <div className={cn(
      "glass rounded-xl p-4 border transition-all duration-300",
      "bg-gradient-to-br",
      style.border,
      style.bg,
      className
    )}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {Icon && (
            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", style.iconBg)}>
              <Icon className={cn("h-4 w-4", style.iconColor)} />
            </div>
          )}
          <div className={cn("text-[10px] uppercase tracking-wider font-medium", style.label)}>
            {label}
          </div>
        </div>
        {trend && (
          <div className={cn(
            "text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md border",
            trend.isPositive ? "bg-[hsl(var(--data-pos)/0.1)] border-[hsl(var(--data-pos)/0.2)] text-[hsl(var(--data-pos))]" : "bg-[hsl(var(--data-neg)/0.1)] border-[hsl(var(--data-neg)/0.2)] text-[hsl(var(--data-neg))]"
          )}>
            {trend.isPositive ? "+" : ""}{trend.value}
          </div>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <div className={cn("text-2xl font-bold font-mono tracking-tight", style.text)}>
          {loading ? (
            <div className="h-8 w-24 bg-white/5 animate-pulse rounded" />
          ) : value}
        </div>
        {subValue && !loading && (
          <div className="text-[10px] text-muted-foreground font-mono opacity-60">
            {subValue}
          </div>
        )}
      </div>
    </div>
  );
}
