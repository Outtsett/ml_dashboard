/**
 * Shared validation utilities — single source of truth for input validation.
 *
 * Import from '@shared/validation' in any server route.
 */

export const SYMBOL_REGEX = /^[A-Z][A-Z0-9_\-\/\.]{0,29}$/;

export function isValidSymbol(symbol: string): boolean {
  return SYMBOL_REGEX.test(symbol);
}
