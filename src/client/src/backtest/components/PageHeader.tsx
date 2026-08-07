/**
 * PageHeader — institutional page chrome. No gradients, no decorative icons.
 *
 * Visual contract:
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │  [icon]  TITLE                [status pill]      [actions ▸]          │
 *   │          subtitle (one line, muted, optional)                         │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * Every page in the redesign uses this header. The visual language is
 * intentionally restrained — single accent color (primary), monospaced
 * status pill, no large headings (the H1 stays at text-xl to preserve
 * vertical real-estate on dense pages).
 */

import { Link } from "wouter";
import { cn } from "@/shared/utils/utils";
import type {
  PageHeaderAction,
  PageStatusPill,
} from "./PageShell.types";
import type { LucideIcon } from "lucide-react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  status?: PageStatusPill;
  actions?: PageHeaderAction[];
  dense?: boolean;
}

const STATUS_TONE_CLASS: Record<PageStatusPill["tone"], string> = {
  live: "border-[hsl(var(--data-pos)/0.3)] text-[hsl(var(--data-pos))] bg-[hsl(var(--data-pos)/0.1)]",
  idle: "border-white/10 text-muted-foreground bg-white/5",
  warn: "border-amber-500/30 text-amber-400 bg-amber-500/10",
  error: "border-[hsl(var(--data-neg)/0.3)] text-[hsl(var(--data-neg))] bg-[hsl(var(--data-neg)/0.1)]",
  info: "border-primary/30 text-primary bg-primary/10",
};

const STATUS_DOT_CLASS: Record<PageStatusPill["tone"], string> = {
  live: "bg-[hsl(var(--data-pos))]",
  idle: "bg-muted-foreground",
  warn: "bg-amber-400",
  error: "bg-[hsl(var(--data-neg))]",
  info: "bg-primary",
};

export function PageHeader({
  title,
  subtitle,
  icon: Icon,
  status,
  actions,
  dense = false,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-start justify-between gap-3 border-b border-border/50",
        dense ? "px-3 py-2" : "px-4 py-2.5",
      )}
      data-testid="page-header"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {Icon && (
            <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          )}
          <h1
            className="font-display truncate text-lg font-semibold leading-tight tracking-tight text-foreground"
            data-testid="page-title"
          >
            {title}
          </h1>
          {status && <StatusPill {...status} />}
        </div>
        {subtitle && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {subtitle}
          </p>
        )}
      </div>

      {actions && actions.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5">
          {actions.map((a, i) => (
            <ActionButton key={`${a.label}-${i}`} action={a} />
          ))}
        </div>
      )}
    </header>
  );
}

function StatusPill({ label, tone, pulse, icon: Icon }: PageStatusPill) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full border px-2 font-mono text-[10px] uppercase tracking-wider tnum",
        STATUS_TONE_CLASS[tone],
      )}
      data-testid={`status-pill-${tone}`}
    >
      {Icon ? (
        <Icon className="h-2.5 w-2.5" aria-hidden />
      ) : (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            STATUS_DOT_CLASS[tone],
            pulse && "animate-pulse",
          )}
        />
      )}
      {label}
    </span>
  );
}

function ActionButton({ action }: { action: PageHeaderAction }) {
  const { label, icon: Icon, onClick, href, active, disabled, variant = "outline", testId } = action;

  const cls = cn(
    "inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-medium transition-colors",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
    disabled
      ? "cursor-not-allowed border-white/5 text-muted-foreground/50"
      : variant === "primary"
        ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
        : variant === "ghost"
          ? "border-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground"
          : "border-white/10 text-foreground/80 hover:border-white/20 hover:bg-white/5",
    active && "border-primary/40 bg-primary/10 text-primary",
  );

  const inner = (
    <>
      {Icon && <Icon className="h-3 w-3" aria-hidden />}
      {label}
    </>
  );

  if (href) {
    return (
      <Link href={href}>
        <span className={cls} data-testid={testId ?? `action-${label}`}>{inner}</span>
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cls}
      data-testid={testId ?? `action-${label}`}
    >
      {inner}
    </button>
  );
}
