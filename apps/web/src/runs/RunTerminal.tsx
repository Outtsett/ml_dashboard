/**
 * The run's terminal, beside its charts. Lines follow the Model Cycle log
 * grammar (`[fold 1/3][train] ...`, `[tune ...]`, `[trade #12] ...`), so the
 * filter chips are the same categories the engine writes.
 */
import { useEffect, useRef, useState } from "react";

import { categorizeLogLine, type LogCategory } from "@/cycle/Terminal";
import type { CycleLogLine } from "@shared/cycle/schema";
import { formatClock } from "@/runs/format";

type FilterId = "all" | "tuning" | "training" | "validation" | "testing" | "trades" | "problems";

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "tuning", label: "Tuning" },
  { id: "training", label: "Training" },
  { id: "validation", label: "Validation" },
  { id: "testing", label: "Testing" },
  { id: "trades", label: "Trades" },
  { id: "problems", label: "Warnings + errors" },
];

/** Okabe-Ito, one hue per category; the level badge carries warnings and errors. */
const CATEGORY_COLOR: Record<LogCategory, string> = {
  data: "#009E73",
  tuning: "#CC79A7",
  training: "#56B4E9",
  validation: "#F0E442",
  testing: "#0072B2",
  trades: "#E69F00",
  control: "#D55E00",
  other: "#8A8F98",
};

/** Rows drawn at once; older lines stay in the filter and the copy. */
const MAX_ROWS = 1500;

/** The engine writes a fold's search as `[fold 1/3][tune ...]`; that is tuning, whichever fold it is in. */
function categoryOf(message: string): LogCategory {
  if (/^\[fold \d+\/\d+\]\[tune\b/.test(message)) return "tuning";
  return categorizeLogLine(message);
}

function matches(line: CycleLogLine, filter: FilterId): boolean {
  if (filter === "all") return true;
  if (filter === "problems") return line.level === "warn" || line.level === "error";
  return categoryOf(line.message) === filter;
}

export function RunTerminal({ lines, live }: { lines: CycleLogLine[]; live: boolean }) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [search, setSearch] = useState("");
  const [follow, setFollow] = useState(true);
  const scroller = useRef<HTMLDivElement | null>(null);

  const needle = search.trim().toLowerCase();
  const filtered = lines.filter((line) => matches(line, filter) && (needle === "" || line.message.toLowerCase().includes(needle)));
  const shown = filtered.length > MAX_ROWS ? filtered.slice(-MAX_ROWS) : filtered;
  const problemCount = lines.filter((line) => line.level === "warn" || line.level === "error").length;

  useEffect(() => {
    if (!follow || !scroller.current) return;
    scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [follow, shown.length, filter]);

  function handleScroll() {
    const element = scroller.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
    if (atBottom !== follow) setFollow(atBottom);
  }

  function copyShown() {
    const text = filtered.map((line) => `${formatClock(line.receivedAt)}  ${line.message}`).join("\n");
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0d10]" data-testid="run-terminal">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/50 px-2 py-1.5">
        <span className="mr-1 font-mono text-[11px] font-bold uppercase text-foreground">Terminal</span>
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setFilter(entry.id)}
            className={`cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[10px] ${
              filter === entry.id ? "border-foreground/60 bg-foreground/10 text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {entry.label}
            {entry.id === "problems" && problemCount > 0 ? ` ${problemCount}` : ""}
          </button>
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-2 py-1">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find in terminal"
          className="h-6 min-w-0 flex-1 rounded border border-border/60 bg-transparent px-2 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/50"
        />
        <span className="font-mono text-[10px] text-muted-foreground">
          {filtered.length.toLocaleString("en-US")} of {lines.length.toLocaleString("en-US")} lines
        </span>
        <button type="button" onClick={copyShown} className="cursor-pointer rounded border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground">
          Copy
        </button>
      </div>
      <div ref={scroller} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto px-2 py-1 font-mono text-[11px] leading-[1.45]">
        {shown.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground">
            {lines.length === 0 ? (live ? "Waiting for the first line." : "This run's terminal was not kept.") : "No line matches."}
          </div>
        ) : (
          shown.map((line, index) => {
            const category = categoryOf(line.message);
            return (
              <div key={`${line.receivedAt}-${line.seq ?? "x"}-${index}`} className="flex gap-2 whitespace-pre-wrap break-words">
                <span className="shrink-0 text-muted-foreground/70">{formatClock(line.receivedAt)}</span>
                {line.level === "error" && <span className="shrink-0 font-bold text-[#D55E00]">✕ ERR</span>}
                {line.level === "warn" && <span className="shrink-0 font-bold text-[#F0E442]">▲ WRN</span>}
                <span className="min-w-0 [overflow-wrap:anywhere]" style={{ color: line.level === "error" ? "#D55E00" : CATEGORY_COLOR[category] }}>{line.message}</span>
              </div>
            );
          })
        )}
      </div>
      {!follow && live && (
        <button
          type="button"
          onClick={() => setFollow(true)}
          className="shrink-0 cursor-pointer border-t border-border/50 bg-[#E69F00]/15 py-1 font-mono text-[10px] text-[#E69F00]"
        >
          ▼ Follow the newest line
        </button>
      )}
    </div>
  );
}
