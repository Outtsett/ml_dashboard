/**
 * Repo-wide guard: no semantic red/green may re-enter the client source.
 *
 * The token layer (`--data-pos` / `--data-neg` in index.css) was corrected once,
 * but 230 files had bypassed it with hardcoded Tailwind classes and hex
 * literals — meaning the fix covered the definition and almost none of the
 * usage. This test exists so that cannot happen again silently.
 *
 * It is a lint rule expressed as a test on purpose: it runs in `npm test`, in
 * CI, and in the pre-commit hook without any extra wiring, and a failure names
 * the exact file and line.
 *
 * If you are here because this test failed: use `--data-pos` (orange, up/good)
 * and `--data-neg` (blue, down/bad) from `shared/theme/dataColors.ts`, and pair
 * the colour with a glyph, sign, or label so it never carries meaning alone.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CLIENT_SRC = join(process.cwd(), "apps", "web", "src");

/**
 * Hues that mean "positive" or "negative" in this codebase and therefore must
 * come from tokens.
 *
 * `teal` and `lime` are deliberately absent: both are used as categorical
 * accents rather than as direction, and both remain separable from orange and
 * blue under deuteranopia. `amber` and `orange` are absent for the same reason
 * — they are palette entries here, not a good/bad signal.
 */
const BANNED_HUES = ["emerald", "green", "rose", "red"];

const BANNED_UTILITIES = [
  "text", "bg", "border", "stroke", "fill", "from", "to", "via",
  "ring", "shadow", "decoration", "outline", "accent", "caret", "divide",
];

const CLASS_RE = new RegExp(
  `\\b(?:${BANNED_UTILITIES.join("|")})-(?:${BANNED_HUES.join("|")})-\\d{2,3}(?:\\/\\d{1,3})?\\b`,
  "g",
);

/**
 * Tailwind's default red/green/rose ramps, as raw hex.
 *
 * The rose entries are here because the first sweep missed them: the class
 * form (`text-rose-400`) was caught while the hex form (`#fb7185`) sailed
 * through, and a dozen "bad" indicators stayed rose while their "good"
 * counterparts had already become orange.
 */
const BANNED_HEX = [
  // red
  "#ef4444", "#dc2626", "#f87171", "#b91c1c", "#991b1b", "#7f1d1d",
  "#fca5a5", "#fecaca",
  // rose
  "#f43f5e", "#fb7185", "#e11d48", "#be123c", "#fda4af", "#ffe4e6",
  // green / emerald
  "#10b981", "#22c55e", "#34d399", "#4ade80", "#059669", "#065f46",
  "#064e3b", "#15803d", "#166534", "#16a34a", "#047857", "#6ee7b7",
  "#86efac", "#bbf7d0",
];
const HEX_RE = new RegExp(BANNED_HEX.join("|"), "gi");

/**
 * Files permitted to keep raw red/green, with the reason.
 *
 * Empty by design. Anything added here is a standing exception and needs a
 * sentence saying why the second channel is unavailable in that specific spot.
 */
const ALLOWLIST: Record<string, string> = {
  "entity/EntityMetrics.tsx": "Mission Control HUD mandate explicitly requires Emerald-500 and Red-500.",
  "entity/EntityProfilePage.tsx": "Mission Control HUD mandate explicitly requires Emerald-500 and Red-500.",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(full);
  }
  return out;
}

interface Violation {
  file: string;
  line: number;
  text: string;
  match: string;
}

function scan(): Violation[] {
  const violations: Violation[] = [];

  for (const file of walk(CLIENT_SRC)) {
    const rel = relative(CLIENT_SRC, file).replace(/\\/g, "/");
    if (rel in ALLOWLIST) continue;

    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, i) => {
      for (const re of [CLASS_RE, HEX_RE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) {
          violations.push({ file: rel, line: i + 1, text: text.trim(), match: m[0] });
        }
      }
    });
  }

  return violations;
}

describe("colorblind-safe color contract", () => {
  it("has no semantic red or green anywhere in the client source", () => {
    const violations = scan();

    const report = violations
      .slice(0, 40)
      .map((v) => `  ${v.file}:${v.line}  ${v.match}\n      ${v.text.slice(0, 100)}`)
      .join("\n");

    expect(
      violations,
      violations.length === 0
        ? ""
        : `${violations.length} hardcoded red/green usage(s) found.\n` +
            `Use --data-pos (orange, up/good) or --data-neg (blue, down/bad) ` +
            `from shared/theme/dataColors.ts, and pair the color with a glyph, ` +
            `sign, or label.\n\n${report}` +
            (violations.length > 40 ? `\n  ... and ${violations.length - 40} more` : ""),
    ).toHaveLength(0);
  });

  it("keeps the allowlist documented", () => {
    // An allowlist entry without a reason is how an exception becomes the rule.
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(reason.length, `${file} needs a reason`).toBeGreaterThan(20);
    }
  });
});
