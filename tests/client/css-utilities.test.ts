/**
 * Guards a silent-failure mode in Tailwind v4.
 *
 * Custom classes declared in `@layer utilities` are plain CSS. Tailwind only
 * generates variants (`hover:`, `focus:`, `md:`, `dark:` …) for utilities it
 * knows about, so `hover:surface-raised` compiles to nothing at all — the
 * markup reads as correct, review passes, and the hover state simply does not
 * exist. That exact bug shipped in StageStepper and was only caught by
 * grepping the built CSS.
 *
 * If this test fails: either write a real `.foo:hover` rule in index.css, or
 * promote the class to a Tailwind `@utility` so variants are generated.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const CLIENT_SRC = join(process.cwd(), "src", "client", "src");
const INDEX_CSS = join(CLIENT_SRC, "index.css");

/** Class names defined inside `@layer utilities { … }` in index.css. */
function customUtilities(): string[] {
  const css = readFileSync(INDEX_CSS, "utf8");
  const start = css.indexOf("@layer utilities");
  if (start === -1) return [];

  // Walk braces from the opening of the layer block to its matching close, so
  // nested rules and media queries do not terminate the scan early.
  const open = css.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const block = css.slice(open, end);
  const names = new Set<string>();
  for (const m of block.matchAll(/^\s*\.([a-zA-Z][\w-]*)/gm)) {
    names.add(m[1]!);
  }
  return [...names];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("custom CSS utilities", () => {
  it("defines some, so this test is actually checking something", () => {
    // A guard against the scan silently finding nothing after a refactor and
    // reporting success forever.
    expect(customUtilities().length).toBeGreaterThan(5);
  });

  it("is never used with a Tailwind variant prefix", () => {
    const utilities = customUtilities();
    // Match `hover:surface-raised`, `md:panel`, `dark:glass` etc. Word-boundary
    // prefixed so `group-hover:opacity-100` and ordinary utilities are ignored.
    const re = new RegExp(
      `\\b([a-z-]+(?:\\[[^\\]]*\\])?):(${utilities.join("|")})\\b`,
      "g",
    );

    const violations: string[] = [];
    for (const file of walk(CLIENT_SRC)) {
      const rel = relative(CLIENT_SRC, file).replace(/\\/g, "/");
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(line)) !== null) {
            violations.push(`${rel}:${i + 1}  ${m[0]}  (generates no CSS)`);
          }
        });
    }

    expect(
      violations,
      violations.length === 0
        ? ""
        : `Tailwind variants on custom utilities produce no CSS:\n${violations.join("\n")}\n\n` +
            `Write a real :hover/:focus rule in index.css, or promote the class ` +
            `to an @utility so variants are generated.`,
    ).toHaveLength(0);
  });
});
