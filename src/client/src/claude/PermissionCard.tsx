/**
 * A tool call Claude wants to make, waiting for Tyler. Three shapes:
 * AskUserQuestion (Claude asks a question — answer with the options it gave),
 * ExitPlanMode (a plan to approve), and every other tool (allow once, always
 * allow the rule Claude Code suggests, or deny with an optional reason).
 */

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ClaudePermissionDecision } from "@shared/claude/types";
import type { TranscriptItem } from "./useClaudeSession";

type PermissionItem = Extract<TranscriptItem, { kind: "permission" }>;

interface Question {
  question: string;
  header?: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
}

function preview(input: unknown): string {
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    if (typeof record.command === "string") return record.command;
    if (typeof record.file_path === "string") return String(record.file_path);
  }
  const text = JSON.stringify(input, null, 1);
  return text.length > 1500 ? `${text.slice(0, 1500)}…` : text;
}

export function PermissionCard({ item, onAnswer }: { item: PermissionItem; onAnswer: (decision: ClaudePermissionDecision) => void }) {
  const [reason, setReason] = useState("");
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const done = item.resolved !== undefined;
  const border = done ? "border-neutral-700" : "border-[#E69F00]/60";

  if (item.toolName === "AskUserQuestion") {
    const questions = ((item.input as { questions?: Question[] })?.questions ?? []) as Question[];
    const complete = questions.every((q) => (answers[q.question] ?? []).length > 0);
    return (
      <div className={`rounded-md border ${border} bg-neutral-900 p-2.5 space-y-2 text-xs`}>
        <div className="text-[10px] uppercase tracking-widest text-[#E69F00]">Claude is asking</div>
        {questions.map((q) => (
          <div key={q.question} className="space-y-1">
            <div className="text-neutral-100">{q.question}</div>
            <div className="flex flex-wrap gap-1.5">
              {(q.options ?? []).map((option) => {
                const chosen = (answers[q.question] ?? []).includes(option.label);
                return (
                  <button
                    key={option.label}
                    type="button"
                    disabled={done}
                    title={option.description}
                    onClick={() =>
                      setAnswers((prev) => {
                        const current = prev[q.question] ?? [];
                        const nextValue = q.multiSelect
                          ? chosen
                            ? current.filter((l) => l !== option.label)
                            : [...current, option.label]
                          : [option.label];
                        return { ...prev, [q.question]: nextValue };
                      })
                    }
                    className={`rounded border px-2 py-0.5 ${chosen ? "border-[#56B4E9] bg-[#56B4E9]/15 text-[#56B4E9]" : "border-neutral-700 text-neutral-300 hover:border-neutral-500"}`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!done && (
          <button
            type="button"
            disabled={!complete}
            onClick={() =>
              onAnswer({
                decision: "allow",
                answers: Object.fromEntries(Object.entries(answers).map(([q, labels]) => [q, labels.join(", ")])),
              })
            }
            className="rounded border border-[#56B4E9]/60 px-2.5 py-1 text-[#56B4E9] disabled:opacity-40"
          >
            Answer
          </button>
        )}
        {done && <div className="text-neutral-500">answered</div>}
      </div>
    );
  }

  const plan = item.toolName === "ExitPlanMode" ? String((item.input as { plan?: string })?.plan ?? "") : null;
  return (
    <div className={`rounded-md border ${border} bg-neutral-900 p-2.5 space-y-2 text-xs`}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-widest text-[#E69F00]">{plan !== null ? "Approve this plan?" : "Allow this tool call?"}</span>
        <span className="font-mono text-neutral-200">{item.toolName}</span>
      </div>
      {item.title && <div className="text-neutral-300">{item.title}</div>}
      {item.decisionReason && <div className="text-neutral-500">{item.decisionReason}</div>}
      {plan !== null ? (
        <div className="prose prose-invert prose-xs max-w-none max-h-72 overflow-y-auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{plan}</ReactMarkdown>
        </div>
      ) : (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-neutral-950 p-2 font-mono text-[11px] text-neutral-300">{preview(item.input)}</pre>
      )}
      {done ? (
        <div className={item.resolved === "deny" ? "text-[#D55E00]" : "text-[#56B4E9]"}>{item.resolved === "deny" ? "denied" : item.resolved === "always" ? "always allowed" : "allowed"}</div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => onAnswer({ decision: "allow" })} className="rounded border border-[#56B4E9]/60 px-2.5 py-1 text-[#56B4E9] hover:bg-[#56B4E9]/10">
            Allow
          </button>
          {item.canAlways && (
            <button type="button" onClick={() => onAnswer({ decision: "always" })} className="rounded border border-neutral-600 px-2.5 py-1 text-neutral-300 hover:bg-neutral-800" title="Allow and add Claude Code's suggested permission rule">
              Always allow
            </button>
          )}
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="reason (optional)"
            className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-neutral-200"
          />
          <button type="button" onClick={() => onAnswer({ decision: "deny", message: reason || undefined })} className="rounded border border-[#D55E00]/60 px-2.5 py-1 text-[#D55E00] hover:bg-[#D55E00]/10">
            Deny
          </button>
        </div>
      )}
    </div>
  );
}
