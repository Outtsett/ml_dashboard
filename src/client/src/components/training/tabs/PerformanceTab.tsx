import { memo } from "react";
import { useTrainingControl } from "@/contexts/TrainingContext";
import { QualityGatePanel } from "../analytics/QualityGatePanel";
import { PerformanceTimeSeries } from "../analytics/PerformanceTimeSeries";
import { RegimeProfileCards } from "../analytics/RegimeProfileCards";
import { ReturnDistributions } from "../analytics/ReturnDistributions";
import { ClassificationPerformance } from "../analytics/ClassificationPerformance";

export interface PerformanceTabProps {
  diagnostics: Record<string, any> | null;
  activeModelId: string | null;
}

function PerformanceTabInner({ diagnostics, activeModelId }: PerformanceTabProps) {
  const { selectedModelType, availableModels } = useTrainingControl();
  
  const modelDef = availableModels[selectedModelType];
  const isPredictor = modelDef?.subcategory === 'classification' || selectedModelType.includes('transformer') || selectedModelType.includes('discovery');

  return (
    <div className="space-y-8 p-8 max-w-[1600px] mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* 1. Universal Quality Gates */}
      <QualityGatePanel diagnostics={diagnostics} />

      {/* 2. Adaptive Content */}
      {isPredictor ? (
        <ClassificationPerformance diagnostics={diagnostics} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PerformanceTimeSeries />
          <div className="space-y-6">
            <RegimeProfileCards />
            <ReturnDistributions />
          </div>
        </div>
      )}
    </div>
  );
}

export const PerformanceTab = memo(PerformanceTabInner);
export default PerformanceTab;
