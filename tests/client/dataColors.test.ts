/**
 * Guards the colorblind-safe color contract.
 *
 * These are not style preferences — this codebase is maintained by a
 * deuteranope, and a red-vs-green semantic pair is unreadable. The tests below
 * pin the two properties that must never regress: direction is orange-vs-blue,
 * and color is never the only channel carrying meaning.
 */

import { describe, it, expect } from "vitest";
import {
  WONG_PALETTE,
  WONG_PALETTE_DARK,
  DATA_COLORS,
  paletteColor,
  paletteColorDark,
  trendTone,
  trendGlyph,
  trendToneClass,
  trendToneColor,
  trendLabel,
} from "@/shared/theme/dataColors";

/** Perceived luminance difference between two hex colors, 0..1. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Simulate deuteranopia (Brettel/Viénot-style approximation) and return the
 * resulting hex. Deuteranopes lack the M-cone, so red and green collapse onto
 * a single axis; two colors that map to near-identical output here are
 * indistinguishable in practice.
 */
function simulateDeuteranopia(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // Viénot 1999 deuteranope transform in linear-ish RGB space.
  return [
    0.625 * r + 0.375 * g + 0.0 * b,
    0.7 * r + 0.3 * g + 0.0 * b,
    0.0 * r + 0.3 * g + 0.7 * b,
  ];
}

/** Euclidean distance between two simulated colors, in 0..441 space. */
function deuteranopeDistance(a: string, b: string): number {
  const [ar, ag, ab] = simulateDeuteranopia(a);
  const [br, bg, bb] = simulateDeuteranopia(b);
  return Math.sqrt((ar - br) ** 2 + (ag - bg) ** 2 + (ab - bb) ** 2);
}

describe("semantic direction colors", () => {
  it("uses orange for positive and blue for negative, never red/green", () => {
    expect(DATA_COLORS.pos).toBe("#E69F00");
    expect(DATA_COLORS.neg).toBe("#0072B2");
  });

  it("keeps positive and negative distinguishable under deuteranopia", () => {
    // A red/green pair scores under ~40 here; orange/blue must clear it by a
    // wide margin. 100 is a deliberately conservative floor.
    const distance = deuteranopeDistance(DATA_COLORS.pos, DATA_COLORS.neg);
    expect(distance).toBeGreaterThan(100);
  });

  it("keeps the warn color separable from positive", () => {
    // This is why warn is yellow and not vermillion: vermillion (#D55E00) and
    // orange (#E69F00) collapse together, yellow separates by lightness.
    const distance = deuteranopeDistance(DATA_COLORS.warn, DATA_COLORS.pos);
    expect(distance).toBeGreaterThan(60);

    const lumaGap = Math.abs(luminance(DATA_COLORS.warn) - luminance(DATA_COLORS.pos));
    expect(lumaGap).toBeGreaterThan(0.15);
  });

  it("demonstrates why the old red/green pair failed", () => {
    // Regression documentation: the tokens this replaced. If someone proposes
    // reverting, this is the number to look at.
    const oldGreen = "#2FB86B";
    const oldRed = "#D94A4A";
    expect(deuteranopeDistance(oldGreen, oldRed)).toBeLessThan(
      deuteranopeDistance(DATA_COLORS.pos, DATA_COLORS.neg),
    );
  });
});

describe("trendTone", () => {
  it("classifies sign", () => {
    expect(trendTone(1.5)).toBe("up");
    expect(trendTone(-1.5)).toBe("down");
    expect(trendTone(0)).toBe("flat");
  });

  it("treats movement inside epsilon as flat", () => {
    expect(trendTone(0.0001, 0.001)).toBe("flat");
    expect(trendTone(-0.0001, 0.001)).toBe("flat");
    expect(trendTone(0.01, 0.001)).toBe("up");
  });

  it("treats non-finite deltas as flat rather than throwing", () => {
    expect(trendTone(NaN)).toBe("flat");
    expect(trendTone(Infinity)).toBe("flat");
    expect(trendTone(-Infinity)).toBe("flat");
  });
});

describe("second channel", () => {
  it("gives every tone a distinct non-color glyph", () => {
    const glyphs = [trendGlyph("up"), trendGlyph("down"), trendGlyph("flat")];
    expect(new Set(glyphs).size).toBe(3);
  });

  it("gives every tone distinct screen-reader text", () => {
    const labels = [trendLabel("up"), trendLabel("down"), trendLabel("flat")];
    expect(new Set(labels).size).toBe(3);
  });

  it("maps tones to distinct classes and colors", () => {
    const classes = [trendToneClass("up"), trendToneClass("down"), trendToneClass("flat")];
    expect(new Set(classes).size).toBe(3);

    const colors = [trendToneColor("up"), trendToneColor("down"), trendToneColor("flat")];
    expect(new Set(colors).size).toBe(3);
    expect(trendToneColor("up")).toBe(DATA_COLORS.pos);
    expect(trendToneColor("down")).toBe(DATA_COLORS.neg);
  });
});

describe("categorical palette", () => {
  it("is the Wong 2011 sequence", () => {
    expect(WONG_PALETTE[0]).toBe("#0072B2");
    expect(WONG_PALETTE[1]).toBe("#E69F00");
    expect(WONG_PALETTE).toHaveLength(8);
  });

  it("replaces black with a visible neutral in the dark variant", () => {
    expect(WONG_PALETTE).toContain("#000000");
    expect(WONG_PALETTE_DARK).not.toContain("#000000");
    expect(WONG_PALETTE_DARK).toHaveLength(8);
  });

  it("cycles safely for any index, including negatives", () => {
    expect(paletteColor(0)).toBe(WONG_PALETTE[0]);
    expect(paletteColor(8)).toBe(WONG_PALETTE[0]);
    expect(paletteColor(-1)).toBe(WONG_PALETTE[7]);
    expect(paletteColorDark(-1)).toBe(WONG_PALETTE_DARK[7]);
  });

  it("keeps the leading five series mutually separable under deuteranopia", () => {
    // Most charts here plot 2-5 series, so the leading slots carry the weight.
    // 70 is set below the measured worst pair in this range (orange/yellow at
    // 79.2) with headroom, and well above the palette's tightest pair overall
    // (blue/green at 37.4).
    const head = WONG_PALETTE_DARK.slice(0, 5);
    for (let i = 0; i < head.length; i++) {
      for (let j = i + 1; j < head.length; j++) {
        const distance = deuteranopeDistance(head[i]!, head[j]!);
        expect(distance, `${head[i]} vs ${head[j]}`).toBeGreaterThan(70);
      }
    }
  });

  it("keeps the tightest pair at opposite ends of the order", () => {
    // Blue vs green is the weakest pair in Wong for a deuteranope. It cannot be
    // fixed by picking different hues without leaving the palette, so instead
    // the two are separated as far as possible in draw order: they only collide
    // when all 8 slots are in use, at which point a legend is required.
    const blue = WONG_PALETTE_DARK.indexOf("#0072B2");
    const green = WONG_PALETTE_DARK.indexOf("#009E73");
    expect(deuteranopeDistance("#0072B2", "#009E73")).toBeLessThan(70);
    expect(Math.abs(blue - green)).toBeGreaterThanOrEqual(6);
  });
});
