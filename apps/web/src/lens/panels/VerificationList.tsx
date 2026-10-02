/**
 * VerificationList — builder + shared-compute checks that back every number
 * on the page, each with a ✓ / ✗ glyph plus text (never color alone) and its
 * measured value against what was expected.
 */

import type { LensVerificationCheck } from "@shared/lens/types";
import { LensFrame } from "../Frame";
import { formatInt } from "./format";

export interface VerificationListProps {
  checks: LensVerificationCheck[];
}

export function VerificationList({ checks }: VerificationListProps) {
  const passCount = checks.filter((c) => c.passed).length;

  return (
    <LensFrame
      resizeKey="verification"
      defaultHeight={300}
      title="Verification"
      question="What was actually checked before these numbers were trusted?"
      basis={`${formatInt(passCount)} / ${formatInt(checks.length)} checks passed`}
      testId="lens-verification"
    >
      {checks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No verification checks were reported.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {checks.map((check) => (
            <li
              key={check.name}
              className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-xs"
              data-testid={`lens-verification-${check.passed ? "pass" : "fail"}`}
            >
              <span aria-hidden="true" className={check.passed ? "text-(--color-data-pos)" : "text-(--color-data-neg)"}>
                {check.passed ? "✓" : "✗"}
              </span>
              <span className="font-medium text-foreground">{check.passed ? "Passed" : "Failed"}</span>
              <span className="font-mono text-muted-foreground">{check.name}</span>
              <span className="font-mono tnum text-muted-foreground">measured {check.measured}</span>
              <span className="font-mono tnum text-muted-foreground">expected {check.expected}</span>
            </li>
          ))}
        </ul>
      )}
    </LensFrame>
  );
}
