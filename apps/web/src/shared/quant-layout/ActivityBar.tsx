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

import { Link, useLocation } from "wouter";
import { cn } from "@/shared/utils/utils";
import {
  Library, Database, BookMarked, BarChart3, Radio, Compass, Settings, PanelLeftOpen, PanelLeftClose,
} from "lucide-react";

const NAV_ITEMS = [
  { label: "Assets", href: "/", icon: BarChart3 },
  { label: "Models", href: "/models", icon: Library },
  { label: "Experiments", href: "/analytics", icon: Compass },
  { label: "Data", href: "/databases", icon: Database },
  { label: "Inference", href: "/live", icon: Radio },
  { label: "Knowledge", href: "/glossary", icon: BookMarked },
];

export interface ActivityBarProps {
  /** Whether the contextual sidebar is currently shown. */
  sidebarOpen: boolean;
  /** Toggle the contextual sidebar (same action as Ctrl+B). */
  onToggleSidebar: () => void;
}

/** Shared icon-button chrome; `active` adds the selected tint. */
function iconClass(active: boolean): string {
  return cn(
    "p-2 rounded-xl transition-colors duration-150",
    active ? "bg-blue-500/10 text-blue-400" : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50",
  );
}

export function ActivityBar({ sidebarOpen, onToggleSidebar }: ActivityBarProps) {
  const [location] = useLocation();

  return (
    <div className="w-12 h-full bg-neutral-950 border-r border-neutral-800 flex flex-col items-center py-2 shrink-0 z-20">
      <div className="flex flex-col gap-3 w-full items-center flex-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === "/" ? location === item.href : location.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="group relative flex justify-center w-full outline-none" title={item.label}>
              <div className={iconClass(isActive)}>
                <Icon className="h-5 w-5" strokeWidth={isActive ? 2.5 : 2} />
              </div>
              {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-6 bg-blue-500 rounded-r-full" />}
            </Link>
          );
        })}
      </div>

      {/* Bottom actions */}
      <div className="flex flex-col gap-3 w-full items-center mb-2">
        <button
          type="button"
          onClick={onToggleSidebar}
          title={sidebarOpen ? "Hide sidebar (Ctrl+B)" : "Show sidebar (Ctrl+B)"}
          className="flex justify-center w-full outline-none"
        >
          <div className={iconClass(false)}>
            {sidebarOpen ? <PanelLeftClose className="h-5 w-5" /> : <PanelLeftOpen className="h-5 w-5" />}
          </div>
        </button>
        <Link href="/settings" title="Settings" className="group relative flex justify-center w-full outline-none">
          <div className={iconClass(location.startsWith("/settings"))}>
            <Settings className="h-5 w-5" strokeWidth={2} />
          </div>
        </Link>
      </div>
    </div>
  );
}
