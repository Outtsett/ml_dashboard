/**
 * Section — Collapsible section component for RegimeAnalytics panels.
 */

import { useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export function Section({ title, icon, children, defaultOpen = false }: {
  title: string; icon: ReactNode; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-1">
      <button
        className="flex items-center gap-1.5 text-[9px] text-muted-foreground hover:text-foreground transition-colors w-full"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {icon}
        <span className="font-medium uppercase tracking-wider">{title}</span>
      </button>
      {open && <div className="pl-1">{children}</div>}
    </div>
  );
}
