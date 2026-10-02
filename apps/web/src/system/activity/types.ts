/**
 * Activity feed types — the normalized shape the right rail renders.
 *
 * Every DomainEvent broadcast on the `pipeline` / `training` / `system` SSE
 * channels collapses into an ActivityEntry so the rail has one row shape to
 * render regardless of which subsystem produced it.
 */

export type ActivityLevel = 'error' | 'warn' | 'success' | 'info';

export interface ActivityEntry {
  /** Stable key for React. Monotonic per session, not derived from content. */
  id: number;
  /** epoch ms, taken from event.metadata.timestamp when present. */
  ts: number;
  level: ActivityLevel;
  /** Subsystem that emitted it — "training", "pipeline", "system", … */
  source: string;
  /** Raw event type, e.g. "pipeline.step.failed". Shown as a dim suffix. */
  type: string;
  /** Single-line summary. Never contains newlines. */
  message: string;
  /**
   * Remaining lines of a multi-line payload (stack traces, tracebacks).
   * Empty when the payload was a one-liner. Rendered behind a disclosure.
   */
  detail: string[];
}

export interface ActivityMetric {
  key: string;
  value: number;
  ts: number;
  source: string;
}

/**
 * Level styling — Okabe-Ito, deuteranopia-safe.
 *
 * Tyler is red-green colorblind, so "error = red / success = green" is not
 * usable here: red vs green is the one contrast that carries no information.
 * Error uses vermillion and success uses sky blue instead, and every row also
 * carries a glyph + an uppercase text label so the level is legible with the
 * colour channel ignored entirely.
 */
export const LEVEL_STYLE: Record<ActivityLevel, {
  color: string;
  label: string;
  glyph: string;
  /** Tailwind classes for the row's left rule + label chip. */
  chip: string;
}> = {
  error:   { color: '#D55E00', label: 'ERROR', glyph: '✖', chip: 'text-[#D55E00] border-[#D55E00]/40 bg-[#D55E00]/10' },
  warn:    { color: '#E69F00', label: 'WARN',  glyph: '▲', chip: 'text-[#E69F00] border-[#E69F00]/40 bg-[#E69F00]/10' },
  success: { color: '#56B4E9', label: 'OK',    glyph: '●', chip: 'text-[#56B4E9] border-[#56B4E9]/40 bg-[#56B4E9]/10' },
  info:    { color: '#9CA3AF', label: 'INFO',  glyph: '·', chip: 'text-zinc-400 border-white/10 bg-white/5' },
};

export const LEVEL_ORDER: ActivityLevel[] = ['error', 'warn', 'success', 'info'];
