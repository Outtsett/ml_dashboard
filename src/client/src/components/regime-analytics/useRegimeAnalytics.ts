/**
 * useRegimeAnalytics — Page-level state + training logic for the RegimeAnalytics panel.
 *
 * Owns: training state, config state, selected model, SSE stream consumption.
 * Replaces 3 inline fetch() calls with regimeApi from apiService (DIP).
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { useDashboard } from "@/contexts/UnifiedDashboardContext";
import { useRegimeModels, useRegimeDiagnostics, useRegimeConvergence, useRegimeAssignments } from "@/hooks/useRegimeData";
import { regimeApi } from "@/lib/apiService";
import type { TrainingProgress } from "./types";

// ── Config state shape ──

export interface RegimeConfig {
  selectedSymbol: string;
  setSelectedSymbol: (s: string) => void;
  selectedTimeframe: string;
  setSelectedTimeframe: (tf: string) => void;
  gibbsIter: number;
  setGibbsIter: (n: number) => void;
  burnIn: number;
  setBurnIn: (n: number) => void;
  testSplit: number;
  setTestSplit: (n: number) => void;
  wfWindows: number;
  setWfWindows: (n: number) => void;
  alpha: number;
  setAlpha: (n: number) => void;
  gamma: number;
  setGamma: (n: number) => void;
  kappa: number;
  setKappa: (n: number) => void;
}

// ── Return type ──

export interface RegimeAnalyticsState {
  // Training
  isTraining: boolean;
  progress: TrainingProgress | null;
  trainLogs: string[];
  trainError: string | null;
  startTraining: () => Promise<void>;
  stopTraining: () => void;
  deleteModel: (id: string) => Promise<void>;
  // Config
  config: RegimeConfig;
  showAdvanced: boolean;
  setShowAdvanced: (v: boolean) => void;
  // Results
  selectedModel: string | null;
  setSelectedModel: (id: string | null) => void;
  showDiagnostics: boolean;
  setShowDiagnostics: (v: boolean) => void;
  // Data (from shared hooks)
  models: ReturnType<typeof useRegimeModels>["models"];
  diagnostics: ReturnType<typeof useRegimeDiagnostics>["data"];
  convergenceData: ReturnType<typeof useRegimeConvergence>["data"];
  assignmentsData: ReturnType<typeof useRegimeAssignments>["data"];
}

export function useRegimeAnalytics(): RegimeAnalyticsState {
  const dashboard = useDashboard();

  // ── Training state ──
  const [isTraining, setIsTraining] = useState(false);
  const [progress, setProgress] = useState<TrainingProgress | null>(null);
  const [trainLogs, setTrainLogs] = useState<string[]>([]);
  const [trainError, setTrainError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Config state ──
  const [selectedSymbol, setSelectedSymbol] = useState(dashboard.symbol || "ES");
  const [selectedTimeframe, setSelectedTimeframe] = useState("30m");
  const [gibbsIter, setGibbsIter] = useState(100);
  const [burnIn, setBurnIn] = useState(30);
  const [testSplit, setTestSplit] = useState(0.15);
  const [wfWindows, setWfWindows] = useState(5);
  const [alpha, setAlpha] = useState(1.0);
  const [gamma, setGamma] = useState(5.0);
  const [kappa, setKappa] = useState(50.0);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Results state ──
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Sync symbol from dashboard context
  useEffect(() => {
    if (dashboard.symbol) setSelectedSymbol(dashboard.symbol);
  }, [dashboard.symbol]);

  // ── Shared data hooks (SRP, DIP — no inline queries) ──
  const { models, refetch: refetchModels } = useRegimeModels(isTraining);
  const { data: diagnostics } = useRegimeDiagnostics(selectedModel);
  const { data: convergenceData } = useRegimeConvergence(selectedModel);
  const { data: assignmentsData } = useRegimeAssignments(selectedModel, { limit: 50000 });

  // ── Training actions (DIP — uses regimeApi, not inline fetch) ──

  const startTraining = useCallback(async () => {
    setIsTraining(true);
    setProgress(null);
    setTrainLogs([]);
    setTrainError(null);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const result = await regimeApi.start({
        modelType: "hdp-hmm",
        symbol: selectedSymbol,
        timeframe: selectedTimeframe,
        hyperparameters: { gibbsIter, burnIn, testSplit, wfWindows, alpha, gamma, kappa },
      }) as { modelId: string };

      const modelId = result.modelId;

      // Consume SSE stream via fetch + ReadableStream
      const streamRes = await fetch(`/api/training/stream/${modelId}`, {
        signal: abort.signal,
      });

      if (!streamRes.ok || !streamRes.body) {
        throw new Error("Failed to connect to training stream");
      }

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventName = line.slice(7).trim();
          } else if (line.startsWith("data: ") && eventName) {
            try {
              const data = JSON.parse(line.slice(6));
              switch (eventName) {
                case "progress":
                  setProgress(data as TrainingProgress);
                  break;
                case "status":
                case "log":
                case "regime_line":
                  setTrainLogs(prev => [...prev.slice(-50), data.message || data.text || data.phase]);
                  break;
                case "done":
                  setSelectedModel(data.modelId);
                  refetchModels();
                  break;
                case "error":
                  setTrainError(data.message);
                  break;
              }
            } catch {
              // Skip malformed JSON
            }
            eventName = "";
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setTrainError(err.message);
      }
    } finally {
      setIsTraining(false);
      abortRef.current = null;
    }
  }, [selectedSymbol, selectedTimeframe, gibbsIter, burnIn, testSplit, wfWindows, alpha, gamma, kappa, refetchModels]);

  const stopTraining = useCallback(() => {
    abortRef.current?.abort();
    regimeApi.stop(`${selectedSymbol}_${selectedTimeframe}`);
    setIsTraining(false);
  }, [selectedSymbol, selectedTimeframe]);

  const deleteModel = useCallback(async (id: string) => {
    await regimeApi.deleteModel(id);
    if (selectedModel === id) setSelectedModel(null);
    refetchModels();
  }, [selectedModel, refetchModels]);

  // ── Compose config object ──
  const config: RegimeConfig = {
    selectedSymbol, setSelectedSymbol,
    selectedTimeframe, setSelectedTimeframe,
    gibbsIter, setGibbsIter,
    burnIn, setBurnIn,
    testSplit, setTestSplit,
    wfWindows, setWfWindows,
    alpha, setAlpha,
    gamma, setGamma,
    kappa, setKappa,
  };

  return {
    isTraining, progress, trainLogs, trainError,
    startTraining, stopTraining, deleteModel,
    config, showAdvanced, setShowAdvanced,
    selectedModel, setSelectedModel,
    showDiagnostics, setShowDiagnostics,
    models, diagnostics, convergenceData, assignmentsData,
  };
}
