/**
 * CycleTerminal — the verbose run terminal, reading `useCycleStore().logs`
 * (a mutable ring buffer bumped by `logsVersion`; see `store.ts`).
 *
 * Category detection follows the TERMINAL LOG GRAMMAR exactly
 * (`docs/plans/2026-09-25-model-cycle.md`): every line starts with one
 * bracketed prefix, and `categorizeLogLine` maps that prefix to a filter
 * chip. `[trade #12] ENTER LONG ...` / `EXIT ...` lines additionally tint
 * the side word.
 */
import { type CSSProperties, type ReactNode, type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { List, type ListImperativeAPI } from "react-window";

import { useCycleStore } from "@/cycle/store";
import { formatClockTime } from "@/cycle/format";
import type { CycleLogLine } from "@shared/cycle/schema";
import { cn } from "@/shared/utils/utils";

export type LogCategory = "data" | "tuning" | "training" | "validation" | "testing" | "trades" | "control" | "other";

interface FilterChip {
  id: "all" | LogCategory | "warnings_errors";
  label: string;
}

const FILTER_CHIPS: FilterChip[] = [
  { id: "all", label: "All" },
  { id: "data", label: "Data" },
  { id: "tuning", label: "Tuning" },
  { id: "training", label: "Training" },
  { id: "validation", label: "Validation" },
  { id: "testing", label: "Testing" },
  { id: "trades", label: "Trades" },
  { id: "control", label: "Control" },
  { id: "warnings_errors", label: "Warnings+Errors" },
];

/** Okabe-Ito, one hue per category, distinct from the ERR/WRN level badges. */
const CATEGORY_COLOR: Record<LogCategory, string> = {
  data: "#009E73", // bluish-green
  tuning: "#CC79A7", // reddish-purple
  training: "#56B4E9", // sky
  validation: "#F0E442", // yellow
  testing: "#0072B2", // blue
  trades: "#E69F00", // orange
  control: "#D55E00", // vermillion
  other: "#8A8F98", // muted grey — no category matched
};

/** Maps a `[prefix]` at the start of a log line to a filter category, per the grammar table. */
export function categorizeLogLine(message: string): LogCategory {
  if (/^\[trade #\d+\]/.test(message)) return "trades";
  if (/^\[fold \d+\/\d+\]\[train\]/.test(message)) return "training";
  if (/^\[fold \d+\/\d+\]\[validate\]/.test(message)) return "validation";
  if (/^\[fold \d+\/\d+\]\[test\]/.test(message)) return "testing";
  if (/^\[tune\b/.test(message)) return "tuning";
  if (/^\[(data|features|plan|device)\]/.test(message)) return "data";
  if (/^\[(control|save|done)\]/.test(message)) return "control";
  return "other";
}

const ROW_HEIGHT = 22;

interface TerminalLine extends CycleLogLine {
  category: LogCategory;
}

/**
 * Each stored line is categorised once. The store appends to one mutable
 * array, so the same line objects come back on every render; re-running the
 * prefix regexes over all of them per update was the terminal's cost that grew
 * with run length (20,000 lines at up to 10 updates a second).
 */
const TERMINAL_LINES = new WeakMap<CycleLogLine, TerminalLine>();

function toTerminalLine(line: CycleLogLine): TerminalLine {
  let terminalLine = TERMINAL_LINES.get(line);
  if (!terminalLine) {
    terminalLine = { ...line, category: categorizeLogLine(line.message) };
    TERMINAL_LINES.set(line, terminalLine);
  }
  return terminalLine;
}

/** Split `text` on every case-insensitive occurrence of `query`, keeping the matched pieces marked. */
function splitOnQuery(text: string, query: string): { text: string; isMatch: boolean }[] {
  if (!query) return [{ text, isMatch: false }];
  const lower = text.toLowerCase();
  const needle = query.toLowerCase();
  const pieces: { text: string; isMatch: boolean }[] = [];
  let cursor = 0;
  let index = lower.indexOf(needle, cursor);
  while (index !== -1) {
    if (index > cursor) pieces.push({ text: text.slice(cursor, index), isMatch: false });
    pieces.push({ text: text.slice(index, index + needle.length), isMatch: true });
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), isMatch: false });
  return pieces;
}

function renderSearchHighlighted(text: string, query: string, keyPrefix: string): ReactNode {
  if (!query) return text;
  return splitOnQuery(text, query).map((piece, index) =>
    piece.isMatch ? (
      <mark key={`${keyPrefix}-${index}`} className="rounded-sm bg-[#F0E442]/50 text-inherit">
        {piece.text}
      </mark>
    ) : (
      <span key={`${keyPrefix}-${index}`}>{piece.text}</span>
    ),
  );
}

/** Renders a log line's message, tinting LONG/SHORT on trade lines and highlighting the search query. */
function renderMessage(message: string, category: LogCategory, query: string): ReactNode {
  if (category !== "trades") return renderSearchHighlighted(message, query, "m");
  const pieces = message.split(/\b(LONG|SHORT)\b/);
  return pieces.map((piece, index) => {
    if (piece === "LONG") {
      return (
        <span key={index} className="font-semibold" style={{ color: "#E69F00" }}>
          ▲ LONG
        </span>
      );
    }
    if (piece === "SHORT") {
      return (
        <span key={index} className="font-semibold" style={{ color: "#0072B2" }}>
          ▼ SHORT
        </span>
      );
    }
    return <span key={index}>{renderSearchHighlighted(piece, query, `m-${index}`)}</span>;
  });
}

function LevelBadge({ level }: { level: CycleLogLine["level"] }) {
  if (level === "error") {
    return (
      <span className="mr-1.5 shrink-0 font-bold" style={{ color: "#D55E00" }}>
        ERR
      </span>
    );
  }
  if (level === "warn") {
    return (
      <span className="mr-1.5 shrink-0 font-bold" style={{ color: "#E69F00" }}>
        WRN
      </span>
    );
  }
  return null;
}

interface RowProps {
  lines: TerminalLine[];
  query: string;
}

function TerminalRow({ index, style, lines, query }: { index: number; style: CSSProperties } & RowProps) {
  const line = lines[index];
  if (!line) return null;
  return (
    <div
      style={style}
      data-testid="terminal-line"
      data-category={line.category}
      data-level={line.level}
      className={cn("flex items-start gap-2 px-2 font-mono text-[11px] leading-[22px] whitespace-pre", line.level === "debug" && "text-muted-foreground/70")}
    >
      <span className="shrink-0 tabular-nums text-muted-foreground/60">{formatClockTime(line.receivedAt)}</span>
      <span className="shrink-0" style={{ color: CATEGORY_COLOR[line.category] }}>
        ▍
      </span>
      <LevelBadge level={line.level} />
      <span className="min-w-0 flex-1 truncate text-foreground/90">{renderMessage(line.message, line.category, query)}</span>
    </div>
  );
}

export function CycleTerminal() {
  const logsVersion = useCycleStore((s) => s.logsVersion);
  const logs = useCycleStore((s) => s.logs);

  const [activeFilter, setActiveFilter] = useState<FilterChip["id"]>("all");
  const [query, setQuery] = useState("");
  const [paused, setPaused] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);
  const previousRowCount = useRef(0);
  const listRef = useRef<ListImperativeAPI>(null);

  const categorized = useMemo<TerminalLine[]>(() => {
    void logsVersion; // re-derive whenever the mutable `logs` array changes
    return logs.map(toTerminalLine);
  }, [logs, logsVersion]);

  const filtered = useMemo(() => {
    let lines = categorized;
    if (activeFilter === "warnings_errors") {
      lines = lines.filter((line) => line.level === "warn" || line.level === "error");
    } else if (activeFilter !== "all") {
      lines = lines.filter((line) => line.category === activeFilter);
    }
    if (query) {
      const needle = query.toLowerCase();
      lines = lines.filter((line) => line.message.toLowerCase().includes(needle));
    }
    return lines;
  }, [categorized, activeFilter, query]);

  const stuckToBottom = !paused && atBottom;

  // New rows landed: either follow them to the bottom, or count them as unseen.
  // Runs post-commit (never touches the DOM during render — the List's new
  // rows must exist before `scrollToRow` can target them).
  useEffect(() => {
    const delta = filtered.length - previousRowCount.current;
    previousRowCount.current = filtered.length;
    if (delta <= 0) return;
    if (stuckToBottom) {
      setUnseenCount(0);
      listRef.current?.scrollToRow({ index: filtered.length - 1, align: "end", behavior: "auto" });
    } else {
      setUnseenCount((count) => count + delta);
    }
  }, [filtered.length, stuckToBottom]);

  // "At the bottom" comes from the scroll position the user leaves the list
  // at, not from which rows rendered: on the first render (a snapshot or a
  // batch of lines) the rendered rows are the top of the list before the
  // effect below has scrolled it, which read as "the user scrolled away" and
  // left the terminal parked on the oldest line.
  const handleScrollCapture = useCallback((event: UIEvent<HTMLDivElement>) => {
    const element = event.target as HTMLElement;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    const nowAtBottom = distanceFromBottom <= ROW_HEIGHT * 2;
    setAtBottom((prev) => (prev === nowAtBottom ? prev : nowAtBottom));
  }, []);

  const jumpToBottom = useCallback(() => {
    setPaused(false);
    setUnseenCount(0);
    listRef.current?.scrollToRow({ index: Math.max(0, filtered.length - 1), align: "end", behavior: "auto" });
  }, [filtered.length]);

  const copyVisible = useCallback(() => {
    const text = filtered.map((line) => `${formatClockTime(line.receivedAt)}  ${line.message}`).join("\n");
    try {
      void navigator.clipboard?.writeText(text);
    } catch {
      // Clipboard access can be denied (permissions, non-secure context, test
      // environment); the terminal stays usable either way.
    }
  }, [filtered]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0d10] text-foreground">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/40 px-2 py-1.5">
        {FILTER_CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            data-testid={`terminal-filter-${chip.id}`}
            onClick={() => setActiveFilter(chip.id)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
              activeFilter === chip.id
                ? "border-primary bg-primary/15 text-foreground"
                : "border-border/50 text-muted-foreground hover:text-foreground",
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-2 py-1.5">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search terminal output"
          aria-label="Search terminal output"
          data-testid="terminal-search"
          className="h-7 min-w-0 flex-1 rounded border border-border/50 bg-transparent px-2 text-xs outline-none placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-ring"
        />
        <span data-testid="terminal-count" className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          showing {filtered.length} of {logs.length}
        </span>
        <button
          type="button"
          data-testid="terminal-copy"
          onClick={copyVisible}
          className="shrink-0 rounded border border-border/50 px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
        >
          Copy visible
        </button>
        <button
          type="button"
          data-testid="terminal-pause-scroll"
          aria-pressed={paused}
          onClick={() => setPaused((value) => !value)}
          className={cn(
            "shrink-0 rounded border px-2 py-1 text-[10px] font-medium",
            paused ? "border-primary bg-primary/15 text-foreground" : "border-border/50 text-muted-foreground hover:text-foreground",
          )}
        >
          {paused ? "Scroll paused" : "Pause scroll"}
        </button>
      </div>

      <div className="relative min-h-0 flex-1" onScrollCapture={handleScrollCapture}>
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No lines match the current filter.</div>
        ) : (
          <List<RowProps>
            listRef={listRef}
            rowCount={filtered.length}
            rowHeight={ROW_HEIGHT}
            rowComponent={TerminalRow}
            rowProps={{ lines: filtered, query }}
            overscanCount={30}
            defaultHeight={384}
            style={{ height: "100%" }}
          />
        )}
        {!stuckToBottom && unseenCount > 0 && (
          <button
            type="button"
            data-testid="terminal-jump-bottom"
            onClick={jumpToBottom}
            className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-primary bg-primary/90 px-3 py-1 text-[11px] font-medium text-primary-foreground shadow-lg"
          >
            ↓ {unseenCount} new line{unseenCount === 1 ? "" : "s"}
          </button>
        )}
      </div>
    </div>
  );
}
