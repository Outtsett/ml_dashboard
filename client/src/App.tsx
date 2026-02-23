import { Suspense, lazy, useEffect } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import { BreadcrumbProvider } from "@/hooks/useBreadcrumbs";
import { UnifiedDashboardProvider } from "@/contexts/UnifiedDashboardContext";
import { RegimeTrainingProvider } from "@/contexts/RegimeTrainingContext";
import { TrainingProvider } from "@/contexts/TrainingContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  DashboardSkeleton,
  DataGridSkeleton,
  ChartSkeleton,
  PageLoader
} from "@/components/LoadingSkeletons";
import { prefetchCriticalData } from "./lib/prefetch";

const MarketData = lazy(() => import("@/pages/MarketData"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Portfolio = lazy(() => import("@/pages/Portfolio"));
const Databases = lazy(() => import("@/pages/Databases"));
const Watchlist = lazy(() => import("@/pages/Watchlist"));
const News = lazy(() => import("@/pages/News"));
const Training = lazy(() => import("@/pages/Training"));
const Backtest = lazy(() => import("@/pages/Backtest"));
const FourierTransform = lazy(() => import("@/pages/FourierTransform"));
const ArchitectureExplorer = lazy(() => import("@/pages/ArchitectureExplorer"));
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
        <Route path="/dashboard">
          <ErrorBoundary>
            <Suspense fallback={<DashboardSkeleton />}>
              <Dashboard />
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
        <Route path="/training">
          <ErrorBoundary>
            <Suspense fallback={<ChartSkeleton />}>
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
        <Route path="/fourier">
          <ErrorBoundary>
            <Suspense fallback={<ChartSkeleton />}>
              <FourierTransform />
            </Suspense>
          </ErrorBoundary>
        </Route>
        <Route path="/architecture">
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <ArchitectureExplorer />
            </Suspense>
          </ErrorBoundary>
        </Route>
        <Route path="/settings">
          <div className="p-6 text-center text-muted-foreground font-mono text-sm">Settings coming soon</div>
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

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <UnifiedDashboardProvider>
          <RegimeTrainingProvider>
          <TrainingProvider>
            <BreadcrumbProvider>
              <Toaster />
              <Router />
            </BreadcrumbProvider>
          </TrainingProvider>
          </RegimeTrainingProvider>
        </UnifiedDashboardProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
