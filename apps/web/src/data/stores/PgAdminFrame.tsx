/**
 * PgAdminFrame — pgAdmin 4 inside the Data page.
 *
 * The dashboard supervises a pgAdmin process and this frames it. The state shown
 * is the supervisor's own answer; when that request fails the panel says so and
 * offers a start, and a restart is reported done only once the supervisor reads
 * ready.
 */

import { useState } from "react";
import { ExternalLink, Power, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/shared/ui/button";
import { usePgAdminStatus, useRestartPgAdmin } from "./hooks";
import { serviceMark, serviceState } from "./status";

export function PgAdminFrame() {
  const [frameKey, setFrameKey] = useState(0);
  const status = usePgAdminStatus(true);
  const restart = useRestartPgAdmin();

  const state = restart.isPending ? "starting" : serviceState(status.data, status.isError);
  const mark = serviceMark(state);
  const address = status.data?.url ?? null;

  const handleRestart = () => {
    restart.mutate(undefined, {
      onSuccess: () => {
        setFrameKey((key) => key + 1);
        toast.success("pgAdmin is ready.");
      },
      onError: (error) => toast.error(`pgAdmin did not restart: ${(error as Error).message}`),
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="pgadmin-panel">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">
          <span style={{ color: mark.color }} className="font-semibold" data-testid="pgadmin-state">
            <span aria-hidden>{mark.glyph} </span>
            {mark.word}
          </span>
          {status.data && (
            <>
              {" "}
              · pgAdmin 4 on port {status.data.port}
              {status.data.pid ? `, process ${status.data.pid}` : ""}
              {status.data.restarts > 0 ? `, restarted ${status.data.restarts} times by the supervisor` : ""}
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={state !== "ready"}
            onClick={() => setFrameKey((key) => key + 1)}
          >
            <RefreshCw className="h-3 w-3" />
            Reload the frame
          </Button>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" disabled={restart.isPending} onClick={handleRestart}>
            <Power className="h-3 w-3" />
            {state === "ready" ? "Restart pgAdmin" : "Start pgAdmin"}
          </Button>
          {address && (
            <Button variant="outline" size="sm" asChild className="h-7 gap-1.5 text-xs">
              <a href={address} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-3 w-3" />
                Open in the browser
              </a>
            </Button>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {state === "ready" && address ? (
          <iframe
            key={frameKey}
            src={address}
            title="pgAdmin 4"
            className="block h-full w-full border-none"
            allow="clipboard-read; clipboard-write"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-2xl" style={{ color: mark.color }} aria-hidden>
              {mark.glyph}
            </p>
            <p className="text-sm font-semibold text-foreground">
              {state === "starting" && "pgAdmin is starting."}
              {state === "stopped" && "pgAdmin is stopped."}
              {state === "error" && "pgAdmin reported an error."}
              {state === "unavailable" && "The dashboard could not read pgAdmin's status."}
              {state === "checking" && "Asking the supervisor for pgAdmin's state."}
            </p>
            <p className="max-w-lg font-mono text-xs text-muted-foreground">
              {state === "unavailable"
                ? (status.error as Error | null)?.message
                : status.data?.error ??
                  (state === "starting"
                    ? "The supervisor is waiting for the pgAdmin port to answer."
                    : state === "checking"
                      ? ""
                      : "The supervisor has no process running.")}
            </p>
          </div>
        )}
      </div>
      <p className="shrink-0 border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        If the frame stays blank while the state reads ready, pgAdmin is refusing to be framed; its own configuration file
        outside this repository decides that. “Open in the browser” always works.
      </p>
    </div>
  );
}
