import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  INDICATOR_REGISTRY, CATEGORY_LABELS,
  type IndicatorCategory,
} from '@/lib/indicator_registry';

const CATEGORY_COLORS: Record<string, string> = {
  overlap: '#3b82f6',     // blue
  momentum: '#a78bfa',    // violet
  trend: '#ef4444',       // red
  volatility: '#f97316',  // orange
  volume: '#06b6d4',      // cyan
  statistics: '#22c55e',  // green
  cycle: '#ec4899',       // pink
  performance: '#10b981', // emerald
};

interface CatalogCategoryProps {
  category: IndicatorCategory;
  searchFilter: string;
  onAdd: (indicatorId: string) => void;
}

function CatalogCategory({
  category,
  searchFilter,
  onAdd,
}: CatalogCategoryProps) {
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
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ backgroundColor: CATEGORY_COLORS[category] || '#6b7280' }}
        />
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
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0 opacity-50 group-hover:opacity-100 transition-opacity"
                style={{ backgroundColor: CATEGORY_COLORS[category] || '#6b7280' }}
              />
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

interface IndicatorSearchProps {
  searchFilter: string;
  categoryOrder: IndicatorCategory[];
  onAddIndicator: (indicatorId: string) => void;
}

export function IndicatorSearch({
  searchFilter,
  categoryOrder,
  onAddIndicator,
}: IndicatorSearchProps) {
  return (
    <div className="py-1">
      {!searchFilter && (
        <div className="px-2 py-1">
          <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
            Catalog
          </span>
        </div>
      )}
      {categoryOrder.map(cat => (
        <CatalogCategory
          key={cat}
          category={cat}
          searchFilter={searchFilter}
          onAdd={onAddIndicator}
        />
      ))}
    </div>
  );
}
