/**
 * How each format family is drawn: the notebook's Okabe-Ito colours (nudged
 * where its black and dark greys would vanish on the dark page) and one glyph
 * per family, so a family is never told apart by colour alone.
 */

import { FORMAT_FAMILIES } from "@shared/studies/storage-format-inventory";

export const FAMILY_COLORS: Record<string, string> = {
  parquet_columnar: "#0072B2",
  vendor_archive: "#E69F00",
  iceberg_manifest: "#56B4E9",
  iceberg_snapshot_metadata: "#009E73",
  database_file: "#CC79A7",
  model_or_array_binary: "#D55E00",
  text_tabular_or_document: "#F0E442",
  checksum_sidecar: "#9A9A9A",
  tensorboard_event: "#F5F5F5",
  report_or_image: "#C4C4C4",
  other: "#6A6A6A",
};

export const FAMILY_GLYPHS: Record<string, string> = {
  parquet_columnar: "●",
  vendor_archive: "■",
  iceberg_manifest: "▲",
  iceberg_snapshot_metadata: "◆",
  database_file: "▼",
  model_or_array_binary: "★",
  text_tabular_or_document: "✚",
  checksum_sidecar: "✖",
  tensorboard_event: "○",
  report_or_image: "□",
  other: "△",
};

export const PARQUET_COLOR = "#0072B2";
export const NOT_PARQUET_COLOR = "#E69F00";

export function familyColor(family: string): string {
  return FAMILY_COLORS[family] ?? "#6A6A6A";
}

export function familyGlyph(family: string): string {
  return FAMILY_GLYPHS[family] ?? "△";
}

export function familyLabel(family: string): string {
  return family.replace(/_/g, " ");
}

/** The families in the notebook's legend order, then any the notebook did not know. */
export function orderedFamilies(present: readonly string[]): string[] {
  const known = FORMAT_FAMILIES.filter((family) => present.includes(family));
  const extra = present.filter((family) => !(FORMAT_FAMILIES as readonly string[]).includes(family)).sort();
  return [...known, ...extra];
}

/** A number of bytes in the unit that reads best (1,024 steps). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Math.abs(bytes);
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const digits = value >= 100 || index === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${bytes < 0 ? "-" : ""}${value.toFixed(digits)} ${units[index]}`;
}

/** Sample a cividis ramp at `fraction` in 0..1 (the notebook's colour for non-family breakdowns). */
const CIVIDIS_STOPS = ["#00224e", "#123570", "#3b496c", "#575d6d", "#707173", "#8a8678", "#a59c74", "#c3b369", "#e1cc55", "#fee838"];
export function cividis(fraction: number): string {
  const position = Math.min(1, Math.max(0, fraction)) * (CIVIDIS_STOPS.length - 1);
  return CIVIDIS_STOPS[Math.round(position)] ?? "#8a8678";
}
