/**
 * CNNArchitectureViz — Visual representation of the 1D CNN architecture.
 *
 * Think of it as: A cross-section of your neural network, showing how your
 * 60-bar × 31-feature data window gets squeezed and transformed at each layer
 * until it becomes a simple 3-way vote: Up, Neutral, or Down.
 *
 * Each colored block represents a processing stage. The block heights shrink
 * to show how the "time" dimension compresses (60 → 30 → 15 → 7 → 1)
 * while the "feature" dimension expands (31 → 64 → 128 → 256).
 *
 * Think of it as:
 *   Conv Block 1 = a small magnifying glass (k=3) scanning 3 bars at a time
 *   Conv Block 2 = a wider lens (k=5) catching 5-bar patterns
 *   Conv Block 3 = another small lens refining what it found
 *   GAP = averaging everything into a single summary
 *   Dense = a trader's brain distilling that summary into a decision
 *   Output = the final call: Buy / Hold / Sell
 */

import { ArrowRight } from 'lucide-react';

interface CNNArchitectureVizProps {
  sequenceLength?: number;
  numFeatures?: number;
  filters?: number[];
  kernelSizes?: number[];
  dropoutRate?: number;
  numClasses?: number;
}

interface LayerStage {
  name: string;
  shape: string;
  seqLen: number;
  type: 'input' | 'conv' | 'gap' | 'dense' | 'output';
  detail?: string;
  analogy?: string;
}

export default function CNNArchitectureViz({
  sequenceLength = 60,
  numFeatures = 31,
  filters = [64, 128, 256],
  kernelSizes = [3, 5, 3],
  dropoutRate = 0.3,
  numClasses = 3,
}: CNNArchitectureVizProps) {
  // Build layer stages dynamically from config
  const stages: LayerStage[] = [];
  let seq = sequenceLength;

  stages.push({
    name: 'Input',
    shape: `${seq}×${numFeatures}`,
    seqLen: seq,
    type: 'input',
    detail: `${seq} bars · ${numFeatures} features`,
    analogy: 'Your raw chart window',
  });

  const analogies = [
    'Small lens scanning 3-bar patterns',
    'Wider lens catching 5-bar moves',
    'Refining with a 3-bar detail pass',
  ];

  for (let i = 0; i < filters.length; i++) {
    seq = Math.floor(seq / 2);
    stages.push({
      name: `Conv ${i + 1}`,
      shape: `${seq}×${filters[i]}`,
      seqLen: seq,
      type: 'conv',
      detail: `k=${kernelSizes[i]} · Pool÷2 · Drop ${(dropoutRate * 100).toFixed(0)}%`,
      analogy: analogies[i] || `Conv block ${i + 1}`,
    });
  }

  stages.push({
    name: 'GAP',
    shape: `${filters[filters.length - 1]}`,
    seqLen: 1,
    type: 'gap',
    detail: 'Global Average',
    analogy: 'Averaging all patterns found',
  });

  stages.push({
    name: 'Dense',
    shape: '64',
    seqLen: 1,
    type: 'dense',
    detail: `ReLU · Drop ${(dropoutRate * 100).toFixed(0)}%`,
    analogy: "Trader's brain distilling",
  });

  stages.push({
    name: 'Output',
    shape: `${numClasses}`,
    seqLen: 1,
    type: 'output',
    detail: 'Softmax',
    analogy: numClasses === 3 ? 'Up / Neutral / Down' : 'Up / Down',
  });

  // Visual height proportional to sequence dimension — creates the "funnel" effect
  const maxSeq = sequenceLength;
  const getHeight = (s: LayerStage) => {
    if (s.type === 'gap') return 48;
    if (s.type === 'dense') return 40;
    if (s.type === 'output') return 32;
    return Math.max(48, Math.round((s.seqLen / maxSeq) * 160));
  };

  const colors: Record<string, string> = {
    input: 'border-slate-400/40 bg-gradient-to-b from-slate-500/20 to-slate-600/10',
    conv: 'border-violet-400/40 bg-gradient-to-b from-violet-500/20 to-purple-600/10',
    gap: 'border-cyan-400/40 bg-gradient-to-b from-cyan-500/20 to-teal-600/10',
    dense: 'border-emerald-400/40 bg-gradient-to-b from-emerald-500/20 to-green-600/10',
    output: 'border-amber-400/40 bg-gradient-to-b from-amber-500/20 to-orange-600/10',
  };

  const shapeColors: Record<string, string> = {
    input: 'text-slate-200',
    conv: 'text-violet-300',
    gap: 'text-cyan-300',
    dense: 'text-emerald-300',
    output: 'text-amber-300',
  };

  return (
    <div className="flex items-end gap-0.5 justify-center h-full px-2 pb-3 pt-6">
      {stages.map((stage, i) => (
        <div key={stage.name} className="flex items-end gap-0.5">
          <div className="flex flex-col items-center gap-0.5">
            {/* Analogy tooltip */}
            <div className="text-[8px] text-muted-foreground/50 text-center max-w-[70px] leading-tight">
              {stage.analogy}
            </div>
            {/* Layer block — height represents sequence dimension */}
            <div
              className={`flex flex-col items-center justify-center rounded-lg border px-2 transition-all hover:scale-105 ${colors[stage.type]}`}
              style={{ height: getHeight(stage), minWidth: 60 }}
            >
              <div className={`text-xs font-mono font-bold ${shapeColors[stage.type]}`}>
                {stage.shape}
              </div>
              <div className="text-[9px] text-muted-foreground whitespace-nowrap font-medium">
                {stage.name}
              </div>
              {stage.detail && (
                <div className="text-[7px] text-muted-foreground/50 whitespace-nowrap mt-0.5">
                  {stage.detail}
                </div>
              )}
            </div>
          </div>
          {i < stages.length - 1 && (
            <ArrowRight className="h-3 w-3 text-muted-foreground/25 shrink-0 mb-8" />
          )}
        </div>
      ))}
    </div>
  );
}
