/**
 * TrainingTerminal — macOS-style terminal showing live training logs.
 * Color-codes lines by content type (error, warning, iteration, command, etc.).
 * During Gibbs sampling, shows a live metrics table with ALL per-iteration columns.
 */

import { RefObject } from "react";
import { Terminal as TerminalIcon, ChevronDown, ChevronUp } from "lucide-react";
import type { LiveMetrics, ConvergencePoint } from "./types";
import GibbsIterationTable from "./GibbsIterationTable";

interface TrainingTerminalProps {
  trainLogs: string[];
  isTraining: boolean;
  liveMetrics: LiveMetrics | null;
  liveConvergence: ConvergencePoint[];
  selectedSymbol: string;
  selectedTimeframe: string;
  showTerminal: boolean;
  setShowTerminal: (show: boolean) => void;
  logEndRef: RefObject<HTMLDivElement | null>;
  burnIn: number;
}

export default function TrainingTerminal({
  trainLogs, isTraining, liveMetrics, liveConvergence,
  selectedSymbol, selectedTimeframe,
  showTerminal, setShowTerminal, logEndRef, burnIn,
}: TrainingTerminalProps) {
  return (
    <div className="bg-[#0d1117] border border-[#30363d] rounded-xl font-mono text-[12px] flex flex-col overflow-hidden h-full">
      {/* Terminal title bar */}
      <div
        className="bg-[#161b22] border-b border-[#30363d] py-1.5 px-3 flex items-center gap-2 cursor-pointer select-none"
        onClick={() => setShowTerminal(!showTerminal)}
      >
        {/* macOS-style traffic lights */}
        <div className="flex gap-1.5 mr-2">
          <div className={`h-2.5 w-2.5 rounded-full ${isTraining ? 'bg-red-500' : 'bg-[#484f58]'}`} />
          <div className={`h-2.5 w-2.5 rounded-full ${isTraining ? 'bg-yellow-500' : 'bg-[#484f58]'}`} />
          <div className={`h-2.5 w-2.5 rounded-full ${isTraining ? 'bg-green-500' : 'bg-[#484f58]'}`} />
        </div>
        <TerminalIcon className="h-3.5 w-3.5 text-[#8b949e]" />
        <span className="text-[#8b949e] text-[11px] font-medium">
          hdp-hmm — {selectedSymbol}@{selectedTimeframe}
        </span>
        {isTraining && liveMetrics && (
          <span className="text-[10px] text-orange-400 ml-2 animate-pulse">
            ● iter {liveMetrics.gibbsIter}/{liveMetrics.gibbsTotal}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {isTraining && (
            <span className="text-[10px] text-[#8b949e] font-mono">
              {liveMetrics ? `${Math.floor(liveMetrics.elapsed / 60)}m ${Math.floor(liveMetrics.elapsed % 60)}s` : '0s'}
            </span>
          )}
          <span className="text-[10px] text-[#484f58]">{trainLogs.length} lines</span>
          {showTerminal ? <ChevronDown className="h-3 w-3 text-[#484f58]" /> : <ChevronUp className="h-3 w-3 text-[#484f58]" />}
        </div>
      </div>

      {/* ── Live Metrics Strip (visible during Gibbs sampling) ── */}
      {showTerminal && isTraining && liveMetrics && liveMetrics.activeStates > 0 && (
        <div className="bg-[#1c2128] border-b border-[#30363d] px-3 py-1.5 flex items-center gap-3 flex-wrap">
          <span className="text-[9px] text-[#484f58] uppercase tracking-widest mr-1">Live</span>
          {/* Regimes */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[#8b949e]">Regimes</span>
            <span className="text-[11px] font-bold font-mono text-orange-400">{liveMetrics.activeStates}</span>
          </div>
          <span className="text-[#30363d]">│</span>
          {/* LL/bar */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[#8b949e]">Fit</span>
            <span className="text-[11px] font-bold font-mono text-violet-400">
              {liveMetrics.fitPerBar !== 0
                ? liveMetrics.fitPerBar.toFixed(2)
                : liveMetrics.nBarsTotal > 0
                  ? (liveMetrics.logLikelihood / liveMetrics.nBarsTotal).toFixed(2)
                  : liveMetrics.logLikelihood.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            <span className="text-[9px] text-[#484f58]">/bar</span>
          </div>
          <span className="text-[#30363d]">│</span>
          {/* Delta */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-[#8b949e]">Δ</span>
            <span className={`text-[11px] font-bold font-mono ${liveMetrics.delta < 1 ? 'text-emerald-400' : liveMetrics.delta < 100 ? 'text-amber-400' : 'text-[#8b949e]'}`}>
              {liveMetrics.delta < 10 ? liveMetrics.delta.toFixed(2) : liveMetrics.delta.toFixed(0)}
            </span>
          </div>
          <span className="text-[#30363d]">│</span>
          {/* Entropy */}
          {liveMetrics.entropy > 0 && (
            <>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[#8b949e]">H</span>
                <span className="text-[11px] font-bold font-mono text-teal-400">{liveMetrics.entropy.toFixed(2)}</span>
              </div>
              <span className="text-[#30363d]">│</span>
            </>
          )}
          {/* Switch rate */}
          {liveMetrics.switchRate > 0 && (
            <>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[#8b949e]">Sw</span>
                <span className="text-[11px] font-bold font-mono text-cyan-400">{liveMetrics.switchRate.toFixed(3)}</span>
              </div>
              <span className="text-[#30363d]">│</span>
            </>
          )}
          {/* Self-transition */}
          {liveMetrics.selfTransition > 0 && (
            <>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[#8b949e]">Self</span>
                <span className="text-[11px] font-bold font-mono text-emerald-400">{liveMetrics.selfTransition.toFixed(2)}</span>
              </div>
              <span className="text-[#30363d]">│</span>
            </>
          )}
          {/* Gibbs progress */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-[#8b949e]">iter</span>
            <span className="text-[11px] font-mono text-cyan-400">{liveMetrics.gibbsIter}/{liveMetrics.gibbsTotal}</span>
            <div className="w-16 h-1.5 bg-[#21262d] rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-500/60 rounded-full transition-all duration-300"
                style={{ width: `${(liveMetrics.gibbsIter / Math.max(liveMetrics.gibbsTotal, 1)) * 100}%` }}
              />
            </div>
          </div>
          {/* Post-Gibbs metrics when they arrive */}
          {liveMetrics.stability > 0 && (
            <>
              <span className="text-[#30363d]">│</span>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[#8b949e]">WF</span>
                <span className="text-[11px] font-bold font-mono text-emerald-400">{(liveMetrics.stability * 100).toFixed(0)}%</span>
              </div>
            </>
          )}
          {liveMetrics.oosSimilarity > 0 && (
            <>
              <span className="text-[#30363d]">│</span>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[#8b949e]">OOS</span>
                <span className="text-[11px] font-bold font-mono text-cyan-400">{(liveMetrics.oosSimilarity * 100).toFixed(0)}%</span>
              </div>
            </>
          )}
          {liveMetrics.qualityScore > 0 && (
            <>
              <span className="text-[#30363d]">│</span>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-[#8b949e]">Quality</span>
                <span className="text-[11px] font-bold font-mono text-amber-400">{liveMetrics.qualityScore.toFixed(0)}</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Terminal body */}
      {showTerminal && (
        <div className="flex-1 overflow-hidden flex flex-col" style={{ scrollBehavior: 'smooth' }}>
          {/* ── Gibbs Iteration Table —— shows DURING training when convergence data exists ── */}
          {liveConvergence.length > 0 && (
            <div className="border-b border-[#30363d] shrink-0">
              <GibbsIterationTable
                points={liveConvergence}
                totalIterations={liveMetrics?.gibbsTotal ?? 0}
                nBars={liveMetrics?.nBarsTotal ?? 0}
                burnIn={burnIn}
              />
            </div>
          )}

          {/* ── Text log (non-iteration lines: steps, metrics, summary) ── */}
          <div className="flex-1 overflow-auto p-3 leading-[1.6]">
          {trainLogs.length === 0 ? (
            <div className="text-[#484f58] flex items-center gap-1">
              <span className="text-green-500">$</span> Ready. Click Train to start HDP-HMM Gibbs sampler.
            </div>
          ) : (
            trainLogs.filter(log => {
              // Filter OUT iteration lines since they're in the table now
              const isIterLine = log.includes('iter ') && log.includes('LL=') && log.includes('Regimes=');
              return !isIterLine;
            }).map((log, i) => {
              const isError = log.includes('ERROR') || log.includes('✗');
              const isWarn = log.includes('⚠');
              const isDone = log.includes('✓') || log.includes('complete');
              const isIter = log.includes('iter ') && log.includes('LL=');
              const isCmd = log.includes('$ python');
              const isStep = /\[\d+\/\d+\]/.test(log);
              const isSummaryLine = /^\d{2}:\d{2}:\d{2}\s{2,}(Regimes|Walk-Forward|Quality|OOS Match|Profile Corr|Switch Ratio|Model Fit|Time)\s/.test(log);
              const isSummaryBorder = log.includes('──────────');

              let color = '#8b949e';
              if (isError) color = '#f85149';
              else if (isWarn) color = '#d29922';
              else if (isDone) color = '#3fb950';
              else if (isSummaryLine) color = '#79c0ff';
              else if (isSummaryBorder) color = '#30363d';
              else if (isIter) color = '#a371f7';
              else if (isCmd) color = '#58a6ff';
              else if (isStep) color = '#f0883e';

              return (
                <div key={i} style={{ color }} className={`whitespace-pre-wrap ${isCmd ? 'font-bold mt-1' : ''} ${isStep ? 'mt-1 font-semibold' : ''}`}>
                  {log}
                </div>
              );
            })
          )}
          {isTraining && (
            <span className="inline-block w-2 h-4 bg-green-500 animate-pulse ml-0.5" />
          )}
          <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
