interface ProgressRingProps {
  /** 0–100 */
  value: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  showLabel?: boolean;
}

export function ProgressRing({
  value,
  size = 48,
  strokeWidth = 4,
  className = "",
  showLabel = true,
}: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(value, 100) / 100) * circumference;

  const color =
    value >= 80
      ? "stroke-[hsl(var(--data-pos))]"
      : value >= 40
        ? "stroke-amber-500"
        : value > 0
          ? "stroke-blue-500"
          : "stroke-muted-foreground/20";

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          className="stroke-muted/30"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={`${color} transition-[stroke-dashoffset,stroke] duration-700 ease-out`}
        />
      </svg>
      {showLabel && (
        <span className="absolute text-[10px] font-mono font-semibold text-foreground/80">
          {Math.round(value)}%
        </span>
      )}
    </div>
  );
}
