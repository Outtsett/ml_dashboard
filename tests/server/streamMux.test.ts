/**
 * The per-tab multiplexed stream (src/server/stream/mux.ts): the server-sent
 * events parser follows the browser's rules, and only same-server API paths may
 * be opened.
 */
import { describe, expect, it } from "vitest";
import { EventParser, isAllowedStreamUrl, normalizeStreamUrl } from "../../src/server/stream/mux";

describe("EventParser", () => {
  it("parses named events, multi-line data and ids across chunk boundaries", () => {
    const parser = new EventParser();
    expect(parser.push("event: cycle_bars\nid: 7\ndata: {\"a\"")).toEqual([]);
    const events = parser.push(":1}\ndata: second line\n\ndata: plain\r\n\r\n: comment\nretry: 5\n\n");
    expect(events).toEqual([
      { type: "cycle_bars", data: "{\"a\":1}\nsecond line", id: "7" },
      { type: "message", data: "plain", id: "7" },
    ]);
  });

  it("does not split a CRLF that arrives across two chunks into an extra blank line", () => {
    const parser = new EventParser();
    expect(parser.push("data: one\r")).toEqual([]);
    expect(parser.push("\ndata: two\r\n\r\n")).toEqual([{ type: "message", data: "one\ntwo", id: undefined }]);
  });

  it("keeps an event the server names 'error', and drops an event with no data", () => {
    const parser = new EventParser();
    expect(parser.push("event: error\ndata: {\"message\":\"boom\"}\n\nevent: ping\n\n")).toEqual([
      { type: "error", data: "{\"message\":\"boom\"}", id: undefined },
    ]);
  });
});

describe("isAllowedStreamUrl", () => {
  it("opens only API paths on this server", () => {
    expect(isAllowedStreamUrl("/api/events/pipeline")).toBe(true);
    expect(isAllowedStreamUrl("/api/live/stream?kinds=quote,bar,news")).toBe(true);
    expect(isAllowedStreamUrl("http://evil.example/api/x")).toBe(false);
    expect(isAllowedStreamUrl("//evil.example/api/x")).toBe(false);
    expect(isAllowedStreamUrl("/api/../etc")).toBe(false);
    expect(isAllowedStreamUrl("/marimo/quant/")).toBe(false);
    expect(isAllowedStreamUrl("/api/stream/mux")).toBe(false);
    // The check is on the parsed path: dot segments, case and encoded dots cannot reach the mux itself.
    expect(isAllowedStreamUrl("/api/events/./../stream/mux")).toBe(false);
    expect(isAllowedStreamUrl("/api/Stream/MUX")).toBe(false);
    expect(isAllowedStreamUrl("/api/%2e%2e/stream/mux")).toBe(false);
    expect(normalizeStreamUrl("/api/events/system?x=1")).toBe("/api/events/system?x=1");
  });
});
