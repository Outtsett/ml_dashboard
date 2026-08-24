/**
 * PageShell — uniform page chrome used by every Live / Research / Validate
 * / Operate / System page.
 *
 * Composition:
 *   ┌─ PageHeader (title · subtitle · status · actions) ────────┐
 *   ├─ KpiStrip (optional, top of content) ─────────────────────┤
 *   ├─ Body (children) ─────────────────────────────────────────┤
 *   └─ footer (optional, e.g. lineage breadcrumb / status) ─────┘
 *
 * Sizing rules:
 *   - `fillHeight`: body uses `flex-1 min-h-0 overflow-hidden` so children
 *     can manage their own scroll (e.g. MarketData chart fills viewport).
 *   - default: body is `flex-1 overflow-auto` so vertical content scrolls
 *     beneath the sticky header/KPI.
 *
 * Dense mode tightens header + KPI padding for ultra-info-dense pages
 * (Risk, Experiments).
 */

import { cn } from "@/shared/utils/utils";
import type { PageShellProps } from "./PageShell.types";
import { PageHeader } from "./PageHeader";
import { KpiStrip } from "./KpiStrip";

export function PageShell({
  title,
  subtitle,
  icon,
  status,
  actions,
  kpis,
  children,
  footer,
  dense = false,
  fillHeight = false,
}: PageShellProps) {
  return (
    <div
      data-testid="page-shell"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
    >
      <PageHeader
        title={title}
        subtitle={subtitle}
        icon={icon}
        status={status}
        actions={actions}
        dense={dense}
      />

      {kpis && kpis.length > 0 && (
        <KpiStrip kpis={kpis} dense={dense} />
      )}

      <main
        className={cn(
          "min-h-0 flex-1",
          fillHeight ? "overflow-hidden" : "overflow-auto",
          dense ? "p-2" : "p-3",
        )}
        data-testid="page-body"
      >
        {children}
      </main>

      {footer && (
        <footer
          data-testid="page-footer"
          className="shrink-0 border-t border-border/50 bg-card/30 px-3 py-1.5 text-[11px] text-muted-foreground"
        >
          {footer}
        </footer>
      )}
    </div>
  );
}
