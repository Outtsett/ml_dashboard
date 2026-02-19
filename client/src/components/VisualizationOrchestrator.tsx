/**
 * Visualization Orchestrator
 * 
 * Dynamically renders category-specific visualizations based on:
 * - Model subcategory (from mlTaxonomy.ts)
 * - Available data (what metrics/outputs exist)
 * - Training state (idle, training, completed)
 * - Layout schemas (flexible panel arrangements per category)
 * 
 * This is the bridge between raw model data and the visualization components.
 */

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  MODEL_SUBCATEGORIES, 
  LAYOUT_SCHEMAS, 
  DATA_CONTRACTS,
  type ModelSubcategory 
} from '@shared/mlTaxonomy';
import { 
  ForceDirectedCluster,
  EmbeddingScatter,
  AnomalyTimeline,
  ComponentLoadings,
  ConfusionMatrixHeatmap,
  ResidualPlot,
  SimilarityMatrix,
  ForecastRibbon
} from './visualizations';
import { AlertCircle, Database, Layers } from 'lucide-react';

// ============== TYPES ==============

interface ModelData {
  subcategory: ModelSubcategory;
  status: 'idle' | 'training' | 'completed' | 'error';
  
  // Training metrics stream
  lossHistory?: { epoch: number; loss: number; valLoss: number }[];
  currentEpoch?: number;
  totalEpochs?: number;
  
  // Model outputs - populated after training
  predictions?: { predicted: number; actual: number; residual?: number }[];
  embeddings?: { x: number; y: number; label?: number; cluster?: number }[];
  clusterAssignments?: { id: string; cluster: number; features?: number[] }[];
  confusionMatrix?: number[][];
  classLabels?: string[];
  
  // Anomaly detection specific
  anomalyScores?: { timestamp: number | string; value: number; anomalyScore: number; isAnomaly?: boolean }[];
  
  // Dimensionality reduction specific
  componentLoadings?: { feature: string; loadings: number[] }[];
  explainedVariance?: number[];
  
  // Time-series / Sequence specific
  forecasts?: { timestamp: number | string; actual?: number; predicted: number; lower?: number; upper?: number }[];
  
  // Contrastive learning specific
  similarityMatrix?: number[][];
  
  // Computed metrics
  metrics?: Record<string, number>;
}

interface VisualizationOrchestratorProps {
  modelData: ModelData | null;
  width?: number;
  height?: number;
  mode?: 'training' | 'analysis';
}

// ============== DATA AVAILABILITY CHECK ==============

function getAvailableVisualizations(data: ModelData): string[] {
  const available: string[] = [];
  
  if (data.lossHistory && data.lossHistory.length > 0) {
    available.push('loss_curves');
  }
  
  if (data.confusionMatrix && data.confusionMatrix.length > 0) {
    available.push('confusion_matrix');
  }
  
  if (data.predictions && data.predictions.length > 0) {
    available.push('residuals_plot', 'predicted_vs_actual');
  }
  
  if (data.embeddings && data.embeddings.length > 0) {
    available.push('embedding_scatter');
  }
  
  if (data.clusterAssignments && data.clusterAssignments.length > 0) {
    available.push('cluster_graph', 'cluster_scatter');
  }
  
  if (data.anomalyScores && data.anomalyScores.length > 0) {
    available.push('anomaly_timeline');
  }
  
  if (data.componentLoadings && data.componentLoadings.length > 0) {
    available.push('component_loadings');
  }
  
  if (data.forecasts && data.forecasts.length > 0) {
    available.push('forecast_ribbon');
  }
  
  if (data.similarityMatrix && data.similarityMatrix.length > 0) {
    available.push('similarity_matrix');
  }
  
  if (data.metrics && Object.keys(data.metrics).length > 0) {
    available.push('metrics_panel');
  }
  
  return available;
}

// ============== PANEL RENDERERS ==============

interface PanelProps {
  data: ModelData;
  panelId: string;
  size: 'small' | 'medium' | 'large';
}

