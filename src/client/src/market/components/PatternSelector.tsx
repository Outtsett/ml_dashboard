import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/shared/ui/badge';
import { Checkbox } from '@/shared/ui/checkbox';
import { CANDLE_PATTERN_CATALOG } from "@/market/lib/candle_patterns";

interface PatternSelectorProps {
  selectedPatterns: string[];
  onSelectionChange: (columns: string[]) => void;
  searchFilter: string;
}

export function PatternSelector({
  selectedPatterns,
  onSelectionChange,
  searchFilter,
}: PatternSelectorProps) {
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
