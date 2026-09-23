import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { Checkbox } from '@/shared/ui/checkbox';
import {
  CANDLE_PATTERNS,
  ALL_CANDLE_PATTERN_COLUMNS,
  SINGLE_CANDLE_PATTERN_COLUMNS,
  isCandlePatternColumn,
} from '@/market/lib/candlePatternCatalog';

/**
 * One "Candle patterns" group, replacing the old "Patterns" and "TA-Lib
 * patterns" sections.
 *
 * Those two listed the same 51 names twice from different implementations. This
 * shows one row per pattern and labels its source, so the choice is which
 * pattern to draw rather than which of two near-identical menus to trust. See
 * candlePatternCatalog.ts for how a source is picked.
 */

interface CandlePatternSelectorProps {
  selectedPatterns: string[];
  onSelectionChange: (columns: string[]) => void;
  searchFilter: string;
  /** Firings the lake returned for the current view, for the readout. */
  firingCount?: number;
  /** Lake error, surfaced rather than swallowed. */
  error?: string | null;
}

export function CandlePatternSelector({
  selectedPatterns,
  onSelectionChange,
  searchFilter,
  firingCount,
  error,
}: CandlePatternSelectorProps) {
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    if (!searchFilter) return CANDLE_PATTERNS;
    const query = searchFilter.toLowerCase();
    return CANDLE_PATTERNS.filter(
      pattern =>
        pattern.displayName.toLowerCase().includes(query) ||
        pattern.column.toLowerCase().includes(query),
    );
  }, [searchFilter]);

  const selectedSet = useMemo(
    () => new Set(selectedPatterns.filter(isCandlePatternColumn)),
    [selectedPatterns],
  );

  const isExpanded = searchFilter ? filtered.length > 0 : expanded;
  if (searchFilter && filtered.length === 0) return null;

  const toggle = (column: string) => {
    onSelectionChange(
      selectedPatterns.includes(column)
        ? selectedPatterns.filter(c => c !== column)
        : [...selectedPatterns, column],
    );
  };

  /** Keep anything that is not a candle pattern, then apply the new set. */
  const replacePatterns = (columns: string[]) => {
    const others = selectedPatterns.filter(c => !isCandlePatternColumn(c));
    onSelectionChange([...others, ...columns]);
  };

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
          Candle patterns
        </span>
        {typeof firingCount === 'number' && firingCount > 0 && (
          <span className="text-[9px] text-zinc-600 font-mono">
            {firingCount.toLocaleString()} firings
          </span>
        )}
        <Badge variant="outline" className="h-4 px-1 text-[9px] font-mono ml-auto">
          {selectedSet.size > 0 ? `${selectedSet.size}/` : ''}
          {filtered.length}
        </Badge>
      </button>

      {isExpanded && (
        <div className="ml-2">
          <div className="flex items-center gap-2 px-2 py-1">
            <button
              onClick={() => replacePatterns(ALL_CANDLE_PATTERN_COLUMNS)}
              className="text-[9px] font-mono text-[#E69F00] hover:underline"
            >
              all {ALL_CANDLE_PATTERN_COLUMNS.length}
            </button>
            <button
              onClick={() => replacePatterns(SINGLE_CANDLE_PATTERN_COLUMNS)}
              className="text-[9px] font-mono text-[#56B4E9] hover:underline"
            >
              the {SINGLE_CANDLE_PATTERN_COLUMNS.length} individual
            </button>
            {selectedSet.size > 0 && (
              <button
                onClick={() => replacePatterns([])}
                className="text-[9px] font-mono text-zinc-500 hover:underline ml-auto"
              >
                clear
              </button>
            )}
          </div>

          {error && (
            <div className="px-2 py-1 text-[9px] font-mono text-[#D55E00]">{error}</div>
          )}

          {filtered.map(pattern => (
            <label
              key={pattern.column}
              className="flex items-center gap-2 px-2 py-0.5 hover:bg-white/[0.03] cursor-pointer"
            >
              <Checkbox
                checked={selectedSet.has(pattern.column)}
                onCheckedChange={() => toggle(pattern.column)}
                className="h-3 w-3"
              />
              <span className="text-[11px] text-zinc-300 truncate">{pattern.displayName}</span>
              <span
                className="text-[8px] font-mono text-zinc-600 ml-auto shrink-0"
                title={
                  pattern.source === 'lake'
                    ? "TA-Lib's own output, stored per bar in the lake"
                    : 'Computed in the browser from the bars on screen'
                }
              >
                {pattern.source}
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
