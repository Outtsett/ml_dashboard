/**
 * LensFrame — the one card chrome every Model Lens view renders inside, so
 * the page reads as one system: title, a plain-words question the view
 * answers, and the n / method line every estimate must carry.
 */

import type { ReactNode } from "react";
import { cn } from "@/shared/utils/utils";

export interface LensFrameProps {
  title: string;
  /** The question this view answers, in plain words. */
  question?: string;
  /** Sample size / method / window — printed beside the view, never hidden. */
  basis?: string;
  /** Right-aligned controls (toggles, selectors). */
  actions?: ReactNode;
  /** Shown instead of children when the view has no data for this model. */
  unavailableReason?: string;
  className?: string;
  children?: ReactNode;
  testId?: string;
}

export function LensFrame({ title, question, basis, actions, unavailableReason, className, children, testId }: LensFrameProps) {
  return (
    <section
      data-testid={testId}
      className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-card", className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">{title}</h3>
          {question && <p className="mt-0.5 text-xs text-muted-foreground">{question}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      <div className="min-h-0 flex-1 p-3">
        {unavailableReason ? (
          <p className="text-sm text-muted-foreground" data-testid={testId ? `${testId}-unavailable` : undefined}>
            Not available for this model: {unavailableReason}
          </p>
        ) : (
          children
        )}
      </div>
      {basis && !unavailableReason && (
        <footer className="border-t border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground tnum">{basis}</footer>
      )}
    </section>
  );
}
