import { Suspense, lazy, useEffect, type ComponentType } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import { BreadcrumbProvider } from "@/hooks/useBreadcrumbs";
import { UnifiedDashboardProvider } from "@/contexts/UnifiedDashboardContext";
import { TrainingProvider } from "@/contexts/TrainingContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  DataGridSkeleton,
  ChartSkeleton,
  PageLoader
} from "@/components/LoadingSkeletons";
import { prefetchCriticalData } from "./lib/prefetch";
import { useWebVitals } from './hooks/useWebVitals';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { useNativeMenu } from '@/hooks/useNativeMenu';

// Retry wrapper for dynamic imports — handles stale chunks after HMR updates
function lazyRetry(
  factory: () => Promise<{ default: ComponentType<any> }>,
  name: string,
  retries = 2,
): ReturnType<typeof lazy> {
  return lazy(() =>
    factory().catch((err: Error) => {
      if (retries > 0 && /dynamically imported module|fetch/i.test(err.message)) {
        console.warn(`[beta] Chunk stale for ${name}, retrying (${retries} left)…`);
        return new Promise<{ default: ComponentType<any> }>((resolve) =>
          setTimeout(() => resolve(lazyRetry(factory, name, retries - 1) as any), 800),
        );
      }
      // Final retry failed — force full reload to pick up new manifest
      console.error(`[beta] Chunk load failed for ${name} after retries, reloading…`);
      window.location.reload();
      return { default: (() => null) as unknown as ComponentType<any> };
    }),
  );
}

const MarketData = lazyRetry(() => import("@/pages/MarketData"), "MarketData");
const Portfolio = lazyRetry(() => import("@/pages/Portfolio"), "Portfolio");
const Databases = lazyRetry(() => import("@/pages/Databases"), "Databases");
const Watchlist = lazyRetry(() => import("@/pages/Watchlist"), "Watchlist");
const News = lazyRetry(() => import("@/pages/News"), "News");
const MLStudio = lazyRetry(() => import("@/pages/MLStudio"), "MLStudio");
const ModelCatalog = lazyRetry(() => import("@/pages/ModelCatalog"), "ModelCatalog");
const Curriculum = lazyRetry(() => import("@/pages/Curriculum"), "Curriculum");
const Settings = lazyRetry(() => import("@/pages/Settings"), "Settings");
const NotFound = lazyRetry(() => import("@/pages/not-found"), "NotFound");

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/">
          <ErrorBoundary>
            <Suspense fallback={<ChartSkeleton />}>
              <MarketData />
            </Suspense>
          </ErrorBoundary>
        </Route>
        <Route path="/ml-hub">
          <Redirect to="/" />
        </Route>
        <Route path="/portfolio">
          <ErrorBoundary>
            <Suspense fallback={<DataGridSkeleton />}>
              <Portfolio />
            </Suspense>
          </ErrorBoundary>
        </Route>
        <Route path="/watchlist">
          <ErrorBoundary>
            <Suspense fallback={<DataGridSkeleton />}>
              <Watchlist />
            </Suspense>
          </ErrorBoundary>
        </Route>
        <Route path="/news">
          <ErrorBoundary>
            <Suspense fallback={<DataGridSkeleton />}>
              <News />
            </Suspense>
          </ErrorBoundary>
        </Route>
        <Route path="/databases">
          <ErrorBoundary>
            <Suspense fallback={<DataGridSkeleton />}>
              <Databases />
            </Suspense>
          </ErrorBoundary>
        </Route>
        <Route path="/ml-studio">
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <MLStudio />
            </Suspense>
          </ErrorBoundary>
        </Route>
        <Route path="/model-catalog">
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <ModelCatalog />
            </Suspense>
          </ErrorBoundary>
        </Route>
        <Route path="/curriculum">
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Curriculum />
            </Suspense>
          </ErrorBoundary>
        </Route>
        <Route path="/settings">
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <Settings />
            </Suspense>
          </ErrorBoundary>
        </Route>
        <Route>
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <NotFound />
            </Suspense>
          </ErrorBoundary>
        </Route>
      </Switch>
    </Layout>
  );
}

function App() {
  useEffect(() => {
    prefetchCriticalData();
  }, []);

  // Global unhandled promise rejection handler
  useEffect(() => {
    const handler = (event: PromiseRejectionEvent) => {
      console.error('[Unhandled Rejection]', event.reason);
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);

  useWebVitals();
  useGlobalShortcuts();
  useNativeMenu();

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <UnifiedDashboardProvider>
          <TrainingProvider>
            <BreadcrumbProvider>
              <Toaster />
              <Router />
            </BreadcrumbProvider>
          </TrainingProvider>
        </UnifiedDashboardProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
