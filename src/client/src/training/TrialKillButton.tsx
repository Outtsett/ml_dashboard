/**
 * TrialKillButton — drops a sentinel via the API to interrupt a running trial
 * mid-boost without stopping the whole study.
 */

import { useState } from "react";
import { Button } from "@/shared/ui/button";

export interface TrialKillButtonProps {
  sessionId: string;
  trialId: number;
  /** Visual variant; defaults to a small destructive ghost. */
  size?: "sm" | "default";
  onKilled?: () => void;
}

export function TrialKillButton({ sessionId, trialId, size = "sm", onKilled }: TrialKillButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/hpo/sessions/${sessionId}/trials/${trialId}/kill`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body}`);
      }
      onKilled?.();
    } catch (e) {
      setError((e as Error).message || "kill failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="inline-flex items-center gap-2">
      <Button variant="destructive" size={size} disabled={busy} onClick={onClick}>
        {busy ? "Killing…" : `Kill #${trialId}`}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}

export default TrialKillButton;