function renderPanel({ data, panelId, size }: PanelProps): React.ReactNode {
  const heightClass = size === 'large' ? 'h-64' : size === 'medium' ? 'h-48' : 'h-32';
  
  switch (panelId) {
    case 'confusion_matrix':
      return (
        <ConfusionMatrixHeatmap 
          matrix={data.confusionMatrix || null}
          labels={data.classLabels}
          normalize={true}
        />
      );
    
    case 'residuals_plot':
    case 'predicted_vs_actual':
      return (
        <ResidualPlot 
          data={data.predictions || null}
          type={panelId === 'residuals_plot' ? 'residual_vs_predicted' : 'predicted_vs_actual'}
        />
      );
    
    case 'embedding_scatter':
    case 'cluster_scatter':
      return (
        <EmbeddingScatter 
          data={data.embeddings || null}
          colorBy={data.subcategory === 'anomaly-detection' ? 'anomaly' : 'cluster'}
        />
      );
    
    case 'cluster_graph':
      return (
        <ForceDirectedCluster 
          data={data.clusterAssignments ? {
            nodes: data.clusterAssignments,
            links: []
          } : null}
          animated={data.status === 'training'}
        />
      );
    
    case 'anomaly_timeline':
      return (
        <AnomalyTimeline 
          data={data.anomalyScores || null}
          threshold={0.5}
          showScores={true}
        />
      );
    
    case 'component_loadings':
      return (
        <ComponentLoadings 
          data={data.componentLoadings || null}
          selectedComponent={0}
        />
      );
    
    case 'forecast_ribbon':
      return (
        <ForecastRibbon 
          data={data.forecasts || null}
          showConfidenceBand={true}
        />
      );
    
    case 'similarity_matrix':
      return (
        <SimilarityMatrix 
          matrix={data.similarityMatrix || null}
          colorScale="coolwarm"
        />
      );
    
    default:
      return null;
  }
}

// ============== LAYOUT RENDERER ==============

function getLayoutForSubcategory(subcategory: ModelSubcategory, mode: 'training' | 'analysis') {
  const schema = LAYOUT_SCHEMAS[subcategory as keyof typeof LAYOUT_SCHEMAS];
  if (!schema) return null;
  
  return mode === 'training' ? schema.training : schema.analysis;
}

function getContractForSubcategory(subcategory: ModelSubcategory) {
  return DATA_CONTRACTS[subcategory as keyof typeof DATA_CONTRACTS] || null;
}

// ============== MAIN COMPONENT ==============

