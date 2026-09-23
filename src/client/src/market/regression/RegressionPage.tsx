/**
 * Price Regression — price against every other variable, one scatter each.
 *
 * Follows the Market chart's symbol and timeframe (SymbolContext), reads the
 * same bars the chart draws, and regresses the close on each X variable
 * separately: variables computed from the bars, plus every lake column that
 * holds rows for this symbol at this timeframe. Each panel carries its fitted
 * line, confidence and prediction bands, flagged outliers and the statistics
 * that say whether the line means anything (Newey-West p, a false-discovery
 * q-value across panels, Durbin-Watson's spurious-regression warning).
 */

import { useEffect, useState } from "react";
import { ScatterChart } from "lucide-react";
import { PageShell } from "@/backtest/components";
import { useSymbolContext } from "@/shared/contexts/SymbolContext";
import { minutesToApiKey, minutesToLabel } from "@/market/lib/timeframes";
import { SERIES_FAMILY_LABELS } from "@shared/series/types";
import type { CookCutoffRule, ResponseMode } from "@shared/regression/types";
import { useRegressionBars, useRegressionColumns, useRegressionVariables } from "./data";
import { responseAxisLabel, selectLakeVariables, sortPanels, type PanelSettings, type PanelSort } from "./panels";
import { useRegressionPanels } from "./usePanels";
import { ScatterPanel } from "./ScatterPanel";
import { DetailView } from "./DetailView";
import { formatTimestamp, stampClockFor } from "./scales";

const BAR_COUNTS = [1000, 2500, 5000, 10000, 20000] as const;
const CONFIDENCE_LEVELS = [0.9, 0.95, 0.99] as const;
const SETTINGS_KEY = "price-regression-settings-v1";

interface StoredSettings {
  barCount: number;
  mode: ResponseMode;
  horizonBars: number;
  confidenceLevel: number;
  cookCutoff: CookCutoffRule;
  refitWithoutFlagged: boolean;
  showConfidence: boolean;
  showPrediction: boolean;
  includeForwardLooking: boolean;
  includePriceLevel: boolean;
  sort: PanelSort;
}

const DEFAULTS: StoredSettings = {
  barCount: 5000,
  mode: "level",
  horizonBars: 5,
  confidenceLevel: 0.95,
  cookCutoff: "four_over_n",
  refitWithoutFlagged: false,
  showConfidence: true,
  showPrediction: true,
  includeForwardLooking: false,
  includePriceLevel: false,
  sort: "catalog",
};

function loadSettings(): StoredSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<StoredSettings>) };
  } catch {
    return DEFAULTS;
  }
}

