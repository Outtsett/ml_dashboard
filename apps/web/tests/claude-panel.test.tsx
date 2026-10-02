// @vitest-environment jsdom
/**
 * `apps/web/src/claude/` — review fixes (2026-09-28):
 * - a markdown image renders as a link, so text the model wrote never makes
 *   the browser fetch a URL on its own;
 * - a permission card names what "Always allow" adds, for this session only.
 */
import "./setup";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import { markdownComponents } from "@/claude/markdown";
import { PermissionCard, describeSuggestion } from "@/claude/PermissionCard";
import { reduce, EMPTY_VIEW } from "@/claude/useClaudeSession";

describe("Claude panel", () => {
  it("renders a markdown image as a link, not an image", () => {
    const { container } = render(<ReactMarkdown components={markdownComponents}>{"![x](https://example.com/p?d=secret)"}</ReactMarkdown>);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/p?d=secret");
  });

  it("names the rule Always allow would add", () => {
    const view = reduce(EMPTY_VIEW, {
      seq: 1, at: 0, type: "permission_request", requestId: "r", toolName: "Bash", input: { command: "npm test" },
      canAlways: true, suggestions: [{ type: "addRules", behavior: "allow", rules: [{ toolName: "Bash", ruleContent: "npm test:*" }] }],
    });
    const item = view.items[0];
    if (item.kind !== "permission") throw new Error("expected a permission card");
    render(<PermissionCard item={item} onAnswer={() => undefined} />);
    expect(screen.getByTestId("permission-suggestions").textContent).toContain("Bash(npm test:*)");
    expect(describeSuggestion({ type: "setMode", mode: "acceptEdits" })).toBe("switch this session to acceptEdits mode");
  });
});
