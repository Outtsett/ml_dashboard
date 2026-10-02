/**
 * The five feature blocks of a Lens bar vector, each with an Okabe-Ito colour
 * AND a glyph: a block is never told apart by hue alone.
 */

import { OKABE } from "@/studies/kit";

export const BLOCKS: Record<string, { colour: string; glyph: string; label: string }> = {
  geometry: { colour: OKABE.blue, glyph: "●", label: "geometry" },
  kinematics: { colour: OKABE.orange, glyph: "▲", label: "kinematics" },
  volume: { colour: OKABE.green, glyph: "■", label: "volume" },
  structure: { colour: OKABE.purple, glyph: "◆", label: "structure" },
  pattern_multihot: { colour: OKABE.sky, glyph: "✚", label: "pattern_multihot" },
};

export function blockColour(block: string): string {
  return BLOCKS[block]?.colour ?? OKABE.grey;
}

export function blockGlyph(block: string): string {
  return BLOCKS[block]?.glyph ?? "○";
}
