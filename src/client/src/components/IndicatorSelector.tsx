import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, ChevronsUpDown, X } from 'lucide-react';
import type { IndicatorCatalog } from '@/hooks/useIndicatorData';

interface IndicatorSelectorProps {
  catalog: IndicatorCatalog | null;
  selectedColumns: string[];
  onSelectionChange: (columns: string[]) => void;
  isLoading?: boolean;
}

// Display-friendly category names
const CATEGORY_LABELS: Record<string, string> = {
  overlap: 'Overlap',
  momentum: 'Momentum',
  volatility: 'Volatility',
  volume: 'Volume',
  trend: 'Trend',
  candle: 'Candle Patterns',
  statistics: 'Statistics',
  cycle: 'Cycle',
  performance: 'Performance',
};

// Quick preset definitions
const PRESETS: Record<string, { label: string; columns: string[] }> = {
  ma: {
    label: 'Moving Averages',
    columns: ['SMA_10', 'SMA_20', 'SMA_50', 'SMA_200', 'EMA_10', 'EMA_20', 'EMA_50', 'EMA_200'],
  },
  bollinger: {
    label: 'Bollinger Bands',
    columns: ['BBL_5_2.0', 'BBM_5_2.0', 'BBU_5_2.0'],
  },
  momentum: {
    label: 'Momentum',
    columns: ['RSI_14', 'MACD_12_26_9', 'MACDs_12_26_9', 'MACDh_12_26_9', 'STOCHk_14_3_3', 'STOCHd_14_3_3'],
  },
};

export function IndicatorSelector({ catalog, selectedColumns, onSelectionChange, isLoading }: IndicatorSelectorProps) {
  const [open, setOpen] = useState(false);

  // All available columns from catalog
  const allColumns = useMemo(() => {
    if (!catalog?.categories) return [];
    return Object.values(catalog.categories).flat();
  }, [catalog]);

  const toggleColumn = (col: string) => {
    if (selectedColumns.includes(col)) {
      onSelectionChange(selectedColumns.filter(c => c !== col));
    } else {
      onSelectionChange([...selectedColumns, col]);
    }
  };

  const applyPreset = (presetKey: string) => {
    const preset = PRESETS[presetKey];
    if (!preset) return;
    // Filter to only columns that actually exist in the catalog
    const validCols = preset.columns.filter(c => allColumns.includes(c));
    // Merge with existing selection (don't replace)
    const merged = Array.from(new Set([...selectedColumns, ...validCols]));
    onSelectionChange(merged);
  };

  const clearAll = () => onSelectionChange([]);

  const selectedCount = selectedColumns.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs font-mono border-white/10 bg-black/30 gap-1.5"
          disabled={!catalog}
        >
          <Activity className="h-3 w-3" />
          Indicators
          {selectedCount > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px] font-mono">
              {selectedCount}
            </Badge>
          )}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search indicators..." className="h-8 text-xs" />

          {/* Presets row */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/5">
            <span className="text-[10px] text-muted-foreground mr-1">Quick:</span>
            {Object.entries(PRESETS).map(([key, preset]) => (
              <Button
                key={key}
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[10px]"
                onClick={() => applyPreset(key)}
              >
                {preset.label}
              </Button>
            ))}
            {selectedCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[10px] text-red-400 ml-auto"
                onClick={clearAll}
              >
                <X className="h-3 w-3 mr-0.5" />
                Clear
              </Button>
            )}
          </div>

          <CommandList>
            <ScrollArea className="h-[300px]">
              <CommandEmpty>No indicator found.</CommandEmpty>
              {catalog?.categories && Object.entries(catalog.categories)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([category, columns]) => (
                  <CommandGroup
                    key={category}
                    heading={
                      <span className="flex items-center gap-1.5">
                        {CATEGORY_LABELS[category] || category}
                        <Badge variant="outline" className="h-4 px-1 text-[9px] font-mono">
                          {columns.filter(c => selectedColumns.includes(c)).length}/{columns.length}
                        </Badge>
                      </span>
                    }
                  >
                    {columns.sort().map((col) => {
                      const isSelected = selectedColumns.includes(col);
                      return (
                        <CommandItem
                          key={col}
                          value={col}
                          onSelect={() => toggleColumn(col)}
                          className="text-xs py-1 cursor-pointer"
                        >
                          <Checkbox
                            checked={isSelected}
                            className="mr-2 h-3.5 w-3.5"
                            onCheckedChange={() => toggleColumn(col)}
                          />
                          <span className={`font-mono text-[11px] ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {col}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ))}
            </ScrollArea>
          </CommandList>
        </Command>

        {/* Footer with selection summary */}
        {selectedCount > 0 && (
          <div className="border-t border-white/5 px-2 py-1.5">
            <div className="flex flex-wrap gap-1">
              {selectedColumns.slice(0, 8).map(col => (
                <Badge
                  key={col}
                  variant="secondary"
                  className="h-4 px-1.5 text-[9px] font-mono cursor-pointer hover:bg-destructive/20"
                  onClick={() => toggleColumn(col)}
                >
                  {col}
                  <X className="h-2.5 w-2.5 ml-0.5" />
                </Badge>
              ))}
              {selectedCount > 8 && (
                <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                  +{selectedCount - 8} more
                </Badge>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
