import { memo } from "react";
import { Button } from "@/shared/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/shared/ui/command";
import {
  Activity, DollarSign, ChevronsUpDown, Check,
  Layers, ZapOff, Play, Square, PanelRightOpen,
} from "lucide-react";
import { IndicatorSelector } from "@/market/components/IndicatorSelector";
import { LabelSelector } from "@/market/components/LabelSelector";
import type { LabelGenerator } from "@/market/lib/useLabelOverlay";
import type { ActiveIndicator } from "@/market/lib/useActiveIndicators";
import type { InstrumentInfo } from "@/market/types";
import { TIMEFRAME_OPTIONS as timeframes } from "@/market/lib/timeframes";

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
  // Label overlay
  labelGenerators: LabelGenerator[];
  labelGeneratorsLoading: boolean;
  selectedLabelGenerator: string | null;
  onSelectLabelGenerator: (generatorType: string | null) => void;
  labelMarkerCount: number;
  labelDistribution: Record<string, number>;
  labelClassBalanceRatio: number | null;
  labelCoveredRange: { start: number; end: number } | null;
  labelChartExtendsPastLabels: boolean;
  labelsLoading: boolean;
  labelsError: string | null;
  // Overlays
  showSR: boolean;
  onToggleSR: () => void;
  showZigZag: boolean;
  onToggleZigZag: () => void;
  showStructure: boolean;
  onToggleStructure: () => void;
  // Tab Control
  activeTab: string;
  onTabChange: (tab: string) => void;
  isTrainingActive: boolean;
  // Training triggers (shared with ML Studio via TrainingContext)
  onStartTraining: () => void;
  onStopTraining: () => void;
  isTrainingStarting: boolean;
  // ML Panel
  onOpenMlPanel?: () => void;
  // Data reset callback
  onResetScrollState: () => void;
}

export const Toolbar = memo(function Toolbar({
  assetType, onAssetTypeChange,
  symbol, onSymbolSelect, symbolOpen, onSymbolOpenChange, activeSymbols,
  isFutures: _isFutures,
  timeframe, onTimeframeChange,
  activeIndicators, onAddIndicator, onRemoveIndicator, onUpdateParams,
  onToggleVisibility, onClearAllIndicators,
  selectedPatterns, onPatternSelectionChange,
  indicatorsLoading,
  labelGenerators, labelGeneratorsLoading, selectedLabelGenerator, onSelectLabelGenerator,
  labelMarkerCount, labelDistribution, labelClassBalanceRatio,
  labelCoveredRange, labelChartExtendsPastLabels, labelsLoading, labelsError,
  showSR, onToggleSR, showZigZag, onToggleZigZag, showStructure, onToggleStructure,
  isTrainingActive, activeTab: _activeTab, onTabChange: _onTabChange,
  onStartTraining, onStopTraining, isTrainingStarting,
  onOpenMlPanel,
  onResetScrollState: _onResetScrollState,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 border-b border-white/[0.08] shrink-0 bg-gradient-to-r from-card/50 via-card/40 to-card/50 backdrop-blur-md flex-wrap">
      <Tabs value={assetType} onValueChange={(v) => {
        const newType = v as "futures" | "forex";
        onAssetTypeChange(newType);
      }}>
        <TabsList className="glass rounded-lg p-0.5 h-auto border border-white/[0.06]">
          <TabsTrigger value="futures" className="rounded-md px-3 py-1.5 text-[11px] font-medium data-[state=active]:bg-emerald-500/15 data-[state=active]:text-emerald-400 data-[state=active]:shadow-[0_0_8px_rgba(16,185,129,0.1)]" data-testid="tab-futures">
            <Activity className="h-3.5 w-3.5 mr-1.5" /> Futures
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
                      onSymbolSelect(inst.symbol, inst.assetType as "futures" | "forex");
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

      {/* Label overlay picker */}
      <LabelSelector
        generators={labelGenerators}
        generatorsLoading={labelGeneratorsLoading}
        selected={selectedLabelGenerator}
        onSelect={onSelectLabelGenerator}
        markerCount={labelMarkerCount}
        distribution={labelDistribution}
        classBalanceRatio={labelClassBalanceRatio}
        coveredRange={labelCoveredRange}
        chartExtendsPastLabels={labelChartExtendsPastLabels}
        isLoading={labelsLoading}
        error={labelsError}
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
          title="microstructure (ATR-filtered swings)"
        >
          <ZapOff className="h-3 w-3" /> ZZ
        </Button>
        <Button
          variant={showStructure ? "default" : "ghost"}
          size="sm"
          className={`h-6 px-2.5 text-[11px] font-mono gap-1.5 ${
            showStructure
              ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 shadow-[0_0_8px_rgba(34,211,238,0.15)]"
              : "text-muted-foreground hover:text-cyan-400 hover:bg-cyan-500/10"
          }`}
          onClick={onToggleStructure}
          title="Order Flow Microstructure (all pivots)"
        >
          <Activity className="h-3 w-3" /> SW
        </Button>
      </div>

      <div className="flex-1" />

      {/* Train / Stop button */}
      {isTrainingActive ? (
        <Button
          variant="outline"
          size="sm"
          className="h-8 px-3 text-[11px] font-mono font-semibold border-red-500/25 bg-red-500/10 hover:bg-red-500/20 hover:border-red-500/40 text-red-400 gap-1.5"
          onClick={onStopTraining}
        >
          <Square className="h-3 w-3" /> Stop
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(52,211,153,0.5)]" />
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={isTrainingStarting}
          className="h-8 px-3 text-[11px] font-mono font-semibold border-emerald-500/25 bg-emerald-500/10 hover:bg-emerald-500/20 hover:border-emerald-500/40 text-emerald-400 gap-1.5 disabled:opacity-40"
          onClick={onStartTraining}
        >
          <Play className="h-3 w-3" /> Train
        </Button>
      )}

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
});

