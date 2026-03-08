import type { Phase } from "./types";
import { PHASES } from "./types";
import { PhaseAPanel } from "./panels/PhaseAPanel";
import { PhaseBPanel } from "./panels/PhaseBPanel";
import { PhaseCPanel } from "./panels/PhaseCPanel";
import { PhaseDPanel } from "./panels/PhaseDPanel";
import { PhaseEPanel } from "./panels/PhaseEPanel";

const PANEL_MAP: Record<Phase, React.FC> = {
  A: PhaseAPanel,
  B: PhaseBPanel,
  C: PhaseCPanel,
  D: PhaseDPanel,
  E: PhaseEPanel,
};

interface PhasePanelProps {
  phase: Phase;
}

export function PhasePanel({ phase }: PhasePanelProps) {
  const info = PHASES.find((p) => p.id === phase);
  if (!info) {
    return <div className="text-sm text-muted-foreground">Unknown phase: {phase}</div>;
  }

  const Panel = PANEL_MAP[phase];

  return (
    <div>
      <h2 className="text-lg font-mono font-semibold mb-2">
        Phase {info.id}: {info.name}
      </h2>
      <p className="text-sm text-muted-foreground mb-4">{info.description}</p>
      <Panel />
    </div>
  );
}
