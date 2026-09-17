import { Suspense, lazy, useEffect, type ComponentType } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "@/infrastructure/api/query_client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/shared/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { toast } from "sonner";
import { AICopilot } from "@/shared/ai/AICopilot";
import { TooltipProvider } from "@/shared/ui/tooltip";
import Layout from "@/shared/layout/Layout";
import { BreadcrumbProvider } from "@/shared/hooks/useBreadcrumbs";
import { UnifiedDashboardProvider } from "@/shared/contexts/UnifiedDashboardContext";
import { TrainingProvider } from "@/training/lib/TrainingContext";
import { ErrorBoundary } from "@/shared/layout/ErrorBoundary";
import {
  DataGridSkeleton,
  ChartSkeleton,
  PageLoader
} from "@/shared/layout/LoadingSkeletons";
import { prefetchCriticalData, registerComponentFactory } from "@/infrastructure/lib/prefetch";
import { useWebVitals } from "@/shared/hooks/useWebVitals";
import { useGlobalShortcuts } from "@/shared/hooks/useGlobalShortcuts";
import { useNativeMenu } from "@/shared/hooks/useNativeMenu";
import { CommandPalette } from "@/shared/layout/CommandPalette";

function lazyRetry(
  factory: () => Promise<{ default: ComponentType }>,
  name: string,
  retries = 2,
): ReturnType<typeof lazy> {
  const retryFactory = (retriesLeft: number): Promise<{ default: ComponentType }> => {
    return factory().catch((err: Error) => {
      if (retriesLeft > 0 && /dynamically imported module|fetch/i.test(err.message)) {
        console.warn(`[beta] Chunk stale for ${name}, retrying (${retriesLeft} left)`);
        return new Promise((resolve) => {
          setTimeout(() => resolve(retryFactory(retriesLeft - 1)), 800);
        });
      }
      console.error(`[beta] Chunk load failed for ${name} after retries, reloading`);
      window.location.reload();
      return { default: (() => null) as ComponentType };
    });
  };
  return lazy(() => retryFactory(retries));
}

// ─── Domain-Driven Pages ───────────────────────────────────────────────────

// Market Domain
const MarketDataFactory = () => import("@/market/MarketDataPage");
const MarketData = lazyRetry(MarketDataFactory, "MarketData");
registerComponentFactory("/", MarketDataFactory);

const NewsFactory = () => import("@/market/NewsPage");
const News = lazyRetry(NewsFactory, "News");
registerComponentFactory("/news", NewsFactory);


// Portfolio Domain

const PaperFactory = () => import("@/portfolio/PaperPage");
const Paper = lazyRetry(PaperFactory, "Paper");
registerComponentFactory("/paper", PaperFactory);

// Data Domain
const DatabasesFactory = () => import("@/data/DatabasesPage");
const Databases = lazyRetry(DatabasesFactory, "Databases");
registerComponentFactory("/databases", DatabasesFactory);

// ML Domain
const MLStudioFactory = () => import("@/ml/MLStudioPage");
const MLStudio = lazyRetry(MLStudioFactory, "MLStudio");
registerComponentFactory("/ml-studio", MLStudioFactory);

const ForecastFactory = () => import("@/ml/ForecastPage");
const Forecast = lazyRetry(ForecastFactory, "Forecast");
registerComponentFactory("/forecast", ForecastFactory);

const ModelCatalogFactory = () => import("@/ml/ModelCatalogPage");
const ModelCatalog = lazyRetry(ModelCatalogFactory, "ModelCatalog");
registerComponentFactory("/model-catalog", ModelCatalogFactory);

const GlossaryFactory = () => import("@/ml/GlossaryPage");
const Glossary = lazyRetry(GlossaryFactory, "Glossary");
registerComponentFactory("/glossary", GlossaryFactory);



const FourierTransformFactory = () => import("@/ml/FourierTransformPage");
const FourierTransform = lazyRetry(FourierTransformFactory, "FourierTransform");
registerComponentFactory("/fourier", FourierTransformFactory);

// Training Domain
const TrainingFactory = () => import("@/training/TrainingPage");
const Training = lazyRetry(TrainingFactory, "Training");
registerComponentFactory("/training", TrainingFactory);

const CurriculumFactory = () => import("@/training/CurriculumPage");
const Curriculum = lazyRetry(CurriculumFactory, "Curriculum");
registerComponentFactory("/curriculum", CurriculumFactory);

// Backtest Domain
// Consolidated into ML Studio

// System Domain
const SettingsFactory = () => import("@/system/SettingsPage");
const Settings = lazyRetry(SettingsFactory, "Settings");
registerComponentFactory("/settings", SettingsFactory);

