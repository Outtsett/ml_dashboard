import { useLocation } from "wouter";
import * as Toolbar from "@radix-ui/react-toolbar";

import { useWebSocketMetrics } from "@/hooks/useWebSocketMetrics";
import { Activity, Bot, Cpu, Server, PlayCircle } from "lucide-react";
import { useClaudePanel } from "@/claude/panelStore";
import * as Progress from "@radix-ui/react-progress";
import { useSymbolContext } from "@/shared/contexts/SymbolContext";
import { minutesToLabel } from "@/market/lib/timeframes";
import { useEntityStore } from "@/shared/contexts/EntityContext";
import { WindowControls } from "@/system/components/WindowControls";
import { MarketTicker } from "./MarketTicker";
import { X } from "lucide-react";

export function TopBar() {
  const [, navigate] = useLocation();
  const { metrics, isConnected } = useWebSocketMetrics();
  // The dashboard-wide selection. The timeframe here was the literal "1m" and
  // the symbol fell back to a literal "MNQ", so the bar kept announcing a pair
  // no page was on.
  const { symbol, timeframeMinutes } = useSymbolContext();
  const { activeEntity, clearEntity } = useEntityStore();
  const claudeOpen = useClaudePanel((state) => state.open);
  const toggleClaude = useClaudePanel((state) => state.toggle);

  return (
    // The desktop window is frameless (electron/main.cjs), so this bar is its
    // title bar: dragging it moves the window, and WindowControls draws the
    // minimize / maximize / close buttons (it renders nothing in a browser).
    <Toolbar.Root className="drag-region flex items-center w-full h-12 bg-neutral-950 border-b border-neutral-800 pl-4 shrink-0 text-sm">
      {/* The window controls took the width the labels used to fill, so the
          selection reads as values with the labels in the tooltip. */}
      <div className="flex items-center gap-3 text-neutral-300 whitespace-nowrap border-r border-neutral-700 pr-4 shrink-0">
        <span className="font-bold text-white tracking-wider">Quant AI Dashboard</span>
        <span className="text-yellow-500 font-mono" title="Symbol">{symbol}</span>
        <span className="text-neutral-200" title="Timeframe">{minutesToLabel(timeframeMinutes)}</span>
        {activeEntity && (
          <div className="no-drag ml-2 flex items-center gap-1.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 pl-2 pr-1 py-0.5 rounded text-xs">
            <div 
              onClick={() => navigate(`/entity/${activeEntity.type}/${activeEntity.id}`)}
              className="cursor-pointer flex items-center gap-1.5 hover:text-blue-300 transition-colors"
              title="Click to view entity profile"
            >
              <span className="font-semibold uppercase tracking-wider text-[10px] opacity-70">{activeEntity.type}:</span>
              <span className="truncate max-w-[150px]">{activeEntity.name}</span>
            </div>
            <button 
              onClick={clearEntity}
              className="cursor-pointer hover:bg-blue-500/30 rounded p-0.5"
              title="Clear active entity context"
            >
              <X className="h-3 w-3 opacity-70" />
            </button>
          </div>
        )}
      </div>

      <div className="no-drag flex-1 min-w-0 h-full border-r border-neutral-700">
        <MarketTicker />
      </div>

      <div className="flex items-center gap-3 px-3 whitespace-nowrap text-xs shrink-0">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-neutral-400" />
          <span className="text-neutral-300">GPU</span>
          <Progress.Root className="relative overflow-hidden bg-neutral-800 rounded-full w-10 h-2" value={metrics.gpuLoad}>
            <Progress.Indicator
              className="bg-(--color-data-cat-2) w-full h-full transition-transform duration-500 ease-in-out"
              style={{ transform: `translateX(-${100 - (metrics.gpuLoad || 0)}%)` }}
            />
          </Progress.Root>
          <span className="text-neutral-400 w-8 text-right">{metrics.gpuLoad}%</span>
        </div>

        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-neutral-400" />
          <span className="text-neutral-300">CPU</span>
          <Progress.Root className="relative overflow-hidden bg-neutral-800 rounded-full w-10 h-2" value={metrics.cpuLoad}>
            <Progress.Indicator
              className="bg-(--color-data-cat-1) w-full h-full transition-transform duration-500 ease-in-out"
              style={{ transform: `translateX(-${100 - (metrics.cpuLoad || 0)}%)` }}
            />
          </Progress.Root>
          <span className="text-neutral-400 w-8 text-right">{metrics.cpuLoad}%</span>
        </div>

        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-neutral-400" />
          <span className="text-neutral-400">{metrics.ping}ms</span>
          <div
            role="img"
            aria-label={isConnected ? "Connected" : "Disconnected"}
            title={isConnected ? "Connected" : "Disconnected"}
            className={`h-2 w-2 rounded-full ${isConnected ? "bg-(--color-data-pos)" : "bg-(--color-data-neg) animate-pulse"}`}
          />
        </div>

        <button
          type="button"
          onClick={() => navigate("/cycle")}
          title="Model cycle: pick a model, press Play"
          className="flex items-center gap-1.5 rounded border border-[#E69F00]/50 bg-[#E69F00]/10 text-[#E69F00] px-2 py-1 transition-colors hover:border-[#E69F00] hover:bg-[#E69F00]/20"
        >
          <PlayCircle className="h-4 w-4" />
          <span className="font-bold">Model cycle</span>
        </button>

        <button
          type="button"
          onClick={toggleClaude}
          aria-expanded={claudeOpen}
          title="Claude Code in the dashboard (Ctrl+Shift+K)"
          className={`flex items-center gap-1.5 rounded border px-2 py-1 transition-colors ${
            claudeOpen
              ? "border-[#56B4E9] bg-[#56B4E9]/15 text-[#56B4E9]"
              : "border-[#56B4E9]/40 text-[#56B4E9] hover:border-[#56B4E9] hover:bg-[#56B4E9]/10"
          }`}
        >
          <Bot className="h-4 w-4" />
          <span className="font-bold">Claude</span>
        </button>

      </div>

      <WindowControls className="border-l border-neutral-800" />
    </Toolbar.Root>
  );
}
