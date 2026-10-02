/**
 * TrainingLogTab — Rich training log viewer.
 *
 * Subscribes to the training SSE stream via TrainingContext and renders
 * formatted events in an xterm.js terminal (no PTY — write-only).
 *
 * Displays:
 * - Log messages (startup info, feature computation, periodic summaries)
 * - Live progress bar (replaces bare "Iteration X/Y" flood)
 * - Formatted metric snapshots at ~10% intervals (LL, states, entropy, etc.)
 * - Regime overlay update notifications
 * - Completion banner with model ID, time, regime count, quality score
 * - Error banner
 */
import { useEffect, useRef, useCallback } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { useTrainingControl, useTrainingLive } from "@/training/lib/TrainingContext";

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

/** Show a metric snapshot at every N% progress. */
const METRIC_INTERVAL_PCT = 10;

/** Bare iteration messages to filter (we show a progress bar instead). */
const ITERATION_RE = /^Iteration \d+\/\d+$/;

interface TrainingLogTabProps {
  visible?: boolean;
}

export function TrainingLogTab({ visible = true }: TrainingLogTabProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  // Focused hooks — avoids full-context re-renders
  const { isTraining, config, modelType, completedModelId, progress, phase, error } = useTrainingControl();
  const { logs, metrics, overlayData, elapsedSec, totalBars, diagnostics, dataRange } = useTrainingLive();

  // Track what we've already rendered to the terminal
  const lastLogIdx = useRef(0);
  const lastMetricBucket = useRef(-1);
  const wasTraining = useRef(false);
  const completedRef = useRef<string | null>(null);
  const errorRef = useRef<string | null>(null);
  const lastOverlayNRegimes = useRef<number | null>(null);
  const onProgressLine = useRef(false);

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

  // Resize on container changes
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

  // Re-fit on visibility toggle
  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => fitRef.current?.fit());
    }
  }, [visible]);

  /** End a \r-overwritten progress line before writing a new full line. */
  const endProgressLine = useCallback(() => {
    if (onProgressLine.current && termRef.current) {
      termRef.current.writeln("");
      onProgressLine.current = false;
    }
  }, []);

  /** Format elapsed seconds as human-readable string. */
  const fmtTime = useCallback((sec: number) =>
    sec >= 60 ? `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s` : `${sec.toFixed(0)}s`
  , []);

  // ── Main reactive effect ────────────────────────────────────────────────────
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    // ── Training start ──────────────────────────────────────────────────────
    if (isTraining && !wasTraining.current) {
      wasTraining.current = true;
      lastLogIdx.current = 0;
      lastMetricBucket.current = -1;
      completedRef.current = null;
      errorRef.current = null;
      lastOverlayNRegimes.current = null;
      onProgressLine.current = false;
      term.clear();

      term.writeln(
        `${C.bold}${C.green}\u25B6 Training started${C.reset}  ` +
        `${C.dim}${modelType} | ${config?.symbol} ${config?.timeframe}${C.reset}`
      );
      const infoParts: string[] = [];
      if (totalBars > 0) infoParts.push(`${totalBars.toLocaleString()} bars`);
      if (dataRange) infoParts.push(`${dataRange.start} \u2192 ${dataRange.end}`);
      if (infoParts.length) term.writeln(`  ${C.dim}${infoParts.join(" | ")}${C.reset}`);
      term.writeln("");
    }

    // ── Training stop (cancelled / stopped without completion) ────────────
    if (!isTraining && wasTraining.current) {
      wasTraining.current = false;
    }

    // ── Log entries ─────────────────────────────────────────────────────────
    const allLogs = logs || [];
    for (let i = lastLogIdx.current; i < allLogs.length; i++) {
      const msg = allLogs[i];
      if (!msg) continue;

      // Filter bare "Iteration 123/500" lines — progress bar replaces them
      if (ITERATION_RE.test(msg)) continue;

      endProgressLine();

      if (msg.toLowerCase().includes("error")) {
        term.writeln(`${C.red}${msg}${C.reset}`);
      } else if (msg.toLowerCase().includes("warn")) {
        term.writeln(`${C.yellow}${msg}${C.reset}`);
      } else {
        term.writeln(`${C.dim}${msg}${C.reset}`);
      }
    }
    lastLogIdx.current = allLogs.length;

    // ── Progress bar (overwrites current line via \r) ───────────────────────
    if (isTraining && progress > 0) {
      const filled = Math.round(progress / 5);
      const bar = "\u2588".repeat(filled) + "\u2591".repeat(20 - filled);
      term.write(
        `\r${C.cyan}[${bar}]${C.reset} ${C.bold}${Math.round(progress)}%${C.reset}` +
        `  ${C.dim}${phase || "training"}  ${fmtTime(elapsedSec)}${C.reset}   `
      );
      onProgressLine.current = true;

      // ── Metric snapshot at interval boundaries ──────────────────────────
      const bucket = Math.floor(progress / METRIC_INTERVAL_PCT) * METRIC_INTERVAL_PCT;
      if (bucket > lastMetricBucket.current && Object.keys(metrics).length > 0) {
        lastMetricBucket.current = bucket;
        endProgressLine();

        const parts: string[] = [];
        if (metrics.log_likelihood != null)
          parts.push(`${C.blue}LL${C.reset} ${C.bold}${metrics.log_likelihood.toFixed(1)}${C.reset}`);
        if (metrics.num_regimes != null)
          parts.push(`${C.magenta}States${C.reset} ${C.bold}${Math.round(metrics.num_regimes)}${C.reset}`);
        if (metrics.beta_entropy != null)
          parts.push(`${C.cyan}Entropy${C.reset} ${C.bold}${metrics.beta_entropy.toFixed(2)}${C.reset}`);
        if (metrics.mean_self_transition != null)
          parts.push(`${C.yellow}SelfTrans${C.reset} ${C.bold}${metrics.mean_self_transition.toFixed(3)}${C.reset}`);
        if (metrics.assignment_stability != null)
          parts.push(`${C.green}Stability${C.reset} ${C.bold}${metrics.assignment_stability.toFixed(2)}${C.reset}`);

        if (parts.length > 0) {
          term.writeln(`  ${parts.join("  ")}`);
        }
      }
    }

    // ── Overlay update ──────────────────────────────────────────────────────
    if (overlayData) {
      const payload = overlayData.payload as Record<string, unknown> | undefined;
      const nRegimes = (payload?.n_regimes as number) ?? null;
      if (nRegimes != null && nRegimes !== lastOverlayNRegimes.current) {
        lastOverlayNRegimes.current = nRegimes;
        endProgressLine();
        term.writeln(
          `${C.green}\u25C6 Regime update${C.reset}  ${C.dim}${nRegimes} regimes detected${C.reset}`
        );
      }
    }

    // ── Completion banner ───────────────────────────────────────────────────
    if (completedModelId && completedModelId !== completedRef.current) {
      completedRef.current = completedModelId;
      endProgressLine();
      term.writeln("");
      term.writeln(`${C.bold}${C.green}\u2713 Training complete${C.reset}`);

      const infoParts: string[] = [
        `${C.dim}Model:${C.reset} ${C.bold}${completedModelId}${C.reset}`,
        `${C.dim}Time:${C.reset} ${fmtTime(elapsedSec)}`,
      ];
      const diag = diagnostics as Record<string, unknown> | null;
      if (diag?.n_regimes) infoParts.push(`${C.magenta}${diag.n_regimes} regimes${C.reset}`);
      if (diag?.quality_score)
        infoParts.push(`${C.yellow}Quality: ${(diag.quality_score as number).toFixed(0)}/100${C.reset}`);
      term.writeln(`  ${infoParts.join("  ")}`);
    }

    // ── Error banner ────────────────────────────────────────────────────────
    if (error && error !== errorRef.current) {
      errorRef.current = error;
      endProgressLine();
      term.writeln(`${C.bold}${C.red}\u2717 ${error}${C.reset}`);
    }

    // Auto-scroll to bottom so the user always sees the latest output
    term.scrollToBottom();
  }, [
    isTraining, logs, metrics, progress, phase, elapsedSec,
    overlayData, completedModelId, diagnostics, error,
    config, modelType, totalBars, dataRange,
    endProgressLine, fmtTime,
  ]);

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
