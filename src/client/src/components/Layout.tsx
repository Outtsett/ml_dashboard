import { useState, useEffect, useMemo } from "react";
import { PanelLeftClose, PanelLeftOpen, Menu, TerminalSquare } from "lucide-react";
import { useLocation } from "wouter";
import { useBreadcrumbItems } from "@/hooks/useBreadcrumbs";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/Logo";
import { Titlebar } from "@/components/desktop/Titlebar";
import { NAVIGATION_CONFIG, ROUTE_META } from "@/lib/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";

// New specialized sub-components
import { SystemStats } from "./layout/SystemStats";
import { NavItemComponent } from "./layout/NavItem";
import { BreadcrumbNavigator } from "./layout/BreadcrumbNavigator";
import { TerminalTabs } from "./terminal/TerminalTabs";

const SIDEBAR_COLLAPSED_KEY = "sidebar_collapsed";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const subCrumbs = useBreadcrumbItems();
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true"; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed)); } catch { /* */ }
  }, [collapsed]);

  // Keyboard shortcut: Ctrl+B to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setTerminalOpen(o => !o);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setCollapsed(c => !c);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Auto-close mobile sidebar on navigation
  useEffect(() => {
    if (isMobile) setMobileOpen(false);
  }, [location, isMobile]);

  // Resolve the current page from the route
  const currentRoute = useMemo(() => {
    if (ROUTE_META[location]) return ROUTE_META[location];
    const baseRoute = Object.keys(ROUTE_META)
      .filter(route => route !== '/')
      .find(route => location.startsWith(route));
    return baseRoute ? ROUTE_META[baseRoute] : ROUTE_META["/"];
  }, [location]);

    const isFullWidthPage = location === "/terminals" || location === "/hardware" || location === "/fourier";
  const effectiveCollapsed = isMobile ? false : collapsed;
  const sidebarBg = 'linear-gradient(180deg, hsl(220, 20%, 8%) 0%, hsl(220, 20%, 12%) 100%)';

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen bg-background text-foreground flex font-sans selection:bg-primary/30 selection:text-primary-foreground">
        <Titlebar />
        
        {isMobile && mobileOpen && (
          <div 
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-30 transition-opacity" 
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside
          className={cn(
            "border-r border-border/50 flex flex-col fixed h-full z-40 transition-all duration-300 ease-in-out",
            effectiveCollapsed ? "w-14" : "w-64",
            isMobile && !mobileOpen ? "-translate-x-full" : "translate-x-0"
          )}
          style={{ background: sidebarBg }}
        >
          {/* Header/Logo */}
          <div className="p-4 border-b border-border/50 relative group">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="h-9 w-9 min-w-[2.25rem] flex items-center justify-center bg-primary/10 rounded-xl border border-primary/20 group-hover:border-primary/40 transition-colors shadow-inner">
                <Logo className="h-6 w-6 text-primary" />
              </div>
              {!effectiveCollapsed && (
                <div className="whitespace-nowrap transition-all duration-300">
                  <span className="text-xl font-display font-bold tracking-tight text-foreground/90">
                    Quant<span className="text-primary text-glow">AI</span>
                  </span>
                  <p className="text-[9px] font-mono text-muted-foreground uppercase tracking-[0.2em] opacity-60 leading-tight">Forex Engine</p>
                </div>
              )}
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-6 overflow-y-auto scrollbar-none">
            {NAVIGATION_CONFIG.map((group, groupIdx) => (
              <div key={groupIdx} className="space-y-1.5">
                {!effectiveCollapsed && (
                  <div className="px-3 text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em] mb-2 opacity-50">
                    {group.title}
                  </div>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavItemComponent 
                      key={item.href} 
                      item={item} 
                      isActive={location === item.href || (item.href !== '/' && location.startsWith(item.href))}
                      collapsed={effectiveCollapsed}
                    />
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* Footer Area */}
          <div className="mt-auto">
            <SystemStats collapsed={effectiveCollapsed} />
            
            <div className="p-3 relative">
              <div className="absolute top-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-border/50 to-transparent" />
              <div className="flex items-center gap-3 pt-1">
                {!effectiveCollapsed && (
                  <>
                    <div className="h-8 w-8 bg-muted/40 rounded-lg flex items-center justify-center p-2 border border-border/50">
                      <Logo className="opacity-70" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-foreground/80">v2.4.1</p>
                      <div className="flex items-center gap-1.5">
                        <div className="h-1.5 w-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                        <p className="text-[10px] text-muted-foreground font-semibold font-mono">NODE_ALGO_CONNECTED</p>
                      </div>
                    </div>
                  </>
                )}
                <button
                  onClick={() => setCollapsed(c => !c)}
                  className={cn(
                    "h-8 w-8 flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all rounded-lg border border-transparent hover:border-primary/20",
                    effectiveCollapsed ? "mx-auto" : "ml-auto"
                  )}
                  title={effectiveCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
                >
                  {effectiveCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </aside>

        <main className={cn(
          "flex-1 min-w-0 flex flex-col h-screen overflow-hidden transition-all duration-300 ease-in-out",
          effectiveCollapsed ? "ml-14" : "ml-64",
          isMobile && "ml-0"
        )}>
          {isMobile && (
            <div className="h-14 border-b border-border bg-background flex items-center px-4 shrink-0 z-30 sticky top-0">
              <button 
                onClick={() => setMobileOpen(true)}
                className="p-2 -ml-2 text-muted-foreground hover:text-foreground"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex-1 flex justify-center pr-8">
                <Logo className="h-6 w-6 text-primary" />
              </div>
            </div>
          )}

          <BreadcrumbNavigator 
            location={location} 
            subCrumbs={subCrumbs} 
            currentRoute={currentRoute} 
          />

          <div className={cn("flex-1 min-h-0 overflow-auto w-full scroll-smooth bg-muted/5", isFullWidthPage ? "p-0" : "p-0")}>
            <div className={cn("animate-in fade-in slide-in-from-bottom-1 duration-200", isFullWidthPage ? "w-full h-full space-y-0" : "w-full h-full space-y-0")}>
              {children}
            </div>
          </div>
        </main>
      </div>
      {/* Global Terminal Pop-out */}
      <div className={cn(
        "fixed bottom-0 right-0 left-0 z-50 bg-background/95 backdrop-blur-xl border-t border-white/10 transition-all duration-500 ease-in-out transform",
        terminalOpen ? "h-[45vh] translate-y-0" : "h-0 translate-y-full"
      )}>
        <div className="absolute -top-10 right-6 flex items-center gap-2">
          <button 
            onClick={() => setTerminalOpen(!terminalOpen)}
            className="h-10 px-4 flex items-center gap-2 bg-primary text-primary-foreground rounded-t-xl font-bold text-[10px] uppercase tracking-widest shadow-lg hover:bg-primary/90 transition-colors"
          >
            <TerminalSquare className="h-3.5 w-3.5" />
            {terminalOpen ? "Close Terminal" : "Open Terminal"}
          </button>
        </div>
        
        {terminalOpen && (
          <div className="h-full w-full overflow-hidden p-1">
            <TerminalTabs visible={terminalOpen} showTrainingTab={true} />
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
