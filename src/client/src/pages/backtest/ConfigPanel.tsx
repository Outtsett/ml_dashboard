import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Sparkles } from "lucide-react";
import type { BrokerConfig, StrategyType, IndicatorStrategyPreset } from "./types";
import { INDICATOR_DEFAULTS } from "./types";

interface ConfigPanelProps {
  selectedModel: string;
  onModelChange: (v: string) => void;
  selectedSymbol: string;
  onSymbolChange: (v: string) => void;
  selectedBroker: string;
  onBrokerChange: (v: string) => void;
  timeframe: string;
  onTimeframeChange: (v: string) => void;
  startDate: string;
  onStartDateChange: (v: string) => void;
  endDate: string;
  onEndDateChange: (v: string) => void;
  splitRatio: number;
  onSplitRatioChange: (v: number) => void;
  initialCapital: number;
  onInitialCapitalChange: (v: number) => void;
  positionSize: number;
  onPositionSizeChange: (v: number) => void;
  stopLossTicks: number | undefined;
  onStopLossTicksChange: (v: number | undefined) => void;
  takeProfitTicks: number | undefined;
  onTakeProfitTicksChange: (v: number | undefined) => void;
  minConfidence: number;
  onMinConfidenceChange: (v: number) => void;
  models: { id: number; name: string; architecture: string; symbol: string }[];
  instruments: { id: number; symbol: string; name: string; assetType: string }[];
  brokers: BrokerConfig[];
  previousRuns: any[];
  selectedRunId: number | null;
  onLoadRun: (run: any) => void;
}

const STRATEGY_TYPES: { value: StrategyType; label: string }[] = [
  { value: 'ml_prediction', label: 'ML Prediction' },
  { value: 'momentum', label: 'Momentum' },
  { value: 'indicator', label: 'Indicator' },
  { value: 'hybrid', label: 'Hybrid' },
];

const INDICATOR_PRESETS: { value: IndicatorStrategyPreset; label: string }[] = [
  { value: 'sma_crossover', label: 'SMA Crossover' },
  { value: 'ema_crossover', label: 'EMA Crossover' },
  { value: 'rsi_reversal', label: 'RSI Reversal' },
  { value: 'macd_signal', label: 'MACD Signal' },
  { value: 'bollinger_breakout', label: 'Bollinger Breakout' },
  { value: 'triple_ma', label: 'Triple MA' },
];

const SESSIONS = ['London', 'New York', 'Tokyo', 'Sydney'];

