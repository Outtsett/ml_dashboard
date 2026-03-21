/**
 * Professional Indicator Selector — mirrors TradingView/NinjaTrader UX.
 *
 * Shows a searchable catalog of configurable indicators grouped by category.
 * Users add indicators with default params, then edit params inline.
 * Each instance is independently configurable and removable.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Activity, ChevronsUpDown, X, Settings, Eye, EyeOff,
  ChevronRight, ChevronDown, Plus, Search,
} from 'lucide-react';
import {
  INDICATOR_REGISTRY, CATEGORY_ORDER, CATEGORY_LABELS,
  getIndicatorDefinition,
  type IndicatorCategory,
} from '@/lib/indicatorRegistry';
import type { ActiveIndicator } from '@/hooks/useActiveIndicators';
import { CANDLE_PATTERN_CATALOG, getPatternDisplayName } from '@/lib/candlePatterns';

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
  isLoading?: boolean;
}

// ─── Param Editor ────────────────────────────────────────────────────────────

function ParamEditor({
  indicator,
  onUpdate,
  onClose,
}: {
  indicator: ActiveIndicator;
  onUpdate: (instanceId: string, params: Record<string, number>) => void;
  onClose: () => void;
}) {
  const def = getIndicatorDefinition(indicator.indicatorId);
  if (!def) return null;

  const [localParams, setLocalParams] = useState<Record<string, number>>({ ...indicator.params });

  const handleApply = () => {
    onUpdate(indicator.instanceId, localParams);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleApply();
    }
  };

  return (
    <div className="bg-zinc-900 border border-white/10 rounded-md p-3 space-y-2.5 mx-1 mb-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-200">
          {def.name} Settings
        </span>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {def.params.map(param => (
        <div key={param.key} className="flex items-center gap-2">
          <label className="text-[11px] text-zinc-400 w-16 shrink-0 font-mono">
            {param.label}
          </label>
          <Input
            type="number"
            min={param.min}
            max={param.max}
            step={param.step}
            value={localParams[param.key] ?? param.default}
            onChange={e => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val) && val >= param.min && val <= param.max) {
                setLocalParams(prev => ({ ...prev, [param.key]: val }));
              }
            }}
            onKeyDown={handleKeyDown}
            className="h-6 text-[11px] font-mono bg-zinc-800 border-white/10 w-20"
          />
          <span className="text-[9px] text-zinc-600 font-mono">
            {param.min}-{param.max}
          </span>
        </div>
      ))}
      <Button
        size="sm"
        className="h-6 w-full text-[11px] font-mono bg-primary/20 hover:bg-primary/30 text-primary"
        onClick={handleApply}
      >
        Apply
      </Button>
    </div>
  );
}

// ─── Format params for display ───────────────────────────────────────────────

function formatParams(indicator: ActiveIndicator): string {
  const def = getIndicatorDefinition(indicator.indicatorId);
  if (!def || def.params.length === 0) return '';
  const vals = def.params.map(p => indicator.params[p.key] ?? p.default);
  return `(${vals.join(',')})`;
}

// ─── Active Indicator Row ────────────────────────────────────────────────────

function ActiveIndicatorRow({
  indicator,
  isEditing,
  onEdit,
  onRemove,
  onToggleVisibility,
  onUpdateParams,
}: {
  indicator: ActiveIndicator;
  isEditing: boolean;
  onEdit: (instanceId: string | null) => void;
  onRemove: (instanceId: string) => void;
  onToggleVisibility: (instanceId: string) => void;
  onUpdateParams: (instanceId: string, params: Record<string, number>) => void;
}) {
  const def = getIndicatorDefinition(indicator.indicatorId);
  if (!def) return null;

  const hasParams = def.params.length > 0;
  const paramStr = formatParams(indicator);

  return (
    <div>
      <div className="flex items-center gap-1 px-2 py-1 hover:bg-white/[0.03] group">
        <span
          className={`flex-1 text-[11px] font-mono truncate ${
            indicator.visible ? 'text-zinc-200' : 'text-zinc-600'
          }`}
        >
          {def.name}
          {paramStr && (
            <span className="text-zinc-500 ml-0.5">{paramStr}</span>
          )}
        </span>
        <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
          {hasParams && (
            <button
              onClick={() => onEdit(isEditing ? null : indicator.instanceId)}
              className={`p-0.5 rounded hover:bg-white/10 transition-colors ${
                isEditing ? 'text-primary' : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title="Settings"
            >
              <Settings className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={() => onToggleVisibility(indicator.instanceId)}
            className="p-0.5 rounded text-zinc-500 hover:text-zinc-300 hover:bg-white/10 transition-colors"
            title={indicator.visible ? 'Hide' : 'Show'}
          >
            {indicator.visible ? (
              <Eye className="h-3 w-3" />
            ) : (
              <EyeOff className="h-3 w-3" />
            )}
          </button>
          <button
            onClick={() => onRemove(indicator.instanceId)}
            className="p-0.5 rounded text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Remove"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
      {isEditing && (
        <ParamEditor
          indicator={indicator}
          onUpdate={onUpdateParams}
          onClose={() => onEdit(null)}
        />
      )}
    </div>
  );
}

// ─── Catalog Category ────────────────────────────────────────────────────────

function CatalogCategory({
  category,
  searchFilter,
  onAdd,
}: {
  category: IndicatorCategory;
  searchFilter: string;
  onAdd: (indicatorId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const indicators = useMemo(() => {
    return INDICATOR_REGISTRY.filter(d => d.category === category);
  }, [category]);

  const filtered = useMemo(() => {
    if (!searchFilter) return indicators;
    const q = searchFilter.toLowerCase();
    return indicators.filter(
      d => d.name.toLowerCase().includes(q) ||
           d.fullName.toLowerCase().includes(q) ||
           d.id.toLowerCase().includes(q),
    );
  }, [indicators, searchFilter]);

  // Auto-expand when search is active and has results
  const isExpanded = searchFilter ? filtered.length > 0 : expanded;

  if (searchFilter && filtered.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-white/[0.03] transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-zinc-500 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-zinc-500 shrink-0" />
        )}
        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
          {CATEGORY_LABELS[category]}
        </span>
        <Badge variant="outline" className="h-4 px-1 text-[9px] font-mono ml-auto">
          {filtered.length}
        </Badge>
      </button>
      {isExpanded && (
        <div className="ml-2">
          {filtered.map(def => (
            <button
              key={def.id}
              onClick={() => onAdd(def.id)}
              className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-primary/5 hover:text-primary transition-colors group"
            >
              <Plus className="h-3 w-3 text-zinc-600 group-hover:text-primary shrink-0 transition-colors" />
              <span className="text-[11px] text-zinc-300 group-hover:text-primary font-mono transition-colors">
                {def.name}
              </span>
              <span className="text-[10px] text-zinc-600 truncate ml-1">
                {def.fullName !== def.name ? def.fullName : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Patterns Section ────────────────────────────────────────────────────────

function PatternsSection({
  selectedPatterns,
  onSelectionChange,
  searchFilter,
}: {
  selectedPatterns: string[];
  onSelectionChange: (columns: string[]) => void;
  searchFilter: string;
}) {
  const [expanded, setExpanded] = useState(false);

  const patternEntries = useMemo(() => {
    return CANDLE_PATTERN_CATALOG.slice().sort((a, b) => a.name.localeCompare(b.name));
  }, []);

  const filtered = useMemo(() => {
    if (!searchFilter) return patternEntries;
    const q = searchFilter.toLowerCase();
    return patternEntries.filter(
      p => p.name.toLowerCase().includes(q) || p.displayName.toLowerCase().includes(q),
    );
  }, [patternEntries, searchFilter]);

  const isExpanded = searchFilter ? filtered.length > 0 : expanded;

  if (searchFilter && filtered.length === 0) return null;

  const togglePattern = (col: string) => {
    if (selectedPatterns.includes(col)) {
      onSelectionChange(selectedPatterns.filter(c => c !== col));
    } else {
      onSelectionChange([...selectedPatterns, col]);
    }
  };

  const patternNames = new Set(patternEntries.map(p => p.name));
  const selectedCount = selectedPatterns.filter(c => patternNames.has(c)).length;

  return (
    <div>
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-left hover:bg-white/[0.03] transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="h-3 w-3 text-zinc-500 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-zinc-500 shrink-0" />
        )}
        <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
          Patterns
        </span>
        <Badge variant="outline" className="h-4 px-1 text-[9px] font-mono ml-auto">
          {selectedCount > 0 ? `${selectedCount}/` : ''}{filtered.length}
        </Badge>
      </button>
      {isExpanded && (
        <div className="ml-2 max-h-[200px] overflow-y-auto">
          {filtered.map(entry => {
            const isSelected = selectedPatterns.includes(entry.name);
            return (
              <button
                key={entry.name}
                onClick={() => togglePattern(entry.name)}
                className="flex items-center gap-1.5 w-full px-2 py-0.5 text-left hover:bg-white/[0.03] transition-colors"
              >
                <Checkbox
                  checked={isSelected}
                  className="h-3 w-3"
                  onCheckedChange={() => togglePattern(entry.name)}
                />
                <span className={`text-[10px] font-mono ${isSelected ? 'text-zinc-200' : 'text-zinc-500'}`}>
                  {entry.displayName}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
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
            <div>
              <div className="flex items-center justify-between px-2 py-1 border-b border-white/5">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Active ({activeIndicators.length})
                </span>
                <button
                  onClick={onClearAll}
                  className="text-[10px] text-red-400/70 hover:text-red-400 font-mono transition-colors"
                >
                  Clear all
                </button>
              </div>
              {activeIndicators.map(ind => (
                <ActiveIndicatorRow
                  key={ind.instanceId}
                  indicator={ind}
                  isEditing={editingId === ind.instanceId}
                  onEdit={setEditingId}
                  onRemove={onRemoveIndicator}
                  onToggleVisibility={onToggleVisibility}
                  onUpdateParams={onUpdateParams}
                />
              ))}
              <div className="border-b border-white/5" />
            </div>
          )}

          {/* Catalog */}
          <div className="py-1">
            {!search && (
              <div className="px-2 py-1">
                <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Catalog
                </span>
              </div>
            )}
            {CATEGORY_ORDER.map(cat => (
              <CatalogCategory
                key={cat}
                category={cat}
                searchFilter={search}
                onAdd={onAddIndicator}
              />
            ))}

            {/* CDL Patterns */}
            <PatternsSection
              selectedPatterns={selectedPatterns}
              onSelectionChange={onPatternSelectionChange}
              searchFilter={search}
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
