/**
 * Re-export shim. `usePrefersReducedMotion` moved to `shared/hooks/` when the
 * live telemetry surface became a second consumer and it stopped being a
 * mechanism-page concern.
 *
 * Prefer importing from `@/shared/hooks/useReducedMotion` in new code.
 */

export { usePrefersReducedMotion } from '@/shared/hooks/useReducedMotion';
