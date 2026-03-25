import { cn } from "@/lib/utils";

const StatBar = ({ label, value, color = "bg-primary/60" }: { label: string; value: number, color?: string }) => (
  <div className="space-y-1.5">
    <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
      <span>{label}</span>
      <span className="font-mono">{value}%</span>
    </div>
    <div className="h-1 bg-border/50 rounded-full overflow-hidden">
      <div 
        className={cn("h-full rounded-full transition-all duration-700 ease-out", color)} 
        style={{ width: `${value}%` }} 
      />
    </div>
  </div>
);

export const SystemStats = ({ collapsed }: { collapsed: boolean }) => {
  if (collapsed) return null;
  
  return (
    <div className="p-3 border-t border-border/50">
      <div className="bg-muted/30 p-3 rounded-lg space-y-2 border border-border/50">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">System</span>
          <span className="text-[10px] font-mono text-emerald-500 font-bold">Online</span>
        </div>
        <StatBar label="CPU" value={23} />
        <StatBar label="GPU" value={54} color="bg-accent/60" />
      </div>
    </div>
  );
};
