import React from 'react';
import { Layers, Settings, Activity } from 'lucide-react';
import type { ModelSummary } from '@/store/telemetryStore';

interface ModelSummaryPanelProps {
  modelSummary: ModelSummary | null;
}

export function ModelSummaryPanel({ modelSummary }: ModelSummaryPanelProps) {
  if (!modelSummary) {
    return (
      <div className="h-full bg-[#111] border border-neutral-800 rounded flex flex-col items-center justify-center text-neutral-500 shadow-sm">
        <Activity className="w-8 h-8 mb-4 opacity-20" />
        <span className="font-mono text-sm">WAITING FOR RUN METADATA...</span>
      </div>
    );
  }

  const { architecture, hyperparameters, environment } = modelSummary;

  return (
    <div className="h-full bg-[#111] border border-neutral-800 rounded flex flex-col shadow-sm overflow-hidden text-sm">
      <div className="px-4 py-3 border-b border-neutral-800 flex items-center gap-2 bg-[#151515]">
        <Layers className="w-4 h-4 text-(--color-accent)" />
        <h2 className="font-bold text-neutral-200 tracking-wide">PPO Metadata</h2>
      </div>

      <div className="p-4 flex-grow overflow-y-auto space-y-6">
        
        {/* Environment / Observation Space */}
        <div>
          <h3 className="text-xs font-bold text-neutral-500 mb-2 uppercase tracking-wider flex items-center gap-2">
            Observation Space
          </h3>
          <div className="flex flex-wrap gap-2">
            {environment?.observation_space?.map((feat: string) => (
              <span key={feat} className="px-2 py-1 bg-[hsl(var(--accent)/0.12)] text-(--color-accent) border border-[hsl(var(--accent)/0.35)] rounded text-xs font-mono">
                {feat}
              </span>
            ))}
          </div>
        </div>

        {/* Hyperparameters */}
        <div>
          <h3 className="text-xs font-bold text-neutral-500 mb-2 uppercase tracking-wider flex items-center gap-2">
            <Settings className="w-3 h-3" /> Hyperparameters
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(hyperparameters || {}).map(([key, val]) => (
              <div key={key} className="flex justify-between items-center bg-[#1a1a1a] px-2 py-1.5 rounded border border-neutral-800">
                <span className="text-neutral-400 text-xs">{key}</span>
                <span className="text-(--color-accent) font-mono text-xs">{String(val)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Architecture */}
        <div>
          <h3 className="text-xs font-bold text-neutral-500 mb-2 uppercase tracking-wider">
            Architecture
          </h3>
          <div className="space-y-2">
            <div className="bg-[#1a1a1a] p-2 rounded border border-neutral-800">
              <span className="text-neutral-400 text-xs block mb-1">Actor (Policy)</span>
              <span className="text-neutral-200 font-mono text-xs">
                {architecture?.actor_hidden_dims?.join(' → ')} ({architecture?.activation})
              </span>
            </div>
            <div className="bg-[#1a1a1a] p-2 rounded border border-neutral-800">
              <span className="text-neutral-400 text-xs block mb-1">Critic (Value)</span>
              <span className="text-neutral-200 font-mono text-xs">
                {architecture?.critic_hidden_dims?.join(' → ')} ({architecture?.activation})
              </span>
            </div>
          </div>
        </div>
        
      </div>
    </div>
  );
}
