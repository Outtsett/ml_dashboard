/**
 * Re-export shim. The Wong 2011 palette moved to `shared/theme/dataColors.ts`
 * when it stopped being an evaluate-stage concern and became the app-wide
 * definition of colorblind-safe data color.
 *
 * Prefer importing from `@/shared/theme/dataColors` in new code.
 */

export { WONG_PALETTE, paletteColor } from "@/shared/theme/dataColors";
