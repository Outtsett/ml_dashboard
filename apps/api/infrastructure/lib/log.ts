/**
 * Server logging sink.
 *
 * This module is the ONE place `console.log` is allowed — the `no-console`
 * ESLint rule (which permits only `warn`/`error` elsewhere) is disabled here
 * deliberately, so every other module routes stdout through these helpers
 * instead of calling console directly.
 */

/** Timestamped, source-tagged line. Use for operational/lifecycle messages. */
export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  // eslint-disable-next-line no-console -- this module is the sanctioned sink
  console.log(`${formattedTime} [${source}] ${message}`);
}

/**
 * Variadic stdout passthrough — byte-identical to `console.log`.
 *
 * Exists so call sites that log multiple values, objects, or their own
 * `[tag]` prefixes can satisfy `no-console` without reshaping their output.
 * Existing prefixes and formats are preserved exactly, which matters for any
 * consumer that greps or parses these lines. Prefer `log()` for new code.
 */
export function logInfo(...args: unknown[]): void {
  // eslint-disable-next-line no-console -- this module is the sanctioned sink
  console.log(...args);
}
