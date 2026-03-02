import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import {
  TrendingUp, DollarSign, ChevronsUpDown, Check,
  Layers, ZapOff, Play, Pause, PanelRightOpen, RotateCcw,
} from "lucide-react";
import { IndicatorSelector } from "@/components/IndicatorSelector";
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
  // Indicators
  catalog: any;
  selectedColumns: string[];
  onSelectionChange: (cols: string[]) => void;
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
  catalog, selectedColumns, onSelectionChange, indicatorsLoading,
  showSR, onToggleSR, showZigZag, onToggleZigZag, showSwingZZ, onToggleSwingZZ,
  replayActive, onToggleReplay,
  onResetChart, isRefetching,
  isTrainingActive, onOpenMlPanel,
  onResetScrollState,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 shrink-0 bg-card/30 backdrop-blur-sm flex-wrap">
      <Tabs value={assetType} onValueChange={(v) => {
        const newType = v as "futures" | "forex";
        onAssetTypeChange(newType);
      }}>
        <TabsList className="glass rounded-lg p-0.5 h-auto">
          <TabsTrigger value="futures" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-primary/20" data-testid="tab-futures">
            <TrendingUp className="h-3 w-3 mr-1" /> Futures
          </TabsTrigger>
          <TabsTrigger value="forex" className="rounded-md px-3 py-1 text-[10px] data-[state=active]:bg-primary/20" data-testid="tab-forex">
            <DollarSign className="h-3 w-3 mr-1" /> Forex
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <Popover open={symbolOpen} onOpenChange={onSymbolOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={symbolOpen}
            className="w-[220px] justify-between h-7 text-xs font-mono border-white/10 bg-black/30"
            data-testid="symbol-selector"
          >
            <span className="flex items-center gap-2">
              <span className="text-primary font-semibold">{symbol}</span>
              {activeSymbols.find(s => s.symbol === symbol)?.name && (
                <span className="text-muted-foreground text-[10px] font-sans truncate">
                  {activeSymbols.find(s => s.symbol === symbol)?.name}
                </span>
              )}
            </span>
            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
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

      <div className="w-px h-5 bg-white/10" />

      {/* Timeframe chips */}
      <div className="flex items-center gap-0.5">
        {timeframes.map((tf) => (
          <Button
            key={tf.label}
            variant={timeframe === tf.minutes ? "default" : "ghost"}
            size="sm"
            className={`h-6 px-2 text-[10px] font-mono ${
              timeframe === tf.minutes
                ? "bg-primary/20 text-primary border border-primary/30"
                : "text-muted-foreground hover:text-primary hover:bg-primary/10"
            }`}
            onClick={() => onTimeframeChange(tf.minutes)}
            data-testid={`timeframe-${tf.label}`}
          >
            {tf.label}
          </Button>
        ))}
      </div>

      <div className="w-px h-5 bg-white/10" />

      {/* Indicators + Overlays */}
      <IndicatorSelector
        catalog={catalog}
        selectedColumns={selectedColumns}
        onSelectionChange={onSelectionChange}
        isLoading={indicatorsLoading}
      />

      <div className="flex items-center gap-0.5">
        <Button
          variant={showSR ? "default" : "ghost"}
          size="sm"
          className={`h-6 px-2 text-[10px] font-mono gap-1 ${
            showSR
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
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
          className={`h-6 px-2 text-[10px] font-mono gap-1 ${
            showZigZag
              ? "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"
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
          className={`h-6 px-2 text-[10px] font-mono gap-1 ${
            showSwingZZ
              ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30"
              : "text-muted-foreground hover:text-cyan-400 hover:bg-cyan-500/10"
          }`}
          onClick={onToggleSwingZZ}
          title="Swing ZigZag (every high/low)"
        >
          <TrendingUp className="h-3 w-3" /> SW
        </Button>
        <Button
          variant={replayActive ? "default" : "ghost"}
          size="sm"
          className={`h-6 px-2 text-[10px] font-mono gap-1 ${
            replayActive
              ? "bg-violet-500/20 text-violet-400 border border-violet-500/30"
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
          className="h-6 px-2 text-[10px] font-mono gap-1 text-muted-foreground hover:text-blue-400 hover:bg-blue-500/10"
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
        className="h-7 px-3 text-[10px] font-mono border-white/10 bg-black/30 hover:bg-primary/10 hover:text-primary gap-1.5"
        onClick={onOpenMlPanel}
      >
        <PanelRightOpen className="h-3.5 w-3.5" />
        ML Tools
        {isTrainingActive && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />}
      </Button>
    </div>
  );
}
