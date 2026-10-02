/** Toggle buttons for which measured columns get a panel (the notebook's multiselect). */

import { PANEL_COLUMNS, type PanelColumn } from "@shared/studies/timescaledb-load-monitor";

export function ColumnPicker({ selected, onChange }: { selected: readonly PanelColumn[]; onChange: (next: PanelColumn[]) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500">Columns to draw</span>
      <div className="flex flex-wrap gap-1">
        {PANEL_COLUMNS.map((column) => {
          const on = selected.includes(column.key);
          return (
            <button
              key={column.key}
              type="button"
              aria-pressed={on}
              title={column.label}
              onClick={() => onChange(on ? selected.filter((key) => key !== column.key) : PANEL_COLUMNS.map((c) => c.key).filter((key) => key === column.key || selected.includes(key)))}
              className={`rounded border px-2 py-1 text-[11px] font-mono ${on ? "border-neutral-500 bg-neutral-700 text-neutral-50" : "border-neutral-700 text-neutral-400 hover:bg-neutral-800"}`}
            >
              {on ? "✓ " : ""}
              {column.key}
            </button>
          );
        })}
      </div>
    </div>
  );
}
