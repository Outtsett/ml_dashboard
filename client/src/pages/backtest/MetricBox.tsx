interface MetricBoxProps {
  label: string;
  value: string;
  subValue?: string;
  color: string;
}

const colorMap: Record<string, { bg: string; label: string; text: string }> = {
  emerald: { bg: 'from-emerald-500/10 to-emerald-600/5 border-emerald-500/20', label: 'text-emerald-300/70', text: 'text-emerald-300' },
  rose: { bg: 'from-rose-500/10 to-rose-600/5 border-rose-500/20', label: 'text-rose-300/70', text: 'text-rose-300' },
  violet: { bg: 'from-violet-500/10 to-violet-600/5 border-violet-500/20', label: 'text-violet-300/70', text: 'text-violet-300' },
  cyan: { bg: 'from-cyan-500/10 to-cyan-600/5 border-cyan-500/20', label: 'text-cyan-300/70', text: 'text-cyan-300' },
  amber: { bg: 'from-amber-500/10 to-amber-600/5 border-amber-500/20', label: 'text-amber-300/70', text: 'text-amber-300' },
  fuchsia: { bg: 'from-fuchsia-500/10 to-fuchsia-600/5 border-fuchsia-500/20', label: 'text-fuchsia-300/70', text: 'text-fuchsia-300' },
};

export function MetricBox({ label, value, subValue, color }: MetricBoxProps) {
  const c = colorMap[color] ?? colorMap.emerald;

  return (
    <div className={`bg-gradient-to-br ${c.bg} rounded-xl p-3 border`}>
      <div className={`text-[10px] ${c.label} uppercase tracking-wider mb-1`}>{label}</div>
      <div className={`text-2xl font-bold ${c.text}`}>{value}</div>
      {subValue && <div className="text-[10px] text-muted-foreground mt-0.5">{subValue}</div>}
    </div>
  );
}
