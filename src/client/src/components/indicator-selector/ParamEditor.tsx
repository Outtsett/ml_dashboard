import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getIndicatorDefinition } from '@/lib/indicator_registry';
import type { ActiveIndicator } from '@/hooks/useActiveIndicators';

interface ParamEditorProps {
  indicator: ActiveIndicator;
  onUpdate: (instanceId: string, params: Record<string, number>) => void;
  onClose: () => void;
}

export function ParamEditor({
  indicator,
  onUpdate,
  onClose,
}: ParamEditorProps) {
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
