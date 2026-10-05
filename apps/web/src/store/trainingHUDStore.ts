import { create } from 'zustand';

export interface NLLVariancePoint {
  epoch: number;
  nll: number;
  variance: number;
}

export interface ConfidenceRmsePoint {
  confidenceBin: string;
  rmse: number;
}

interface TrainingHUDState {
  nllVariance: NLLVariancePoint[];
  confidenceRmse: ConfidenceRmsePoint[];
  isConnected: boolean;
  connect: () => void;
  disconnect: () => void;
}

let ws: WebSocket | null = null;
let reconnectTimeout: ReturnType<typeof setTimeout>;

export const useTrainingHUDStore = create<TrainingHUDState>((set, get) => ({
  nllVariance: [],
  confidenceRmse: [],
  isConnected: false,

  connect: () => {
    if (ws) return;

    // Use ws/wss based on current protocol
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${scheme}://${window.location.host}/api/training/telemetry`;
    
    const socket = new WebSocket(url);
    ws = socket;

    socket.onopen = () => {
      set({ isConnected: true });
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        set((state) => {
          let updatedNll = state.nllVariance;
          let updatedRmse = state.confidenceRmse;

          // Handle array replacement or single point appending
          if (data.nllVariance) {
            updatedNll = Array.isArray(data.nllVariance) ? data.nllVariance : [...state.nllVariance, data.nllVariance].slice(-100);
          }
          if (data.confidenceRmse) {
            updatedRmse = Array.isArray(data.confidenceRmse) ? data.confidenceRmse : data.confidenceRmse;
          }

          return {
            nllVariance: updatedNll,
            confidenceRmse: updatedRmse
          };
        });
      } catch (err) {
        console.error("Failed to parse training telemetry message", err);
      }
    };

    socket.onclose = () => {
      ws = null;
      set({ isConnected: false });
      reconnectTimeout = setTimeout(() => get().connect(), 3000);
    };

    socket.onerror = (error) => {
      console.error("TrainingHUD WebSocket error", error);
      socket.close();
    };
  },

  disconnect: () => {
    clearTimeout(reconnectTimeout);
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = null;
    }
    set({ isConnected: false });
  }
}));
