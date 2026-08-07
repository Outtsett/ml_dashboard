import { Card, CardContent } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Slider } from "@/shared/ui/slider";
import { Play, Loader2, AlertTriangle } from "lucide-react";

interface ForecastControlsProps {
  symbol: string;
  onSymbolChange: (sym: string) => void;
  timeframe: string;
  onTimeframeChange: (tf: string) => void;
  modelSize: string;
  onModelSizeChange: (ms: string) => void;
  context: number;
  onContextChange: (c: number) => void;
  horizon: number;
  onHorizonChange: (h: number) => void;
  allSymbols: string[];
  onRun: () => void;
  isPending: boolean;
  isError: boolean;
  errorMessage?: string;
}

export function ForecastControls({
  symbol, onSymbolChange,
  timeframe, onTimeframeChange,
  modelSize, onModelSizeChange,
  context, onContextChange,
  horizon, onHorizonChange,
  allSymbols,
  onRun, isPending, isError, errorMessage,
}: ForecastControlsProps) {
  return (
    <Card className="glass rounded-xl border border-blue-500/20">
      <CardContent className="p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Symbol</label>
            <Select value={symbol} onValueChange={onSymbolChange}>
              <SelectTrigger className="w-28 h-9 rounded-lg text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {allSymbols.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Timeframe</label>
            <Select value={timeframe} onValueChange={onTimeframeChange}>
              <SelectTrigger className="w-20 h-9 rounded-lg text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="300">5m</SelectItem>
                <SelectItem value="900">15m</SelectItem>
                <SelectItem value="3600">1H</SelectItem>
                <SelectItem value="14400">4H</SelectItem>
                <SelectItem value="86400">1D</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Model Size</label>
            <Select value={modelSize} onValueChange={onModelSizeChange}>
              <SelectTrigger className="w-24 h-9 rounded-lg text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tiny">Tiny (8M)</SelectItem>
                <SelectItem value="mini">Mini (20M)</SelectItem>
                <SelectItem value="small">Small (46M)</SelectItem>
                <SelectItem value="base">Base (200M)</SelectItem>
                <SelectItem value="large">Large (710M)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1 w-32">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Context: {context} bars
            </label>
            <Slider
              value={[context]}
              onValueChange={([v]) => onContextChange(v!)}
              min={100}
              max={1000}
              step={50}
              className="mt-2"
            />
          </div>

          <div className="space-y-1 w-28">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Horizon: {horizon} bars
            </label>
            <Slider
              value={[horizon]}
              onValueChange={([v]) => onHorizonChange(v!)}
              min={5}
              max={100}
              step={1}
              className="mt-2"
            />
          </div>

          <Button
            onClick={onRun}
            disabled={isPending}
            className="h-9 rounded-lg px-6 bg-blue-600 hover:bg-blue-500 text-white"
          >
            {isPending ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Running...</>
            ) : (
              <><Play className="h-3.5 w-3.5 mr-1.5" /> Run Forecast</>
            )}
          </Button>
        </div>

        {isError && (
          <div className="mt-3 text-sm text-[hsl(var(--data-neg))] flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            {errorMessage}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
