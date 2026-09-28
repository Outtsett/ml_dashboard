/**
 * `src/server/claude/session.ts` — the panel's approval gate (review fixes,
 * 2026-09-28):
 * - the card is sent what "Always allow" would add;
 * - "Always allow" applies exactly that, for this session only, never to a
 *   settings file (a suggestion aimed at userSettings would loosen every later
 *   panel and terminal session);
 * - a suggested mode change keeps the session's own mode in step.
 */
import { describe, expect, it, vi } from "vitest";
import { ClaudeSession } from "../../src/server/claude/session";
import type { ClaudePanelEvent } from "../../src/shared/claude/types";

function session() {
  const s = new ClaudeSession(
    { cwd: process.cwd(), loadSdk: async () => ({}) as never, mcpServers: () => ({}) },
    {},
  );
  const events: ClaudePanelEvent[] = [];
  s.subscribe((event) => events.push(event));
  return { s, events };
}

type Ask = (tool: string, input: Record<string, unknown>, options: Record<string, unknown>) => Promise<{ behavior: string; updatedPermissions?: { destination?: string; type?: string }[] }>;

const RULE = { type: "addRules", behavior: "allow", destination: "userSettings", rules: [{ toolName: "Bash", ruleContent: "npm test:*" }] };

async function request(suggestions: unknown[]) {
  const { s, events } = session();
  const ask = (s as unknown as { askPermission: Ask }).askPermission.bind(s);
  const result = ask("Bash", { command: "npm test" }, { signal: new AbortController().signal, suggestions, toolUseID: "t1" });
  const card = events.find((e) => e.type === "permission_request") as Extract<ClaudePanelEvent, { type: "permission_request" }>;
  return { s, card, result };
}

describe("Claude panel approvals", () => {
  it("shows the card what Always allow would add, without a destination", async () => {
    const { card } = await request([RULE]);
    expect(card.canAlways).toBe(true);
    expect(card.suggestions).toEqual([{ type: "addRules", behavior: "allow", mode: undefined, rules: [{ toolName: "Bash", ruleContent: "npm test:*" }], directories: undefined }]);
  });

  it("applies Always allow to this session only", async () => {
    const { s, card, result } = await request([RULE]);
    s.answer(card.requestId, { decision: "always" });
    const resolved = await result;
    expect(resolved.behavior).toBe("allow");
    expect(resolved.updatedPermissions?.map((u) => u.destination)).toEqual(["session"]);
  });

  it("keeps the session's mode in step with a suggested mode change", async () => {
    const { s, card, result } = await request([{ type: "setMode", mode: "acceptEdits", destination: "localSettings" }]);
    s.answer(card.requestId, { decision: "always" });
    await result;
    expect(s.permissionMode).toBe("acceptEdits");
  });

  it("allows once without touching permissions", async () => {
    const { s, card, result } = await request([RULE]);
    s.answer(card.requestId, { decision: "allow" });
    expect((await result).updatedPermissions).toBeUndefined();
  });
});

describe("Claude panel idle clock", () => {
  type Internals = { query: unknown; status: string; touch: () => void; close: () => void };

  function running(watched: boolean) {
    const s = new ClaudeSession(
      { cwd: process.cwd(), loadSdk: async () => ({}) as never, mcpServers: () => ({}), hasViewers: () => watched },
      {},
    );
    const internals = s as unknown as Internals;
    let closed = 0;
    internals.query = { close: () => undefined };
    internals.status = "running";
    internals.close = () => { closed += 1; };
    return { s, internals, closed: () => closed };
  }

  it("never closes a turn that is still working, watched or not", () => {
    vi.useFakeTimers();
    const { internals, closed } = running(false);
    internals.touch();
    vi.advanceTimersByTime(31 * 60_000);
    expect(closed()).toBe(0);
    vi.useRealTimers();
  });

  it("denies an approval nobody is watching and closes", async () => {
    vi.useFakeTimers();
    const { s, internals, closed } = running(false);
    const ask = (s as unknown as { askPermission: Ask }).askPermission.bind(s);
    const result = ask("Bash", { command: "x" }, { signal: new AbortController().signal, toolUseID: "t" });
    internals.touch();
    vi.advanceTimersByTime(31 * 60_000);
    expect((await result).behavior).toBe("deny");
    expect(closed()).toBe(1);
    vi.useRealTimers();
  });
});
