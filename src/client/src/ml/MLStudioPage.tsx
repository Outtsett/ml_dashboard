/**
 * ML Studio — the research surface, in two tabs.
 *
 *   Pipeline    the 6-stage Data → Features → Labels → Train → Evaluate →
 *               Promote flow (StageStepper + one panel per active stage)
 *   RL Console  the PPO/DQN/Transformer launcher that used to be /rl-console
 *
 * Why two tabs rather than seven stages. The stepper numbers its stages and
 * draws a completion-coloured connector between them, which is visual grammar
 * for "step N feeds step N+1". RL Console reads nothing from Promote and gates
 * nothing after it, so appending it as "Stage 7" would assert a dependency that
 * does not exist in the code. Two tabs say the true thing: one route, two tools.
 *
 * MLStudioProvider sits ABOVE the tabs, not inside the Pipeline panel, so
 * switching to RL Console and back does not unmount the pipeline reducer and
 * lose everything the stages hold that is not persisted to localStorage.
 *
 * The RL panel must stay behind Radix's `TabsContent` — it opens a WebSocket on
 * mount (see `RLConsolePanel.tsx`), and `TabsContent` without `forceMount` does
 * not render an inactive tab's children, so the socket stays closed until the
 * tab is actually selected. A CSS-only `hidden` wrapper would not do that.
 */

import { useState } from "react";
import { BrainCircuit, Bot } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { MLStudioProvider, useMLStudio } from "./MLStudioContext";
import { StageStepper } from "./StageStepper";
import { RLConsolePanel } from "./RLConsolePanel";
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

type StudioTab = "pipeline" | "rl-console";

export default function MLStudioPage() {
  const [tab, setTab] = useState<StudioTab>("pipeline");

  return (
    <MLStudioProvider>
      <div className="h-full flex flex-col w-full px-2 pb-2 gap-2 min-h-0">
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as StudioTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList className="w-fit shrink-0">
            <TabsTrigger value="pipeline" data-testid="tab-pipeline">
              <BrainCircuit className="mr-1.5 h-3.5 w-3.5" />
              Pipeline
            </TabsTrigger>
            <TabsTrigger value="rl-console" data-testid="tab-rl-console">
              <Bot className="mr-1.5 h-3.5 w-3.5" />
              RL Console
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="pipeline"
            className="mt-2 flex min-h-0 flex-1 flex-col gap-2"
          >
            <StageStepper />
            <div className="flex-1 min-h-0 overflow-y-auto">
              <ActiveStage />
            </div>
          </TabsContent>

          <TabsContent value="rl-console" className="mt-2 flex min-h-0 flex-1 flex-col">
            <RLConsolePanel />
          </TabsContent>
        </Tabs>
      </div>
    </MLStudioProvider>
  );
}
