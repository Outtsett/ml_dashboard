/**
 * VirtualList — Reusable virtualized list wrapper for react-window v2.
 *
 * Handles auto-sizing, consistent styling, and empty state rendering.
 *
 * Use when a list exceeds ~200 items. Below that threshold, native DOM
 * rendering with CSS overflow-auto is more efficient than measurement overhead.
 *
 * Usage:
 *   <VirtualList
 *     items={data}
 *     itemHeight={48}
 *     renderItem={({ item, index, style }) => (
 *       <div style={style}>{item.name}</div>
 *     )}
 *     emptyMessage="No items"
 *   />
 */

import { type CSSProperties, type ReactElement, type ReactNode } from 'react';
import { List } from 'react-window';

interface VirtualListProps<T> {
  /** Array of items to render */
  items: T[];
  /** Fixed height of each item in pixels */
  itemHeight: number;
  /** Render function for each item. Must apply `style` to the outermost element. */
  renderItem: (props: { item: T; index: number; style: CSSProperties }) => ReactElement | null;
  /** Optional empty state message */
  emptyMessage?: string;
  /** Optional empty state component */
  emptyComponent?: ReactNode;
  /** Optional className for the outer container */
  className?: string;
  /** Number of items to over-render above/below the visible area (default: 5) */
  overscanCount?: number;
  /** Optional explicit height (defaults to 400px, auto-sizes via CSS) */
  height?: number;
}

interface RowProps<T> {
  items: T[];
  renderItem: (props: { item: T; index: number; style: CSSProperties }) => ReactElement | null;
}

function Row<T>({
  index,
  style,
  items,
  renderItem,
}: {
  index: number;
  style: CSSProperties;
  ariaAttributes: Record<string, unknown>;
  items: T[];
  renderItem: (props: { item: T; index: number; style: CSSProperties }) => ReactElement | null;
}) {
  const item = items[index]!;
  return renderItem({ item, index, style });
}

export function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  emptyMessage,
  emptyComponent,
  className = '',
  overscanCount = 5,
  height = 400,
}: VirtualListProps<T>) {
  if (items.length === 0) {
    if (emptyComponent) return <>{emptyComponent}</>;
    if (emptyMessage) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground text-sm py-8">
          {emptyMessage}
        </div>
      );
    }
    return null;
  }

  return (
    <div className={`flex-1 min-h-0 ${className}`} style={{ height }}>
      <List<RowProps<T>>
        rowCount={items.length}
        rowHeight={itemHeight}
        overscanCount={overscanCount}
        style={{ height: '100%' }}
        rowComponent={Row}
        rowProps={{ items, renderItem }}
      />
    </div>
  );
}