export function VisualizationOrchestrator({
  modelData,
  width,
  height,
  mode = 'training'
}: VisualizationOrchestratorProps) {
  const availableViz = useMemo(() => {
    if (!modelData) return [];
    return getAvailableVisualizations(modelData);
  }, [modelData]);
  
  const layout = useMemo(() => {
    if (!modelData) return null;
    return getLayoutForSubcategory(modelData.subcategory, mode);
  }, [modelData, mode]);
  
  const contract = useMemo(() => {
    if (!modelData) return null;
    return getContractForSubcategory(modelData.subcategory);
  }, [modelData]);
  
  const subcategoryInfo = modelData 
    ? MODEL_SUBCATEGORIES[modelData.subcategory] 
    : null;
  
  if (!modelData) {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <Database className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No Model Selected</p>
          <p className="text-xs opacity-60 mt-1">Select or create a model to view visualizations</p>
        </div>
      </div>
    );
  }
  
  if (availableViz.length === 0 && modelData.status !== 'training') {
    return (
      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center max-w-md">
          <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No Visualization Data</p>
          <p className="text-xs opacity-60 mt-1">
            {modelData.status === 'idle' 
              ? 'Train this model to generate visualizations'
              : 'Model completed but no output data was captured'}
          </p>
          {contract && (
            <div className="mt-4 text-left bg-black/20 rounded p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Required Data</p>
              <div className="space-y-1 text-[11px]">
                <p><span className="text-muted-foreground">Inputs:</span> {contract.inputs?.features?.join(', ') || 'N/A'}</p>
                {contract.labels && (
                  <p><span className="text-muted-foreground">Labels:</span> {contract.labels.type} ({contract.labels.generation?.join(', ') || 'custom'})</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
  
  // Render based on layout schema
  if (!layout || !layout.panels) {
    // Fallback: render available visualizations in a simple grid
    return (
      <div className="w-full h-full">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">{subcategoryInfo?.name || modelData.subcategory}</span>
          </div>
          <Badge variant="outline" className={
            modelData.status === 'training' ? 'border-amber-500/50 text-amber-400' :
            modelData.status === 'completed' ? 'border-emerald-500/50 text-emerald-400' :
            modelData.status === 'error' ? 'border-rose-500/50 text-rose-400' :
            'border-white/20'
          }>
            {modelData.status}
          </Badge>
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          {availableViz.slice(0, 4).map(vizId => (
            <Card key={vizId} className="bg-black/20 border-white/10">
              <CardHeader className="pb-1 pt-2 px-3">
                <CardTitle className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {vizId.replace(/_/g, ' ')}
                </CardTitle>
              </CardHeader>
              <CardContent className="h-40 px-2 pb-2">
                {renderPanel({ data: modelData, panelId: vizId, size: 'medium' })}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }
  
  // Render according to layout schema
  const { layout: layoutType, panels } = layout;
  
  return (
    <div className="w-full h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{subcategoryInfo?.name || modelData.subcategory}</span>
          <Badge variant="outline" className="text-[9px] ml-1">{mode}</Badge>
        </div>
        <Badge variant="outline" className={
          modelData.status === 'training' ? 'border-amber-500/50 text-amber-400 animate-pulse' :
          modelData.status === 'completed' ? 'border-emerald-500/50 text-emerald-400' :
          modelData.status === 'error' ? 'border-rose-500/50 text-rose-400' :
          'border-white/20'
        }>
          {modelData.status}
          {modelData.status === 'training' && modelData.currentEpoch && modelData.totalEpochs && (
            <span className="ml-1">({modelData.currentEpoch}/{modelData.totalEpochs})</span>
          )}
        </Badge>
      </div>
      
      <div className={`grid gap-3 ${
        layoutType === 'grid-2x3' ? 'grid-cols-3 grid-rows-2' :
        layoutType === 'grid-3x2' ? 'grid-cols-2 grid-rows-3' :
        layoutType === 'grid-2x2' ? 'grid-cols-2 grid-rows-2' :
        'grid-cols-2'
      }`}>
        {panels.map((panel: any) => {
          const isAvailable = availableViz.includes(panel.id);
          const [rowSpan, colSpan] = panel.span || [1, 1];
          
          return (
            <Card 
              key={panel.id}
              className={`bg-black/20 border-white/10 ${
                !isAvailable ? 'opacity-40' : ''
              }`}
              style={{
                gridColumn: `span ${colSpan}`,
                gridRow: `span ${rowSpan}`,
              }}
            >
              <CardHeader className="pb-1 pt-2 px-3">
                <CardTitle className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                  {panel.id.replace(/_/g, ' ')}
                  {!isAvailable && (
                    <span className="text-[8px] opacity-60 normal-case">awaiting data</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className={`px-2 pb-2 ${
                panel.size === 'large' ? 'h-52' :
                panel.size === 'medium' ? 'h-40' :
                'h-28'
              }`}>
                {isAvailable 
                  ? renderPanel({ data: modelData, panelId: panel.id, size: panel.size })
                  : (
                    <div className="h-full flex items-center justify-center text-muted-foreground">
                      <div className="text-center">
                        <Database className="h-5 w-5 mx-auto mb-1 opacity-20" />
                        <p className="text-[10px]">No data yet</p>
                      </div>
                    </div>
                  )
                }
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export default VisualizationOrchestrator;
