import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Copy, Check, Play, X, Loader2 } from "lucide-react";
import { type HighlighterCore } from "shiki";
import { createHighlighter } from "shiki";
import { motion, AnimatePresence } from "framer-motion";
import { useTerminalSession } from "../../hooks/useTerminalSession";

/* ── Singleton highlighter (lazy-initialized, created once) ── */
let highlighterInstance: HighlighterCore | null = null;
let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (highlighterInstance) return Promise.resolve(highlighterInstance);
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["vitesse-dark"],
      langs: ["python", "typescript"],
    }).then((h) => {
      highlighterInstance = h;
      return h;
    });
  }
  return highlighterPromise;
}

interface CodeBlockProps {
  code: string;
  language: "python" | "typescript";
  title?: string;
  showLineNumbers?: boolean;
  highlightLines?: number[];
}

/** Syntax-highlighted code block with copy button and optional Run-in-Terminal */
export function CodeBlock({
  code,
  language,
  title,
  showLineNumbers = true,
  highlightLines = [],
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const [highlighter, setHighlighter] = useState<HighlighterCore | null>(
    highlighterInstance,
  );
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const terminalOutputRef = useRef<HTMLPreElement>(null);
  const { sessionId, connected, output, create, sendInput, close } =
    useTerminalSession();
  const canRun = language === "python";

  useEffect(() => {
    if (highlighter) return;
    let cancelled = false;
    getHighlighter().then((h) => {
      if (!cancelled) setHighlighter(h);
    });
    return () => {
      cancelled = true;
    };
  }, [highlighter]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  /** Build a PowerShell command that writes code to a temp file and runs it. */
  const buildRunCommand = useCallback((src: string): string => {
    // Escape single quotes for PowerShell here-string safety
    const escaped = src.replace(/'/g, "''");
    return [
      `$code = @'`,
      escaped,
      `'@`,
      `$code | Out-File -Encoding utf8 $env:TEMP\\curriculum_run.py`,
      `python $env:TEMP\\curriculum_run.py`,
      ``,
    ].join("\n");
  }, []);

  const handleRun = useCallback(async () => {
    if (launching) return;
    setLaunching(true);
    setTerminalOpen(true);
    try {
      await create();
      // Small delay so the shell prompt is ready before we send input
      await new Promise((r) => setTimeout(r, 600));
      sendInput(buildRunCommand(code) + "\r");
    } finally {
      setLaunching(false);
    }
  }, [code, create, sendInput, buildRunCommand, launching]);

  const handleCloseTerminal = useCallback(async () => {
    setTerminalOpen(false);
    await close();
  }, [close]);

  // Auto-scroll terminal output
  useEffect(() => {
    const el = terminalOutputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [output]);

  const highlightSet = useMemo(() => new Set(highlightLines), [highlightLines]);

  const rendered = useMemo(() => {
    if (!highlighter) return null;
    return highlighter.codeToHtml(code, {
      lang: language,
      theme: "vitesse-dark",
    });
  }, [highlighter, code, language]);

  // Post-process Shiki HTML to inject line numbers & highlighted-line classes
  const processedHtml = useMemo(() => {
    if (!rendered) return null;

    const lines = code.split("\n");
    // Extract the inner HTML between the <code>...</code> tags
    const codeMatch = rendered.match(/<code[^>]*>([\s\S]*?)<\/code>/);
    if (!codeMatch) return rendered;

    const innerHtml = codeMatch[1]!;
    // Shiki wraps each line in a <span class="line">...</span>
    const lineRegex = /<span class="line">([\s\S]*?)<\/span>/g;
    const lineMatches = [...innerHtml.matchAll(lineRegex)];

    const wrappedLines = (lineMatches.length > 0 ? lineMatches : lines).map(
      (match, i) => {
        const lineNum = i + 1;
        const isHighlighted = highlightSet.has(lineNum);
        const lineContent =
          typeof match === "string" ? escapeHtml(match) : match[0];
        const highlightClass = isHighlighted
          ? " shiki-highlighted-line"
          : "";
        const lineNumSpan = showLineNumbers
          ? `<span class="shiki-line-number" data-line="${lineNum}">${lineNum}</span>`
          : "";
        return `<span class="shiki-line-wrapper${highlightClass}">${lineNumSpan}<span class="shiki-line-content">${lineContent}</span></span>`;
      },
    );

    // Replace inner code content with our wrapped version
    return rendered.replace(
      /<code[^>]*>[\s\S]*?<\/code>/,
      `<code>${wrappedLines.join("\n")}</code>`,
    );
  }, [rendered, code, highlightSet, showLineNumbers]);

  return (
    <div className="rounded-lg border border-border/50 bg-[hsl(220,15%,6%)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 bg-muted/20">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
          </div>
          {title && (
            <span className="text-xs text-muted-foreground font-mono ml-2">
              {title}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {language}
          </span>
          {canRun && (
            <button
              onClick={handleRun}
              disabled={launching}
              className="p-1 rounded hover:bg-muted/40 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-40"
              title="Run in Terminal"
            >
              {launching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-muted/40 transition-colors text-muted-foreground hover:text-foreground"
            title="Copy code"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {processedHtml ? (
        <div
          className="shiki-container overflow-x-auto p-4 text-sm leading-relaxed"
          dangerouslySetInnerHTML={{ __html: processedHtml }}
        />
      ) : (
        <pre className="p-4 overflow-x-auto text-sm leading-relaxed">
          <code className="font-mono text-[13px] text-foreground/90 whitespace-pre">
            {code}
          </code>
        </pre>
      )}

      <AnimatePresence>
        {terminalOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            className="border-t border-border/30 bg-[hsl(220,15%,4%)] overflow-hidden"
          >
            <div className="flex items-center justify-between px-3 py-1.5 bg-muted/10 border-b border-border/20">
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-muted-foreground font-mono">
                  Terminal
                </span>
                {sessionId && (
                  <span className="text-[9px] text-muted-foreground/50 font-mono">
                    {sessionId}
                    {connected ? "" : " (disconnected)"}
                  </span>
                )}
              </div>
              <button
                onClick={handleCloseTerminal}
                className="p-0.5 rounded hover:bg-muted/40 transition-colors text-muted-foreground hover:text-foreground"
                title="Close terminal"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
            <pre
              ref={terminalOutputRef}
              className="p-3 h-48 overflow-auto text-xs font-mono text-foreground/80 whitespace-pre-wrap"
            >
              {output || (launching ? "Starting terminal…" : "")}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .shiki-container pre {
          margin: 0;
          background: transparent !important;
          padding: 0;
        }
        .shiki-container code {
          font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
            "Liberation Mono", monospace;
          font-size: 13px;
          display: block;
          counter-reset: line;
        }
        .shiki-line-wrapper {
          display: flex;
          min-height: 1.5em;
          padding: 0 0.25rem;
          border-radius: 2px;
        }
        .shiki-highlighted-line {
          background: hsl(220 50% 40% / 0.15);
          border-left: 2px solid hsl(220 70% 55%);
          margin-left: -2px;
        }
        .shiki-line-number {
          display: inline-block;
          width: 2.5em;
          text-align: right;
          padding-right: 1.25em;
          color: hsl(220 10% 35%);
          user-select: none;
          flex-shrink: 0;
        }
        .shiki-line-content {
          flex: 1;
          white-space: pre;
        }
        .shiki-line-content .line {
          display: contents;
        }
      `}</style>
    </div>
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