const MODE_OPTIONS: Array<{ value: ResponseMode; label: string; title: string }> = [
  { value: "level", label: "Price level", title: "The close itself against X — what you asked for. Beware shared trends." },
  { value: "difference", label: "Change", title: "Close minus previous close, against X minus its previous value. Removes a shared trend." },
  { value: "forward_return", label: "Forward return", title: "X now against the log return over the next N bars — does X predict the move?" },
];

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: Array<{ value: T; label: string; title?: string }>;
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex rounded-md border border-white/10 bg-white/[0.02] p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={`rounded px-2 py-1 text-[11px] transition-colors ${
            value === option.value ? "bg-[#E69F00]/20 text-[#E69F00]" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Check({ checked, onChange, label, title }: { checked: boolean; onChange: (value: boolean) => void; label: string; title?: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground" title={title}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="accent-[#E69F00]" />
      {label}
    </label>
  );
}

export default function RegressionPage() {
  const { symbol, timeframeMinutes, assetType } = useSymbolContext();
  const clock = stampClockFor(assetType);
  const timeframeApiKey = minutesToApiKey(timeframeMinutes);
  const [settings, setSettings] = useState<StoredSettings>(loadSettings);
  const [filter, setFilter] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // Storage unavailable: settings last for this visit only.
    }
  }, [settings]);

  const update = <K extends keyof StoredSettings>(key: K, value: StoredSettings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));

  const barsQuery = useRegressionBars(symbol, timeframeApiKey, settings.barCount);
  const variablesQuery = useRegressionVariables(symbol, timeframeApiKey);
  const bars = barsQuery.data;

  const lakeVariables = selectLakeVariables(variablesQuery.data?.variables ?? [], settings);
  const columnsQuery = useRegressionColumns(
    symbol,
    timeframeApiKey,
    timeframeMinutes * 60,
    bars,
    lakeVariables.map((variable) => variable.id),
  );

  // Only the settings that change a fit go to the worker; the band toggles and
  // the sort order redraw without refitting.
  const fitSettings = {
    mode: settings.mode,
    horizonBars: settings.horizonBars,
    confidenceLevel: settings.confidenceLevel,
    cookCutoff: settings.cookCutoff,
    refitWithoutFlagged: settings.refitWithoutFlagged,
    includeForwardLooking: settings.includeForwardLooking,
    includePriceLevel: settings.includePriceLevel,
  };
  const { panels, bars: fittedBars, computing, error: fitError, milliseconds: fitMilliseconds } = useRegressionPanels({
    bars,
    lakeVariables: variablesQuery.data?.variables,
    columns: columnsQuery.data,
    settings: fitSettings,
    barMilliseconds: timeframeMinutes * 60_000,
  });
  const panelSettings: PanelSettings = fitSettings;

  const needle = filter.trim().toLowerCase();
  const visible = sortPanels(panels, settings.sort).filter(
    (panel) =>
      !needle ||
      panel.variable.label.toLowerCase().includes(needle) ||
      panel.variable.id.toLowerCase().includes(needle) ||
      (SERIES_FAMILY_LABELS[panel.variable.family] ?? "").toLowerCase().includes(needle),
  );
  const significant = panels.filter((panel) => panel.qValue !== null && panel.qValue < 0.05).length;
  const spurious = panels.filter((panel) => panel.result.ok && panel.result.fit.spuriousRegressionSuspected).length;
  const opened = openId ? panels.find((panel) => panel.variable.id === openId) ?? null : null;

  const first = bars?.[0]?.timestamp;
  const last = bars?.[bars.length - 1]?.timestamp;
  const subtitle = `${symbol} · ${minutesToLabel(timeframeMinutes)} · follows the Market chart`;

  return (
    <PageShell title="Price Regression" subtitle={subtitle} icon={ScatterChart} dense>
      <div className="space-y-2" data-testid="price-regression-page">
        <div className="space-y-2 rounded-md border border-white/[0.07] bg-white/[0.015] p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Y axis</span>
            <Segmented value={settings.mode} options={MODE_OPTIONS} onChange={(value) => update("mode", value)} ariaLabel="What the Y axis measures" />
            {settings.mode === "forward_return" && (
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                next
                <input
                  type="range"
                  min={1}
                  max={60}
                  value={settings.horizonBars}
                  onChange={(event) => update("horizonBars", Number(event.target.value))}
                  className="w-28 accent-[#E69F00]"
                  aria-label="Forward return horizon in bars"
                />
                <span className="w-14 font-mono tabular-nums text-foreground">{settings.horizonBars} bar{settings.horizonBars === 1 ? "" : "s"}</span>
              </label>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Bars</span>
            <Segmented
              value={settings.barCount}
              options={BAR_COUNTS.map((count) => ({ value: count, label: count.toLocaleString() }))}
              onChange={(value) => update("barCount", value)}
              ariaLabel="How many of the newest bars to fit"
            />
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Level</span>
            <Segmented
              value={settings.confidenceLevel}
              options={CONFIDENCE_LEVELS.map((level) => ({ value: level, label: `${Math.round(level * 100)}%` }))}
              onChange={(value) => update("confidenceLevel", value)}
              ariaLabel="Confidence level for the bands and slope interval"
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Check checked={settings.showConfidence} onChange={(value) => update("showConfidence", value)} label="confidence band" title="Where the average Y at each X probably is." />
            <Check checked={settings.showPrediction} onChange={(value) => update("showPrediction", value)} label="prediction band" title="Where a single new bar probably lands." />
            <Check checked={settings.refitWithoutFlagged} onChange={(value) => update("refitWithoutFlagged", value)} label="refit without flagged" title="Draw a second line fitted without the outliers and influential bars." />
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground" title="Cook's distance above which a bar is called influential.">
              Cook cut-off
              <select
                value={settings.cookCutoff}
                onChange={(event) => update("cookCutoff", event.target.value as CookCutoffRule)}
                className="rounded border border-white/10 bg-neutral-900 px-1 py-0.5 text-[11px] text-foreground"
              >
                <option value="four_over_n">4 / n</option>
                <option value="one">1</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Check checked={settings.includeForwardLooking} onChange={(value) => update("includeForwardLooking", value)} label="forward-looking label columns" title="Lake columns computed from future bars. Shown with a leakage badge." />
            <Check checked={settings.includePriceLevel} onChange={(value) => update("includePriceLevel", value)} label="price-level columns" title="Lake columns whose values are prices. Against the close they are near-identities." />
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Sort
              <select
                value={settings.sort}
                onChange={(event) => update("sort", event.target.value as PanelSort)}
                className="rounded border border-white/10 bg-neutral-900 px-1 py-0.5 text-[11px] text-foreground"
              >
                <option value="catalog">catalog order</option>
                <option value="q_value">strongest evidence (q)</option>
                <option value="spearman">|Spearman ρ|</option>
                <option value="r_squared">R²</option>
              </select>
            </label>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="filter variables"
              className="min-w-[120px] flex-1 rounded border border-white/10 bg-neutral-900 px-2 py-0.5 text-[11px] text-foreground placeholder:text-muted-foreground/60"
              aria-label="Filter variables"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-0.5 text-[10px] text-muted-foreground">
          <span>Y: <span className="text-foreground/85">{responseAxisLabel(settings)}</span></span>
          {bars?.some((bar) => bar.activeContract) && (
            <span title="The Market chart's series for a futures root: front-month contract per day, ratio-adjusted at each roll so a roll is not a price move. Levels before the latest roll are scaled, not the exchange prints.">
              front-month, ratio-adjusted at rolls
            </span>
          )}
          {bars && first !== undefined && last !== undefined && (
            <span>{bars.length.toLocaleString()} bars, {formatTimestamp(first, clock)} → {formatTimestamp(last, clock)}</span>
          )}
          <span>{panels.length} variables</span>
          <span title="Variables whose Newey-West slope survives a 5% false-discovery rate across every variable computed here.">
            {significant} significant at q &lt; 0.05
          </span>
          {spurious > 0 && <span className="text-[#F0E442]" title="R² above Durbin-Watson.">{spurious} suspected spurious</span>}
          {(computing || columnsQuery.isFetching || barsQuery.isFetching) && <span className="text-[#56B4E9]">updating…</span>}
          {!computing && fitMilliseconds !== null && (
            <span title="Time the background worker took to fit every panel.">fitted in {Math.round(fitMilliseconds)} ms</span>
          )}
        </div>

        {barsQuery.isError && (
          <p className="rounded border border-[#D55E00]/30 bg-[#D55E00]/10 p-2 text-[11px] text-foreground">
            Bars for {symbol} could not be loaded: {(barsQuery.error as Error).message}
          </p>
        )}
        {variablesQuery.isError && (
          <p className="rounded border border-[#D55E00]/30 bg-[#D55E00]/10 p-2 text-[11px] text-foreground">
            Lake variables unavailable: {(variablesQuery.error as Error).message}. The bar-derived variables are still shown.
          </p>
        )}
        {columnsQuery.isError && (
          <p className="rounded border border-[#D55E00]/30 bg-[#D55E00]/10 p-2 text-[11px] text-foreground">
            Lake columns could not be read: {(columnsQuery.error as Error).message}
          </p>
        )}
        {barsQuery.isLoading && <p className="p-4 text-center text-[12px] text-muted-foreground">Loading {settings.barCount.toLocaleString()} bars of {symbol}…</p>}
        {bars && bars.length === 0 && <p className="p-4 text-center text-[12px] text-muted-foreground">The lake returned no bars for {symbol} at {minutesToLabel(timeframeMinutes)}.</p>}

        {fitError && (
          <p className="rounded border border-[#D55E00]/30 bg-[#D55E00]/10 p-2 text-[11px] text-foreground">
            The fits could not be computed: {fitError}
          </p>
        )}
        {opened && fittedBars ? (
          <DetailView
            panel={opened}
            bars={fittedBars}
            clock={clock}
            settings={panelSettings}
            showConfidence={settings.showConfidence}
            showPrediction={settings.showPrediction}
            onBack={() => setOpenId(null)}
          />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {visible.map((panel) => (
              <ScatterPanel
                key={panel.variable.id}
                panel={panel}
                showConfidence={settings.showConfidence}
                showPrediction={settings.showPrediction}
                onOpen={setOpenId}
              />
            ))}
          </div>
        )}
        {!opened && columnsQuery.isLoading && lakeVariables.length > 0 && (
          <p className="text-center text-[11px] text-muted-foreground">Reading {lakeVariables.length} lake columns…</p>
        )}
      </div>
    </PageShell>
  );
}
