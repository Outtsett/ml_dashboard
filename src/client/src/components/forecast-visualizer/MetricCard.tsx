import React from "react";
import { Card, CardContent } from "@/components/ui/card";

interface MetricCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  hint: string;
}

const COLOR_MAP: Record<string, string> = {
  green: "text-green-400 bg-green-500/10 border-green-500/20",
  red: "text-red-400 bg-red-500/10 border-red-500/20",
  blue: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  cyan: "text-cyan-400 bg-cyan-500/10 border-cyan-500/20",
  violet: "text-violet-400 bg-violet-500/10 border-violet-500/20",
};

export function MetricCard({ label, value, icon, color, hint }: MetricCardProps) {
  const cls = COLOR_MAP[color] || COLOR_MAP.blue;
  const [textColor] = cls!.split(" ");

  return (
    <Card className={`glass rounded-xl border ${cls!.split(" ").slice(1).join(" ")}`}>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1">
          <div className={textColor}>{icon}</div>
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</span>
        </div>
        <div className={`text-xl font-bold font-mono ${textColor}`}>{value}</div>
        <div className="text-[10px] text-muted-foreground mt-1">{hint}</div>
      </CardContent>
    </Card>
  );
}
