/**
 * KnowledgeShell — the frame every Knowledge page sits in: one tab strip
 * (Studies, Model Catalog, Glossary) over the page itself.
 *
 * Why: the left rail has one Knowledge entry, so the pages it holds are told
 * apart here. Each tab is a route, so a link to `/model-catalog?model=<id>`
 * opens the catalog with its tab lit.
 */

import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { BookMarked, FlaskConical, Layers } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/shared/utils/utils";

interface KnowledgeTab {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Route prefixes this tab owns. */
  prefixes: string[];
}

const KNOWLEDGE_TABS: KnowledgeTab[] = [
  { label: "Studies", href: "/studies", icon: FlaskConical, prefixes: ["/studies", "/knowledge"] },
  { label: "Model Catalog", href: "/model-catalog", icon: Layers, prefixes: ["/model-catalog", "/models", "/catalog"] },
  { label: "Glossary", href: "/glossary", icon: BookMarked, prefixes: ["/glossary"] },
];

/** Every route prefix that belongs to Knowledge; the left rail lights its entry on these. */
export const KNOWLEDGE_ROUTE_PREFIXES = KNOWLEDGE_TABS.flatMap((tab) => tab.prefixes);

export function isKnowledgeRoute(pathname: string): boolean {
  return KNOWLEDGE_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function KnowledgeShell({ children }: { children: ReactNode }) {
  const [pathname] = useLocation();

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <nav
        aria-label="Knowledge"
        className="flex shrink-0 items-center gap-1 border-b border-neutral-800 bg-neutral-950 px-3 py-1.5"
      >
        {KNOWLEDGE_TABS.map((tab) => {
          const isActive = tab.prefixes.some((prefix) => pathname.startsWith(prefix));
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              data-testid={`knowledge-tab-${tab.href.slice(1)}`}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-md border-b-2 px-3 py-1.5 text-xs transition-colors",
                isActive
                  ? "border-blue-500 bg-blue-500/10 font-semibold text-blue-400"
                  : "border-transparent text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
