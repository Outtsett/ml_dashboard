/**
 * The conversation: Tyler's turns (with the page they were sent from), Claude's
 * text as markdown, its thinking folded away, each tool call beside its result,
 * permission requests, and a cost/time line per completed turn.
 */

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronRight, Wrench } from "lucide-react";
import type { ClaudePermissionDecision } from "@shared/claude/types";
import { PermissionCard } from "./PermissionCard";
import type { SessionView, TranscriptItem } from "./useClaudeSession";

function toolSummary(name: string, input: unknown): string {
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    for (const field of ["command", "file_path", "pattern", "path", "url", "route", "description", "query"]) {
      if (typeof record[field] === "string") return String(record[field]).slice(0, 140);
    }
  }
  return name;
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-invert prose-sm max-w-none text-[13px] leading-relaxed prose-pre:bg-neutral-950 prose-pre:text-[11px] prose-code:text-[#56B4E9] prose-a:text-[#56B4E9]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function Item({ item, onAnswer }: { item: TranscriptItem; onAnswer: (requestId: string, decision: ClaudePermissionDecision) => void }) {
  switch (item.kind) {
    case "user":
      return (
        <div className="ml-8 rounded-lg bg-neutral-800/80 px-3 py-2 text-[13px] text-neutral-100 whitespace-pre-wrap">
          {item.text}
          {item.context && (
            <div className="mt-1 text-[10px] text-neutral-500 font-mono">
              from {item.context.route}
              {item.context.symbol ? ` · ${item.context.symbol}` : ""}
              {item.context.timeframe ? ` ${item.context.timeframe}` : ""}
            </div>
          )}
        </div>
      );
    case "text":
      return <Markdown text={item.text} />;
    case "thinking":
      return item.text ? (
        <details className="text-[11px] text-neutral-500">
          <summary className="cursor-pointer select-none">thinking</summary>
          <div className="mt-1 whitespace-pre-wrap">{item.text}</div>
        </details>
      ) : null;
    case "tool":
      return (
        <details className="rounded border border-neutral-800 bg-neutral-900/60 text-[11px]">
          <summary className="flex cursor-pointer select-none items-center gap-1.5 px-2 py-1 text-neutral-300">
            <ChevronRight className="h-3 w-3 shrink-0" />
            <Wrench className="h-3 w-3 shrink-0 text-neutral-500" />
            <span className="font-mono text-neutral-200">{item.name.replace(/^mcp__/, "")}</span>
            <span className="truncate text-neutral-500">{toolSummary(item.name, item.input)}</span>
            {item.result === undefined ? (
              <span className="ml-auto text-neutral-500">…</span>
            ) : item.isError ? (
              <span className="ml-auto text-[#D55E00]">error</span>
            ) : (
              <span className="ml-auto text-[#56B4E9]">done</span>
            )}
          </summary>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all border-t border-neutral-800 px-2 py-1 font-mono text-neutral-400">{JSON.stringify(item.input, null, 1)}</pre>
          {item.result !== undefined && (
            <pre className={`max-h-72 overflow-auto whitespace-pre-wrap break-all border-t border-neutral-800 px-2 py-1 font-mono ${item.isError ? "text-[#D55E00]" : "text-neutral-300"}`}>
              {item.result}
            </pre>
          )}
        </details>
      );
    case "permission":
      return <PermissionCard item={item} onAnswer={(decision) => onAnswer(item.requestId, decision)} />;
    case "result":
      return (
        <div className="text-[10px] font-mono text-neutral-500">
          {item.isError ? `ended: ${item.subtype}` : "done"} · {(item.durationMs / 1000).toFixed(1)} s · {item.numTurns} turns · ${item.costUsd.toFixed(3)}
        </div>
      );
    case "error":
      return <div className="rounded border border-[#D55E00]/50 bg-[#D55E00]/10 px-2 py-1 text-[11px] text-[#D55E00] whitespace-pre-wrap">{item.message}</div>;
    default:
      return null;
  }
}

export function ClaudeTranscript({ view, onAnswer }: { view: SessionView; onAnswer: (requestId: string, decision: ClaudePermissionDecision) => void }) {
  const end = useRef<HTMLDivElement>(null);
  const count = view.items.length + view.draftText.length;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [count]);
  return (
    <div className="space-y-2.5">
      {view.items.map((item) => (
        <Item key={item.key} item={item} onAnswer={onAnswer} />
      ))}
      {view.draftThinking && !view.draftText && <div className="text-[11px] italic text-neutral-500">thinking…</div>}
      {view.draftText && <Markdown text={view.draftText} />}
      <div ref={end} />
    </div>
  );
}
