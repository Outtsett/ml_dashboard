/**
 * Runner Factory — DIP-compliant runner registration.
 *
 * Concrete runner classes register themselves here at startup.
 * The orchestrator calls getRunner(name) and never imports PythonRunner directly.
 */
import type { ITrainerRunner } from "./runners/types";

// ─── Private registry ────────────────────────────────────────────────────────

const runners = new Map<string, ITrainerRunner>();

// ─── Public API ──────────────────────────────────────────────────────────────

/** Register a runner instance under a name (e.g. "python", "tfjs"). */
export function registerRunner(name: string, runner: ITrainerRunner): void {
  if (runners.has(name)) {
    console.warn(`[runnerFactory] Overwriting existing runner: "${name}"`);
  }
  runners.set(name, runner);
}

/** Retrieve a registered runner by name. Returns undefined if not found. */
export function getRunner(name: string): ITrainerRunner | undefined {
  return runners.get(name);
}

/** List all registered runner names (for diagnostics / startup logging). */
export function getRegisteredRunners(): string[] {
  return Array.from(runners.keys());
}
