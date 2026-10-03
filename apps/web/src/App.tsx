import { Suspense, lazy, useEffect, type ComponentType } from "react";
import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "@/infrastructure/api/query_client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/shared/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { toast } from "sonner";
import { AICopilot } from "@/shared/ai/AICopilot";
import { ClaudePanel } from "@/claude/ClaudePanel";
import { TooltipProvider } from "@/shared/ui/tooltip";
import Layout from "@/shared/layout/Layout";
import { ResizableSidePanel } from "@/shared/layout/ResizableSidePanel";
import { BreadcrumbProvider } from "@/shared/hooks/useBreadcrumbs";
import { UnifiedDashboardProvider } from "@/shared/contexts/UnifiedDashboardContext";
import { DuckDBProvider } from "@/shared/contexts/DuckDBContext";
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

const RegressionFactory = () => import("@/market/regression/RegressionPage");
const Regression = lazyRetry(RegressionFactory, "Regression");
registerComponentFactory("/regression", RegressionFactory);
const AnalyticsFactory = () => import("@/analytics/AnalyticsPage");
const Analytics = lazyRetry(AnalyticsFactory, "Analytics");
registerComponentFactory("/analytics", AnalyticsFactory);


// Portfolio Domain

const PaperFactory = () => import("@/portfolio/PaperPage");
const Paper = lazyRetry(PaperFactory, "Paper");
registerComponentFactory("/paper", PaperFactory);

// Data Domain
const DatabasesFactory = () => import("@/data/DatabasesPage");
const Databases = lazyRetry(DatabasesFactory, "Databases");
registerComponentFactory("/databases", DatabasesFactory);

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

const CycleFactory = () => import("@/cycle/CyclePage");
const Cycle = lazyRetry(CycleFactory, "Cycle");
registerComponentFactory("/cycle", CycleFactory);

const LiveFactory = () => import("@/live/LivePage");
const Live = lazyRetry(LiveFactory, "Live");
registerComponentFactory("/live", LiveFactory);

const LabelsFactory = () => import("@/labels/LabelsPage");
const Labels = lazyRetry(LabelsFactory, "Labels");
registerComponentFactory("/labels", LabelsFactory);

const StudiesFactory = () => import("@/studies/StudiesPage");
const Studies = lazyRetry(StudiesFactory, "Studies");
registerComponentFactory("/studies", StudiesFactory);

const StudyFactory = () => import("@/studies/StudyPage");
const Study = lazyRetry(StudyFactory, "Study");

const FeatureGraphFactory = () => import("@/studies/pages/FeatureGraphPage");
const FeatureGraph = lazyRetry(FeatureGraphFactory, "FeatureGraph");
registerComponentFactory("/feature-graph", FeatureGraphFactory);

const EntityProfileFactory = () => import("@/entity/EntityProfilePage");
const EntityProfile = lazyRetry(EntityProfileFactory, "EntityProfile");

const NotFound = lazyRetry(() => import("@/shared/layout/not-found"), "NotFound");

