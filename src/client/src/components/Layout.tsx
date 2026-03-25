import React, { useState, useEffect, useMemo } from "react";
import { ChevronRight, PanelLeftClose, PanelLeftOpen, Menu, Home, LucideIcon } from "lucide-react";
import { Link, useLocation } from "wouter";
import { prefetchOnHover } from "@/lib/prefetch";
import { useBreadcrumbItems } from "@/hooks/useBreadcrumbs";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/Logo";
import { Titlebar } from "@/components/desktop/Titlebar";
import { NAVIGATION_CONFIG, ROUTE_META } from "@/lib/navigation";
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

/**
 * System Statistics Component (Internal to Layout)
 */
const SystemStats = ({ collapsed }: { collapsed: boolean }) => {
  if (collapsed) return null;
  
  return (
    <div className="p-3 border-t border-border/50">
      <div className="bg-muted/30 p-3 rounded-lg space-y-2 border border-border/50">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">System</span>
          <span className="text-[10px] font-mono text-emerald-500 font-bold">Online</span>
        </div>
        <StatBar label="CPU" value={23} />
        <StatBar label="GPU" value={54} color="bg-accent/60" />
      </div>
    </div>
  );
};

const StatBar = ({ label, value, color = "bg-primary/60" }: { label: string; value: number, color?: string }) => (
  <div className="space-y-1.5">
    <div className="flex justify-between text-[10px] text-muted-foreground font-medium">
      <span>{label}</span>
      <span className="font-mono">{value}%</span>
    </div>
    <div className="h-1 bg-border/50 rounded-full overflow-hidden">
      <div 
        className={cn("h-full rounded-full transition-all duration-700 ease-out", color)} 
        style={{ width: `${value}%` }} 
      />
    </div>
  </div>
);

/**
 * Navigation Item Component
 */
const NavItemComponent = ({ 
  item, 
  isActive, 
  collapsed 
}: { 
  item: typeof NAVIGATION_CONFIG[0]['items'][0], 
  isActive: boolean, 
  collapsed: boolean 
}) => {
  const Icon = item.icon;
  
  const content = (
    <Link href={item.href}>
      <div
        data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
        className={cn(
          "flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-all text-sm rounded-md group relative",
          isActive
            ? "bg-primary/10 text-primary font-semibold border-l-[3px] border-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-l-[3px] border-transparent"
        )}
        onMouseEnter={prefetchOnHover(item.href)}
      >
        <Icon className={cn(
          "min-w-[1rem] transition-all shrink-0",
          isActive 
            ? "h-[1.125rem] w-[1.125rem] text-primary drop-shadow-[0_0_8px_hsla(210,100%,60%,0.5)]" 
            : "h-4 w-4 group-hover:scale-110"
        )} />
        {!collapsed && <span className="whitespace-nowrap truncate">{item.label}</span>}
        {isActive && !collapsed && (
          <div className="absolute right-2 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
        )}
      </div>
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={12} className="bg-popover border-border text-popover-foreground shadow-xl">
          <p className="text-xs font-bold">{item.label}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
};

/**
 * Breadcrumb Navigator Component
 */
const BreadcrumbNavigator = ({ location, subCrumbs, currentRoute }: { 
  location: string, 
  subCrumbs: any[], 
  currentRoute: any 
}) => {
  const RouteIcon = currentRoute?.icon || Home;
  
  return (
    <div className={cn(
      "border-b border-border bg-background/95 supports-[backdrop-filter]:bg-background/60 backdrop-blur px-4 pb-2 shrink-0 z-10 sticky top-0 shadow-sm",
      window.electronAPI ? "pt-[36px]" : "pt-4 drag-region"
    )}>     
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
            <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
          </BreadcrumbSeparator>

          {subCrumbs.length === 0 ? (
            <BreadcrumbSlot>
              <BreadcrumbPage className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                <RouteIcon className="h-3.5 w-3.5 text-primary/80" />
                {currentRoute?.label || "Page"}
              </BreadcrumbPage>
            </BreadcrumbSlot>
          ) : (
            <>
              <BreadcrumbSlot>
                <BreadcrumbLink asChild>
                  <Link href={location} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium">
                    <RouteIcon className="h-3.5 w-3.5" />
                    {currentRoute?.label || "Page"}
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbSlot>

              {subCrumbs.map((crumb, i) => (
                <React.Fragment key={i}>
                  <BreadcrumbSeparator>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
                  </BreadcrumbSeparator>
                  <BreadcrumbSlot>
                    {i === subCrumbs.length - 1 ? (
                      <BreadcrumbPage className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                        {crumb.icon && <crumb.icon className="h-3.5 w-3.5 text-primary/80" />}
                        {crumb.label}
                      </BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink
                        {...(crumb.href ? { asChild: true } : {})}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
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
                </React.Fragment>
              ))}
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
};

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const subCrumbs = useBreadcrumbItems();
  const isMobile = useIsMobile();
  const [mobileOpen, setMobileOpen] = useState(false);
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

  // Auto-close mobile sidebar on navigation
  useEffect(() => {
    if (isMobile) setMobileOpen(false);
  }, [location, isMobile]);

  // Resolve the current page from the route
  const currentRoute = useMemo(() => {
    // Exact match
    if (ROUTE_META[location]) return ROUTE_META[location];
    // Prefix match for nested routes (e.g., /ml-studio/subpage)
    const baseRoute = Object.keys(ROUTE_META)
      .filter(route => route !== '/')
      .find(route => location.startsWith(route));
    return baseRoute ? ROUTE_META[baseRoute] : ROUTE_META["/"];
  }, [location]);

  const effectiveCollapsed = isMobile ? false : collapsed;

  const sidebarBg = 'linear-gradient(180deg, hsl(220, 20%, 8%) 0%, hsl(220, 20%, 12%) 100%)';

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-screen bg-background text-foreground flex font-sans selection:bg-primary/30 selection:text-primary-foreground">
        <Titlebar />
        
        {/* Desktop Sidebar / Mobile Drawer Overlay */}
        {isMobile && mobileOpen && (
          <div 
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-30 transition-opacity" 
            onClick={() => setMobileOpen(false)}
          />
        )}

        <aside
          className={cn(
            "border-r border-border/50 flex flex-col fixed h-full z-40 transition-all duration-300 ease-in-out",
            effectiveCollapsed ? "w-14" : "w-56",
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
            {!effectiveCollapsed && (
              <div className="absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent opacity-50" />
            )}
          </div>

          {/* Navigation Scroll Area */}
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

          {/* System Footer Area */}
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
                {/* Hide collapse toggle on mobile — sidebar is overlay */}
                {!isMobile && (
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
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className={cn(
          "flex-1 min-w-0 flex flex-col h-screen overflow-hidden transition-all duration-300 ease-in-out",
          effectiveCollapsed ? "ml-14" : "ml-56",
          isMobile && "ml-0"
        )}>
          {/* Top Bar for Mobile Menu */}
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

          {/* Breadcrumbs Section */}
          <BreadcrumbNavigator 
            location={location} 
            subCrumbs={subCrumbs} 
            currentRoute={currentRoute} 
          />

          {/* Page Content Section */}
          <div className="p-4 md:p-6 flex-1 min-h-0 overflow-auto w-full scroll-smooth bg-muted/5">
            <div className="max-w-[1600px] mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
              {children}
            </div>
          </div>
        </main>
      </div>
    </TooltipProvider>
  );
}
