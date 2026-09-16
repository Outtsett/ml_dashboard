import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { Checkbox } from '@/shared/ui/checkbox';
import {
  TALIB_PATTERN_CATALOG,
  TALIB_SINGLE_CANDLE_PATTERNS,
  type TalibPatternEntry,
} from '@/market/lib/talibPatternCatalog';
import {
  isTalibPatternColumn,
  talibPatternColumn,
  talibPatternName,
} from '@/market/lib/useTalibPatternOverlays';

/**
 * TA-Lib's own pattern firings, read from the lake.
 *
 * Kept separate from the `Patterns` group above it on purpose. That group runs 60
 * TypeScript rewrites over the bars currently on screen; this one draws what the
 * C library actually emitted, stored per bar. They share names and disagree on
 * bars, so mixing them into one list would make a disagreement look like a bug.
 *
 * Grouped by how many candles the rule reads, because that is the distinction the
 * name hides: only 13 of the 61 are individual, single-candle patterns, and
 * hammer is not one of them.
 */

interface TalibPatternSelectorProps {
  selectedPatterns: string[];
  onSelectionChange: (columns: string[]) => void;
  searchFilter: string;
  /** Firings currently drawn, so an empty chart reads as empty rather than broken. */
  firingCount?: number;
  error?: string | null;
}

const GROUP_LABEL: Record<number, string> = {
  1: '1 candle — individual patterns',
  2: '2 candles',
  3: '3 candles',
  4: '4 candles',
  5: '5 candles',
};

export function TalibPatternSelector({
  selectedPatterns,
  onSelectionChange,
  searchFilter,
  firingCount,
  error,
}: TalibPatternSelectorProps) {
  const [expanded, setExpanded] = useState(false);

  const filtered = useMemo(() => {
    if (!searchFilter) return TALIB_PATTERN_CATALOG;
    const q = searchFilter.toLowerCase();
    return TALIB_PATTERN_CATALOG.filter(
      p =>
        p.name.includes(q) ||
        p.displayName.toLowerCase().includes(q) ||
        p.talibFunction.toLowerCase().includes(q),
    );
  }, [searchFilter]);

  const grouped = useMemo(() => {
    const byLength = new Map<number, TalibPatternEntry[]>();
    for (const entry of filtered) {
      const bucket = byLength.get(entry.candleCount) ?? [];
      bucket.push(entry);
      byLength.set(entry.candleCount, bucket);
    }
    return [...byLength.entries()].sort((a, b) => a[0] - b[0]);
  }, [filtered]);

  const isExpanded = searchFilter ? filtered.length > 0 : expanded;
  if (searchFilter && filtered.length === 0) return null;

  const selectedNames = new Set(
    selectedPatterns.filter(isTalibPatternColumn).map(talibPatternName),
  );

  const toggle = (name: string) => {
    const column = talibPatternColumn(name);
    onSelectionChange(
      selectedPatterns.includes(column)
        ? selectedPatterns.filter(c => c !== column)
        : [...selectedPatterns, column],
    );
  };

  const selectSingleCandle = () => {
    const others = selectedPatterns.filter(c => !isTalibPatternColumn(c));
    onSelectionChange([...others, ...TALIB_SINGLE_CANDLE_PATTERNS.map(talibPatternColumn)]);
  };

  const clearAll = () => {
    onSelectionChange(selectedPatterns.filter(c => !isTalibPatternColumn(c)));
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
          TA-Lib patterns
        </span>
        <span className="text-[9px] text-zinc-600 font-mono">lake</span>
        <Badge variant="outline" className="h-4 px-1 text-[9px] font-mono ml-auto">
          {selectedNames.size > 0 ? `${selectedNames.size}/` : ''}{filtered.length}
        </Badge>
      </button>

      {isExpanded && (
        <div className="ml-2">
          <div className="flex items-center gap-2 px-2 py-1">
            <button
              onClick={selectSingleCandle}
              className="text-[9px] font-mono text-[#E69F00] hover:underline"
            >
              the 13 individual
            </button>
            {selectedNames.size > 0 && (
              <button
                onClick={clearAll}
                className="text-[9px] font-mono text-zinc-500 hover:underline"
              >
                clear
              </button>
            )}
            {error ? (
              <span className="text-[9px] font-mono text-[#D55E00] ml-auto truncate" title={error}>
                lake unavailable
              </span>
            ) : selectedNames.size > 0 && firingCount !== undefined ? (
              <span className="text-[9px] font-mono text-zinc-500 ml-auto">
                {firingCount.toLocaleString()} firings
              </span>
            ) : null}
          </div>

          <div className="max-h-[220px] overflow-y-auto">
            {grouped.map(([candleCount, entries]) => (
              <div key={candleCount}>
                <div className="px-2 pt-1.5 pb-0.5 text-[9px] font-mono text-zinc-600 uppercase tracking-wider">
                  {GROUP_LABEL[candleCount] ?? `${candleCount} candles`}
                  <span className="ml-1 text-zinc-700">({entries.length})</span>
                </div>
                {entries.map(entry => {
                  const isSelected = selectedNames.has(entry.name);
                  return (
                    <button
                      key={entry.name}
                      onClick={() => toggle(entry.name)}
                      title={`${entry.talibFunction} · ${entry.patternType} · reads ${entry.candleCount} candle${entry.candleCount === 1 ? '' : 's'}`}
                      className="flex items-center gap-1.5 w-full px-2 py-0.5 text-left hover:bg-white/[0.03] transition-colors"
                    >
                      <Checkbox
                        checked={isSelected}
                        className="h-3 w-3"
                        onCheckedChange={() => toggle(entry.name)}
                      />
                      <span
                        className={`text-[10px] font-mono ${isSelected ? 'text-zinc-200' : 'text-zinc-500'}`}
                      >
                        {entry.displayName}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