function Router() {
  const [location] = useLocation();
  const isMarketData = location === "/";

  return (
    <Layout>
      <div className="flex flex-row flex-1 w-full h-full overflow-hidden">
        {/* Persistent Background Layer: The Global Chart.
            min-w-0: a flex item will not shrink below its content by default,
            and the chart canvas carries an explicit pixel width — without it,
            widening the side panel pushed the panel off-screen instead of
            narrowing the chart. */}
        <div className="flex-1 min-w-0 relative z-0 bg-neutral-950">
          <ErrorBoundary>
            <Suspense fallback={<ChartSkeleton />}>
              <MarketData />
            </Suspense>
          </ErrorBoundary>
        </div>

        {/* Foreground Overlay Layer */}
        {!isMarketData && (
          <ResizableSidePanel className="z-10 bg-neutral-950/90 backdrop-blur-2xl border-l border-white/5 shadow-[0_0_50px_rgba(0,0,0,0.5)] animate-in slide-in-from-right-8 duration-300">
            <Switch>
              {/* Redirects */}
              <Route path="/ml-hub"><Redirect to="/ml-studio" /></Route>
              <Route path="/rl-console"><Redirect to="/ml-studio" /></Route>
              <Route path="/risk"><Redirect to="/ml-studio" /></Route>
              <Route path="/portfolio"><Redirect to="/ml-studio" /></Route>
              <Route path="/watchlist"><Redirect to="/" /></Route>
              
              {/* Routes rendered in the side panel */}
              <Route path="/news"><ErrorBoundary><Suspense fallback={<DataGridSkeleton />}><News /></Suspense></ErrorBoundary></Route>
              <Route path="/regression"><ErrorBoundary><Suspense fallback={<PageLoader />}><Regression /></Suspense></ErrorBoundary></Route>
              <Route path="/analytics"><ErrorBoundary><Suspense fallback={<PageLoader />}><Analytics /></Suspense></ErrorBoundary></Route>
<Route path="/feature-graph"><ErrorBoundary><Suspense fallback={<PageLoader />}><FeatureGraph /></Suspense></ErrorBoundary></Route>
              <Route path="/databases"><ErrorBoundary><Suspense fallback={<DataGridSkeleton />}><Databases /></Suspense></ErrorBoundary></Route>
              <Route path="/forecast"><ErrorBoundary><Suspense fallback={<PageLoader />}><Forecast /></Suspense></ErrorBoundary></Route>
              <Route path="/curriculum"><ErrorBoundary><Suspense fallback={<PageLoader />}><Curriculum /></Suspense></ErrorBoundary></Route>
              <Route path="/models"><ErrorBoundary><Suspense fallback={<PageLoader />}><ModelCatalog /></Suspense></ErrorBoundary></Route>
              <Route path="/glossary"><ErrorBoundary><Suspense fallback={<PageLoader />}><Glossary /></Suspense></ErrorBoundary></Route>
              <Route path="/fourier"><ErrorBoundary><Suspense fallback={<PageLoader />}><FourierTransform /></Suspense></ErrorBoundary></Route>
              <Route path="/paper"><ErrorBoundary><Suspense fallback={<DataGridSkeleton />}><Paper /></Suspense></ErrorBoundary></Route>
              <Route path="/terminals"><ErrorBoundary><Suspense fallback={<PageLoader />}><Terminals /></Suspense></ErrorBoundary></Route>
              <Route path="/hardware"><ErrorBoundary><Suspense fallback={<PageLoader />}><Hardware /></Suspense></ErrorBoundary></Route>
              <Route path="/lens"><ErrorBoundary><Suspense fallback={<PageLoader />}><Lens /></Suspense></ErrorBoundary></Route>
              <Route path="/marimo"><ErrorBoundary><Suspense fallback={<PageLoader />}><Marimo /></Suspense></ErrorBoundary></Route>
              <Route path="/cycle"><ErrorBoundary><Suspense fallback={<PageLoader />}><Cycle /></Suspense></ErrorBoundary></Route>
              <Route path="/labels"><ErrorBoundary><Suspense fallback={<PageLoader />}><Labels /></Suspense></ErrorBoundary></Route>
              <Route path="/studies"><ErrorBoundary><Suspense fallback={<PageLoader />}><Studies /></Suspense></ErrorBoundary></Route>
              <Route path="/studies/:slug"><ErrorBoundary><Suspense fallback={<PageLoader />}><Study /></Suspense></ErrorBoundary></Route>
              <Route path="/live"><ErrorBoundary><Suspense fallback={<PageLoader />}><Live /></Suspense></ErrorBoundary></Route>
              <Route path="/settings"><ErrorBoundary><Suspense fallback={<PageLoader />}><Settings /></Suspense></ErrorBoundary></Route>
              <Route path="/training"><ErrorBoundary><Suspense fallback={<PageLoader />}><Training /></Suspense></ErrorBoundary></Route>
              <Route path="/entity/:type/:id"><ErrorBoundary><Suspense fallback={<PageLoader />}><EntityProfile /></Suspense></ErrorBoundary></Route>

              {/* Catch-all */}
              <Route>
                <ErrorBoundary>
                  <Suspense fallback={<PageLoader />}>
                    <NotFound />
                  </Suspense>
                </ErrorBoundary>
              </Route>
            </Switch>
          </ResizableSidePanel>
        )}
      </div>
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
      <DuckDBProvider>
      <TooltipProvider>
        <UnifiedDashboardProvider>
          <TrainingProvider>
            <BreadcrumbProvider>
              <Toaster />
              <SonnerToaster richColors position="bottom-right" />
              <CommandPalette />
              <Router />
              <AICopilot />
              <ClaudePanel />
            </BreadcrumbProvider>
          </TrainingProvider>
        </UnifiedDashboardProvider>
      </TooltipProvider>
      </DuckDBProvider>
    </QueryClientProvider>
  );
}

export default App;

