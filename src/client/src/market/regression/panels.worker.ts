/**
 * Fits every regression panel off the main thread.
 *
 * Receives the bars, the lake variables and their aligned columns, and the
 * settings; assembles the X variables and runs computePanels exactly as the
 * page used to. The fitted arrays go back as transferred buffers, not copies.
 */

import type { OhlcvData } from "@/market/components/types";
import type { RegressionVariable } from "@shared/regression/types";
import {
  assemblePanelVariables,
  barEncodings,
  computePanels,
  encodingBuffers,
  panelBuffers,
  selectLakeVariables,
  type AlignedColumns,
  type BarEncodings,
  type PanelModel,
  type PanelSettings,
  type VariableFilter,
} from "./panels";

export interface PanelsRequest {
  requestId: number;
  bars: OhlcvData[];
  lakeVariables: RegressionVariable[];
  columns: AlignedColumns | undefined;
  settings: PanelSettings & VariableFilter;
  barMilliseconds: number;
}

export type PanelsResponse =
  | { requestId: number; panels: PanelModel[]; encodings: BarEncodings; milliseconds: number }
  | { requestId: number; error: string };

self.onmessage = (event: MessageEvent<PanelsRequest>) => {
  const { requestId, bars, lakeVariables, columns, settings, barMilliseconds } = event.data;
  const started = performance.now();
  try {
    const variables = assemblePanelVariables(bars, selectLakeVariables(lakeVariables, settings), columns);
    const panels = computePanels(
      bars.map((bar) => bar.close),
      variables,
      settings,
      { timestampsMilliseconds: bars.map((bar) => bar.timestamp), barMilliseconds },
    );
    const encodings = barEncodings(bars);
    const response: PanelsResponse = { requestId, panels, encodings, milliseconds: performance.now() - started };
    (self as unknown as Worker).postMessage(response, [...panelBuffers(panels), ...encodingBuffers(encodings)]);
  } catch (error) {
    const response: PanelsResponse = { requestId, error: error instanceof Error ? error.message : String(error) };
    (self as unknown as Worker).postMessage(response);
  }
};
