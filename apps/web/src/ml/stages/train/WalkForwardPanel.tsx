/**
 * WalkForwardPanel — Stage 4 walk-forward + objective config form.
 *
 * Per W4 frontend sub-plan §1: writes `state.walkForward` and
 * `state.objectiveConfig`. The original ConfigStrip held this logic for the
 * standalone /training page; here it's lifted into MLStudioContext so the
 * pipeline can persist + share it across reloads.
 *
 * Fields:
 *   folds              int   ≥1   required
 *   foldMonths         int   ≥1   required
 *   purgeBars          int   ≥0
 *   objective metric   enum  required
 *   nTrials            int   ≥1   required
 *   pruner enabled     bool        (toggle Median ↔ none)
 */

import { useEffect, useMemo } from "react";
import { Settings2 } from "lucide-react";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { useMLStudio, type ObjectiveConfig, type WalkForwardConfig } from "../../MLStudioContext";

const DEFAULT_WALK_FORWARD: WalkForwardConfig = {
  trainMonths: 24,
  testMonths: 6,
  stepMonths: 6,
  foldMonths: 6,
  folds: 4,
  purgeBars: 5,
};

const DEFAULT_OBJECTIVE: ObjectiveConfig = {
  metric: "sharpe_after_costs",
  direction: "maximize",
  nTrials: 25,
  pruner: "median",
};

const OBJECTIVE_METRICS: Array<{
  value: ObjectiveConfig["metric"];
  label: string;
  direction: ObjectiveConfig["direction"];
}> = [
  { value: "sharpe_after_costs", label: "Sharpe (after costs)", direction: "maximize" },
  { value: "profit_factor", label: "Profit factor", direction: "maximize" },
  { value: "neg_log_loss", label: "Neg log loss", direction: "minimize" },
  { value: "ece", label: "ECE (calibration)", direction: "minimize" },
  { value: "win_rate", label: "Win rate", direction: "maximize" },
];

export function WalkForwardPanel() {
  const { state, dispatch } = useMLStudio();

  // Seed defaults on first mount if missing.
  useEffect(() => {
    if (!state.walkForward) {
      dispatch({ type: "setWalkForward", walkForward: DEFAULT_WALK_FORWARD });
    }
    if (!state.objectiveConfig) {
      dispatch({ type: "setObjectiveConfig", config: DEFAULT_OBJECTIVE });
    }
    // Run once on mount.
  }, []);

  const wf = state.walkForward ?? DEFAULT_WALK_FORWARD;
  const obj = state.objectiveConfig ?? DEFAULT_OBJECTIVE;

  const updateWF = (patch: Partial<WalkForwardConfig>) => {
    dispatch({
      type: "setWalkForward",
      walkForward: { ...wf, ...patch },
    });
  };
  const updateObj = (patch: Partial<ObjectiveConfig>) => {
    dispatch({
      type: "setObjectiveConfig",
      config: { ...obj, ...patch },
    });
  };

  const objectiveLabel = useMemo(() => {
    return (
      OBJECTIVE_METRICS.find((m) => m.value === obj.metric)?.label ?? obj.metric
    );
  }, [obj.metric]);

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5 space-y-4">
      <header className="flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-primary" />
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            Walk-forward & objective
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Optimize <span className="text-foreground">{objectiveLabel}</span> across walk-forward folds.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <NumField
          label="Folds"
          value={wf.folds ?? 4}
          min={1}
          step={1}
          onChange={(n) => updateWF({ folds: n })}
        />
        <NumField
          label="Fold months"
          value={wf.foldMonths ?? wf.testMonths}
          min={1}
          step={1}
          onChange={(n) => updateWF({ foldMonths: n, testMonths: n })}
        />
        <NumField
          label="Train months"
          value={wf.trainMonths}
          min={1}
          step={1}
          onChange={(n) => updateWF({ trainMonths: n })}
        />
        <NumField
          label="Step months"
          value={wf.stepMonths ?? wf.testMonths}
          min={1}
          step={1}
          onChange={(n) => updateWF({ stepMonths: n })}
        />
        <NumField
          label="Purge bars"
          value={wf.purgeBars ?? 0}
          min={0}
          step={1}
          onChange={(n) => updateWF({ purgeBars: n })}
        />
        <NumField
          label="HPO trials"
          value={obj.nTrials}
          min={1}
          step={1}
          onChange={(n) => updateObj({ nTrials: n })}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-white/5">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-xs font-medium text-foreground" htmlFor="wf-objective">
            Objective metric
          </label>
          <Select
            value={obj.metric}
            onValueChange={(v) => {
              const meta = OBJECTIVE_METRICS.find((m) => m.value === v);
              updateObj({
                metric: v as ObjectiveConfig["metric"],
                direction: meta?.direction ?? "maximize",
              });
            }}
          >
            <SelectTrigger id="wf-objective" className="h-8 text-sm bg-white/5 border-white/10">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OBJECTIVE_METRICS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}{" "}
                  <span className="text-muted-foreground">
                    ({m.direction === "maximize" ? "↑" : "↓"})
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-foreground">Median pruner</span>
            <span className="text-[10px] text-muted-foreground">
              Stops trials below the running median.
            </span>
          </div>
          <Switch
            checked={obj.pruner === "median"}
            onCheckedChange={(checked) =>
              updateObj({ pruner: checked ? "median" : "none" })
            }
          />
        </label>
      </div>
    </section>
  );
}

interface NumFieldProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (n: number) => void;
}

function NumField({ label, value, min, max, step, onChange }: NumFieldProps) {
  const id = `wf-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium text-foreground">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="h-8 text-sm bg-white/5 border-white/10"
      />
    </div>
  );
}
