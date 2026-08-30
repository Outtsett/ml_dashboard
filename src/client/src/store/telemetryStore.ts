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

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  metrics: DEFAULT_METRICS,
  history: {
    reward: [], loss: [], kl: [], entropy: [], gpuLoad: [], cpuLoad: [], ping: [],
    status: [], eta: [], symbol: [], bars: [], span: [], progress: [], value_loss: []
  },
  logs: [],
  modelSummary: null,
  isConnected: false,
  
  connect: (url = "ws://localhost:5000/metrics") => {
    if (ws) return; // Already connecting or connected

    ws = new WebSocket(url);

    ws.onopen = () => {
      set({ isConnected: true });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
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

    ws.onclose = () => {
      ws = null;
      set({ isConnected: false });
      reconnectTimeout = setTimeout(() => get().connect(url), 3000);
    };

    ws.onerror = (error) => {
      console.error("WebSocket error", error);
      if (ws) ws.close();
    };
  },
  
  disconnect: () => {
    clearTimeout(reconnectTimeout);
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
