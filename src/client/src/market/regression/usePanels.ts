/**
 * The regression panels, fitted in a Web Worker.
 *
 * Every input is something that keeps its identity until it genuinely
 * changes (query results and the settings state), so an unrelated re-render
 * never re-sends work. The latest request wins: an answer to a request that
 * has since been superseded is dropped, and the previous panels stay on
 * screen, marked as updating, until the new ones arrive.
 */

import { useEffect, useRef, useState } from "react";
import type { OhlcvData } from "@/market/components/types";
import type { RegressionVariable } from "@shared/regression/types";
import type { AlignedColumns, PanelModel, PanelSettings, VariableFilter } from "./panels";
import type { PanelsRequest, PanelsResponse } from "./panels.worker";
import PanelsWorker from "./panels.worker?worker";

export interface PanelsInput {
  bars: OhlcvData[] | undefined;
  lakeVariables: RegressionVariable[] | undefined;
  columns: AlignedColumns | undefined;
  settings: PanelSettings & VariableFilter;
  barMilliseconds: number;
}

export interface PanelsState {
  panels: PanelModel[];
  /**
   * The exact bars these panels were fitted on. Every pairs.barIndex points
   * into THIS array — not into whatever bars are newest — so a symbol switch
   * in flight can never pair an old fit with new timestamps.
   */
  bars: OhlcvData[] | null;
  computing: boolean;
  error: string | null;
  /** Time the worker spent on the last answer. */
  milliseconds: number | null;
}

export function useRegressionPanels({ bars, lakeVariables, columns, settings, barMilliseconds }: PanelsInput): PanelsState {
  const workerRef = useRef<Worker | null>(null);
  const latestRef = useRef(0);
  const requestedBarsRef = useRef<OhlcvData[] | null>(null);
  const [state, setState] = useState<PanelsState>({ panels: [], bars: null, computing: false, error: null, milliseconds: null });

  useEffect(() => {
    const worker = new PanelsWorker();
    worker.onmessage = (event: MessageEvent<PanelsResponse>) => {
      const response = event.data;
      if (response.requestId !== latestRef.current) return;
      if ("error" in response) {
        setState((current) => ({ ...current, computing: false, error: response.error }));
      } else {
        setState({
          panels: response.panels,
          bars: requestedBarsRef.current,
          computing: false,
          error: null,
          milliseconds: response.milliseconds,
        });
      }
    };
    worker.onerror = (event) => {
      setState((current) => ({ ...current, computing: false, error: event.message || "the regression worker failed" }));
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  // Keyed by value, not identity: a settings object rebuilt on every render
  // must not re-send the same work (and a re-send per answer would loop).
  const settingsKey = JSON.stringify(settings);

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker) return;
    if (!bars || bars.length === 0) {
      latestRef.current += 1;
      requestedBarsRef.current = null;
      setState({ panels: [], bars: null, computing: false, error: null, milliseconds: null });
      return;
    }
    latestRef.current += 1;
    requestedBarsRef.current = bars;
    const request: PanelsRequest = {
      requestId: latestRef.current,
      bars,
      lakeVariables: lakeVariables ?? [],
      columns,
      settings: JSON.parse(settingsKey) as PanelsInput["settings"],
      barMilliseconds,
    };
    setState((current) => ({ ...current, computing: true }));
    worker.postMessage(request);
  }, [bars, lakeVariables, columns, settingsKey, barMilliseconds]);

  return state;
}
