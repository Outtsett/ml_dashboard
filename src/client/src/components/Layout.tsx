import { useState, useEffect } from "react";
import { Home, LineChart, Database, Settings, Server, BarChart2, List, Newspaper, ChevronRight, PanelLeftClose, PanelLeftOpen, BrainCircuit, BookOpen } from "lucide-react";
import { Link, useLocation } from "wouter";
import { prefetchOnHover } from "@/lib/prefetch";
import { useBreadcrumbItems } from "@/hooks/useBreadcrumbs";
import { Logo } from "@/components/ui/Logo";
import { Titlebar } from "@/components/desktop/Titlebar";
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
  "/ml-studio": { label: "ML Studio", icon: BrainCircuit },
  "/model-catalog": { label: "Model Catalog", icon: BookOpen },
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

  const navGroups = [
    {
      title: "Market & Data",
      items: [
        { icon: Database, label: "Market Data", href: "/" },
        { icon: List, label: "Watchlist", href: "/watchlist" },
        { icon: Newspaper, label: "News", href: "/news" },
        { icon: Server, label: "Databases", href: "/databases" },
      ]
    },
    {
      title: "Analysis & Models",
      items: [
        { icon: BrainCircuit, label: "ML Studio", href: "/ml-studio" },
        { icon: BookOpen, label: "Model Catalog", href: "/model-catalog" },
      ]
    },
    {
      title: "Execution",
      items: [
        { icon: BarChart2, label: "Portfolio", href: "/portfolio" },
      ]
    },
    {
      title: "System",
      items: [
        { icon: Settings, label: "Settings", href: "/settings" },
      ]
    }
  ];

  return (
    <TooltipProvider delayDuration={200}>
    <div className="min-h-screen bg-background text-foreground flex font-sans">
      <Titlebar />
      <aside
        className={`border-r border-border flex flex-col fixed h-full z-20 transition-all duration-200 ease-in-out ${
          collapsed ? "w-14" : "w-56"
        }`}
        style={{ background: 'linear-gradient(180deg, hsl(220, 15%, 7%) 0%, hsl(220, 15%, 9.5%) 100%)' }}
      >
        {/* Logo */}
        <div className="p-4 border-b border-border relative">
          <div className="flex items-center gap-2 overflow-hidden">
            <div className="h-8 w-8 min-w-[2rem] flex items-center justify-center">
              <Logo className="h-full w-full" />
            </div>
            {!collapsed && (
              <div className="whitespace-nowrap">
                <span className="text-lg font-display font-semibold tracking-tight">Quant<span className="text-primary text-glow">AI</span></span>
                <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest opacity-70">Intelligence</p>
              </div>
            )}
          </div>
          <div className="absolute bottom-0 left-3 right-3 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-4 overflow-y-auto">
          {navGroups.map((group, groupIdx) => (
            <div key={groupIdx} className="space-y-1">
              {!collapsed && (
                <div className="px-3 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {group.title}
                </div>
              )}
              {group.items.map((item) => {
                const isActive = location === item.href || (item.href !== '/' && location.startsWith(item.href));
                const navContent = (
                  <Link key={item.href} href={item.href}>
                    <div
                      data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                      className={`flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-all text-sm rounded-md ${
                        isActive
                          ? "bg-primary/10 text-primary font-medium border-l-[3px] border-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-l-[3px] border-transparent"
                      }`}
                      onMouseEnter={prefetchOnHover(item.href)}
                    >
                      <item.icon className={`min-w-[1rem] transition-all ${isActive ? "h-[1.125rem] w-[1.125rem] text-primary drop-shadow-[0_0_6px_hsla(210,50%,55%,0.4)]" : "h-4 w-4"}`} />
                      {!collapsed && <span className="whitespace-nowrap">{item.label}</span>}
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
            </div>
          ))}
        </nav>

        {/* System stats — hidden when collapsed */}
        {!collapsed && (
          <div className="p-3 border-t border-border">
            <div className="bg-muted/50 p-3 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">System</span>
                <span className="text-[10px] font-mono text-emerald-500">Online</span>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>CPU</span>
                  <span className="font-mono">23%</span>
                </div>
                <div className="h-1.5 bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-primary/60 w-[23%] rounded-full transition-all duration-700 ease-out" />
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>GPU</span>
                  <span className="font-mono">54%</span>
                </div>
                <div className="h-1.5 bg-border rounded-full overflow-hidden">
                  <div className="h-full bg-accent/60 w-[54%] rounded-full transition-all duration-700 ease-out" />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Collapse toggle + version */}
        <div className="p-3 relative">
          <div className="absolute top-0 left-3 right-3 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
          <div className="flex items-center gap-2 pt-1">
            {!collapsed && (
              <>
                <div className="h-7 w-7 bg-muted rounded flex items-center justify-center p-1.5">
                  <Logo />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">v2.4.1</p>
                  <div className="flex items-center gap-1.5">
                    <div className="h-1.5 w-1.5 bg-emerald-500 rounded-full animate-pulse" />
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

      <main className={`flex-1 min-w-0 flex flex-col h-screen overflow-hidden transition-all duration-200 ease-in-out ${collapsed ? "ml-14" : "ml-56"}`}>
        {/* Breadcrumb bar */}
        {(() => {
          const RouteIcon = currentRoute?.icon || Home;
          return (
        <div className={`border-b border-border bg-background/95 supports-[backdrop-filter]:bg-background/60 backdrop-blur px-4 pb-2 shrink-0 z-10 sticky top-0 shadow-[0_1px_3px_0_rgba(0,0,0,0.25)] ${window.electronAPI ? 'pt-[36px]' : 'pt-4 drag-region'}`}>
          <Breadcrumb className="no-drag">
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
                  <BreadcrumbPage className="flex items-center gap-1.5 text-sm font-medium">
                    <RouteIcon className="h-3.5 w-3.5 text-primary/70" />
                    {currentRoute?.label || "Page"}
                  </BreadcrumbPage>
                </BreadcrumbSlot>
              ) : (
                <>
                  <BreadcrumbSlot>
                    <BreadcrumbLink asChild>
                      <Link href={location} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                        <RouteIcon className="h-3.5 w-3.5" />
                        {currentRoute?.label || "Page"}
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
                          <BreadcrumbPage className="flex items-center gap-1.5 text-sm font-medium">
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
          );
        })()}

        <div className="p-4 flex-1 min-h-0 overflow-auto w-full">
          {children}
        </div>
      </main>
    </div>
    </TooltipProvider>
  );
}