const TerminalsFactory = () => import("@/system/TerminalsPage");
const Terminals = lazyRetry(TerminalsFactory, "Terminals");
registerComponentFactory("/terminals", TerminalsFactory);

const HardwareFactory = () => import("@/system/HardwarePage");
const Hardware = lazyRetry(HardwareFactory, "Hardware");
registerComponentFactory("/hardware", HardwareFactory);

const LensFactory = () => import("@/lens/LensPage");
const Lens = lazyRetry(LensFactory, "Lens");
registerComponentFactory("/lens", LensFactory);

const MarimoFactory = () => import("@/marimo/MarimoPage");
const Marimo = lazyRetry(MarimoFactory, "Marimo");
registerComponentFactory("/marimo", MarimoFactory);

const NotFound = lazyRetry(() => import("@/shared/layout/not-found"), "NotFound");

/**
 * Route definition helper to ensure consistent suspense and error boundary wrapping
 */
const AppRoute = ({ path, component: Component, fallback = <PageLoader /> }: {
  path: string,
  component: ComponentType,
  fallback?: React.ReactNode
}) => (
  <Route path={path}>
    <ErrorBoundary>
      <Suspense fallback={fallback}>
        <Component />
      </Suspense>
    </ErrorBoundary>
  </Route>
);

function Router() {
  return (
    <Layout>
      <Switch>
        <AppRoute path="/" component={MarketData} fallback={<ChartSkeleton />} />
        
        {/* Redirects, not components. Old bookmarks and any link written
            before the nav was consolidated keep working; wouter matches these
            before the catch-all below. */}
        <Route path="/ml-hub">
          <Redirect to="/ml-studio" />
        </Route>
        <Route path="/rl-console">
          <Redirect to="/ml-studio" />
        </Route>
        <Route path="/risk">
          <Redirect to="/ml-studio" />
        </Route>
        {/* /portfolio and /watchlist were removed 2026-09-16. Portfolio's Risk
            half became ML Studio's Risk tab; Watchlist has no successor, so it
            lands on the Market chart it was always used alongside. */}
        <Route path="/portfolio">
          <Redirect to="/ml-studio" />
        </Route>
        <Route path="/watchlist">
          <Redirect to="/" />
        </Route>
        
        <AppRoute path="/news" component={News} fallback={<DataGridSkeleton />} />
        <AppRoute path="/databases" component={Databases} fallback={<DataGridSkeleton />} />
        
        <AppRoute path="/ml-studio" component={MLStudio} />
        <AppRoute path="/forecast" component={Forecast} />
        <AppRoute path="/curriculum" component={Curriculum} />
        <AppRoute path="/model-catalog" component={ModelCatalog} />
        <AppRoute path="/glossary" component={Glossary} />
        <AppRoute path="/fourier" component={FourierTransform} />
        <AppRoute path="/paper" component={Paper} fallback={<DataGridSkeleton />} />

        <AppRoute path="/terminals" component={Terminals} />
        <AppRoute path="/hardware" component={Hardware} />
        <AppRoute path="/lens" component={Lens} />
        <AppRoute path="/marimo" component={Marimo} />

        <AppRoute path="/settings" component={Settings} />
        <AppRoute path="/training" component={Training} />

        {/* Catch-all */}
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
      toast.error("Unexpected error", {
        description: String(event.reason)?.slice(0, 120),
        duration: 5000,
      });
    };
    window.addEventListener('unhandledrejection', handler);
    return () => window.removeEventListener('unhandledrejection', handler);
  }, []);

  useWebVitals();
  useGlobalShortcuts();
  useNativeMenu();

  // Zoom keyboard shortcuts: Ctrl+= (zoom in), Ctrl+- (zoom out), Ctrl+0 (reset)
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getZoom) return; // Not in Electron

    const handler = async (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        const current = await api.getZoom();
        api.setZoom(Math.min(current + 0.1, 3.0));
      } else if (e.key === "-") {
        e.preventDefault();
        const current = await api.getZoom();
        api.setZoom(Math.max(current - 0.1, 0.5));
      } else if (e.key === "0") {
        e.preventDefault();
        api.resetZoom();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <UnifiedDashboardProvider>
          <TrainingProvider>
            <BreadcrumbProvider>
              <Toaster />
              <SonnerToaster richColors position="bottom-right" />
              <CommandPalette />
              <Router />
              <AICopilot />
            </BreadcrumbProvider>
          </TrainingProvider>
        </UnifiedDashboardProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