export function ConfigPanel({
  selectedModel, onModelChange,
  selectedSymbol, onSymbolChange,
  selectedBroker, onBrokerChange,
  timeframe, onTimeframeChange,
  startDate, onStartDateChange,
  endDate, onEndDateChange,
  splitRatio, onSplitRatioChange,
  initialCapital, onInitialCapitalChange,
  positionSize, onPositionSizeChange,
  stopLossTicks, onStopLossTicksChange,
  takeProfitTicks, onTakeProfitTicksChange,
  minConfidence, onMinConfidenceChange,
  models, instruments, brokers,
  previousRuns, selectedRunId, onLoadRun,
}: ConfigPanelProps) {
  const [strategyType, setStrategyType] = useState<StrategyType>('ml_prediction');
  const [indicatorPreset, setIndicatorPreset] = useState<IndicatorStrategyPreset>('sma_crossover');
  const [indicatorParams, setIndicatorParams] = useState<Record<string, number>>(INDICATOR_DEFAULTS.sma_crossover);
  const [selectedSessions, setSelectedSessions] = useState<string[]>(['London', 'New York']);

  const selectedInstrument = instruments.find((i) => i.symbol === selectedSymbol);
  const isForex = selectedInstrument?.assetType === 'forex';
  const showModelSelector = strategyType === 'ml_prediction' || strategyType === 'hybrid';
  const showIndicatorSelector = strategyType === 'indicator' || strategyType === 'hybrid';

  const handleStrategyTypeChange = (type: StrategyType) => {
    setStrategyType(type);
    if (type === 'momentum') {
      onModelChange('momentum');
    } else if (type === 'ml_prediction') {
      onModelChange('__last_trained__');
    }
  };

  const handlePresetChange = (preset: IndicatorStrategyPreset) => {
    setIndicatorPreset(preset);
    setIndicatorParams({ ...INDICATOR_DEFAULTS[preset] });
  };

  const handleParamChange = (key: string, value: number) => {
    setIndicatorParams((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSession = (session: string) => {
    setSelectedSessions((prev) =>
      prev.includes(session) ? prev.filter((s) => s !== session) : [...prev, session]
    );
  };

  return (
    <div className="lg:col-span-1 space-y-3 overflow-y-auto pr-1">
      <Card className="glass rounded-2xl gradient-border">
        <CardHeader className="py-2 px-3 border-b border-white/5">
          <CardTitle className="text-xs font-medium text-primary flex items-center gap-2">
            <Sparkles className="h-3 w-3" /> Parameters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-3 text-xs">
          {/* Strategy Type */}
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">Strategy Type</Label>
            <Select value={strategyType} onValueChange={(v) => handleStrategyTypeChange(v as StrategyType)}>
              <SelectTrigger className="h-8 rounded-lg bg-white/5 border-white/10 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRATEGY_TYPES.map((st) => (
                  <SelectItem key={st.value} value={st.value}>{st.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Model Selection (shown for ml_prediction and hybrid) */}
          {showModelSelector && (
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground">Model</Label>
              <Select value={selectedModel} onValueChange={onModelChange}>
                <SelectTrigger className="h-8 rounded-lg bg-white/5 border-white/10 text-xs">
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__last_trained__">Last Trained (in-memory)</SelectItem>
                  {models.map(m => (
                    <SelectItem key={m.id} value={String(m.id)}>
                      {m.name} ({m.architecture})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Indicator Preset (shown for indicator and hybrid) */}
          {showIndicatorSelector && (
            <>
              <div className="space-y-1.5">
                <Label className="text-[10px] text-muted-foreground">Indicator Preset</Label>
                <Select value={indicatorPreset} onValueChange={(v) => handlePresetChange(v as IndicatorStrategyPreset)}>
                  <SelectTrigger className="h-8 rounded-lg bg-white/5 border-white/10 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INDICATOR_PRESETS.map((ip) => (
                      <SelectItem key={ip.value} value={ip.value}>{ip.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Dynamic indicator parameters */}
              <div className="space-y-1.5 pl-2 border-l-2 border-[hsl(185,40%,45%)]/30">
                {Object.entries(indicatorParams).map(([key, value]) => (
                  <div key={key} className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground capitalize">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </Label>
                    <Input
                      type="number"
                      value={value}
                      onChange={(e) => handleParamChange(key, Number(e.target.value))}
                      className="h-7 rounded-lg bg-white/5 border-white/10 text-[10px]"
                      min={1}
                      step={1}
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Instrument */}
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">Instrument</Label>
            <Select value={selectedSymbol} onValueChange={onSymbolChange}>
              <SelectTrigger className="h-8 rounded-lg bg-white/5 border-white/10 text-xs">
                <SelectValue placeholder="Select instrument" />
              </SelectTrigger>
              <SelectContent>
                {instruments.map(inst => (
                  <SelectItem key={inst.id} value={inst.symbol}>
                    {inst.symbol} — {inst.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Session Filter (forex only) */}
          {isForex && (
            <div className="space-y-1.5">
              <Label className="text-[10px] text-muted-foreground">Session Filter</Label>
              <div className="grid grid-cols-2 gap-1.5">
                {SESSIONS.map((session) => (
                  <label
                    key={session}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer text-[10px] transition-colors ${
                      selectedSessions.includes(session)
                        ? 'bg-[hsl(185,40%,45%)]/15 border border-[hsl(185,40%,45%)]/30 text-[hsl(185,40%,45%)]'
                        : 'bg-white/5 border border-white/10 text-muted-foreground'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSessions.includes(session)}
                      onChange={() => toggleSession(session)}
                      className="sr-only"
                    />
                    <div className={`w-3 h-3 rounded border flex items-center justify-center ${
                      selectedSessions.includes(session) ? 'bg-[hsl(185,40%,45%)] border-[hsl(185,40%,45%)]' : 'border-white/30'
                    }`}>
                      {selectedSessions.includes(session) && (
                        <svg className="w-2 h-2 text-white" viewBox="0 0 12 12"><path d="M10 3L4.5 8.5 2 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      )}
                    </div>
                    {session}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Broker */}
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">Broker Profile</Label>
            <Select value={selectedBroker} onValueChange={onBrokerChange}>
              <SelectTrigger className="h-8 rounded-lg bg-white/5 border-white/10 text-xs">
                <SelectValue placeholder="Auto-detect" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (by asset type)</SelectItem>
                {brokers.map(b => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.broker} — {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Timeframe */}
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">Timeframe</Label>
            <Select value={timeframe} onValueChange={onTimeframeChange}>
              <SelectTrigger className="h-8 rounded-lg bg-white/5 border-white/10 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['1m', '5m', '15m', '30m', '1H', '4H', '1D'].map(tf => (
                  <SelectItem key={tf} value={tf}>{tf}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Date Range */}
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">Date Range (optional)</Label>
            <div className="grid grid-cols-2 gap-1">
              <Input type="date" value={startDate} onChange={e => onStartDateChange(e.target.value)}
                className="h-7 rounded-lg bg-white/5 border-white/10 text-[10px]" />
              <Input type="date" value={endDate} onChange={e => onEndDateChange(e.target.value)}
                className="h-7 rounded-lg bg-white/5 border-white/10 text-[10px]" />
            </div>
          </div>

          {/* Train/Test Split */}
          <div className="space-y-2 pt-2 border-t border-white/5">
            <Label className="text-[10px] text-muted-foreground flex justify-between">
              <span>Train/Test Split</span>
              <span className="font-mono text-primary">{(splitRatio * 100).toFixed(0)}% / {((1 - splitRatio) * 100).toFixed(0)}%</span>
            </Label>
            <Slider value={[splitRatio * 100]} min={50} max={95} step={5}
              onValueChange={v => onSplitRatioChange((v[0] ?? splitRatio * 100) / 100)} className="py-1" />
          </div>

          {/* Capital & Position */}
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">Initial Capital ($)</Label>
            <Input type="number" value={initialCapital} onChange={e => onInitialCapitalChange(Number(e.target.value))}
              className="h-7 rounded-lg bg-white/5 border-white/10 text-xs" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">Position Size (lots/contracts)</Label>
            <Input type="number" value={positionSize} onChange={e => onPositionSizeChange(Number(e.target.value))}
              className="h-7 rounded-lg bg-white/5 border-white/10 text-xs" min={0.01} step={0.01} />
          </div>

          {/* Risk Management */}
          <div className="space-y-2 pt-2 border-t border-white/5">
            <Label className="text-[10px] text-muted-foreground flex justify-between">
              <span>Stop Loss (Ticks)</span>
              <span className="font-mono text-muted-foreground">{stopLossTicks ?? 'Off'}</span>
            </Label>
            <Slider value={[stopLossTicks ?? 0]} max={100} step={1}
              onValueChange={v => { const val = v[0]; if (val !== undefined) onStopLossTicksChange(val > 0 ? val : undefined); }} className="py-1" />
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] text-muted-foreground flex justify-between">
              <span>Take Profit (Ticks)</span>
              <span className="font-mono text-muted-foreground">{takeProfitTicks ?? 'Off'}</span>
            </Label>
            <Slider value={[takeProfitTicks ?? 0]} max={200} step={1}
              onValueChange={v => { const val = v[0]; if (val !== undefined) onTakeProfitTicksChange(val > 0 ? val : undefined); }} className="py-1" />
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] text-muted-foreground flex justify-between">
              <span>Min Confidence</span>
              <span className="font-mono text-primary">{(minConfidence * 100).toFixed(0)}%</span>
            </Label>
            <Slider value={[minConfidence * 100]} min={30} max={95} step={5}
              onValueChange={v => onMinConfidenceChange((v[0] ?? minConfidence * 100) / 100)} className="py-1" />
          </div>
        </CardContent>
      </Card>

      {/* Previous Runs */}
      {previousRuns.length > 0 && (
        <Card className="glass rounded-2xl gradient-border">
          <CardHeader className="py-2 px-3 border-b border-white/5">
            <CardTitle className="text-xs font-medium text-accent">Previous Runs</CardTitle>
          </CardHeader>
          <ScrollArea className="max-h-48">
            <CardContent className="space-y-1.5 pt-2">
              {previousRuns.map((run: any) => (
                <button key={run.id} onClick={() => onLoadRun(run)}
                  className={`w-full text-left p-2 rounded-lg text-[10px] transition-colors ${
                    selectedRunId === run.id ? 'bg-primary/20 border border-primary/30' : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-mono font-bold truncate">{run.name}</span>
                    <Badge variant="outline" className={`text-[8px] ${
                      run.status === 'completed' ? 'border-emerald-500/50 text-emerald-400' : 'border-amber-500/50 text-amber-400'
                    }`}>{run.status}</Badge>
                  </div>
                  <div className="flex gap-2 mt-0.5 text-muted-foreground">
                    <span>{run.symbol}</span>
                    <span>{run.total_trades ?? 0} trades</span>
                    {run.total_return_pct != null && (
                      <span className={run.total_return_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {run.total_return_pct >= 0 ? '+' : ''}{run.total_return_pct.toFixed(1)}%
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </CardContent>
          </ScrollArea>
        </Card>
      )}
    </div>
  );
}
