import { useQuery } from "@tanstack/react-query";

interface Experiment {
  id: number;
  model: string;
  reward: number;
  valScore: number;
  status: string;
}

export function useExperiments() {
  return useQuery({
    queryKey: ["experiments"],
    queryFn: async (): Promise<Experiment[]> => {
      // In a real app, this would fetch from the REST API endpoint
      // const res = await fetch("/api/experiments");
      // return res.json();
      
      // Mocking for the wireframe:
      return [
        { id: 12, model: "Transformer-L", reward: 0.82, valScore: 0.74, status: "completed" },
        { id: 11, model: "Transformer-M", reward: 0.75, valScore: 0.68, status: "completed" },
        { id: 10, model: "LSTM-Deep", reward: 0.45, valScore: 0.51, status: "completed" },
      ];
    },
    refetchInterval: 5000, // Poll every 5s for updates
  });
}
