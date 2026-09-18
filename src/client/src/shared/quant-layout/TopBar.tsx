import * as Toolbar from "@radix-ui/react-toolbar";

import { useWebSocketMetrics } from "@/hooks/useWebSocketMetrics";
import { Activity, Cpu, PanelRight, Server } from "lucide-react";
import * as Progress from "@radix-ui/react-progress";
import { trendTone, trendToneClass, trendGlyph, trendLabel } from "@/shared/theme/dataColors";
import { useSymbolContext } from "@/shared/contexts/SymbolContext";
import { minutesToLabel } from "@/market/lib/timeframes";

export interface TopBarProps {
  sidePanelOpen: boolean;
  onToggleSidePanel: () => void;
}

export function TopBar({ sidePanelOpen, onToggleSidePanel }: TopBarProps) {
  const { metrics, isConnected } = useWebSocketMetrics();
  // The dashboard-wide selection. The timeframe here was the literal "1m" and
  // the symbol fell back to a literal "MNQ", so the bar kept announcing a pair
  // no page was on.
  const { symbol, timeframeMinutes } = useSymbolContext();

  return (
    <Toolbar.Root className="flex items-center w-full h-12 bg-neutral-950 border-b border-neutral-800 px-4 shrink-0 text-sm">
      <div className="flex items-center gap-4 text-neutral-300 whitespace-nowrap border-r border-neutral-700 pr-4">
        <span className="font-bold text-white tracking-wider">Quant AI Dashboard</span>
        <div className="flex items-center gap-2">
          <span className="text-neutral-500">Symbol:</span>
          <span className="text-yellow-500 font-mono">{symbol}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-neutral-500">TF:</span>
          <span className="text-neutral-200">{minutesToLabel(timeframeMinutes)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-neutral-500">Date Range:</span>
          <span className="text-neutral-200">{metrics.span || "Last 756 Days"}</span>
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-4 flex items-center h-full border-r border-neutral-700">
        <span className="text-neutral-500 mr-4 whitespace-nowrap">Live Metrics Ticker:</span>
        <div className="flex gap-8 items-center h-full w-full">
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">Reward</span>
            <span className={trendToneClass(trendTone(metrics.reward))}>
              <span aria-hidden="true">{trendGlyph(trendTone(metrics.reward))} </span>
              {metrics.reward >= 0 ? "+" : ""}{metrics.reward.toFixed(4)}
              <span className="sr-only"> {trendLabel(trendTone(metrics.reward))}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">Loss</span>
            <span className="text-neutral-200">{metrics.loss.toFixed(4)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">KL</span>
            <span className="text-neutral-200">{metrics.kl.toFixed(4)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-neutral-400">Entropy</span>
            <span className="text-neutral-200">{metrics.entropy.toFixed(4)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-6 pl-4 whitespace-nowrap text-xs">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-neutral-400" />
          <span className="text-neutral-300 w-8">GPU</span>
          <Progress.Root className="relative overflow-hidden bg-neutral-800 rounded-full w-16 h-2" value={metrics.gpuLoad}>
            <Progress.Indicator
              className="bg-(--color-data-cat-2) w-full h-full transition-transform duration-500 ease-in-out"
              style={{ transform: `translateX(-${100 - (metrics.gpuLoad || 0)}%)` }}
            />
          </Progress.Root>
          <span className="text-neutral-400 w-8 text-right">{metrics.gpuLoad}%</span>
        </div>

        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-neutral-400" />
          <span className="text-neutral-300 w-8">CPU</span>
          <Progress.Root className="relative overflow-hidden bg-neutral-800 rounded-full w-16 h-2" value={metrics.cpuLoad}>
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

        {/* Live metrics and the leaderboard used to hold 320px of the window
            open permanently. They are a drawer now, and this opens it. */}
        <button
          type="button"
          onClick={onToggleSidePanel}
          aria-expanded={sidePanelOpen}
          aria-controls="side-panel"
          title="Live metrics and leaderboard (Ctrl+J)"
          data-testid="toggle-side-panel"
          className={`flex items-center gap-1.5 rounded border px-2 py-1 transition-colors ${
            sidePanelOpen
              ? "border-neutral-600 bg-neutral-800 text-neutral-100"
              : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
          }`}
        >
          <PanelRight className="h-4 w-4" />
          <span>Metrics</span>
        </button>
      </div>
    </Toolbar.Root>
  );
}
