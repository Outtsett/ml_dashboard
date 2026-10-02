/**
 * The rule written out: TA_CANDLEAVERAGE as a typeset formula with every
 * symbol defined and carrying its current value for the candle in the
 * calculator, the eight settings the thirteen functions read, and the thirteen
 * rules with their lookback (TA-Lib's `Function(name).lookback`, 10 for all).
 */

import { FormulaCard, SelectControl, fmt, type FormulaSymbol } from "@/studies/kit";
import {
  CANDLE_SETTINGS, PATTERN_RULES, RANGE_TYPE_LABEL, SETTING_NAMES, SINGLE_CANDLE_PATTERNS, patternLookback, type SettingName,
} from "@shared/studies/single-candle-recognizer";
import type { CandleView } from "./controls";

const TEX = String.raw`\text{CandleAverage}(s,\, i) \;=\; \frac{f_s}{d_s}\times
\begin{cases}
  \dfrac{1}{p_s}\displaystyle\sum_{k=i-p_s}^{i-1} r_s(k) & p_s \neq 0 \\[2ex]
  r_s(i) & p_s = 0
\end{cases}`;

export function RuleFormula({ view, setting, onSetting }: { view: CandleView; setting: string; onSetting: (value: SettingName) => void }) {
  const name = (SETTING_NAMES as readonly string[]).includes(setting) ? (setting as SettingName) : "BodyDoji";
  const parts = view.evaluation.averages[name];
  const definition = CANDLE_SETTINGS[name];
  const ticks = (value: number) => `${fmt(value / view.unit, 3)} ticks`;
  const symbols: FormulaSymbol[] = [
    { tex: "s", name: "setting: which yardstick is being asked for", value: name },
    { tex: "i", name: "bar index: the candle being classified, the one drawn on the right", value: "the candle above" },
    { tex: "p_s", name: "averaging period: how many bars before i are averaged (0 means none: the bar's own range)", value: `${parts.averagePeriod} bars` },
    {
      tex: "r_s(k)",
      name: `range of bar k: ${RANGE_TYPE_LABEL[parts.rangeType]}`,
      value: parts.averagePeriod > 0 ? `mean ${ticks(parts.yardstick)}` : `this bar's own: ${ticks(parts.yardstick)}`,
    },
    { tex: "f_s", name: "factor: what fraction (or multiple) of that yardstick counts", value: fmt(parts.factor, 2) },
    { tex: "d_s", name: "divisor: 2 when the range type is the two shadows, else 1", value: String(parts.divisor) },
    { tex: "\\sum", name: "sum over: the p_s bars before this one, the part a single candle cannot see", value: parts.averagePeriod > 0 ? ticks(parts.trailingSum) : "empty (p = 0)" },
    { tex: "\\text{CandleAverage}", name: `the threshold: ${definition.meaning}`, value: ticks(parts.value) },
  ];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <SelectControl label="Setting shown in the legend" value={name} options={SETTING_NAMES.map((n) => ({ value: n, label: n }))} onChange={onSetting} />
        <p className="max-w-prose pb-1 text-[11px] text-neutral-400">The legend carries the values for the candle in the calculator below; move a slider there and they change here.</p>
      </div>
      <FormulaCard tex={TEX} symbols={symbols} caption="When p = 0 the sum vanishes and the yardstick is the bar's own range: genuinely single-bar. That happens for ShadowLong and ShadowVeryLong only, and in all 13 functions those are paired with a 10-bar companion, which is why the lookback is 10 for every one of them." />
    </div>
  );
}

export function SettingsTable({ view }: { view: CandleView }) {
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-left text-neutral-500">
          <th className="py-0.5 font-normal">setting</th>
          <th className="py-0.5 font-normal">yardstick r</th>
          <th className="py-0.5 text-right font-normal">period p</th>
          <th className="py-0.5 text-right font-normal">factor f</th>
          <th className="py-0.5 text-right font-normal">divisor d</th>
          <th className="py-0.5 text-right font-normal">value now</th>
          <th className="py-0.5 pl-3 font-normal">what it decides</th>
        </tr>
      </thead>
      <tbody>
        {SETTING_NAMES.map((name) => {
          const setting = CANDLE_SETTINGS[name];
          const parts = view.evaluation.averages[name];
          return (
            <tr key={name} className="border-t border-neutral-900">
              <td className="py-0.5 font-mono text-neutral-200">{name}</td>
              <td className="py-0.5 text-neutral-300">{RANGE_TYPE_LABEL[setting.rangeType]}</td>
              <td className="py-0.5 text-right font-mono tnum">{setting.averagePeriod}</td>
              <td className="py-0.5 text-right font-mono tnum">{fmt(setting.factor, 2)}</td>
              <td className="py-0.5 text-right font-mono tnum">{parts.divisor}</td>
              <td className="py-0.5 text-right font-mono tnum text-neutral-200">{fmt(parts.value / view.unit, 2)}</td>
              <td className="py-0.5 pl-3 text-neutral-400">{setting.meaning}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function RulesTable({ view }: { view: CandleView }) {
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="text-left text-neutral-500">
          <th className="py-0.5 font-normal">pattern</th>
          <th className="py-0.5 font-normal">rule</th>
          <th className="py-0.5 font-normal">settings it reads</th>
          <th className="py-0.5 text-right font-normal">lookback</th>
        </tr>
      </thead>
      <tbody>
        {SINGLE_CANDLE_PATTERNS.map((pattern) => {
          const rule = PATTERN_RULES[pattern];
          const fires = view.evaluation.signals[pattern] !== 0;
          return (
            <tr key={pattern} className="border-t border-neutral-900">
              <td className="py-0.5 font-mono text-neutral-200">{fires ? "● " : ""}{pattern}</td>
              <td className="py-0.5 text-neutral-300">{rule.text}</td>
              <td className="py-0.5 font-mono text-neutral-400">{rule.settings.join(", ")}</td>
              <td className="py-0.5 text-right font-mono tnum">{patternLookback(pattern)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
