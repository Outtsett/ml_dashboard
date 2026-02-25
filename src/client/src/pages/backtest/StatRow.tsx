interface StatRowProps {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}

export function StatRow({ label, value, positive, negative }: StatRowProps) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono ${positive ? 'text-green-400' : negative ? 'text-rose-400' : ''}`}>{value}</span>
    </div>
  );
}
