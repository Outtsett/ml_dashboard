import React, { memo } from "react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { ChevronRight, Sparkles, Target } from "lucide-react";

/** A colored block showing data shape at a model layer */
export const ShapeBlock = memo(({ shape, label, sublabel, bg }: {
  shape: string; label: string; sublabel?: string; bg: string;
}) => (
  <div className={`rounded-xl border px-3 py-2 text-center min-w-[72px] ${bg}`}>
    <div className="font-mono text-[11px] font-bold whitespace-nowrap">{shape}</div>
    <div className="text-[10px] font-medium mt-0.5 opacity-80">{label}</div>
    {sublabel && <div className="text-[9px] opacity-50 mt-px">{sublabel}</div>}
  </div>
));

/** Arrow between shape blocks */
export const FlowArrow = memo(() => (
  <div className="flex items-center shrink-0 px-0.5">
    <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
  </div>
));

/** Horizontal chain of shape blocks with arrows */
export function ShapeFlow({ steps }: { steps: { shape: string; label: string; sublabel?: string; bg: string }[] }) {
  return (
    <ScrollArea className="w-full">
      <div className="flex items-center py-3 px-1 min-w-max">
        {steps.map((s, i) => (
          <React.Fragment key={i}>
            {i > 0 && <FlowArrow />}
            <ShapeBlock {...s} />
          </React.Fragment>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

/** Highlighted insight callout */
export function Insight({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-[10px] font-semibold text-primary uppercase tracking-wider">{title}</span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

/** Strength/weakness badge list */
export function Traits({ strengths, weaknesses, bestFor }: {
  strengths: string[]; weaknesses: string[]; bestFor: string;
}) {
  return (
    <div className="space-y-2 mt-4">
      <div className="flex flex-wrap gap-1.5">
        {strengths.map(s => (
          <Badge key={s} variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400 bg-emerald-500/5">
            ✓ {s}
          </Badge>
        ))}
        {weaknesses.map(w => (
          <Badge key={w} variant="outline" className="text-[10px] border-rose-500/30 text-rose-400 bg-rose-500/5">
            ✗ {w}
          </Badge>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Target className="h-3.5 w-3.5 text-amber-400" />
        <span className="text-xs text-amber-400 font-medium">Best for: {bestFor}</span>
      </div>
    </div>
  );
}

/** Mini data grid — simplified visual of an input matrix */
export function MiniGrid({ rows, cols, highlightRows, label, highlightColor = "bg-violet-400/70", cellColor = "bg-white/10" }: {
  rows: number; cols: number; label?: string;
  highlightRows?: [number, number];
  highlightColor?: string; cellColor?: string;
}) {
  return (
    <div className="inline-block">
      {label && <div className="text-[9px] text-muted-foreground mb-1 font-mono">{label}</div>}
      <div className="inline-grid gap-[2px]" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: rows * cols }).map((_, i) => {
          const row = Math.floor(i / cols);
          const hl = highlightRows && row >= highlightRows[0] && row <= highlightRows[1];
          return (
            <div
              key={i}
              className={`w-2 h-2 rounded-sm ${hl ? highlightColor : cellColor}`}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Rating dots for comparison matrix */
export function RatingDots({ value, max = 5, activeColor = "bg-primary" }: { value: number; max?: number; activeColor?: string }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`w-2 h-2 rounded-full ${i < value ? activeColor : 'bg-white/10'}`}
        />
      ))}
    </div>
  );
}
