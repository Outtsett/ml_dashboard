import * as NavigationMenu from "@radix-ui/react-navigation-menu";
import { Link, useLocation } from "wouter";
import { cn } from "@/shared/utils/utils";
import {
  BrainCircuit,
  Library,
  Database,
  BookOpen,
  BookMarked,
  Newspaper,
  ActivitySquare,
  BarChart3,
  Microscope,
  NotebookPen,
  ScatterChart,
  PlayCircle,
  Tags,
} from "lucide-react";

// This list is the app's actual rendered sidebar. shared/hooks/navigation.ts's
// NAVIGATION_CONFIG is a separate, richer nav model (groups, descriptions,
// `pending` soon-badges) with exactly one consumer, CommandPalette.tsx -- its
// own NavItemComponent renderer has zero consumers and is not what a user
// sees. Real, mounted routes belong in BOTH lists until those two nav systems
// are unified; adding a page here without also adding it to navigation.ts
// (or vice versa) silently reopens the "built but undiscoverable" gap.
// Four entries were folded in or removed when the nav was consolidated, so a
// link that used to be here now lives one level down:
//   Risk       → the "Risk" tab of /portfolio
//   RL Console → the "RL Console" tab of /ml-studio
//   HPO        → deleted; study config and the trial list are the "HPO Config"
//                tab of ML Studio's RL Console
//   Operate    → deleted; deployment lives in ML Studio's Promote stage
// /risk and /rl-console still resolve — App.tsx redirects them.
//   Watchlist  → removed 2026-09-16 at the user's request.
//   Portfolio  → removed with it; its Risk half is now the "Risk" tab of
//                ML Studio, which is where Risk was asked to live.
const NAV_ITEMS = [
  { label: "Market", href: "/", icon: BarChart3 },
  { label: "Regression", href: "/regression", icon: ScatterChart },
  { label: "Model Cycle", href: "/cycle", icon: PlayCircle },
  { label: "ML Studio", href: "/ml-studio", icon: BrainCircuit },
  { label: "Catalog", href: "/model-catalog", icon: Library },
  { label: "Data", href: "/databases", icon: Database },
  { label: "Labels", href: "/labels", icon: Tags },
  { label: "Lens", href: "/lens", icon: Microscope },
  { label: "Notebooks", href: "/marimo", icon: NotebookPen },
  { label: "Glossary", href: "/glossary", icon: BookMarked },
  { label: "Paper", href: "/paper", icon: BookOpen },
  { label: "News", href: "/news", icon: Newspaper },
  { label: "System", href: "/settings", icon: ActivitySquare },
];

export function LeftSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const [location] = useLocation();

  return (
    <div className={cn(
      "h-full bg-neutral-950 border-r border-neutral-800 flex flex-col pt-4 transition-all duration-300",
      collapsed ? "w-16" : "w-64"
    )}>
      <NavigationMenu.Root className="w-full h-full flex flex-col" orientation="vertical">
        <NavigationMenu.List className="flex flex-col gap-2 px-2 w-full m-0 list-none">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === "/" ? location === item.href : location.startsWith(item.href);
            const Icon = item.icon;
            
            return (
              <NavigationMenu.Item key={item.href} className="w-full">
                {/* `data-testid` is the automation contract for the sidebar.
                    The label span is hidden when the rail is collapsed, so a
                    text selector works only in the expanded state and an E2E
                    navigation silently stops finding links the moment someone
                    collapses the rail. Keying on href instead is stable in both
                    states: "/" becomes nav-market, "/ml-studio" nav-ml-studio. */}
                <Link
                  href={item.href}
                  data-testid={`nav-${item.href === "/" ? "market" : item.href.slice(1)}`}
                  aria-label={item.label}
                  className="w-full block outline-none"
                >
                  <div className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 cursor-pointer outline-none",
                    "hover:bg-neutral-800/50 hover:shadow-[0_0_15px_rgba(212,175,55,0.15)]",
                    isActive 
                      ? "bg-neutral-800/80 text-[#D4AF37] shadow-[0_0_15px_rgba(212,175,55,0.2)]" 
                      : "text-neutral-400"
                  )}>
                    <Icon className={cn("h-5 w-5 shrink-0", isActive ? "text-[#D4AF37]" : "text-neutral-500")} />
                    {!collapsed && (
                      <span className="font-medium text-sm tracking-wide">{item.label}</span>
                    )}
                  </div>
                </Link>
              </NavigationMenu.Item>
            );
          })}
        </NavigationMenu.List>
      </NavigationMenu.Root>
    </div>
  );
}
