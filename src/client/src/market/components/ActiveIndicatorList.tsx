import { Settings, Eye, EyeOff, X } from 'lucide-react';
import { getIndicatorDefinition } from "@/market/lib/indicator_registry";
import type { ActiveIndicator } from "@/market/lib/useActiveIndicators";
import { ParamEditor } from './ParamEditor';

function formatParams(indicator: ActiveIndicator): string {
  const def = getIndicatorDefinition(indicator.indicatorId);
  if (!def || def.params.length === 0) return '';
  const vals = def.params.map(p => indicator.params[p.key] ?? p.default);
  return `(${vals.join(',')})`;
}

interface ActiveIndicatorRowProps {
  indicator: ActiveIndicator;
  isEditing: boolean;
  onEdit: (instanceId: string | null) => void;
  onRemove: (instanceId: string) => void;
  onToggleVisibility: (instanceId: string) => void;
  onUpdateParams: (instanceId: string, params: Record<string, number>) => void;
}

function ActiveIndicatorRow({
  indicator,
  isEditing,
  onEdit,
  onRemove,
  onToggleVisibility,
  onUpdateParams,
}: ActiveIndicatorRowProps) {
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

interface ActiveIndicatorListProps {
  activeIndicators: ActiveIndicator[];
  editingId: string | null;
  setEditingId: (instanceId: string | null) => void;
  onRemoveIndicator: (instanceId: string) => void;
  onToggleVisibility: (instanceId: string) => void;
  onUpdateParams: (instanceId: string, params: Record<string, number>) => void;
  onClearAll: () => void;
}

export function ActiveIndicatorList({
  activeIndicators,
  editingId,
  setEditingId,
  onRemoveIndicator,
  onToggleVisibility,
  onUpdateParams,
  onClearAll,
}: ActiveIndicatorListProps) {
  return (
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
  );
}
