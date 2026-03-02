/**
 * LabelsTab — Label generator selector, params, preview/clear, distribution.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, Loader2, BarChart3 } from "lucide-react";
import { LABEL_GENERATORS, type LabelGeneratorKey } from "@shared/mlTaxonomy";
import type { LabelsTabProps } from "./types";

export function LabelsTab({
  selectedGenerator, setSelectedGenerator,
  labelParams, setLabelParams,
  currentParams, generatorDef,
  onGenerate, isPreviewing, chartDataLength,
  showLabels, onClearLabels,
  labelDistribution, visibleLabelsCount,
  symbol,
}: LabelsTabProps) {
  return (
    <div className="p-3 space-y-3">
      {/* Generator selector */}
      <div className="space-y-1">
        <label className="text-[10px] text-muted-foreground">Generator</label>
        <Select
          value={selectedGenerator}
          onValueChange={(v) => {
            setSelectedGenerator(v as LabelGeneratorKey);
            setLabelParams({});
          }}
        >
          <SelectTrigger className="h-7 text-[10px] bg-black/30 border-white/10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(LABEL_GENERATORS).map(([key, gen]) => (
              <SelectItem key={key} value={key} className="text-xs">
                {gen.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Params */}
      {generatorDef?.params && generatorDef.params.length > 0 && (
        <div className="space-y-2 p-2 rounded-lg bg-white/5">
          <p className="text-[9px] text-muted-foreground font-medium">Parameters</p>
          {generatorDef.params.slice(0, 3).map((param) => (
            <div key={param.id} className="flex items-center gap-2">
              <label className="text-[10px] text-muted-foreground flex-1">{param.name}</label>
              <Input
                type="number"
                value={(currentParams[param.id] as number) ?? param.default}
                onChange={(e) => setLabelParams(prev => ({ ...prev, [param.id]: parseFloat(e.target.value) }))}
                className="h-6 w-20 text-[10px] bg-black/30 border-white/10"
              />
            </div>
          ))}
        </div>
      )}

      {/* Preview / Clear */}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onGenerate}
          disabled={isPreviewing || chartDataLength === 0}
          className="flex-1 h-7 text-[10px] bg-linear-to-r from-violet-600 to-teal-500"
        >
          {isPreviewing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Eye className="h-3 w-3 mr-1" />}
          Preview
        </Button>
        {showLabels && (
          <Button
            size="sm"
            variant="outline"
            onClick={onClearLabels}
            className="h-7 text-[10px] border-white/10"
          >
            Clear
          </Button>
        )}
      </div>

      {/* Label distribution */}
      {showLabels && visibleLabelsCount > 0 && (
        <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/20 space-y-2">
          <p className="text-[10px] text-green-400 font-medium flex items-center gap-1">
            <BarChart3 className="h-3 w-3" />
            Distribution ({labelDistribution.total} visible)
          </p>
          <div className="space-y-1">
            {[
              { label: 'BUY', count: labelDistribution.buy, pct: labelDistribution.buyPct, color: 'green' },
              { label: 'SELL', count: labelDistribution.sell, pct: labelDistribution.sellPct, color: 'rose' },
              { label: 'HOLD', count: labelDistribution.hold, pct: labelDistribution.holdPct, color: 'violet' },
            ].map(({ label, count, pct, color }) => (
              <div key={label} className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className={`h-full bg-${color}-500 rounded-full transition-all`} style={{ width: `${pct}%` }} />
                </div>
                <span className={`text-${color}-400 text-[9px] font-mono w-16 text-right`}>
                  {label} {count} ({pct}%)
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Symbol info footer */}
      <div className="p-2 rounded-lg bg-white/5 mt-auto">
        <p className="font-mono text-sm text-primary">{symbol}</p>
        <p className="text-[9px] text-muted-foreground">
          {chartDataLength > 0 ? `${chartDataLength.toLocaleString()} bars loaded` : 'No data'}
        </p>
      </div>
    </div>
  );
}
