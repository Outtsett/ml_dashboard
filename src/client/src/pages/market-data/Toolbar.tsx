import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  TrendingUp, DollarSign, ChevronsUpDown, Check,
  Layers, ZapOff, Play, Pause, PanelRightOpen, RotateCcw,
} from "lucide-react";
import { IndicatorSelector } from "@/components/IndicatorSelector";
import type { ActiveIndicator } from "@/hooks/useActiveIndicators";
import type { InstrumentInfo } from "./types";
import { TIMEFRAME_OPTIONS as timeframes } from "@/lib/timeframes";

interface ToolbarProps {
  // Asset / Symbol / Contract
  assetType: "futures" | "forex";
  onAssetTypeChange: (type: "futures" | "forex") => void;
  symbol: string;
  onSymbolSelect: (sym: string, type: "futures" | "forex") => void;
  symbolOpen: boolean;
  onSymbolOpenChange: (open: boolean) => void;
  activeSymbols: InstrumentInfo[];
  // Futures flag
  isFutures: boolean;
  // Timeframe
  timeframe: number;
  onTimeframeChange: (minutes: number) => void;
  // Active indicators (new system)
  activeIndicators: ActiveIndicator[];
  onAddIndicator: (indicatorId: string) => void;
  onRemoveIndicator: (instanceId: string) => void;
  onUpdateParams: (instanceId: string, params: Record<string, number>) => void;
  onToggleVisibility: (instanceId: string) => void;
  onClearAllIndicators: () => void;
  // CDL Patterns
  selectedPatterns: string[];
  onPatternSelectionChange: (cols: string[]) => void;
  indicatorsLoading: boolean;
  // Overlays
  showSR: boolean;
  onToggleSR: () => void;
  showZigZag: boolean;
  onToggleZigZag: () => void;
  showSwingZZ: boolean;
  onToggleSwingZZ: () => void;
  // Replay
  replayActive: boolean;
  onToggleReplay: () => void;
  // Chart reset
  onResetChart: () => void;
  isRefetching: boolean;
  // ML Panel
  isTrainingActive: boolean;
  onOpenMlPanel: () => void;
  // Data reset callback
  onResetScrollState: () => void;
}

