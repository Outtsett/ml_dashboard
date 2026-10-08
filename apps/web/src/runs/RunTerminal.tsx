/**
 * The run's terminal as a time series: one row per logged step, one column
 * per quantity. The engine's lines (`[fold 1/3][tune trial 7/20] complete
 * sharpe_ratio=1.25 best=1.25`) are read into rows by `@shared/runs/logRows`
 * (when, fold, stage, trial, what happened in words, named numbers); the
 * columns are the quantities present in the rows on screen, so the table is
 * a data frame of the run rather than a wall of text. Search trials fold to
 * one row each until opened; every row keeps the raw line on hover.
 */
import { useEffect, useRef, useState } from "react";
import { barTimeOf, formatBarTime } from "@/runs/barTime";

import type { CycleLogLine } from "@shared/cycle/schema";
import { parseLogLine, STAGE_MEANING, summariseTrials, type LogRow, type LogStage, type TrialSummary } from "@shared/runs/logRows";
import { formatClock } from "@/runs/format";

type FilterId = "all" | "tune" | "train" | "validate" | "test" | "trade" | "problems";

const FILTERS: Array<{ id: FilterId; label: string }> = [
  { id: "all", label: "All" },
  { id: "tune", label: "Search" },
  { id: "train", label: "Fit" },
  { id: "validate", label: "Validate" },
  { id: "test", label: "Test" },
  { id: "trade", label: "Trades" },
  { id: "problems", label: "Warnings + errors" },
];

/** Okabe-Ito, one hue per stage; the level badge carries warnings and errors. */
const STAGE_COLOR: Record<LogStage, string> = {
  data: "#009E73",
  device: "#009E73",
  features: "#009E73",
  plan: "#009E73",
  tune: "#CC79A7",
  train: "#56B4E9",
  validate: "#F0E442",
  replay: "#F0E442",
  test: "#0072B2",
  trade: "#E69F00",
  save: "#8A8F98",
  other: "#8A8F98",
};

/** Columns in the order a reader expects them; any other quantity follows in first-seen order. */
const COLUMN_ORDER = [
  "bar", "close", "P(up)", "signal", "position", "equity", "price forecast",
  "training loss", "validation loss", "validation accuracy", "validation F1", "validation mean absolute error", "validation sign accuracy", "best so far",
  "Sharpe ratio", "net profit", "net", "gross", "cost", "trades", "accuracy", "bars held", "exit reason",
  "fit", "step", "samples per second", "fit time", "bars seen",
];

/** Rows drawn at once; older rows stay in the filter and the copy. */
const MAX_ROWS = 1500;
/** A quantity becomes a column once this share of the rows on screen carry it (at least 3 rows); below that it is written into the row's event cell. */
const MIN_COLUMN_SHARE = 0.02;

function matches(row: LogRow, filter: FilterId): boolean {
  if (filter === "all") return true;
  if (filter === "problems") return row.level === "warn" || row.level === "error";
  if (filter === "validate") return row.stage === "validate" || row.stage === "replay";
  return row.stage === filter;
}

const parsed = new WeakMap<CycleLogLine, LogRow>();
function rowOf(line: CycleLogLine): LogRow {
  let row = parsed.get(line);
  if (!row) {
    row = parseLogLine(line);
    parsed.set(line, row);
  }
  return row;
}

