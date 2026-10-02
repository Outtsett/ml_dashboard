import { fmt, fmtInt } from "@/studies/kit";

/** The collector stamps local wall clock; the digits are shown as they are. */
export function stamp(milliseconds: number | null | undefined): string {
  if (milliseconds === null || milliseconds === undefined) return "—";
  return new Date(milliseconds).toISOString().slice(0, 19).replace("T", " ");
}

export function megabytes(value: number | null | undefined, decimals = 0): string {
  return `${fmt(value, decimals)} MB`;
}

export function countAndMegabytes(count: number, value: number): string {
  return `${fmtInt(count)} · ${megabytes(value)}`;
}

export const NOT_A_NUMBER = "NaN";

/** A statistic that could not be computed is shown as NaN, never left out. */
export function statistic(value: number | null | undefined, decimals = 2): string {
  return value === null || value === undefined || !Number.isFinite(value) ? NOT_A_NUMBER : fmt(value, decimals);
}
