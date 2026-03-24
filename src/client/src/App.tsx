import { Suspense, lazy, useEffect } from "react";
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

const MarketData = lazy(() => import("@/pages/MarketData"));
const Portfolio = lazy(() => import("@/pages/Portfolio"));
const Databases = lazy(() => import("@/pages/Databases"));
const Watchlist = lazy(() => import("@/pages/Watchlist"));
const News = lazy(() => import("@/pages/News"));
const MLStudio = lazy(() => import("@/pages/MLStudio"));
const ModelCatalog = lazy(() => import("@/pages/ModelCatalog"));
const Settings = lazy(() => import("@/pages/Settings"));
const NotFound = lazy(() => import("@/pages/not-found"));

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
