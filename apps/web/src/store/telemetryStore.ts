import { create } from 'zustand';

export interface TelemetryMetrics {
  reward: number;
  loss: number;
  kl: number;
  entropy: number;
  gpuLoad: number;
  cpuLoad: number;
  ping: number;
  status: "idle" | "training" | "evaluating" | "error";
  eta?: string;
  symbol?: string;
  bars?: number;
  span?: string;
  progress?: number;
  value_loss?: number;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
}

const DEFAULT_METRICS: TelemetryMetrics = {
  reward: 0,
  loss: 0,
  kl: 0,
  entropy: 0,
  gpuLoad: 0,
  cpuLoad: 0,
  ping: 0,
  status: "idle",
};

/**
 * The run metadata a training process publishes once, over the telemetry
 * socket. Shaped by what `ModelSummaryPanel` reads off it — the observation
 * space it lists, the hyperparameters it tabulates, and the two hidden-dim
 * stacks it renders — so the panel and the socket cannot drift apart.
 */
export interface ModelSummary {
  architecture?: {
    actor_hidden_dims?: number[];
    critic_hidden_dims?: number[];
    activation?: string;
  };
  hyperparameters?: Record<string, string | number | boolean | null>;
  environment?: {
    observation_space?: string[];
  };
}

interface TelemetryState {
  metrics: TelemetryMetrics;
  history: Record<keyof TelemetryMetrics, number[]>;
  logs: LogEntry[];
  modelSummary: ModelSummary | null;
  isConnected: boolean;
  connect: (url?: string) => void;
  disconnect: () => void;
  reset: () => void;
}

let ws: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout>;
let pingInterval: ReturnType<typeof setInterval> | undefined;

/** How often the round trip to the server is measured for the ping readout. */
const PING_INTERVAL_MS = 2000;

/**
 * The metrics socket on the origin the page was served from. It was the
 * literal `ws://localhost:5000/metrics`, which the desktop window's
 * Content-Security-Policy (connect-src ws://127.0.0.1:*) refuses, so in the
 * desktop app the socket never opened and CPU, GPU and ping sat at 0.
 */
export function metricsSocketUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${window.location.host}/metrics`;
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  metrics: DEFAULT_METRICS,
  history: {
    reward: [], loss: [], kl: [], entropy: [], gpuLoad: [], cpuLoad: [], ping: [],
    status: [], eta: [], symbol: [], bars: [], span: [], progress: [], value_loss: []
  },
  logs: [],
  modelSummary: null,
  isConnected: false,
  
  connect: (url = metricsSocketUrl()) => {
    if (ws) return; // Already connecting or connected

    const socket = new WebSocket(url);
    ws = socket;

    socket.onopen = () => {
      set({ isConnected: true });
      const sendPing = () => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "ping", sentAt: performance.now() }));
        }
      };
      sendPing();
      clearInterval(pingInterval);
      pingInterval = setInterval(sendPing, PING_INTERVAL_MS);
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // The server echoes each ping; the round trip is the ping readout.
        if (data.type === "pong") {
          if (typeof data.sentAt === "number") {
            const ping = Math.max(0, Math.round(performance.now() - data.sentAt));
            set((state) => ({
              metrics: { ...state.metrics, ping },
              history: { ...state.history, ping: [...state.history.ping, ping].slice(-50) },
            }));
          }
          return;
        }
        
        if (data.type === 'log') {
          set((state) => ({
            logs: [...state.logs.slice(-200), {
              id: Math.random().toString(36).substring(7),
              timestamp: new Date().toISOString(),
              level: data.level || 'info',
              message: data.message
            }]
          }));
          return;
        }
        
        if (data.type === 'model_summary') {
          set({ modelSummary: data.data });
          return;
        }
        
        set((state) => {
          const newMetrics = { ...state.metrics, ...data };
          const newHistory = { ...state.history };
          
          (Object.keys(data) as Array<keyof TelemetryMetrics>).forEach((key) => {
            if (typeof data[key] === "number") {
              newHistory[key] = [...(state.history[key] || []), data[key]].slice(-50);
            }
          });
          
          return { metrics: newMetrics, history: newHistory };
        });
      } catch (err) {
        console.error("Failed to parse websocket message", err);
      }
    };

    socket.onclose = () => {
      clearInterval(pingInterval);
      ws = null;
      set({ isConnected: false });
      reconnectTimeout = setTimeout(() => get().connect(url), 3000);
    };

    socket.onerror = (error) => {
      console.error("WebSocket error", error);
      socket.close();
    };
  },
  
  disconnect: () => {
    clearTimeout(reconnectTimeout);
    clearInterval(pingInterval);
    if (ws) {
      ws.onclose = null; // Prevent auto-reconnect
      ws.close();
      ws = null;
    }
    set({ isConnected: false });
  },
  
  reset: () => {
    set({
      metrics: DEFAULT_METRICS,
      history: {
        reward: [], loss: [], kl: [], entropy: [], gpuLoad: [], cpuLoad: [], ping: [],
        status: [], eta: [], symbol: [], bars: [], span: [], progress: [], value_loss: []
      },
      logs: [],
      modelSummary: null,
    });
  }
}));
