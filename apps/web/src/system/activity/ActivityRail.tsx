/**
 * ActivityRail — live view of what the dashboard is doing, docked right.
 *
 * Subscribes to the dashboard's own SSE event bus (pipeline / training /
 * system) so training progress, ingestion, model registry changes and server
 * lifecycle are all readable without leaving the current page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, PanelRightClose, Trash2, ArrowDownToLine } from 'lucide-react';
import { cn } from '@/shared/utils/utils';
import { useActivityFeed } from './useActivityFeed';
import { LEVEL_ORDER, LEVEL_STYLE, type ActivityEntry, type ActivityLevel } from './types';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Compact numeric formatting for the metric strip. */
function formatValue(v: number): string {
  if (Number.isInteger(v)) return String(v);
  if (Math.abs(v) >= 1000) return v.toFixed(0);
  if (Math.abs(v) >= 1) return v.toFixed(3);
  return v.toFixed(5);
}

function Row({ entry }: { entry: ActivityEntry }) {
  const [open, setOpen] = useState(false);
  const style = LEVEL_STYLE[entry.level];
  const hasDetail = entry.detail.length > 0;

  return (
    <div
      className="border-b border-white/[0.04] px-2 py-1 hover:bg-white/[0.03]"
      style={{ borderLeft: `2px solid ${style.color}` }}
    >
      <div className="flex items-start gap-1.5">
        <span className="tnum text-[9px] text-muted-foreground/60 pt-[2px] shrink-0">
          {formatTime(entry.ts)}
        </span>
        {/* Glyph + word, so the level survives with colour ignored entirely. */}
        <span
          className={cn(
            'shrink-0 rounded border px-1 text-[8px] font-bold tracking-wider leading-[14px]',
            style.chip,
          )}
        >
          {style.glyph} {style.label}
        </span>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={hasDetail ? () => setOpen((o) => !o) : undefined}
            className={cn(
              'w-full text-left text-[10px] leading-snug font-mono break-words',
              hasDetail ? 'cursor-pointer hover:text-foreground' : 'cursor-default',
            )}
          >
            {hasDetail && (
              open
                ? <ChevronDown className="inline h-2.5 w-2.5 mr-0.5 -mt-px" />
                : <ChevronRight className="inline h-2.5 w-2.5 mr-0.5 -mt-px" />
            )}
            {entry.message}
            {hasDetail && !open && (
              <span className="ml-1 text-[9px] text-muted-foreground/70">
                +{entry.detail.length} lines
              </span>
            )}
          </button>
          <div className="text-[8px] text-muted-foreground/40 font-mono">{entry.type}</div>
          {open && hasDetail && (
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-black/40 p-1.5 text-[9px] leading-tight text-muted-foreground whitespace-pre-wrap break-words">
              {entry.detail.join('\n')}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

export function ActivityRail({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Only hold SSE connections open while the rail is mounted and visible.
  const { entries, metrics, connected, counts, clear } = useActivityFeed(open);
  const [levels, setLevels] = useState<Set<ActivityLevel>>(new Set(LEVEL_ORDER));
  const [query, setQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const listRef = useRef<HTMLDivElement | null>(null);

  const toggleLevel = useCallback((lvl: ActivityLevel) => {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lvl)) next.delete(lvl); else next.add(lvl);
      return next;
    });
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (!levels.has(e.level)) return false;
      if (!q) return true;
      return e.message.toLowerCase().includes(q) || e.type.toLowerCase().includes(q);
    });
  }, [entries, levels, query]);

  useEffect(() => {
    if (!autoScroll || !listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [filtered, autoScroll]);

  if (!open) return null;

  return (
    // h-screen, not h-full: the parent is `min-h-screen` with no resolved
    // height, so a percentage height collapses to auto (the rail rendered
    // 133px tall). This aside is a direct child of the viewport-height flex
    // row alongside <main className="h-screen">, so 100vh is exact here.
    <aside className="w-[380px] shrink-0 border-l border-white/10 bg-background/95 flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 h-8 border-b border-white/10 shrink-0">
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ background: connected ? '#56B4E9' : '#9CA3AF' }}
          title={connected ? 'Event stream live' : 'Event stream offline'}
        />
        <span className="text-[10px] font-bold uppercase tracking-widest">Activity</span>
        <span className="text-[9px] text-muted-foreground/60 tnum">{entries.length}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => setAutoScroll((a) => !a)}
            title={autoScroll ? 'Auto-scroll on' : 'Auto-scroll off'}
            className={cn(
              'h-5 w-5 flex items-center justify-center rounded hover:bg-white/10',
              autoScroll ? 'text-[#56B4E9]' : 'text-muted-foreground/50',
            )}
          >
            <ArrowDownToLine className="h-3 w-3" />
          </button>
          <button
            onClick={clear}
            title="Clear"
            className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground/60 hover:bg-white/10 hover:text-foreground"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <button
            onClick={onClose}
            title="Close activity rail (Ctrl+Shift+A)"
            className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground/60 hover:bg-white/10 hover:text-foreground"
          >
            <PanelRightClose className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Metric strip — latest value per key */}
      {metrics.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-white/10 shrink-0 max-h-24 overflow-auto">
          {metrics.map((m) => (
            <div
              key={m.key}
              className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 leading-tight"
              title={`${m.key} · ${m.source} · ${formatTime(m.ts)}`}
            >
              <div className="text-[8px] uppercase tracking-wider text-muted-foreground/60">{m.key}</div>
              <div className="text-[10px] font-mono tnum text-foreground">{formatValue(m.value)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Level filters + search */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10 shrink-0">
        {LEVEL_ORDER.map((lvl) => {
          const s = LEVEL_STYLE[lvl];
          const on = levels.has(lvl);
          return (
            <button
              key={lvl}
              onClick={() => toggleLevel(lvl)}
              aria-pressed={on}
              className={cn(
                'rounded border px-1 text-[8px] font-bold tracking-wider leading-[16px] transition-opacity',
                s.chip,
                on ? 'opacity-100' : 'opacity-30',
              )}
              title={`${on ? 'Hide' : 'Show'} ${s.label}`}
            >
              {s.glyph} {s.label} {counts[lvl] ?? 0}
            </button>
          );
        })}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter…"
          className="ml-auto w-24 rounded border border-white/10 bg-black/30 px-1.5 text-[9px] h-[18px] focus:outline-none focus:border-primary/40"
        />
      </div>

      {/* Feed */}
      <div ref={listRef} className="flex-1 min-h-0 overflow-auto">
        {filtered.length === 0 ? (
          <div className="p-3 text-[10px] text-muted-foreground/50">
            {entries.length === 0
              ? connected
                ? 'Connected — waiting for dashboard activity.'
                : 'Connecting to the event stream…'
              : 'No entries match the current filter.'}
          </div>
        ) : (
          filtered.map((e) => <Row key={e.id} entry={e} />)
        )}
      </div>
    </aside>
  );
}
