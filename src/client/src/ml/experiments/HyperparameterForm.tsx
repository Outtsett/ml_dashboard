import React from "react";
import { Label } from "@/shared/ui/label";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Badge } from "@/shared/ui/badge";

/** A single hyperparameter setting. */
export type HyperparameterScalar = string | number | boolean;

/**
 * What one field holds: a scalar when the field is fixed, and a list once it is
 * switched to sweep mode — either an enumerated set of options or the two-element
 * [min, max] of a numeric range.
 */
export type HyperparameterValue = HyperparameterScalar | HyperparameterScalar[];

export interface HyperparameterConfig {
  name: string;
  type: string;
  default: HyperparameterScalar;
  min?: number;
  max?: number;
  options?: HyperparameterScalar[];
  description: string;
}

interface HyperparameterFormProps {
  hyperparameters: HyperparameterConfig[];
  value: Record<string, HyperparameterValue>; // Current form state
  onChange: (key: string, val: HyperparameterValue) => void;
}

/**
 * React's `value` prop takes a string; a boolean, a list, or a missing setting
 * does not survive the trip. A sweep list is shown the way it is typed back in,
 * comma-separated, so the input round-trips.
 */
function inputValue(v: HyperparameterValue | undefined): string {
  if (v === undefined) return "";
  return Array.isArray(v) ? v.join(",") : String(v);
}

export function HyperparameterForm({ hyperparameters, value, onChange }: HyperparameterFormProps) {
  return (
    <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
      {hyperparameters.map((hp) => {
        const isSweep = value[`${hp.name}_isSweep`] === true;
        const current = value[hp.name];
        
        return (
          <div key={hp.name} className="p-3 border border-border/50 rounded-lg bg-background/50 flex flex-col gap-3">
            
            {/* Header row: Name, Description, Sweep Toggle */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-semibold font-mono text-primary">{hp.name}</Label>
                  <Badge variant="outline" className="text-[10px]">{hp.type}</Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 max-w-[80%]">{hp.description}</p>
              </div>
              
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground cursor-pointer" htmlFor={`sweep-${hp.name}`}>
                  Sweep Range
                </Label>
                <Switch 
                  id={`sweep-${hp.name}`}
                  checked={isSweep}
                  onCheckedChange={(c) => {
                    onChange(`${hp.name}_isSweep`, c);
                    // Reset value format based on sweep mode
                    if (c && hp.type === 'number') {
                      onChange(hp.name, [hp.min || 0, hp.max || 1]);
                    } else {
                      onChange(hp.name, hp.default);
                    }
                  }}
                />
              </div>
            </div>

            {/* Input Row */}
            <div className="mt-2">
              {!isSweep ? (
                // Fixed Value Mode
                hp.options ? (
                  <Select 
                    value={inputValue(current) || String(hp.default)} 
                    onValueChange={(v) => onChange(hp.name, v)}
                  >
                    <SelectTrigger className="w-full h-8">
                      <SelectValue placeholder="Select value" />
                    </SelectTrigger>
                    <SelectContent>
                      {hp.options.map(opt => (
                        <SelectItem key={opt.toString()} value={opt.toString()}>
                          {opt.toString()}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input 
                    type={hp.type === 'number' ? 'number' : 'text'}
                    value={inputValue(current ?? hp.default)}
                    onChange={(e) => onChange(hp.name, hp.type === 'number' ? Number(e.target.value) : e.target.value)}
                    className="h-8 font-mono text-sm"
                  />
                )
              ) : (
                // Sweep Mode (Range or List)
                hp.options ? (
                  <Input 
                    placeholder="Comma separated values e.g. gelu,relu"
                    value={inputValue(current)}
                    onChange={(e) => onChange(hp.name, e.target.value.split(","))}
                    className="h-8 font-mono text-sm"
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <Input 
                      type="number"
                      placeholder="Min"
                      value={inputValue(Array.isArray(current) ? current[0] : hp.min)}
                      onChange={(e) => {
                        const range = Array.isArray(current) ? [...current] : [hp.min ?? 0, hp.max ?? 1];
                        range[0] = Number(e.target.value);
                        onChange(hp.name, range);
                      }}
                      className="h-8 font-mono text-sm w-1/2"
                    />
                    <span className="text-muted-foreground text-xs">to</span>
                    <Input 
                      type="number"
                      placeholder="Max"
                      value={inputValue(Array.isArray(current) ? current[1] : hp.max)}
                      onChange={(e) => {
                        const range = Array.isArray(current) ? [...current] : [hp.min ?? 0, hp.max ?? 1];
                        range[1] = Number(e.target.value);
                        onChange(hp.name, range);
                      }}
                      className="h-8 font-mono text-sm w-1/2"
                    />
                  </div>
                )
              )}
            </div>

          </div>
        )
      })}
    </div>
  );
}
