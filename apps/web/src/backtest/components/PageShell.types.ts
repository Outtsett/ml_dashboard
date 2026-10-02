/**
 * Shared types for the senior-quant page-shell language.
 *
 * Every Live / Research / Validate / Operate page is composed from the same
 * primitives — PageShell wraps PageHeader + optional KpiStrip + body slot +
 * optional footer. The types here are the contract between PageShell and its
 * consumers.
 */

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** A single KPI to render inside KpiStrip / KpiCard. */
export interface Kpi {
  /** Short, uppercase label (e.g. "NAV", "DAILY P&L", "99% VaR"). */
  label: string;
  /** Formatted scalar value. Strings only — formatting is the caller's job
   *  so KPI cells stay dumb and the same component can render currency,
   *  percent, ratios, counts. */
  value: string;
  /** Optional change indicator. `delta.value` is a pre-formatted scalar
   *  ("+1.23%"), `delta.direction` drives the pos/neg coloring. */
  delta?: { value: string; direction: "pos" | "neg" | "neutral" };
  /** Optional 60-point sparkline series, newest-last. Renders via Sparkline. */
  spark?: number[];
  /** Optional sparkline mood; falls back to `delta.direction` if both
   *  exist, else neutral. */
  sparkDirection?: "pos" | "neg" | "neutral";
  /** Optional one-line hover tooltip. */
  hint?: string;
  /** Optional explicit testid override for the cell. */
  testId?: string;
}

/** Slot for the right-side actions in PageHeader. */
export interface PageHeaderAction {
  label: string;
  icon?: LucideIcon;
  onClick?: () => void;
  href?: string;
  /** Active state — shows a primary-color outline. */
  active?: boolean;
  /** Disabled state. */
  disabled?: boolean;
  /** Visual emphasis. `primary` for the focal CTA, `ghost` for everything else. */
  variant?: "primary" | "outline" | "ghost";
  testId?: string;
}

/** Optional status pill rendered next to the page title (e.g. "Live", "Training"). */
export interface PageStatusPill {
  label: string;
  /** Drives the dot color. */
  tone: "live" | "idle" | "warn" | "error" | "info";
  /** When `live`, the dot pulses. */
  pulse?: boolean;
  icon?: LucideIcon;
}

export interface PageShellProps {
  /** Page title — rendered in font-display. Plain text, no gradient. */
  title: string;
  /** One-line subtitle under the title. Kept short. */
  subtitle?: string;
  /** Optional icon to anchor the title. */
  icon?: LucideIcon;
  /** Optional status pill displayed inline with the title. */
  status?: PageStatusPill;
  /** Right-side actions in the header strip. */
  actions?: PageHeaderAction[];
  /** Optional KPI strip rendered above the body. Pass null to suppress. */
  kpis?: Kpi[];
  /** Page body. Use a 12-col grid for dense layouts. */
  children: ReactNode;
  /** Optional footer (e.g. status bar / lineage breadcrumb). */
  footer?: ReactNode;
  /** Tighten body padding for ultra-dense pages (Bloomberg-style). */
  dense?: boolean;
  /** Make the body fill 100% of the available height (no scroll) — needed for
   *  full-bleed pages like MarketData chart. Default is normal scrolling. */
  fillHeight?: boolean;
}
