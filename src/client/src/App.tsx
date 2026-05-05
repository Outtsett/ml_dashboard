import { Suspense, lazy, useEffect, type ComponentType } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/query_client";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "sonner";
import { toast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Layout from "@/components/Layout";
import { BreadcrumbProvider } from "@/hooks/useBreadcrumbs";
import { UnifiedDashboardProvider } from "@/contexts/UnifiedDashboardContext";
import { TrainingProvider } from "@/contexts/TrainingContext";
import { ChatProvider } from "@/contexts/ChatContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  DataGridSkeleton,
  ChartSkeleton,
  PageLoader
} from "@/components/LoadingSkeletons";
import { prefetchCriticalData, registerComponentFactory } from "./lib/prefetch";
import { useWebVitals } from './hooks/useWebVitals';
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts';
import { useNativeMenu } from '@/hooks/useNativeMenu';
import { CommandPalette } from "@/components/CommandPalette";

// Retry wrapper for dynamic imports ï¿½ handles stale chunks after HMR updates
function lazyRetry(
  factory: () => Promise<{ default: ComponentType<any> }>,
  name: string,
  retries = 2,
): ReturnType<typeof lazy> {
  return lazy(() =>
    factory().catch((err: Error) => {
      if (retries > 0 && /dynamically imported module|fetch/i.test(err.message)) {
        console.warn(`[beta] Chunk stale for ${name}, retrying (${retries} left)ï¿½`);
        return new Promise<{ default: ComponentType<any> }>((resolve) =>
          setTimeout(() => resolve(lazyRetry(factory, name, retries - 1) as any), 800),
        );
      }
      // Final retry failed ï¿½ force full reload to pick up new manifest
      console.error(`[beta] Chunk load failed for ${name} after retries, reloadingï¿½`);
      window.location.reload();
      return { default: (() => null) as unknown as ComponentType<any> };
    }),
  );
}

const MarketDataFactory = () => import("@/pages/MarketData");
const MarketData = lazyRetry(MarketDataFactory, "MarketData");
registerComponentFactory("/", MarketDataFactory);

const PortfolioFactory = () => import("@/pages/Portfolio");
const Portfolio = lazyRetry(PortfolioFactory, "Portfolio");
registerComponentFactory("/portfolio", PortfolioFactory);

const DatabasesFactory = () => import("@/pages/Databases");
const Databases = lazyRetry(DatabasesFactory, "Databases");
registerComponentFactory("/databases", DatabasesFactory);

const WatchlistFactory = () => import("@/pages/Watchlist");
const Watchlist = lazyRetry(WatchlistFactory, "Watchlist");
registerComponentFactory("/watchlist", WatchlistFactory);

const NewsFactory = () => import("@/pages/News");
const News = lazyRetry(NewsFactory, "News");
registerComponentFactory("/news", NewsFactory);

const MLStudioFactory = () => import("@/pages/MLStudio");
const MLStudio = lazyRetry(MLStudioFactory, "MLStudio");
registerComponentFactory("/ml-studio", MLStudioFactory);

const TerminalsFactory = () => import("@/pages/Terminals");
const Terminals = lazyRetry(TerminalsFactory, "Terminals");
registerComponentFactory("/terminals", TerminalsFactory);

const HardwareFactory = () => import("@/pages/Hardware");
const Hardware = lazyRetry(HardwareFactory, "Hardware");
registerComponentFactory("/hardware", HardwareFactory);


const ModelCatalogFactory = () => import("@/pages/ModelCatalog");
const ModelCatalog = lazyRetry(ModelCatalogFactory, "ModelCatalog");
registerComponentFactory("/model-catalog", ModelCatalogFactory);

const FourierTransformFactory = () => import("@/pages/FourierTransform");
const FourierTransform = lazyRetry(FourierTransformFactory, "FourierTransform");
registerComponentFactory("/fourier", FourierTransformFactory);

const ArchitectureExplorerFactory = () => import("@/pages/ArchitectureExplorer");
const ArchitectureExplorer = lazyRetry(ArchitectureExplorerFactory, "ArchitectureExplorer");
registerComponentFactory("/architecture", ArchitectureExplorerFactory);

const SettingsFactory = () => import("@/pages/Settings");
const Settings = lazyRetry(SettingsFactory, "Settings");
registerComponentFactory("/settings", SettingsFactory);

const NotFound = lazyRetry(() => import("@/pages/not-found"), "NotFound");

/**
 * Route definition helper to ensure consistent suspense and error boundary wrapping
 */
const AppRoute = ({ path, component: Component, fallback = <PageLoader /> }: { 
  path: string, 
  component: ComponentType<any>, 
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
        
        <Route path="/ml-hub">
          <Redirect to="/ml-studio" />
        </Route>
        
        <AppRoute path="/portfolio" component={Portfolio} fallback={<DataGridSkeleton />} />
        <AppRoute path="/watchlist" component={Watchlist} fallback={<DataGridSkeleton />} />
        <AppRoute path="/news" component={News} fallback={<DataGridSkeleton />} />
        <AppRoute path="/databases" component={Databases} fallback={<DataGridSkeleton />} />
        
        <AppRoute path="/ml-studio" component={MLStudio} />
        <AppRoute path="/model-catalog" component={ModelCatalog} />
        <AppRoute path="/fourier" component={FourierTransform} />
        <AppRoute path="/architecture" component={ArchitectureExplorer} />
        
        <AppRoute path="/terminals" component={Terminals} />
        <AppRoute path="/hardware" component={Hardware} />
        
        <AppRoute path="/settings" component={Settings} />
        
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
    const api = (window as any).electronAPI;
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
            <ChatProvider>
            <BreadcrumbProvider>
              <Toaster />
              <SonnerToaster richColors position="bottom-right" />
              <CommandPalette />
              <Router />
            </BreadcrumbProvider>
            </ChatProvider>
          </TrainingProvider>
        </UnifiedDashboardProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;



