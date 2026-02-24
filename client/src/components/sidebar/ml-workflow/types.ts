/**
 * Types for MLWorkflowSidebar sub-components.
 */

import type { LabelGeneratorKey } from "@shared/mlTaxonomy";
import { LABEL_GENERATORS } from "@shared/mlTaxonomy";

export type LabelGenerator = (typeof LABEL_GENERATORS)[LabelGeneratorKey];
import type { LabelMarker } from "@/components/TradingChart";

export interface TrainingProgress {
  epoch: number;
  totalEpochs: number;
  loss: number;
  valLoss: number;
  accuracy: number;
  valAccuracy?: number;
  learningRate?: number;
  elapsedMs?: number;
  batchSize?: number;
  status: string;
  message?: string;
  trainSize?: number;
  valSize?: number;
  stepsPerEpoch?: number;
  samplesSeen?: number;
  symbol?: string;
}

export interface MlModel {
  id: number;
  name: string;
  architecture: string;
  symbol: string;
  status: string;
  metrics?: string;
  hyperparameters?: string;
}

export interface BacktestRunResult {
  run: { id: number; [k: string]: any };
  metrics: {
    totalTrades: number;
    winRate: number;
    totalPnl: number;
    maxDrawdown: number;
    sharpeRatio: number;
    profitFactor: number;
  };
}

export interface XAIResult {
  method: string;
  features: { name: string; importance: number }[];
}

export interface MLWorkflowSidebarProps {
  chartData: { timestamp: number; open: number; high: number; low: number; close: number; volume: number }[];
  effectiveSymbol: string;
  symbol: string;
  isFutures: boolean;
  timeframe: number;
  onLabelMarkersChange: (markers: LabelMarker[], show: boolean) => void;
  activeTab?: string;
  onTabChange?: (tab: string) => void;
}

// ─── Tab-level prop interfaces ───────────────────────────────────────────────

export interface LabelDistribution {
  total: number;
  buy: number;
  sell: number;
  hold: number;
  buyPct: number;
  sellPct: number;
  holdPct: number;
}

export interface LabelsTabProps {
  selectedGenerator: LabelGeneratorKey;
  setSelectedGenerator: (g: LabelGeneratorKey) => void;
  labelParams: Record<string, unknown>;
  setLabelParams: React.Dispatch<React.SetStateAction<Record<string, unknown>>>;
  currentParams: Record<string, unknown>;
  generatorDef: LabelGenerator | undefined;
  onGenerate: () => void;
  isPreviewing: boolean;
  chartDataLength: number;
  showLabels: boolean;
  onClearLabels: () => void;
  labelDistribution: LabelDistribution;
  visibleLabelsCount: number;
  effectiveSymbol: string;
}

export interface TrainTabProps {
  isTraining: boolean;
  currentProgress: TrainingProgress | null;
  currentEpoch: number;
  totalEpochs: number;
  progressPct: number;
  lossHistory: { epoch: number; loss: number; valLoss: number; accuracy?: number }[];
  // Config
  pipeline: 'universal' | 'legacy';
  setPipeline: (v: 'universal' | 'legacy') => void;
  labelType: 'direction' | 'triple_barrier';
  setLabelType: (v: 'direction' | 'triple_barrier') => void;
  epochs: number;
  setEpochs: (v: number) => void;
  batchSize: number;
  setBatchSize: (v: number) => void;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  maxBars: number;
  setMaxBars: (v: number) => void;
  timeframeSec: number;
  setTimeframeSec: (v: number) => void;
  labelHorizon: number;
  setLabelHorizon: (v: number) => void;
  labelAtrMultiplier: number;
  setLabelAtrMultiplier: (v: number) => void;
  labelNumClasses: 2 | 3;
  setLabelNumClasses: (v: 2 | 3) => void;
  takeProfitATR: number;
  setTakeProfitATR: (v: number) => void;
  stopLossATR: number;
  setStopLossATR: (v: number) => void;
  maxHoldingPeriod: number;
  setMaxHoldingPeriod: (v: number) => void;
  // Actions
  onStartTraining: () => void;
  isStartingTraining: boolean;
  onStopTraining: () => void;
  isStoppingTraining: boolean;
  // Model info
  symbol: string;
  activeModelName: string;
  mlModels: MlModel[];
}

export interface BacktestTabProps {
  btModel: string;
  setBtModel: (v: string) => void;
  btCapital: number;
  setBtCapital: (v: number) => void;
  btPositionSize: number;
  setBtPositionSize: (v: number) => void;
  btMinConfidence: number;
  setBtMinConfidence: (v: number) => void;
  btResult: BacktestRunResult | null;
  btTradesData: { trades: any[]; chartMarkers: any[]; count: number } | undefined;
  btSelectedRunId: number | null;
  setBtSelectedRunId: (v: number | null) => void;
  previousRuns: any[];
  onRunBacktest: () => void;
  isRunningBacktest: boolean;
  onClearResults: () => void;
  symbol: string;
  mlModels: MlModel[];
}

export interface XAITabProps {
  xaiMethod: string;
  setXaiMethod: (v: string) => void;
  xaiResult: XAIResult | undefined;
  activeModelName: string;
}
