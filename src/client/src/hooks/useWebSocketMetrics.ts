import { useEffect } from "react";
import { useTelemetryStore, TelemetryMetrics, metricsSocketUrl } from "../store/telemetryStore";

export type { TelemetryMetrics };

export function useWebSocketMetrics(url: string = metricsSocketUrl()) {
  const metrics = useTelemetryStore((state) => state.metrics);
  const history = useTelemetryStore((state) => state.history);
  const logs = useTelemetryStore((state) => state.logs);
  const isConnected = useTelemetryStore((state) => state.isConnected);
  const connect = useTelemetryStore((state) => state.connect);

  useEffect(() => {
    connect(url);
  }, [connect, url]);

  return { metrics, history, logs, isConnected };
}
