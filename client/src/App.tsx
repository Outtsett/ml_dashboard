import { Suspense, lazy, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  DashboardSkeleton,
  MLHubSkeleton,
  DataGridSkeleton,
  ChartSkeleton,
  PageLoader
} from "@/components/LoadingSkeletons";
import { prefetchCriticalData } from "./lib/prefetch";

const MarketData = lazy(() => import("@/pages/MarketData"));
const Portfolio = lazy(() => import("@/pages/Portfolio"));
const MLHub = lazy(() => import("@/pages/MLHub"));
const Training = lazy(() => import("@/pages/Training"));
const Backtest = lazy(() => import("@/pages/Backtest"));
const Databases = lazy(() => import("@/pages/Databases"));
const Watchlist = lazy(() => import("@/pages/Watchlist"));
const News = lazy(() => import("@/pages/News"));
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
          <ErrorBoundary>
            <Suspense fallback={<MLHubSkeleton />}>
              <MLHub />
            </Suspense>
          </ErrorBoundary>
        </Route>
        <Route path="/training">
          <ErrorBoundary>
            <Suspense fallback={<MLHubSkeleton />}>
              <Training />
            </Suspense>
          </ErrorBoundary>
        </Route>
        <Route path="/backtest">
          <ErrorBoundary>
            <Suspense fallback={<DataGridSkeleton />}>
              <Backtest />
            </Suspense>
          </ErrorBoundary>
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
        <Route path="/settings">
          <div className="p-6 text-center text-muted-foreground font-mono text-sm">Settings coming soon</div>
        </Route>
        <Route>
          <Suspense fallback={<PageLoader />}>
            <NotFound />
          </Suspense>
        </Route>
      </Switch>
    </Layout>
  );
}

function App() {
  useEffect(() => {
    prefetchCriticalData();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
