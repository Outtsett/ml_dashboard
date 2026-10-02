import React from "react";
import { Info } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Switch } from "@/shared/ui/switch";
import { Badge } from "@/shared/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import type {
  SearchDimension,
  DistributionType,
} from "@shared/hpoTypes";
import type { HyperparameterDef } from "@shared/trainingTypes";
import { cn } from "@/shared/utils/utils";
import { fieldInput } from "./OptimizerConfigFields";

interface SearchDimensionItemProps {
  paramKey: string;
  hp: HyperparameterDef;
  dimension: SearchDimension;
  included: boolean;
  onToggle: (key: string, on: boolean) => void;
  onDimensionChange: (key: string, dim: SearchDimension) => void;
  disabled?: boolean;
}

export function SearchDimensionItem({
  paramKey,
  hp,
  dimension,
  included,
  onToggle,
  onDimensionChange,
  disabled,
}: SearchDimensionItemProps) {
  const dimType = dimension.type;
  const isNumeric = dimType === "int" || dimType === "float";

  const updateDim = (patch: Partial<SearchDimension>) =>
    onDimensionChange(paramKey, { ...dimension, ...patch });

  return (
    <div
      className={cn(
        "rounded-lg border p-2.5 transition-colors",
        included
          ? "border-orange-500/25 bg-orange-500/5"
          : "border-white/6 bg-white/[0.02]",
      )}
    >
      {/* header row */}
      <div className="flex items-center gap-2">
        <Switch
          checked={included}
          onCheckedChange={(v) => onToggle(paramKey, v)}
          disabled={disabled}
          className="scale-75 origin-left"
        />
        <span className="text-xs font-medium truncate flex-1" title={hp.label}>
          {hp.label}
        </span>
        <Badge
          variant="outline"
          className="text-[9px] px-1.5 py-0 font-mono shrink-0"
        >
          {dimType}
        </Badge>
        {hp.description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 text-muted-foreground/40 shrink-0 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="top" className="text-[10px] max-w-56">
              {hp.description}
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* range editor — visible only when included */}
      {included && (
        <div className="mt-2 pl-6">
          {isNumeric && (
            <div className="grid grid-cols-4 gap-2">
              <div className="space-y-0.5">
                <Label className="text-[9px] text-muted-foreground/60">Low</Label>
                <Input
                  type="number"
                  className={cn(fieldInput, "h-6 text-[11px]")}
                  value={dimension.low ?? ""}
                  step={dimension.step ?? (dimType === "int" ? 1 : 0.01)}
                  disabled={disabled}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) updateDim({ low: v });
                  }}
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[9px] text-muted-foreground/60">High</Label>
                <Input
                  type="number"
                  className={cn(fieldInput, "h-6 text-[11px]")}
                  value={dimension.high ?? ""}
                  step={dimension.step ?? (dimType === "int" ? 1 : 0.01)}
                  disabled={disabled}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v)) updateDim({ high: v });
                  }}
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[9px] text-muted-foreground/60">Step</Label>
                <Input
                  type="number"
                  className={cn(fieldInput, "h-6 text-[11px]")}
                  value={dimension.step ?? ""}
                  min={0}
                  disabled={disabled}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v > 0) updateDim({ step: v });
                  }}
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[9px] text-muted-foreground/60">Dist</Label>
                <Select
                  value={dimension.distribution ?? "uniform"}
                  onValueChange={(v) =>
                    updateDim({ distribution: v as DistributionType })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger className="h-6 rounded-md bg-white/5 border-white/10 text-[11px] px-1.5 [&>span]:text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1a1a2e] border-white/10">
                    <SelectItem value="uniform" className="text-[11px]">Uniform</SelectItem>
                    <SelectItem value="loguniform" className="text-[11px]">Log-uniform</SelectItem>
                    <SelectItem value="normal" className="text-[11px]">Normal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* logScale toggle */}
              <div className="col-span-4 flex items-center gap-1.5 mt-0.5">
                <Switch
                  checked={dimension.logScale ?? false}
                  onCheckedChange={(v) => updateDim({ logScale: v })}
                  disabled={disabled}
                  className="scale-[0.6] origin-left"
                />
                <span className="text-[9px] text-muted-foreground/60">
                  Log scale
                </span>
              </div>
            </div>
          )}

          {dimType === "categorical" && (
            <div className="space-y-1">
              <Label className="text-[9px] text-muted-foreground/60">
                Choices
              </Label>
              <div className="flex flex-wrap gap-1">
                {(hp.choices ?? []).map((choice) => {
                  const active = dimension.choices?.includes(choice) ?? false;
                  return (
                    <button
                      key={String(choice)}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        const current = dimension.choices ?? [];
                        const next = active
                          ? current.filter((c) => c !== choice)
                          : [...current, choice];
                        updateDim({ choices: next });
                      }}
                      className={cn(
                        "text-[10px] px-1.5 py-0.5 rounded border transition-colors",
                        active
                          ? "bg-orange-500/20 border-orange-500/40 text-orange-300"
                          : "bg-white/5 border-white/10 text-muted-foreground/60 hover:bg-white/10",
                        disabled && "opacity-40 cursor-not-allowed",
                      )}
                    >
                      {String(choice)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {dimType === "bool" && (
            <span className="text-[9px] text-muted-foreground/50 italic">
              true / false (no config needed)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
