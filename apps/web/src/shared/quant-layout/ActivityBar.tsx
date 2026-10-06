/**
 * ActivityBar — the fixed 48px domain switcher on the far left (VS Code pattern).
 *
 * What: one icon per top-level domain route, plus the sidebar toggle and Settings.
 * Why:  routes live here so the ContextualSidebar (LeftSidebar) only ever shows the tree for the
 *       active domain. The sidebar toggle lives here too: when the sidebar is hidden, its own
 *       close button is gone, so the re-open control must sit on a surface that never collapses.
 *
 * Transitions are colour-only (`transition-colors`) — nothing here changes size, so nothing
 * here can cause a layout shift.
 */

import { Link, useLocation, useSearch } from "wouter";
import { cn } from "@/shared/utils/utils";
import { Database, BookMarked, BarChart3, Activity, BrainCircuit, Settings, Layers,
} from "lucide-react";

const NAV_ITEMS = [
  { label: "Market", href: "/", icon: BarChart3 },
  { label: "Catalog", href: "/analytics?tab=catalog", icon: Database },
  { label: "Analytics", href: "/analytics", icon: Activity },
  { label: "AI Studio", href: "/training", icon: BrainCircuit },
  { label: "Data", href: "/databases", icon: Layers },
  { label: "Knowledge", href: "/studies", icon: BookMarked },
];

export interface ActivityBarProps {
  /** Unused now that sidebar is removed */
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
}

export function ActivityBar({}: ActivityBarProps = {}) {
  const [pathname] = useLocation();
  const search = useSearch();

  return (
    <div className="w-[72px] h-full bg-neutral-950 border-r border-neutral-800 flex flex-col items-center py-2 shrink-0 z-20 select-none">
      <div className="flex flex-col gap-1 w-full items-center flex-1 px-1">
        {NAV_ITEMS.map((item) => {
          let isActive = false;
          if (item.href === "/") {
            isActive = pathname === "/";
          } else if (item.href === "/analytics?tab=catalog") {
            isActive = (pathname === "/analytics" && search.includes("tab=catalog")) ||
              pathname.startsWith("/models") ||
              pathname.startsWith("/model-catalog") ||
              pathname.startsWith("/catalog");
          } else if (item.href === "/analytics") {
            isActive = (pathname.startsWith("/analytics") && !search.includes("tab=catalog")) ||
              pathname.startsWith("/inference");
          } else if (item.href === "/training") {
            isActive = pathname.startsWith("/training");
          } else if (item.href === "/studies") {
            isActive = pathname.startsWith("/studies") || pathname.startsWith("/glossary") || pathname.startsWith("/knowledge");
          } else {
            isActive = pathname.startsWith(item.href);
          }
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group relative flex flex-col items-center justify-center w-full px-1 py-1.5 outline-none rounded-xl transition-colors hover:bg-neutral-900/70"
            >
              <div className={cn(
                "p-1.5 rounded-lg transition-colors duration-150 flex items-center justify-center",
                isActive ? "bg-blue-500/15 text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.2)]" : "text-neutral-400 group-hover:text-neutral-200"
              )}>
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
              </div>
              <span className={cn(
                "text-[10px] font-medium tracking-tight mt-0.5 text-center leading-tight transition-colors",
                isActive ? "text-blue-400 font-semibold" : "text-neutral-400 group-hover:text-neutral-200"
              )}>
                {item.label}
              </span>
              {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-7 bg-blue-500 rounded-r-full" />}
            </Link>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div className="flex flex-col gap-1.5 w-full items-center mb-2 px-1">
        <Link 
          href="/settings" 
          title="Settings" 
          className="group flex flex-col items-center justify-center w-full px-1 py-1 outline-none rounded-xl hover:bg-neutral-900/60 transition-colors"
        >
          <div className={cn(
            "p-1 rounded-lg transition-colors",
            pathname.startsWith("/settings") ? "text-blue-400" : "text-neutral-400 group-hover:text-neutral-200"
          )}>
            <Settings className="h-4 w-4" strokeWidth={2} />
          </div>
          <span className={cn(
            "text-[9px] font-medium transition-colors leading-tight",
            pathname.startsWith("/settings") ? "text-blue-400 font-semibold" : "text-neutral-500 group-hover:text-neutral-300"
          )}>
            Settings
          </span>
        </Link>
      </div>
    </div>
  );
}
