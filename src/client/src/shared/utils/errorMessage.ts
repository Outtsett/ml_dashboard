/**
 * errorMessage — narrow an unknown thrown value to a string.
 *
 * SRP: one function. Imported wherever a catch used to be typed `any`.
 */
/** Narrow an unknown thrown value to a message.
 *  `catch (e: any)` hides the case where what was thrown is not an Error at
 *  all — a string, or undefined from a rejected promise — and `e.message` is
 *  then silently undefined. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
