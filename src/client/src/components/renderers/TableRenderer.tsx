/**
 * TableRenderer — Key-value or multi-column table.
 *
 * Value is Record<string, number|string> (key-value mode) or array of records (tabular mode).
 * Sortable columns. Severity coloring on numeric cells. Dark theme styling.
 */

import { useMemo, useState } from 'react';
import type { RendererProps } from '@/lib/diagnostics-schema';
import { getMetricSeverity, SEVERITY_COLORS } from '@/lib/diagnostics-schema';
import { RendererShell, useShellProps } from './RendererShell';
import { cn } from '@/lib/utils';

type CellValue = string | number;
type Row = Record<string, CellValue>;

function parseTableValue(value: RendererProps['metric']['value']): {
  columns: string[];
  rows: Row[];
  isKeyValue: boolean;
} {
  // Array of records
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
    const records = value as unknown as Row[];
    const colSet = new Set<string>();
    for (const rec of records) {
      for (const k of Object.keys(rec)) colSet.add(k);
    }
    return { columns: Array.from(colSet), rows: records, isKeyValue: false };
  }

  // Record<string, number|string> — key-value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, CellValue>;
    const rows: Row[] = Object.entries(obj).map(([k, v]) => ({ key: k, value: v }));
    return { columns: ['key', 'value'], rows, isKeyValue: true };
  }

  return { columns: [], rows: [], isKeyValue: false };
}

export function TableRenderer(props: RendererProps) {
  const { metricKey, mission, compact, context } = useShellProps(props);

  const { columns, rows: parsedRows, isKeyValue } = useMemo(
    () => parseTableValue(props.metric.value),
    [props.metric.value],
  );

  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const rows = useMemo(() => {
    if (!sortCol) return parsedRows;
    return [...parsedRows].sort((a, b) => {
      const av = a[sortCol] ?? '';
      const bv = b[sortCol] ?? '';
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortAsc ? av - bv : bv - av;
      }
      const as = String(av);
      const bs = String(bv);
      return sortAsc ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [parsedRows, sortCol, sortAsc]);

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortAsc(!sortAsc);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
  };

  if (rows.length === 0) {
    return (
      <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
        <div className="flex items-center justify-center h-20 text-zinc-600 text-xs font-mono">
          No table data
        </div>
      </RendererShell>
    );
  }

  const formatCell = (val: CellValue): string => {
    if (typeof val === 'number') {
      return val.toFixed(context.decimals ?? 4);
    }
    return String(val);
  };

  const getCellSeverity = (val: CellValue) => {
    if (typeof val !== 'number') return null;
    if (context.good == null && context.bad == null && context.great == null) return null;
    return getMetricSeverity(val, context);
  };

  const maxVisibleRows = compact ? 6 : 12;

  return (
    <RendererShell metricKey={metricKey} mission={mission} compact={compact} severity="neutral">
      <div className={cn('overflow-auto scrollbar-hidden', compact ? 'max-h-[140px]' : 'max-h-[260px]')}>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              {columns.map(col => (
                <th
                  key={col}
                  onClick={() => handleSort(col)}
                  className={cn(
                    'table-header text-left px-2 py-1.5 border-b border-zinc-800 cursor-pointer select-none',
                    'hover:text-zinc-300 transition-colors',
                    sortCol === col && 'text-cyan-400',
                  )}
                >
                  <span className="flex items-center gap-1">
                    {isKeyValue && col === 'key' ? 'Parameter' : isKeyValue && col === 'value' ? 'Value' : col}
                    {sortCol === col && (
                      <span className="text-[8px]">{sortAsc ? '\u25B2' : '\u25BC'}</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, maxVisibleRows).map((row, i) => (
              <tr key={i} className="table-row hover-highlight transition-colors">
                {columns.map(col => {
                  const val = row[col] ?? '';
                  const sev = getCellSeverity(val);
                  return (
                    <td
                      key={col}
                      className={cn(
                        'px-2 py-1 font-mono',
                        compact ? 'text-[10px]' : 'text-[11px]',
                        typeof val === 'number' ? 'tabular-nums text-right' : 'text-left',
                        isKeyValue && col === 'key' ? 'text-zinc-400 font-medium' : '',
                        sev ? SEVERITY_COLORS[sev] : 'text-zinc-300',
                      )}
                    >
                      {formatCell(val)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > maxVisibleRows && (
          <div className="text-center text-[8px] font-mono text-zinc-600 py-1">
            +{rows.length - maxVisibleRows} more rows
          </div>
        )}
      </div>
    </RendererShell>
  );
}
