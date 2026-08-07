/**
 * DataPipelineFlow — Visual strip showing the data journey.
 *
 * Source -> Features -> Split -> [Training] -> [Output]
 *
 * The first 3 steps are universal. Steps 4-5 come from the model adapter (OCP).
 */

import { Database, Sigma, Scissors, Flame, Layers, ArrowRight } from 'lucide-react';
import { getAdapter } from './modelAdapters';

interface DataPipelineFlowProps {
  modelType?: string;
  symbol: string;
  timeframe: string;
  numBars?: number;
  numFeatures?: number;
  trainSize?: number;
  testSize?: number;
  isTraining: boolean;
  iterationCount: number;
  currentStep?: number;
  totalSteps?: number;
  phase?: string;
  nRegimes?: number;
}

interface PipelineStep {
  icon: typeof Database;
  label: string;
  value: string;
  detail: string;
  borderColor: string;
  textColor: string;
  pulse: boolean;
}

export default function DataPipelineFlow({
  modelType = 'primitives-discovery',
  symbol,
  timeframe,
  numBars,
  numFeatures = 10,
  trainSize,
  testSize,
  isTraining,
  iterationCount,
  currentStep,
  totalSteps,
  phase,
  nRegimes,
}: DataPipelineFlowProps) {
  const adapter = getAdapter(modelType);
  const isActive = isTraining && adapter.activePhases.includes(phase || '');
  const isDone = phase === 'complete' || (nRegimes !== undefined && nRegimes > 0 && !isTraining);

  // Universal steps (Source, Features, Split) + adapter-driven steps (Training, Output)
  const steps: PipelineStep[] = [
    {
      icon: Database,
      label: 'Source',
      value: `${symbol} ${timeframe}`,
      detail: numBars ? `${(numBars / 1000).toFixed(1)}K bars` : 'QuestDB OHLCV',
      borderColor: 'border-cyan-500/30',
      textColor: 'text-cyan-400',
      pulse: false,
    },
    {
      icon: Sigma,
      label: 'Features',
      value: `${numFeatures} dims`,
      detail: 'returns, range, vol',
      borderColor: 'border-violet-500/30',
      textColor: 'text-violet-400',
      pulse: false,
    },
    {
      icon: Scissors,
      label: 'Split',
      value: trainSize && testSize
        ? `${(trainSize / 1000).toFixed(1)}K / ${(testSize / 1000).toFixed(1)}K`
        : '85 / 15',
      detail: 'train / test',
      borderColor: 'border-[hsl(var(--data-pos)/0.3)]',
      textColor: 'text-[hsl(var(--data-pos))]',
      pulse: false,
    },
    {
      icon: Flame,
      label: adapter.trainingStepLabel,
      value: isTraining && currentStep && totalSteps
        ? `Step ${currentStep}/${totalSteps}`
        : isTraining ? `${iterationCount} iter` : 'Idle',
      detail: isActive ? 'training...' : isTraining ? phase || 'starting' : 'ready',
      borderColor: isTraining ? 'border-orange-500/40' : 'border-slate-500/30',
      textColor: isTraining ? 'text-orange-400' : 'text-slate-400',
      pulse: isActive,
    },
    {
      icon: Layers,
      label: adapter.outputStepLabel,
      value: isDone && nRegimes ? `${nRegimes} found` : adapter.outputDefault,
      detail: isDone ? adapter.outputComplete : adapter.outputDefault,
      borderColor: isDone ? 'border-[hsl(var(--data-neg)/0.4)]' : 'border-[hsl(var(--data-neg)/0.2)]',
      textColor: isDone ? 'text-[hsl(var(--data-neg))]' : 'text-[hsl(var(--data-neg)/0.5)]',
      pulse: false,
    },
  ];

  return (
    <div className="flex items-stretch gap-0 overflow-x-auto">
      {steps.map((step, i) => {
        const Icon = step.icon;
        return (
          <div key={step.label} className="flex items-center shrink-0">
            <div
              className={`flex items-center gap-2 rounded-xl border px-3 py-2 bg-card/40 backdrop-blur-sm transition-all
                ${step.borderColor} ${step.pulse ? 'animate-pulse' : ''}`}
            >
              <Icon className={`h-4 w-4 shrink-0 ${step.textColor}`} />
              <div className="flex flex-col min-w-0">
                <span className="text-[9px] text-muted-foreground uppercase tracking-widest font-medium">
                  {step.label}
                </span>
                <span className={`text-xs font-mono font-bold ${step.textColor} whitespace-nowrap`}>
                  {step.value}
                </span>
                <span className="text-[9px] text-muted-foreground/50 whitespace-nowrap">
                  {step.detail}
                </span>
              </div>
            </div>
            {i < steps.length - 1 && (
              <ArrowRight className="h-3 w-3 text-muted-foreground/20 shrink-0 mx-1" />
            )}
          </div>
        );
      })}
    </div>
  );
}
