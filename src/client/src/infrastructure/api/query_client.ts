import { toast } from "sonner";
import { QueryClient, QueryCache, MutationCache, QueryFunction } from "@tanstack/react-query";

// ─── Fetch listener for speed audit instrumentation ─────────────────────────
type FetchListener = (url: string, durationMs: number, sizeBytes: number | null) => void;
let fetchListener: FetchListener | null = null;
export function setFetchListener(listener: FetchListener | null) {
  fetchListener = listener;
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  signal?: AbortSignal,
): Promise<Response> {
  const start = performance.now();
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
    signal,
  });
  const durationMs = performance.now() - start;
  const contentLength = res.headers.get("content-length");
  fetchListener?.(url, durationMs, contentLength ? parseInt(contentLength) : null);

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey, signal }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
      signal,
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Only toast on background refetch failures — not initial loads
      if (query.state.data !== undefined) {
        toast.error("Data refresh failed", {
          description: error.message?.slice(0, 120) || "An unexpected error occurred",
          duration: 5000,
        });
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      // Only toast if the mutation doesn't handle errors itself
      if (!mutation.options.onError) {
        toast.error("Action failed", {
          description: error.message?.slice(0, 120) || "An unexpected error occurred",
          duration: 5000,
        });
      }
    },
  }),
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
      retryDelay: 1000,
    },
  },
});

export function invalidateAllQueries() {
  queryClient.invalidateQueries();
}

export function clearQueryCache() {
  queryClient.clear();
}