export function RunTerminal({
  lines,
  live,
  onLocate,
  seekTime,
}: {
  lines: CycleLogLine[];
  live: boolean;
  /** A line that names a bar was clicked: its bar time, in epoch seconds. */
  onLocate?: (seconds: number) => void;
  /** A bar was clicked on the chart: scroll to the first line logged on it. */
  seekTime?: number | null;
}) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [search, setSearch] = useState("");
  const [follow, setFollow] = useState(live);
  const [picked, setPicked] = useState<number | null>(null);
  const [openTrials, setOpenTrials] = useState<Set<string>>(new Set());
  const [legend, setLegend] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  const scroller = useRef<HTMLDivElement | null>(null);

  const rows = lines.map(rowOf);
  const needle = search.trim().toLowerCase();
  const filteredRows = rows.filter((row) => matches(row, filter) && (needle === "" || row.raw.toLowerCase().includes(needle)));
  const trials = summariseTrials(filteredRows);

  // each search trial folds to one row (its settings and score) unless opened or "every step" is on
  type Shown = { kind: "row"; row: LogRow; index: number } | { kind: "trial"; summary: TrialSummary; index: number };
  const shownAll: Shown[] = [];
  for (let index = 0; index < filteredRows.length; index += 1) {
    const summary = trials.get(index);
    const key = summary ? `${summary.fold}:${summary.trial}` : "";
    if (summary && !showSteps && !openTrials.has(key)) {
      shownAll.push({ kind: "trial", summary, index });
      index = summary.lastIndex;
      continue;
    }
    shownAll.push({ kind: "row", row: filteredRows[index]!, index });
  }
  const shown = shownAll.length > MAX_ROWS ? shownAll.slice(-MAX_ROWS) : shownAll;
  const problemCount = rows.filter((row) => row.level === "warn" || row.level === "error").length;

  // the columns: every quantity present in the rows on screen, in reading order
  const present = new Set<string>();
  for (const entry of shown) {
    if (entry.kind === "row") entry.row.numbers.forEach((number) => present.add(number.name));
    else {
      entry.summary.settings.forEach((number) => present.add(number.name));
      if (entry.summary.score) present.add(entry.summary.score.name);
      if (entry.summary.bestSoFar) present.add(entry.summary.bestSoFar.name);
    }
  }
  // a quantity is a column when it recurs (the time series); a one-off number stays in its row's "what happened" cell
  const frequency = new Map<string, number>();
  for (const entry of shown) {
    const names = entry.kind === "row" ? entry.row.numbers.map((number) => number.name) : [...entry.summary.settings.map((number) => number.name), entry.summary.score?.name ?? "", entry.summary.bestSoFar?.name ?? ""];
    for (const name of names) if (name) frequency.set(name, (frequency.get(name) ?? 0) + 1);
  }
  const minimumRows = Math.max(3, Math.ceil(shown.length * MIN_COLUMN_SHARE));
  const recurring = [...present].filter((name) => COLUMN_ORDER.includes(name) || (frequency.get(name) ?? 0) >= minimumRows);
  const columns = [...COLUMN_ORDER.filter((name) => recurring.includes(name)), ...recurring.filter((name) => !COLUMN_ORDER.includes(name))];
  const columnSet = new Set(columns);
  const inline = (row: LogRow) => row.numbers.filter((number) => !columnSet.has(number.name)).map((number) => `${number.name} ${number.value}`).join(" · ");

  useEffect(() => {
    if (!follow || !scroller.current) return;
    scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [follow, shown.length, filter]);

  // a bar clicked on the chart: find the first shown row stamped with that bar and scroll to it
  useEffect(() => {
    if (seekTime === null || seekTime === undefined) return;
    const stamp = formatBarTime(seekTime);
    const position = shown.findIndex((entry) => entry.kind === "row" && entry.row.raw.includes(stamp));
    if (position < 0) return;
    setFollow(false);
    setPicked(position);
    rowRefs.current.get(position)?.scrollIntoView({ block: "center" });
    // `shown` changes every poll; re-running on it would fight the user's scrolling
  }, [seekTime]);

  function handleScroll() {
    const element = scroller.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
    if (atBottom !== follow) setFollow(atBottom);
  }

  /** Tab-separated, one column per quantity: pastes into a sheet as the same table. */
  function copyShown() {
    const header = ["time", "fold", "stage", "trial", "event", ...columns].join("\t");
    const body = filteredRows.map((row) => {
      const cell = (name: string) => row.numbers.find((number) => number.name === name)?.value ?? "";
      return [formatClock(row.receivedAt), row.fold ?? "", STAGE_MEANING[row.stage].label, row.trial ?? "", row.event, ...columns.map(cell)].join("\t");
    });
    void navigator.clipboard?.writeText([header, ...body].join("\n")).catch(() => undefined);
  }

  const cellClass = "whitespace-nowrap px-1.5 py-[1px] text-right tabular-nums";
  const headClass = "sticky top-0 z-10 whitespace-nowrap border-b border-border/60 bg-[#0b0d10] px-1.5 py-1 text-left font-bold uppercase tracking-wide text-muted-foreground";

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0d10]" data-testid="run-terminal">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/50 px-2 py-1.5">
        <span className="mr-1 font-mono text-[11px] font-bold uppercase text-foreground">Terminal</span>
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setFilter(entry.id)}
            data-testid={`terminal-filter-${entry.id}`}
            className={`cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[10px] ${
              filter === entry.id ? "border-foreground/60 bg-foreground/10 text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"
            }`}
          >
            {entry.label}
            {entry.id === "problems" && problemCount > 0 ? ` ${problemCount}` : ""}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setLegend(!legend)}
          className={`ml-auto cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[10px] ${legend ? "border-foreground/60 text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
          data-testid="terminal-legend-toggle"
        >
          ? What the stages mean
        </button>
      </div>
      {legend && (
        <div className="grid shrink-0 gap-x-4 gap-y-0.5 border-b border-border/50 px-2 py-1.5 font-mono text-[10px] sm:grid-cols-2" data-testid="terminal-legend">
          {(Object.keys(STAGE_MEANING) as LogStage[]).filter((stage) => stage !== "other").map((stage) => (
            <div key={stage} className="flex gap-2">
              <span className="w-16 shrink-0 font-bold" style={{ color: STAGE_COLOR[stage] }}>{STAGE_MEANING[stage].label}</span>
              <span className="text-muted-foreground">{STAGE_MEANING[stage].meaning}</span>
            </div>
          ))}
          <div className="text-muted-foreground sm:col-span-2">A run reads: Data → Features → Plan, then for each fold Search → Fit → Validate → Replay → Test (with Trades) → Record. Only the Test stage is out of sample.</div>
        </div>
      )}
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-2 py-1">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find in terminal"
          className="h-6 min-w-0 flex-1 rounded border border-border/60 bg-transparent px-2 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus:border-foreground/50"
        />
        <span className="font-mono text-[10px] text-muted-foreground">
          {filteredRows.length.toLocaleString("en-US")} of {lines.length.toLocaleString("en-US")} lines · {columns.length} columns
        </span>
        <button
          type="button"
          onClick={() => setShowSteps(!showSteps)}
          title="Each search trial is one row (its settings and score) unless opened; this shows every fit and validation step of every trial"
          className={`cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[10px] ${showSteps ? "border-foreground/60 text-foreground" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
        >
          Every trial step
        </button>
        <button type="button" onClick={copyShown} title="Copies the table as tab-separated columns" className="cursor-pointer rounded border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground">
          Copy table
        </button>
      </div>
      <div ref={scroller} onScroll={handleScroll} className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-[1.4]">
        {shown.length === 0 ? (
          <div className="py-6 text-center text-muted-foreground">
            {lines.length === 0 ? (live ? "Waiting for the first line." : "This run's terminal was not kept.") : "No line matches."}
          </div>
        ) : (
          <table className="border-collapse" data-testid="terminal-table">
            <thead>
              <tr>
                <th className={`${headClass} left-0 z-20`}>Time</th>
                <th className={headClass} title="The bar the line is about (the series' own clock), when it names one">Bar time</th>
                <th className={headClass}>Fold</th>
                <th className={headClass}>Stage</th>
                <th className={headClass}>Trial</th>
                <th className={headClass}>What happened</th>
                {columns.map((name) => (
                  <th key={name} className={`${headClass} text-right`}>{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((entry, position) => {
                if (entry.kind === "trial") {
                  const s = entry.summary;
                  const key = `${s.fold}:${s.trial}`;
                  const cell = (name: string) => s.settings.find((number) => number.name === name)?.value ?? (s.score?.name === name ? s.score.value : s.bestSoFar?.name === name ? s.bestSoFar.value : "");
                  return (
                    <tr
                      key={`trial-${key}-${position}`}
                      onClick={() => setOpenTrials((previous) => new Set(previous).add(key))}
                      title={`Click to open the trial's ${s.stepCount} steps`}
                      className="cursor-pointer border-b border-border/20 hover:bg-foreground/5"
                      style={{ color: STAGE_COLOR.tune }}
                      data-testid="terminal-trial-row"
                    >
                      <td className="sticky left-0 whitespace-nowrap bg-[#0b0d10] px-1.5 py-[1px] text-muted-foreground/70">{formatClock(filteredRows[s.firstIndex]!.receivedAt)}</td>
                      <td className={cellClass} />
                      <td className={cellClass}>{s.fold ?? ""}</td>
                      <td className="whitespace-nowrap px-1.5 py-[1px]">{STAGE_MEANING.tune.label}</td>
                      <td className={cellClass}>{s.trial}{s.trialCount ? `/${s.trialCount}` : ""}</td>
                      <td className="whitespace-nowrap px-1.5 py-[1px]">▸ trial {s.score ? "scored" : "running"} · {s.stepCount} steps</td>
                      {columns.map((name) => (
                        <td key={name} className={cellClass}>{cell(name)}</td>
                      ))}
                    </tr>
                  );
                }
                const row = entry.row;
                const barTime = barTimeOf(row.raw);
                const color = row.level === "error" ? "#D55E00" : STAGE_COLOR[row.stage];
                const cell = (name: string) => row.numbers.find((number) => number.name === name)?.value ?? "";
                return (
                  <tr
                    key={`${row.receivedAt}-${row.seq ?? "x"}-${position}`}
                    ref={(node) => {
                      if (node) rowRefs.current.set(position, node);
                      else rowRefs.current.delete(position);
                    }}
                    onClick={() => {
                      if (barTime === null || !onLocate) return;
                      setPicked(position);
                      onLocate(barTime);
                    }}
                    title={barTime === null ? row.raw : `${row.raw}\n\nClick to show this bar on the chart`}
                    className={`border-b border-border/20 ${barTime === null ? "" : "cursor-pointer hover:bg-foreground/5"} ${picked === position ? "bg-[#F0E442]/15 outline outline-1 outline-[#F0E442]/60" : ""}`}
                    style={{ color }}
                  >
                    <td className="sticky left-0 whitespace-nowrap bg-[#0b0d10] px-1.5 py-[1px] text-muted-foreground/70">{formatClock(row.receivedAt)}</td>
                    <td className="whitespace-nowrap px-1.5 py-[1px] tabular-nums">{row.barStamp ?? ""}</td>
                    <td className={cellClass}>{row.fold ?? ""}</td>
                    <td className="whitespace-nowrap px-1.5 py-[1px]">
                      {row.level === "error" && <span className="mr-1 font-bold text-[#D55E00]">✕</span>}
                      {row.level === "warn" && <span className="mr-1 font-bold text-[#F0E442]">▲</span>}
                      {STAGE_MEANING[row.stage].label}
                    </td>
                    <td className={cellClass}>{row.trial ?? (row.trade !== null ? `#${row.trade}` : "")}</td>
                    <td className="max-w-[36rem] truncate px-1.5 py-[1px]">
                      {row.event}
                      {inline(row) && <span className="text-muted-foreground"> · {inline(row)}</span>}
                    </td>
                    {columns.map((name) => (
                      <td key={name} className={cellClass}>{cell(name)}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {!follow && live && (
        <button
          type="button"
          onClick={() => setFollow(true)}
          className="shrink-0 cursor-pointer border-t border-border/50 bg-[#E69F00]/15 py-1 font-mono text-[10px] text-[#E69F00]"
        >
          ▼ Follow the newest row
        </button>
      )}
    </div>
  );
}
