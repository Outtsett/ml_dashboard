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

// Sub-components
import { ActiveIndicatorList } from '@/market/components/ActiveIndicatorList';
import { IndicatorSearch } from '@/market/components/IndicatorSearch';

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

  const activeCount = activeIndicators.length;

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

          </div>
        </ScrollArea>

      </PopoverContent>
    </Popover>
  );
}
