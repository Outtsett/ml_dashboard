/**
 * MLStudioPage — the 6-stage Data → Features → Labels → Train → Evaluate →
 * Promote research pipeline (StageStepper + one panel per active stage).
 *
 * This is the intended content of /ml-studio -- the sidebar's own nav entry
 * already describes it this way (navigation.ts: "Data → Features → Labels →
 * Train pipeline"). The route previously rendered a smaller, unrelated PPO/
 * DQN training console instead; that page's real, working functionality was
 * kept and relocated to /rl-console (RLConsolePage.tsx) rather than deleted.
 */

import { MLStudioProvider, useMLStudio } from "./MLStudioContext";
import { StageStepper } from "./StageStepper";
import { DataStage } from "./stages/DataStage";
import { FeaturesStage } from "./stages/FeaturesStage";
import { LabelsStage } from "./stages/LabelsStage";
import { TrainStage } from "./stages/TrainStage";
import { EvaluateStage } from "./stages/EvaluateStage";
import { PromoteStage } from "./stages/PromoteStage";

function ActiveStage() {
  const { state } = useMLStudio();
  switch (state.activeStage) {
    case "data":
      return <DataStage />;
    case "features":
      return <FeaturesStage />;
    case "labels":
      return <LabelsStage />;
    case "train":
      return <TrainStage />;
    case "evaluate":
      return <EvaluateStage />;
    case "promote":
      return <PromoteStage />;
  }
}

export default function MLStudioPage() {
  return (
    <MLStudioProvider>
      <div className="h-full flex flex-col w-full px-2 pb-2 gap-2 min-h-0">
        <StageStepper />
        <div className="flex-1 min-h-0 overflow-y-auto">
          <ActiveStage />
        </div>
      </div>
    </MLStudioProvider>
  );
}
