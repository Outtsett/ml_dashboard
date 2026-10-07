import { Suspense, lazy, useEffect, type ComponentType } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "@/infrastructure/api/query_client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/shared/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { toast } from "sonner";
import { TooltipProvider } from "@/shared/ui/tooltip";
import Layout from "@/shared/layout/Layout";
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

// Lazy load non-critical overlay components to reduce main thread blocking during LCP
const AICopilot = lazy(() => import("@/shared/ai/AICopilot").then(m => ({ default: m.AICopilot })));
const ClaudePanel = lazy(() => import("@/claude/ClaudePanel").then(m => ({ default: m.ClaudePanel })));
const CommandPalette = lazy(() => import("@/shared/layout/CommandPalette").then(m => ({ default: m.CommandPalette })));

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
      console.error(`[beta] Chunk load failed for ${name} after retries:`, err);
      const lastReload = Number(sessionStorage.getItem("last_chunk_reload") || 0);
      const now = Date.now();
      if (now - lastReload > 15000) {
        sessionStorage.setItem("last_chunk_reload", String(now));
        window.location.reload();
      }
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

import Analytics from "@/analytics/AnalyticsPage";
registerComponentFactory("/analytics", () => Promise.resolve({ default: Analytics }));
// The Analytics tab is the many-runs complement of the run page (2026-10-07);
// `?tab=catalog` still opens the model catalog the Catalog nav item points at.
const CompareFactory = () => import("@/runs/compare/ComparePage");
const Compare = lazyRetry(CompareFactory, "Compare");
function AnalyticsRoute() {
  const catalog = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("tab") === "catalog";
  return catalog ? <Analytics /> : <Compare />;
}


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
registerComponentFactory("/model-catalog", ModelCatalogFactory);

const GlossaryFactory = () => import("@/ml/GlossaryPage");
const Glossary = lazyRetry(GlossaryFactory, "Glossary");
registerComponentFactory("/glossary", GlossaryFactory);



const FourierTransformFactory = () => import("@/ml/FourierTransformPage");
const FourierTransform = lazyRetry(FourierTransformFactory, "FourierTransform");
registerComponentFactory("/fourier", FourierTransformFactory);

// Training Domain
const TrainingFactory = () => import("@/runs/RunPage");
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

const DIKWPipelineFactory = () => import("@/inference/DIKWPipeline");
registerComponentFactory("/inference", DIKWPipelineFactory);

const NotFound = lazyRetry(() => import("@/shared/layout/not-found"), "NotFound");

function Router() {
  return (
    <Layout>
      <div className="flex-1 w-full h-full overflow-hidden bg-neutral-950">
        <Switch>
          <Route path="/">
            <ErrorBoundary>
              <Suspense fallback={<ChartSkeleton />}>
                <MarketData />
              </Suspense>
            </ErrorBoundary>
          </Route>

          {/* Redirects */}
          <Route path="/ml-studio"><Redirect to="/training" /></Route>
          <Route path="/ml-hub"><Redirect to="/ml-studio" /></Route>
          <Route path="/rl-console"><Redirect to="/ml-studio" /></Route>
          <Route path="/risk"><Redirect to="/ml-studio" /></Route>
          <Route path="/portfolio"><Redirect to="/ml-studio" /></Route>
          <Route path="/watchlist"><Redirect to="/" /></Route>
          
          {/* Main Domain Routes */}
          <Route path="/news"><ErrorBoundary><Suspense fallback={<DataGridSkeleton />}><News /></Suspense></ErrorBoundary></Route>
          <Route path="/regression"><ErrorBoundary><Suspense fallback={<PageLoader />}><Regression /></Suspense></ErrorBoundary></Route>
          <Route path="/analytics"><ErrorBoundary><Suspense fallback={<PageLoader />}><AnalyticsRoute /></Suspense></ErrorBoundary></Route>
          <Route path="/knowledge"><Redirect to="/studies" /></Route>
          <Route path="/feature-graph"><ErrorBoundary><Suspense fallback={<PageLoader />}><FeatureGraph /></Suspense></ErrorBoundary></Route>
          <Route path="/databases"><ErrorBoundary><Suspense fallback={<DataGridSkeleton />}><Databases /></Suspense></ErrorBoundary></Route>
          <Route path="/forecast"><ErrorBoundary><Suspense fallback={<PageLoader />}><Forecast /></Suspense></ErrorBoundary></Route>
          <Route path="/curriculum"><ErrorBoundary><Suspense fallback={<PageLoader />}><Curriculum /></Suspense></ErrorBoundary></Route>
          <Route path="/models"><Redirect to="/analytics?tab=catalog" /></Route>
          <Route path="/model-catalog"><Redirect to="/analytics?tab=catalog" /></Route>
          <Route path="/catalog"><Redirect to="/analytics?tab=catalog" /></Route>
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
          <Route path="/inference"><Redirect to="/analytics" /></Route>
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
              <Router />
              <Suspense fallback={null}>
                <CommandPalette />
                <AICopilot />
                <ClaudePanel />
              </Suspense>
            </BreadcrumbProvider>
          </TrainingProvider>
        </UnifiedDashboardProvider>
      </TooltipProvider>
      </DuckDBProvider>
    </QueryClientProvider>
  );
}

export default App;

