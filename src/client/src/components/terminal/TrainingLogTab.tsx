/**
 * TrainingLogTab — Read-only training log viewer.
 *
 * Subscribes to the training SSE stream via TrainingContext and renders
 * formatted events in an xterm.js terminal (no PTY — write-only).
 * Auto-activates when training starts.
 */
import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useTrainingContext } from "@/contexts/TrainingContext";

const THEME = {
  background: "#0a0a0a",
  foreground: "#c9d1d9",
  cursor: "#0a0a0a",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39d353",
  white: "#c9d1d9",
  brightBlack: "#6e7681",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightRed: "#ffa198",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d364",
  brightWhite: "#f0f6fc",
};

// ANSI escape codes
const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
};

interface TrainingLogTabProps {
  visible?: boolean;
}

export function TrainingLogTab({ visible = true }: TrainingLogTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const training = useTrainingContext();
  const lastLogCount = useRef(0);
  const wasTraining = useRef(false);

  // Initialize xterm (read-only)
  useEffect(() => {
    if (!containerRef.current) return;

    const term = new XTerm({
      theme: THEME,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: false,
      cursorStyle: "underline",
      scrollback: 10_000,
      disableStdin: true,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    termRef.current = term;
    fitRef.current = fit;

    term.open(containerRef.current);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => fit.fit());
    });

    term.writeln(`${C.dim}Training log — waiting for training to start...${C.reset}`);

    return () => {
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Resize
  useEffect(() => {
    if (!containerRef.current || !fitRef.current) return;
    const observer = new ResizeObserver(() => {
      try {
        fitRef.current?.fit();
      } catch { /* not visible */ }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Re-fit on visibility change
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => fitRef.current?.fit());
    }
  }, [visible]);

  // Format SSE events into ANSI terminal output
  const writeEvent = useCallback((type: string, data: Record<string, unknown>) => {
    const term = termRef.current;
    if (!term) return;

    switch (type) {
      case "started":
        term.writeln(
          `${C.bold}${C.green}\u25B6 Training started${C.reset} ` +
          `${C.dim}${data.modelType} | ${data.symbol} ${data.timeframe}${C.reset}`
        );
        term.writeln("");
        break;

      case "progress": {
        const pct = Math.round((data.pct as number) || 0);
        const filled = Math.round(pct / 5);
        const bar = "\u2588".repeat(filled) + "\u2591".repeat(20 - filled);
        const phase = data.phase || "training";
        // Overwrite current line with \r
        term.write(
          `\r${C.cyan}[${bar}]${C.reset} ${C.bold}${pct}%${C.reset} ` +
          `${C.dim}${data.step}/${data.totalSteps} ${phase}${C.reset}`
        );
        break;
      }

      case "metric": {
        const metrics = (data.metrics as Record<string, number>) || {};
        for (const [name, value] of Object.entries(metrics)) {
          const formatted = typeof value === "number" ? value.toFixed(4) : String(value);
          const color = name === "log_likelihood" ? C.blue
            : name === "num_regimes" ? C.magenta
            : C.white;
          term.writeln(`  ${color}${name}${C.reset}: ${C.bold}${formatted}${C.reset}`);
        }
        break;
      }

      case "overlay":
        term.writeln(`\r${C.green}\u25C6 Regime update${C.reset} ${C.dim}overlay refreshed${C.reset}`);
        break;

      case "log": {
        const level = (data.level as string) || "info";
        const color = level === "error" ? C.red : level === "warn" ? C.yellow : C.dim;
        term.writeln(`${color}${data.message}${C.reset}`);
        break;
      }

      case "done":
        term.writeln("");
        term.writeln(`${C.bold}${C.green}\u2713 Training complete${C.reset}`);
        if (data.elapsedSec) {
          term.writeln(`${C.dim}  Elapsed: ${(data.elapsedSec as number).toFixed(1)}s${C.reset}`);
        }
        break;

      case "error":
        term.writeln(`${C.bold}${C.red}\u2717 Error: ${data.message}${C.reset}`);
        if (data.details) {
          term.writeln(`${C.dim}${C.red}${data.details}${C.reset}`);
        }
        break;
    }
  }, []);

  // React to training state changes
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    // When training starts fresh, clear and write header
    if (training.isTraining && !wasTraining.current) {
      wasTraining.current = true;
      lastLogCount.current = 0;
      term.clear();
      writeEvent("started", {
        modelType: training.modelType,
        symbol: training.config?.symbol,
        timeframe: training.config?.timeframe,
      });
    }

    // When training stops
    if (!training.isTraining && wasTraining.current) {
      wasTraining.current = false;
    }

    // Process new log entries (logs are plain strings from onProgress/onLog)
    const logs = training.logs || [];
    for (let i = lastLogCount.current; i < logs.length; i++) {
      const msg = logs[i];
      if (msg) {
        writeEvent("log", { message: msg, level: "info" });
      }
    }
    lastLogCount.current = logs.length;
  }, [training.isTraining, training.logs, training.modelType, training.config, writeEvent]);

  return (
    <div
      style={{
        flex: "1 1 0%",
        minHeight: 0,
        width: "100%",
        display: visible ? "flex" : "none",
        flexDirection: "column",
      }}
    >
      <div
        ref={containerRef}
        style={{ flex: "1 1 0%", minHeight: 0, padding: "4px 0 0 4px" }}
      />
    </div>
  );
}
