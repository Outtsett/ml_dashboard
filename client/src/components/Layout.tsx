import { useState, useEffect } from "react";
import { Home, LineChart, Database, Settings, Server, BarChart2, List, Newspaper, ChevronRight, PanelLeftClose, PanelLeftOpen, Network, Brain, FlaskConical, AudioWaveform, LayoutDashboard } from "lucide-react";
import { Link, useLocation } from "wouter";
import { prefetchOnHover } from "@/lib/prefetch";
import { useBreadcrumbItems } from "@/hooks/useBreadcrumbs";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem as BreadcrumbSlot,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

const SIDEBAR_COLLAPSED_KEY = "sidebar_collapsed";

const routeMeta: Record<string, { label: string; icon: typeof Home }> = {
  "/": { label: "Market Data", icon: Database },
  "/dashboard": { label: "Dashboard", icon: LayoutDashboard },
  "/training": { label: "Training", icon: Brain },
  "/backtest": { label: "Backtest", icon: FlaskConical },
  "/fourier": { label: "Fourier", icon: AudioWaveform },
  "/architecture": { label: "Architecture", icon: Network },
  "/portfolio": { label: "Portfolio", icon: BarChart2 },
  "/watchlist": { label: "Watchlist", icon: List },
  "/news": { label: "News", icon: Newspaper },
  "/databases": { label: "Databases", icon: Server },
  "/settings": { label: "Settings", icon: Settings },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const subCrumbs = useBreadcrumbItems();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed)); } catch { /* */ }
  }, [collapsed]);

  // Keyboard shortcut: Ctrl+B to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setCollapsed(c => !c);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Resolve the current page from the route
  const currentRoute = routeMeta[location] ?? routeMeta["/"];

  const navItems = [
    { icon: Database, label: "Market Data", href: "/" },
    { icon: LayoutDashboard, label: "Dashboard", href: "/dashboard" },
    { icon: Brain, label: "Training", href: "/training" },
    { icon: FlaskConical, label: "Backtest", href: "/backtest" },
    { icon: AudioWaveform, label: "Fourier", href: "/fourier" },
    { icon: Network, label: "Architecture", href: "/architecture" },
    { icon: BarChart2, label: "Portfolio", href: "/portfolio" },
    { icon: List, label: "Watchlist", href: "/watchlist" },
    { icon: Newspaper, label: "News", href: "/news" },
    { icon: Server, label: "Databases", href: "/databases" },
    { icon: Settings, label: "Settings", href: "/settings" },
  ];

  return (
    <TooltipProvider delayDuration={200}>
    <div className="min-h-screen bg-background text-foreground flex font-sans">
      <aside
        className={`bg-card border-r border-border flex flex-col fixed h-full z-20 transition-all duration-200 ease-in-out ${
          collapsed ? "w-14" : "w-56"
        }`}
      >
        {/* Logo */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="h-8 w-8 min-w-[2rem] bg-primary/20 border border-primary/30 flex items-center justify-center">
              <LineChart className="h-4 w-4 text-primary" />
            </div>
            {!collapsed && (
              <div className="whitespace-nowrap">
                <span className="text-lg font-display font-semibold">Quant<span className="text-primary">AI</span></span>
                <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider">Trading System</p>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navItems.map((item) => {
            const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
            const navContent = (
              <Link key={item.href} href={item.href}>
                <div
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                  className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-all text-sm ${
                    isActive
                      ? "bg-primary/10 text-foreground border-l-2 border-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  }`}
                  onMouseEnter={prefetchOnHover(item.href)}
                >
                  <item.icon className={`h-4 w-4 min-w-[1rem] ${isActive ? "text-primary" : ""}`} />
                  {!collapsed && <span className="font-medium whitespace-nowrap">{item.label}</span>}
                </div>
              </Link>
            );

            if (collapsed) {
              return (
                <Tooltip key={item.href}>
                  <TooltipTrigger asChild>{navContent}</TooltipTrigger>
                  <TooltipContent side="right" sideOffset={8}>
                    <p className="text-xs font-medium">{item.label}</p>
                  </TooltipContent>
                </Tooltip>
              );
            }
            return navContent;
          })}
        </nav>

        {/* System stats — hidden when collapsed */}
        {!collapsed && (
          <div className="p-3 border-t border-border">
            <div className="bg-muted/50 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">System</span>
                <span className="text-[10px] font-mono text-emerald-500">Online</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>CPU</span>
                  <span className="font-mono">42%</span>
                </div>
                <div className="h-1 bg-border overflow-hidden">
                  <div className="h-full bg-primary/60 w-[42%]" />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>GPU</span>
                  <span className="font-mono">78%</span>
                </div>
                <div className="h-1 bg-border overflow-hidden">
                  <div className="h-full bg-accent/60 w-[78%]" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Collapse toggle + version */}
        <div className="p-3 border-t border-border">
          <div className="flex items-center gap-2">
            {!collapsed && (
              <>
                <div className="h-7 w-7 bg-muted flex items-center justify-center text-xs font-mono text-muted-foreground">Q</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">v2.4.1</p>
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 bg-emerald-500 rounded-full" />
                    <p className="text-[10px] text-muted-foreground font-mono">Active</p>
                  </div>
                </div>
              </>
            )}
            <button
              onClick={() => setCollapsed(c => !c)}
              className={`h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors rounded ${
                collapsed ? "mx-auto" : "ml-auto"
              }`}
              title={collapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </aside>

      <main className={`flex-1 min-w-0 transition-all duration-200 ease-in-out ${collapsed ? "ml-14" : "ml-56"}`}>
        {/* Breadcrumb bar */}
        <div className="border-b border-border bg-card/50 backdrop-blur-sm px-4 py-2 sticky top-0 z-10">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbSlot>
                <BreadcrumbLink asChild>
                  <Link href="/" className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
                    <Home className="h-3.5 w-3.5" />
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbSlot>

              <BreadcrumbSeparator>
                <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
              </BreadcrumbSeparator>

              {subCrumbs.length === 0 ? (
                <BreadcrumbSlot>
                  <BreadcrumbPage className="flex items-center gap-1.5 text-xs font-medium">
                    <currentRoute.icon className="h-3.5 w-3.5 text-primary/70" />
                    {currentRoute.label}
                  </BreadcrumbPage>
                </BreadcrumbSlot>
              ) : (
                <>
                  <BreadcrumbSlot>
                    <BreadcrumbLink asChild>
                      <Link href={location} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <currentRoute.icon className="h-3.5 w-3.5" />
                        {currentRoute.label}
                      </Link>
                    </BreadcrumbLink>
                  </BreadcrumbSlot>

                  {subCrumbs.map((crumb, i) => (
                    <span key={i} className="contents">
                      <BreadcrumbSeparator>
                        <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                      </BreadcrumbSeparator>
                      <BreadcrumbSlot>
                        {i === subCrumbs.length - 1 ? (
                          <BreadcrumbPage className="flex items-center gap-1.5 text-xs font-medium">
                            {crumb.icon && <crumb.icon className="h-3.5 w-3.5 text-primary/70" />}
                            {crumb.label}
                          </BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink
                            {...(crumb.href ? { asChild: true } : {})}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {crumb.href ? (
                              <Link href={crumb.href}>
                                {crumb.icon && <crumb.icon className="h-3.5 w-3.5" />}
                                {crumb.label}
                              </Link>
                            ) : (
                              <>
                                {crumb.icon && <crumb.icon className="h-3.5 w-3.5" />}
                                {crumb.label}
                              </>
                            )}
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbSlot>
                    </span>
                  ))}
                </>
              )}
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        <div className="p-4 max-w-[1800px] mx-auto">
          {children}
        </div>
      </main>
    </div>
    </TooltipProvider>
  );
}
