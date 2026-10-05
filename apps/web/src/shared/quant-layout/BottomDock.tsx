import { useState } from "react";
import { Terminal, Cpu, Activity, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/shared/utils/utils";
import { LoggingTerminal, LogEntry } from "./LoggingTerminal";

// Mock logs for the UI design phase
const MOCK_LOGS: LogEntry[] = [
  { id: "1", timestamp: new Date().toISOString(), level: "info", message: "System initialized. Active workspace ready." },
  { id: "2", timestamp: new Date(Date.now() - 5000).toISOString(), level: "info", message: "Loaded model registry." },
];

export function BottomDock() {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"logs" | "hardware">("logs");
  const [logs] = useState<LogEntry[]>(MOCK_LOGS);

  // If collapsed, just show a minimal status bar
  if (!expanded) {
    return (
      <div className="h-8 border-t border-neutral-800 bg-[#0f0f0f] flex items-center px-3 gap-4 shrink-0 text-xs text-neutral-400 select-none z-50">
        <button 
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1.5 hover:text-neutral-200 transition-colors"
        >
          <ChevronUp className="h-3 w-3" />
          <Terminal className="h-3.5 w-3.5 text-blue-400" />
          <span>System Dock</span>
        </button>

        <div className="flex-1" />

        {/* Global HUD Mini-Stats */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5" title="Global GPU Compute">
            <Cpu className="h-3.5 w-3.5 text-[#E69F00]" />
            <span>GPU: 0%</span>
          </div>
          <div className="flex items-center gap-1.5" title="Global GPU VRAM">
            <Activity className="h-3.5 w-3.5 text-amber-500" />
            <span>VRAM: 2%</span>
          </div>
        </div>
      </div>
    );
  }

  // Expanded View
  return (
    <div className="h-64 border-t border-neutral-800 bg-[#0f0f0f] flex flex-col shrink-0 z-50 shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
      {/* Dock Header */}
      <div className="h-8 border-b border-neutral-800 flex items-center px-2 bg-neutral-950">
        <div className="flex items-center h-full gap-1">
          <button
            onClick={() => setActiveTab("logs")}
            className={cn(
              "px-3 h-full text-xs font-medium flex items-center gap-2 border-b-2 transition-colors",
              activeTab === "logs" ? "border-blue-500 text-neutral-200 bg-neutral-900/50" : "border-transparent text-neutral-500 hover:text-neutral-300"
            )}
          >
            <Terminal className="h-3.5 w-3.5" />
            Terminal
          </button>
          <button
            onClick={() => setActiveTab("hardware")}
            className={cn(
              "px-3 h-full text-xs font-medium flex items-center gap-2 border-b-2 transition-colors",
              activeTab === "hardware" ? "border-[#E69F00] text-neutral-200 bg-neutral-900/50" : "border-transparent text-neutral-500 hover:text-neutral-300"
            )}
          >
            <Cpu className="h-3.5 w-3.5" />
            Hardware Monitor
          </button>
        </div>

        <div className="flex-1" />
        
        <button 
          onClick={() => setExpanded(false)}
          className="p-1 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 rounded"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {/* Dock Content */}
      <div className="flex-1 overflow-hidden relative bg-[#0a0a0a]">
        {activeTab === "logs" && (
          <div className="absolute inset-0 border-none">
            <LoggingTerminal logs={logs} title="Global Output" />
          </div>
        )}
        {activeTab === "hardware" && (
          <div className="absolute inset-0 p-4 flex flex-col gap-2">
            <h3 className="text-sm text-neutral-400">System Telemetry</h3>
            <p className="text-xs text-neutral-500">Awaiting hardware metrics stream...</p>
          </div>
        )}
      </div>
    </div>
  );
}
