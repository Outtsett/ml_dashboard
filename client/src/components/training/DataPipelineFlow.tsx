/**
 * DataPipelineFlow — Visual strip showing the HDP-HMM data journey.
 *
 * Think of it as: An assembly line for regime discovery. Raw OHLCV bars enter
 * on the left, get compressed into 10 "vital signs" features, split chronologically,
 * run through the Gibbs sampler (the hotel that builds rooms on demand), and out
 * come discovered regime assignments on the right.
 */

import { Database, Sigma, Scissors, Flame, Layers, ArrowRight } from 'lucide-react';

interface DataPipelineFlowProps {
  symbol: string;
  timeframe: string;
  numBars?: number;
  numFeatures?: number;
  trainSize?: number;
  testSize?: number;
  isTraining: boolean;
  gibbsIter: number;
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
  symbol,
  timeframe,
  numBars,
  numFeatures = 10,
  trainSize,
  testSize,
  isTraining,
  gibbsIter,
  currentStep,
  totalSteps,
  phase,
  nRegimes,
}: DataPipelineFlowProps) {
  const isGibbs = phase === 'gibbs_sampling';
  const isDone = phase === 'complete' || (nRegimes !== undefined && nRegimes > 0 && !isTraining);

  const steps: PipelineStep[] = [
    {
      icon: Database,
      label: 'Source',
      value: `${symbol} ${timeframe}`,
      detail: numBars ? `${(numBars / 1000).toFixed(1)}K bars` : 'DuckDB OHLCV',
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
      borderColor: 'border-emerald-500/30',
      textColor: 'text-emerald-400',
      pulse: false,
    },
    {
      icon: Flame,
      label: 'Gibbs',
      value: isTraining && currentStep && totalSteps
        ? `Step ${currentStep}/${totalSteps}`
        : isTraining ? `${gibbsIter} iter` : 'Idle',
      detail: isGibbs ? 'sampling...' : isTraining ? phase || 'starting' : 'ready',
      borderColor: isTraining ? 'border-orange-500/40' : 'border-slate-500/30',
      textColor: isTraining ? 'text-orange-400' : 'text-slate-400',
      pulse: isGibbs,
    },
    {
      icon: Layers,
      label: 'Regimes',
      value: isDone && nRegimes ? `${nRegimes} found` : 'auto-K',
      detail: isDone ? 'discovered' : 'nonparametric',
      borderColor: isDone ? 'border-rose-500/40' : 'border-rose-500/20',
      textColor: isDone ? 'text-rose-400' : 'text-rose-300/50',
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
