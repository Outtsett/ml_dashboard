/**
 * Professional Indicator Selector — mirrors TradingView/NinjaTrader UX.
 *
 * Shows a searchable catalog of configurable indicators grouped by category.
 * Users add indicators with default params, then edit params inline.
 * Each instance is independently configurable and removable.
 */

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/shared/ui/button';
import { Badge } from '@/shared/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import { ScrollArea } from '@/shared/ui/scroll-area';
import {
  Activity, ChevronsUpDown, X, Search,
} from 'lucide-react';
import {
  CATEGORY_ORDER,
} from "@/market/lib/indicator_registry";
import type { ActiveIndicator } from "@/market/lib/useActiveIndicators";
import { getPatternDisplayName } from "@/market/lib/candle_patterns";

// Sub-components
import { ActiveIndicatorList } from '@/market/components/ActiveIndicatorList';
import { IndicatorSearch } from '@/market/components/IndicatorSearch';
import { CandlePatternSelector } from '@/market/components/CandlePatternSelector';

// ─── Props ───────────────────────────────────────────────────────────────────

interface IndicatorSelectorProps {
  /** Active indicator instances */
  activeIndicators: ActiveIndicator[];
  /** Add a new indicator by registry id */
  onAddIndicator: (indicatorId: string) => void;
  /** Remove an indicator instance */
  onRemoveIndicator: (instanceId: string) => void;
  /** Update params for an instance */
  onUpdateParams: (instanceId: string, params: Record<string, number>) => void;
  /** Toggle visibility of an instance */
  onToggleVisibility: (instanceId: string) => void;
  /** Clear all indicators */
  onClearAll: () => void;
  /** Selected CDL pattern columns */
  selectedPatterns: string[];
  /** Callback for CDL pattern selection changes */
  onPatternSelectionChange: (columns: string[]) => void;
  /** Firings currently drawn from the lake, for the TA-Lib group's readout. */
  talibFiringCount?: number;
  /** Why the lake could not answer, shown rather than swallowed. */
  talibError?: string | null;
  isLoading?: boolean;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function IndicatorSelector({
  activeIndicators,
  onAddIndicator,
  onRemoveIndicator,
  onUpdateParams,
  onToggleVisibility,
  onClearAll,
  selectedPatterns,
  onPatternSelectionChange,
  talibFiringCount,
  talibError,
}: IndicatorSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Focus search when popover opens
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      setSearch('');
      setEditingId(null);
    }
  }, [open]);

  const activeCount = activeIndicators.length + selectedPatterns.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs font-mono border-white/10 bg-black/30 gap-1.5"
        >
          <Activity className="h-3 w-3" />
          Indicators
          {activeCount > 0 && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px] font-mono">
              {activeCount}
            </Badge>
          )}
          <ChevronsUpDown className="h-3 w-3 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-0" align="start">
        {/* Search */}
        <div className="flex items-center gap-2 px-2 py-1.5 border-b border-white/5">
          <Search className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
          <input
            ref={searchRef}
            type="text"
            placeholder="Search indicators..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none font-mono"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <ScrollArea className="max-h-[420px]">
          {/* Active Indicators */}
          {activeIndicators.length > 0 && !search && (
            <ActiveIndicatorList
              activeIndicators={activeIndicators}
              editingId={editingId}
              setEditingId={setEditingId}
              onRemoveIndicator={onRemoveIndicator}
              onToggleVisibility={onToggleVisibility}
              onUpdateParams={onUpdateParams}
              onClearAll={onClearAll}
            />
          )}

          {/* Catalog */}
          <div className="py-1">
            <IndicatorSearch
              searchFilter={search}
              categoryOrder={CATEGORY_ORDER}
              onAddIndicator={onAddIndicator}
            />

            {/* One list: the browser detectors and the lake's TA-Lib firings
                deduplicated to a single row per pattern. */}
            <CandlePatternSelector
              selectedPatterns={selectedPatterns}
              onSelectionChange={onPatternSelectionChange}
              searchFilter={search}
              firingCount={talibFiringCount}
              error={talibError}
            />
          </div>
        </ScrollArea>

        {/* Footer: selected patterns summary */}
        {selectedPatterns.length > 0 && !search && (
          <div className="border-t border-white/5 px-2 py-1.5">
            <div className="flex flex-wrap gap-1">
              {selectedPatterns.slice(0, 6).map(col => (
                <Badge
                  key={col}
                  variant="secondary"
                  className="h-4 px-1.5 text-[9px] font-mono cursor-pointer hover:bg-destructive/20"
                  onClick={() =>
                    onPatternSelectionChange(selectedPatterns.filter(c => c !== col))
                  }
                >
                  {getPatternDisplayName(col)}
                  <X className="h-2.5 w-2.5 ml-0.5" />
                </Badge>
              ))}
              {selectedPatterns.length > 6 && (
                <Badge variant="outline" className="h-4 px-1.5 text-[9px]">
                  +{selectedPatterns.length - 6} more
                </Badge>
              )}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