export function Toolbar({
  assetType, onAssetTypeChange,
  symbol, onSymbolSelect, symbolOpen, onSymbolOpenChange, activeSymbols,
  isFutures,
  timeframe, onTimeframeChange,
  activeIndicators, onAddIndicator, onRemoveIndicator, onUpdateParams,
  onToggleVisibility, onClearAllIndicators,
  selectedPatterns, onPatternSelectionChange,
  indicatorsLoading,
  showSR, onToggleSR, showZigZag, onToggleZigZag, showSwingZZ, onToggleSwingZZ,
  replayActive, onToggleReplay,
  onResetChart, isRefetching,
  isTrainingActive, onOpenMlPanel,
  onResetScrollState,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 border-b border-white/[0.08] shrink-0 bg-gradient-to-r from-card/50 via-card/40 to-card/50 backdrop-blur-md flex-wrap">
      <Tabs value={assetType} onValueChange={(v) => {
        const newType = v as "futures" | "forex";
        onAssetTypeChange(newType);
      }}>
        <TabsList className="glass rounded-lg p-0.5 h-auto border border-white/[0.06]">
          <TabsTrigger value="futures" className="rounded-md px-3 py-1.5 text-[11px] font-medium data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-400 data-[state=active]:shadow-[0_0_8px_rgba(16,185,129,0.1)]" data-testid="tab-futures">
            <TrendingUp className="h-3.5 w-3.5 mr-1.5" /> Futures
          </TabsTrigger>
          <TabsTrigger value="forex" className="rounded-md px-3 py-1.5 text-[11px] font-medium data-[state=active]:bg-primary/20 data-[state=active]:text-primary data-[state=active]:shadow-[0_0_8px_rgba(96,165,250,0.1)]" data-testid="tab-forex">
            <DollarSign className="h-3.5 w-3.5 mr-1.5" /> Forex
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Popover open={symbolOpen} onOpenChange={onSymbolOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={symbolOpen}
            className="w-[230px] justify-between h-8 text-xs font-mono border-primary/20 bg-black/40 hover:bg-black/50 hover:border-primary/30 shadow-[0_0_12px_rgba(96,165,250,0.06)] border-l-2 border-l-primary/50"
            data-testid="symbol-selector"
          >
            <span className="flex items-center gap-2">
              <span className="text-primary font-bold text-sm tracking-wide">{symbol}</span>
              {activeSymbols.find(s => s.symbol === symbol)?.name && (
                <span className="text-muted-foreground text-[10px] font-sans truncate">
                  {activeSymbols.find(s => s.symbol === symbol)?.name}
                </span>
              )}
            </span>
            <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-40" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[280px] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search symbol..." />
            <CommandList>
              <CommandEmpty>No symbol found.</CommandEmpty>
              <CommandGroup>
                {activeSymbols.map((inst) => (
                  <CommandItem
                    key={inst.symbol}
                    value={`${inst.symbol} ${inst.name}`}
                    onSelect={() => {
                      onSymbolSelect(inst.symbol, assetType);
                      onSymbolOpenChange(false);
                    }}
                    className="flex items-center gap-2"
                  >
                    <Check className={`h-3 w-3 ${symbol === inst.symbol ? 'opacity-100' : 'opacity-0'}`} />
                    <span className="font-mono font-semibold text-xs">{inst.symbol}</span>
                    <span className="text-muted-foreground text-xs truncate">{inst.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <div className="w-px h-5 bg-gradient-to-b from-transparent via-white/10 to-transparent" />

      {/* Timeframe chips */}
      <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-lg px-1 py-0.5 border border-white/[0.04]">
        {timeframes.map((tf) => (
          <Button
            key={tf.label}
            variant={timeframe === tf.minutes ? "default" : "ghost"}
            size="sm"
            className={`h-6 px-2.5 text-[11px] font-mono font-medium ${
              timeframe === tf.minutes
                ? "bg-primary/25 text-primary border border-primary/30 shadow-[0_0_10px_rgba(96,165,250,0.12)]"
                : "text-muted-foreground hover:text-primary hover:bg-primary/10"
            }`}
            onClick={() => onTimeframeChange(tf.minutes)}
            data-testid={`timeframe-${tf.label}`}
          >
            {tf.label}
          </Button>
        ))}
      </div>

      <div className="w-px h-5 bg-gradient-to-b from-transparent via-white/10 to-transparent" />

      {/* Indicators (new professional system) */}
      <IndicatorSelector
        activeIndicators={activeIndicators}
        onAddIndicator={onAddIndicator}
        onRemoveIndicator={onRemoveIndicator}
        onUpdateParams={onUpdateParams}
        onToggleVisibility={onToggleVisibility}
        onClearAll={onClearAllIndicators}
        selectedPatterns={selectedPatterns}
        onPatternSelectionChange={onPatternSelectionChange}
        isLoading={indicatorsLoading}
      />

      <div className="flex items-center gap-0.5 bg-white/[0.03] rounded-lg px-1.5 py-0.5 border border-white/[0.04]">
        <Button
          variant={showSR ? "default" : "ghost"}
          size="sm"
          className={`h-6 px-2.5 text-[11px] font-mono gap-1.5 ${
            showSR
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.15)]"
              : "text-muted-foreground hover:text-emerald-400 hover:bg-emerald-500/10"
          }`}
          onClick={onToggleSR}
          title="Support & Resistance levels"
        >
          <Layers className="h-3 w-3" /> S/R
        </Button>
        <Button
          variant={showZigZag ? "default" : "ghost"}
          size="sm"
          className={`h-6 px-2.5 text-[11px] font-mono gap-1.5 ${
            showZigZag
              ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 shadow-[0_0_8px_rgba(234,179,8,0.15)]"
              : "text-muted-foreground hover:text-yellow-400 hover:bg-yellow-500/10"
          }`}
          onClick={onToggleZigZag}
          title="ZigZag (ATR-filtered swings)"
        >
          <ZapOff className="h-3 w-3" /> ZZ
        </Button>
        <Button
          variant={showSwingZZ ? "default" : "ghost"}
          size="sm"
          className={`h-6 px-2.5 text-[11px] font-mono gap-1.5 ${
            showSwingZZ
              ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-[0_0_8px_rgba(34,211,238,0.15)]"
              : "text-muted-foreground hover:text-cyan-400 hover:bg-cyan-500/10"
          }`}
          onClick={onToggleSwingZZ}
          title="Swing ZigZag (every high/low)"
        >
          <TrendingUp className="h-3 w-3" /> SW
        </Button>
        <div className="w-px h-4 bg-white/[0.06] mx-0.5" />
        <Button
          variant={replayActive ? "default" : "ghost"}
          size="sm"
          className={`h-6 px-2.5 text-[11px] font-mono gap-1.5 ${
            replayActive
              ? "bg-violet-500/20 text-violet-400 border border-violet-500/30 shadow-[0_0_8px_rgba(139,92,246,0.15)]"
              : "text-muted-foreground hover:text-violet-400 hover:bg-violet-500/10"
          }`}
          onClick={onToggleReplay}
          title={replayActive ? "Exit replay mode" : "Enter replay mode"}
        >
          {replayActive ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          Replay
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2.5 text-[11px] font-mono gap-1.5 text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10"
          onClick={onResetChart}
          title="Reset chart (reload data)"
        >
          <RotateCcw className={`h-3 w-3 ${isRefetching ? 'animate-spin' : ''}`} />
          Reset
        </Button>
      </div>

      <div className="flex-1" />

      {/* ML Tools drawer trigger */}
      <Button
        variant="outline"
        size="sm"
        className="h-8 px-4 text-[11px] font-mono font-semibold border-primary/25 bg-gradient-to-r from-primary/10 to-primary/5 hover:from-primary/20 hover:to-primary/10 hover:border-primary/40 text-primary/90 hover:text-primary gap-2 shadow-[0_0_12px_rgba(96,165,250,0.08)]"
        onClick={onOpenMlPanel}
      >
        <PanelRightOpen className="h-3.5 w-3.5" />
        ML Tools
        {isTrainingActive && <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.5)]" />}
      </Button>
    </div>
  );
}
