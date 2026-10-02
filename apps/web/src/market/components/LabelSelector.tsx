import { memo } from "react";
import { Button } from "@/shared/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/shared/ui/command";
import { Tags, Check, Loader2 } from "lucide-react";
import { CANDLE_UP_COLOR, CANDLE_DOWN_COLOR, MARKER_NEUTRAL_COLOR } from "@/market/components/chartConfig";
import type { LabelGenerator } from "@/market/lib/useLabelOverlay";

interface LabelSelectorProps {
  generators: LabelGenerator[];
  generatorsLoading: boolean;
  selected: string | null;
  onSelect: (generatorType: string | null) => void;
  markerCount: number;
  distribution: Record<string, number>;
  classBalanceRatio: number | null;
  coveredRange: { start: number; end: number } | null;
  chartExtendsPastLabels: boolean;
  isLoading: boolean;
  error: string | null;
}

function formatDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ") + "Z";
}

/**
 * Fold a class-count map into what the legend can show.
 *
 * Mirrors the marker encoding in `labelMarkerStyle.ts`: a vocabulary inside
 * [-2, 2] reads as signed and is summarised by direction, anything wider is
 * ordinal and is summarised by class count, because "up vs down" is not a
 * meaningful split of 21 return buckets.
 */
function summarizeDistribution(distribution: Record<string, number>): {
  kind: "signed" | "ordinal";
  up: number;
  down: number;
  flat: number;
  classes: number;
  min: number;
  max: number;
} {
  let up = 0;
  let down = 0;
  let flat = 0;
  let min = Infinity;
  let max = -Infinity;
  let classes = 0;

  for (const [key, count] of Object.entries(distribution)) {
    const value = Number(key);
    if (!Number.isFinite(value)) continue;
    classes += 1;
    if (value < min) min = value;
    if (value > max) max = value;
    if (value > 0) up += count;
    else if (value < 0) down += count;
    else flat += count;
  }

  const bounded = Number.isFinite(min) && Number.isFinite(max);
  const kind = bounded && min >= -2 && max <= 2 ? "signed" : "ordinal";
  return { kind, up, down, flat, classes, min: bounded ? min : 0, max: bounded ? max : 0 };
}

/** Group generators by their taxonomy category so the list stays scannable. */
function groupByCategory(generators: LabelGenerator[]): [string, LabelGenerator[]][] {
  const groups = new Map<string, LabelGenerator[]>();
  for (const g of generators) {
    const key = g.category || "other";
    const bucket = groups.get(key);
    if (bucket) bucket.push(g);
    else groups.set(key, [g]);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

export const LabelSelector = memo(function LabelSelector({
  generators,
  generatorsLoading,
  selected,
  onSelect,
  markerCount,
  distribution,
  classBalanceRatio,
  coveredRange,
  chartExtendsPastLabels,
  isLoading,
  error,
}: LabelSelectorProps) {
  const active = generators.find(g => g.id === selected) ?? null;
  const grouped = groupByCategory(generators);

  // Summed by sign across every class present, not read off the "1"/"-1"/"0"
  // keys. Those three keys are all this used to look at, so a generator with a
  // wider vocabulary had most of its rows silently dropped from the tally —
  // `structural` reports {-2:323, -1:12, 0:1, 1:719, 2:443} and the legend
  // showed "down 12", omitting the 323 break-of-structure-down bars entirely.
  const summary = summarizeDistribution(distribution);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={selected ? "default" : "ghost"}
          size="sm"
          className={`h-8 px-2.5 text-[11px] font-mono gap-1.5 border ${
            selected
              ? "bg-primary/20 text-primary border-primary/30"
              : "text-muted-foreground border-white/[0.06] hover:text-primary hover:bg-primary/10"
          }`}
          title="Overlay generated labels on the candles"
          data-testid="label-selector"
        >
          {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Tags className="h-3 w-3" />}
          {active ? active.name : "Labels"}
          {selected && markerCount > 0 && (
            <span className="text-[10px] opacity-70">{markerCount}</span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[340px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search label generator..." />
          <CommandList className="max-h-[380px]">
            <CommandEmpty>
              {generatorsLoading ? "Loading generators..." : "No generator found."}
            </CommandEmpty>

            <CommandGroup heading="Overlay">
              <CommandItem
                value="none no labels clear"
                onSelect={() => onSelect(null)}
                className="flex items-center gap-2"
              >
                <Check className={`h-3 w-3 ${selected === null ? "opacity-100" : "opacity-0"}`} />
                <span className="text-xs">None</span>
                <span className="text-muted-foreground text-[10px] ml-auto">clear overlay</span>
              </CommandItem>
            </CommandGroup>

            {grouped.map(([category, items]) => (
              <CommandGroup key={category} heading={category}>
                {items.map(g => (
                  <CommandItem
                    key={g.id}
                    value={`${g.id} ${g.name} ${g.description}`}
                    onSelect={() => onSelect(g.id)}
                    className="flex items-start gap-2 py-1.5"
                  >
                    <Check className={`h-3 w-3 mt-0.5 shrink-0 ${selected === g.id ? "opacity-100" : "opacity-0"}`} />
                    <span className="flex flex-col min-w-0">
                      <span className="text-xs font-medium">{g.name}</span>
                      <span className="text-muted-foreground text-[10px] leading-tight">{g.description}</span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>

        {selected && (
          <div className="border-t border-white/[0.08] px-3 py-2 space-y-1">
            {error ? (
              <p className="text-[10px] text-amber-400 leading-tight">{error}</p>
            ) : (
              <>
                <div className="flex items-center gap-3 text-[10px] font-mono">
                  {summary.kind === "signed" ? (
                    <>
                      <span style={{ color: CANDLE_UP_COLOR }}>&#9650; {summary.up.toLocaleString()}</span>
                      <span style={{ color: CANDLE_DOWN_COLOR }}>&#9660; {summary.down.toLocaleString()}</span>
                      <span style={{ color: MARKER_NEUTRAL_COLOR }}>&#9679; {summary.flat.toLocaleString()}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      {summary.classes} classes &middot; {summary.min}&ndash;{summary.max} &middot; cividis ramp
                    </span>
                  )}
                </div>
                {classBalanceRatio !== null && (
                  <p className="text-[10px] text-muted-foreground">
                    class balance {classBalanceRatio.toFixed(3)}
                    {classBalanceRatio < 0.1 && " — rare-event label, stratify before training"}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground">
                  {markerCount.toLocaleString()} markers drawn
                  {coveredRange && `, ${formatDay(coveredRange.start)} → ${formatDay(coveredRange.end)}`}
                </p>
                {chartExtendsPastLabels && (
                  <p className="text-[10px] leading-tight" style={{ color: CANDLE_DOWN_COLOR }}>
                    Chart extends past the newest label — scroll left to
                    {coveredRange ? ` ${formatDay(coveredRange.end)}` : " the labeled range"} to see arrows.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
});
