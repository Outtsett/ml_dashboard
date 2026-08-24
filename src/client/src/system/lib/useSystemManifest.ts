import { useQuery } from "@tanstack/react-query";

export interface SystemManifest {
  timestamp: string;
  hardware: {
    cores: number;
    threads: number;
    total_ram_gb: number;
    free_ram_gb: number;
    load_avg: number[];
    gpu?: {
      utilization: number;
      memory_used_mb: number;
      memory_total_mb: number;
      temperature: number;
    };
  };
  infrastructure: {
    questdb: { connected: boolean; row_count: number; tables: string[] };
    /** Server-side cache stats (getCacheStats()). No client reads this today —
     *  `unknown` keeps it in the payload without asserting a shape. */
    cache: unknown;
    storage: { models_path: string; size_mb: number; free_gb: number };
  };
  inventory: {
    total_models: number;
    /** Newest model row. No client reads this today — see `cache` above. */
    latest_model?: unknown;
    symbol_coverage: string[];
  };
}

export function useSystemManifest() {
  return useQuery<SystemManifest>({
    queryKey: ["/api/system/manifest"],
    queryFn: async () => {
      const res = await fetch("/api/system/manifest");
      if (!res.ok) throw new Error("Failed to fetch system manifest");
      return res.json();
    },
    refetchInterval: 30000, // Refresh every 30s
    staleTime: 15000,
  });
}
