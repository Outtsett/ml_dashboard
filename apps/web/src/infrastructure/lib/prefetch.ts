import { queryClient } from "@/infrastructure/api/query_client";
import { fetchArray } from "@/infrastructure/api/fetch_array";

const prefetchedRoutes = new Set<string>();
const componentFactories = new Map<string, () => Promise<unknown>>();

/**
 * Registry for lazy component factories to enable preloading
 */
export function registerComponentFactory(route: string, factory: () => Promise<unknown>) {
  componentFactories.set(route, factory);
}

/**
 * Preload the JS chunk for a specific route
 */
export async function prefetchComponent(route: string) {
  const factory = componentFactories.get(route);
  if (factory) {
    try {
      // Trigger the dynamic import but don't wait for it if we want to be truly async
      await factory();
    } catch (e) {
      console.warn(`Component prefetch failed for ${route}:`, e);
    }
  }
}

export async function prefetchRouteData(route: string) {
  if (prefetchedRoutes.has(route)) return;
  prefetchedRoutes.add(route);

  // Parallelize data and component prefetching
  const prefetchers: Promise<void>[] = [prefetchComponent(route)];

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
    "/watchlist": async () => {
      await queryClient.prefetchQuery({
        queryKey: ["/api/instruments"],
        queryFn: () => fetchArray("/api/instruments"),
        staleTime: 300000,
      });
    },
    "/news": async () => {
      await queryClient.prefetchQuery({
        queryKey: ["/api/news"],
        queryFn: () => fetchArray("/api/news"),
        staleTime: 60000,
      });
    },
    "/model-catalog": async () => {
      await Promise.all([
        queryClient.prefetchQuery({
          queryKey: ["/api/model-catalog/stats"],
          staleTime: 300000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/model-catalog/taxonomy"],
          staleTime: 300000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/model-catalog", ""],
          staleTime: 60000,
        }),
      ]);
    },
    "/databases": async () => {
      await Promise.all([
        queryClient.prefetchQuery({
          queryKey: ["/api/databases/sqlite/stats"],
          queryFn: () => fetch("/api/databases/sqlite/stats").then(r => r.json()),
          staleTime: 30000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/databases/lake/stats"],
          queryFn: () => fetch("/api/databases/lake/stats").then(r => r.json()),
          staleTime: 30000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/uploads"],
          queryFn: () => fetchArray("/api/uploads"),
          staleTime: 10000,
        }),
      ]);
    },
    "/portfolio": async () => {
      await Promise.all([
        queryClient.prefetchQuery({
          queryKey: ["/api/ml/trades", "open"],
          queryFn: () => fetchArray("/api/ml/trades?status=open&limit=100"),
          staleTime: 60000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["/api/ml/trades", "closed"],
          queryFn: () => fetchArray("/api/ml/trades?status=closed&limit=50"),
          staleTime: 60000,
        }),
        queryClient.prefetchQuery({
          queryKey: ["backtest-runs"],
          queryFn: () => fetchArray("/api/backtest/runs?limit=1"),
          staleTime: 60000,
        }),
      ]);
    },
  };

  const prefetcher = prefetchConfig[route];
  if (prefetcher) {
    prefetchers.push(prefetcher());
  }

  try {
    await Promise.allSettled(prefetchers);
  } catch (e) {
    console.warn(`Unified prefetch failed for ${route}:`, e);
  }
}

export function prefetchOnHover(route: string) {
  return () => {
    setTimeout(() => prefetchRouteData(route), 100);
  };
}

export async function prefetchCriticalData() {
  try {
    // Start preloading the most likely next components immediately
    const criticalRoutes = ["/", "/ml-studio", "/portfolio"];
    criticalRoutes.forEach(route => prefetchComponent(route));

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
