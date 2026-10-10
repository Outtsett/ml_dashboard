/**
 * How a service state is drawn on the Data page: a glyph, a word and an
 * Okabe-Ito colour together, so the state never rests on colour alone.
 */

import type { PgAdminStatus } from "./hooks";

export type ServiceState = PgAdminStatus["status"] | "unavailable" | "checking";

export interface ServiceMark {
  glyph: string;
  word: string;
  /** Okabe-Ito: blue for ready, orange for in progress, vermillion for not running. */
  color: string;
}

const MARKS: Record<ServiceState, ServiceMark> = {
  ready: { glyph: "●", word: "ready", color: "#56B4E9" },
  starting: { glyph: "◐", word: "starting", color: "#E69F00" },
  stopped: { glyph: "▲", word: "stopped", color: "#D55E00" },
  error: { glyph: "✕", word: "error", color: "#D55E00" },
  unavailable: { glyph: "?", word: "status unavailable", color: "#D55E00" },
  // Before the first answer arrives nothing is known, so the mark is grey, not a state's colour.
  checking: { glyph: "…", word: "checking", color: "#9CA3AF" },
};

/** `failed` is the status request itself failing, which is not the same as the service being down. */
export function serviceState(status: PgAdminStatus | undefined, failed: boolean): ServiceState {
  if (failed) return "unavailable";
  return status?.status ?? "checking";
}

export function serviceMark(state: ServiceState): ServiceMark {
  return MARKS[state];
}
