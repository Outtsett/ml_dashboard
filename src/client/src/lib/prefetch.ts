import { queryClient } from "./query_client";
import { fetchArray } from "./fetch_array";

const prefetchedRoutes = new Set<string>();

export async function prefetchRouteData(route: string) {
  if (prefetchedRoutes.has(route)) return;
  prefetchedRoutes.add(route);

  const prefetchConfig: Record<string, () => Promise<void>> = {
    "/": async () => {
      await Promise.all([
        queryClient.prefetchQuery({
          queryKey: ["/api/ml/models"],
          queryFn: () => fetchArray("/api/ml/models"),
          staleTime: 60000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/ml/trades"],
          queryFn: () => fetchArray("/api/ml/trades"),
          staleTime: 60000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/ml/regimes"],
          queryFn: () => fetchArray("/api/ml/regimes"),
          staleTime: 60000,
        }),
      ]);
    },
    "/ml-hub": async () => {
      await Promise.all([
        queryClient.prefetchQuery({
          queryKey: ["/api/ml/models"],
          queryFn: () => fetchArray("/api/ml/models"),
          staleTime: 60000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/ml/feature-sets"],
          queryFn: () => fetchArray("/api/ml/feature-sets"),
          staleTime: 60000,
        }),
      ]);
    },
    "/backtest": async () => {
      await queryClient.prefetchQuery({
        queryKey: ["/api/instruments"],
        queryFn: () => fetchArray("/api/instruments"),
        staleTime: 300000,
      });
    },
    "/data": async () => {
      await queryClient.prefetchQuery({
        queryKey: ["/api/instruments"],
        queryFn: () => fetchArray("/api/instruments"),
        staleTime: 300000,
      });
    },
    "/databases": async () => {
      await Promise.all([
        queryClient.prefetchQuery({
          queryKey: ["/api/health"],
          queryFn: () => fetch("/api/health").then(r => r.json()),
          staleTime: 30000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/questdb/status"],
          queryFn: () => fetch("/api/questdb/status").then(r => r.json()),
          staleTime: 30000,
        }),
      ]);
    },
    "/portfolio": async () => {
      await queryClient.prefetchQuery({
        queryKey: ["/api/ml/trades"],
        queryFn: () => fetchArray("/api/ml/trades"),
        staleTime: 60000,
      });
    },
  };

  const prefetcher = prefetchConfig[route];
  if (prefetcher) {
    try {
      await prefetcher();
    } catch (e) {
      console.warn(`Prefetch failed for ${route}:`, e);
    }
  }
}

export function prefetchOnHover(route: string) {
  return () => {
    setTimeout(() => prefetchRouteData(route), 100);
  };
}

export async function prefetchCriticalData() {
  try {
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: ["/api/instruments"],
        queryFn: () => fetchArray("/api/instruments"),
        staleTime: 300000,
      }),
      queryClient.prefetchQuery({
        queryKey: ["/api/ml/models"],
        queryFn: () => fetchArray("/api/ml/models"),
        staleTime: 60000,
      }),
    ]);
  } catch (e) {
    console.warn("Critical prefetch failed:", e);
  }
}
