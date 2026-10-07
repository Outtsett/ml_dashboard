import { memo } from "react";
import { Button } from "@/shared/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/shared/ui/command";
import { Activity, DollarSign, ChevronsUpDown, Check, Layers, ZapOff } from "lucide-react";
import { IndicatorSelector } from "@/market/components/IndicatorSelector";
import { LakeSeriesSelector } from "@/market/components/LakeSeriesSelector";
import type { LakeSeriesControls } from "@/market/lib/useLakeSeries";
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
  /** Every column in the lake, offered as a chart series. */
  lakeSeries: LakeSeriesControls;
  indicatorsLoading?: boolean;
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
  isTrainingActive: boolean;
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
  lakeSeries,
  indicatorsLoading,
  labelGenerators, labelGeneratorsLoading, selectedLabelGenerator, onSelectLabelGenerator,
  labelMarkerCount, labelDistribution, labelClassBalanceRatio,
  labelCoveredRange, labelChartExtendsPastLabels, labelsLoading, labelsError,
  showSR, onToggleSR, showZigZag, onToggleZigZag, showStructure, onToggleStructure,
  isTrainingActive: _isTrainingActive,
  onResetScrollState: _onResetScrollState,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 border-b border-white/[0.08] shrink-0 bg-gradient-to-r from-card/50 via-card/40 to-card/50 backdrop-blur-md flex-wrap">
      <Tabs value={assetType} onValueChange={(v) => {
        const newType = v as "futures" | "forex";
        onAssetTypeChange(newType);
      }}>
        <TabsList className="glass rounded-lg p-0.5 h-auto border border-white/[0.06]">
          <TabsTrigger value="futures" className="rounded-md px-3 py-1.5 text-[11px] font-medium data-[state=active]:bg-[hsl(var(--data-pos)/0.15)] data-[state=active]:text-[hsl(var(--data-pos))] data-[state=active]:shadow-[0_0_8px_rgba(16,185,129,0.1)]" data-testid="tab-futures">
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
        isLoading={indicatorsLoading}
      />

      {/* Every column in the lake, categorized and drawable */}
      <LakeSeriesSelector
        catalog={lakeSeries.catalog}
        catalogError={lakeSeries.catalogError}
        isCatalogLoading={lakeSeries.isCatalogLoading}
        selectedIds={lakeSeries.selectedIds}
        statuses={lakeSeries.statuses}
        onToggle={lakeSeries.toggle}
        onClear={lakeSeries.clear}
        atLimit={lakeSeries.atLimit}
        isFetching={lakeSeries.isFetching}
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
              ? "bg-[hsl(var(--data-pos)/0.2)] text-[hsl(var(--data-pos))] border border-[hsl(var(--data-pos)/0.3)] shadow-[0_0_8px_rgba(16,185,129,0.15)]"
              : "text-muted-foreground hover:text-[hsl(var(--data-pos))] hover:bg-[hsl(var(--data-pos)/0.1)]"
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
    </div>
  );
});

