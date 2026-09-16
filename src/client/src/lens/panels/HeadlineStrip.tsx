/**
 * HeadlineStrip — the verdict sentence plus every headline KPI with its CI
 * and n, so the record's bottom line is visible before any chart loads.
 */

import type { LensHeadline, LensManifest } from "@shared/lens/types";
import { LensFrame } from "../Frame";
import { EstimateStat, StatCell } from "./common";
import { formatEstimate, formatInt, formatPercent, formatUsd, formatUsdSigned, toStatTone, trendGlyph, trendTone } from "./format";

export interface HeadlineStripProps {
  headline: LensHeadline;
  manifest: LensManifest;
}

export function HeadlineStrip({ headline, manifest }: HeadlineStripProps) {
  const hitRate = formatEstimate(headline.hitRate, (v) => formatPercent(v), 0.5);
  const winRate = formatEstimate(headline.winRate, (v) => formatPercent(v), 0.5);
  const profitFactor = formatEstimate(headline.profitFactor, (v) => formatNumberPf(v), 1);
  const meanTrade = formatEstimate(headline.meanTradeNetUsd, (v) => formatUsdSigned(v), 0, 0.005);

  const totalTone = trendTone(headline.totalNetUsd, 0.005);
  const buyHoldDelta = headline.buyHoldNetUsd === null ? null : headline.totalNetUsd - headline.buyHoldNetUsd;

  const basis = `${formatInt(headline.barCount)} bars (n_eff ${formatInt(headline.effectiveSampleSize)}) · ${formatInt(
    headline.tradeCount,
  )} trades (${formatInt(headline.longCount)}L / ${formatInt(headline.shortCount)}S) · threshold ${manifest.defaultThreshold.toFixed(3)} · ${manifest.symbol} ${manifest.timeframe}`;

  return (
    <LensFrame title="Headline" question="What does this model's out-of-sample record say, taken as a whole?" basis={basis} testId="lens-headline">
      <p className="mb-3 text-sm font-medium leading-relaxed text-foreground" data-testid="lens-headline-verdict">
        {headline.verdict}
      </p>
      <div className="flex flex-wrap gap-2">
        <StatCell
          label="Bars"
          value={formatInt(headline.barCount)}
          sub={`n_eff ${formatInt(headline.effectiveSampleSize)}`}
          hint="Effective sample size = bars ÷ forecast horizon, since labels overlap."
        />
        <StatCell
          label="Trades"
          value={formatInt(headline.tradeCount)}
          sub={`${formatInt(headline.longCount)} long / ${formatInt(headline.shortCount)} short`}
        />
        <EstimateStat label="Hit rate" estimate={hitRate} testId="lens-headline-hit-rate" />
        <EstimateStat label="Win rate" estimate={winRate} testId="lens-headline-win-rate" />
        <EstimateStat label="Profit factor" estimate={profitFactor} testId="lens-headline-profit-factor" />
        <EstimateStat label="Mean trade net" estimate={meanTrade} testId="lens-headline-mean-trade" />
        <StatCell
          label="Total net vs buy & hold"
          value={formatUsdSigned(headline.totalNetUsd)}
          sub={
            headline.buyHoldNetUsd === null
              ? "buy & hold unavailable"
              : `buy & hold ${formatUsdSigned(headline.buyHoldNetUsd)} · ${trendGlyph(trendTone(buyHoldDelta ?? 0, 0.005))} ${formatUsdSigned(buyHoldDelta)} vs it`
          }
          tone={toStatTone(totalTone)}
          hint="Cumulative simulated net PnL, cost-adjusted, against a buy-and-hold benchmark over the same bars."
          testId="lens-headline-total-net"
        />
        <StatCell
          label="Max drawdown"
          value={formatUsd(headline.maxDrawdownUsd)}
          sub="peak to trough, model equity"
          tone="neg"
        />
        <StatCell
          label="AUC"
          value={headline.areaUnderCurve === null ? "—" : headline.areaUnderCurve.toFixed(3)}
          sub="0.5 = coin flip"
          tone={headline.areaUnderCurve === null ? "neutral" : toStatTone(trendTone(headline.areaUnderCurve - 0.5, 0.005))}
        />
        <StatCell
          label="Brier score"
          value={headline.brierScore === null ? "—" : headline.brierScore.toFixed(4)}
          sub="lower is better, 0.25 = coin flip"
        />
        <StatCell label="Exposure" value={formatPercent(headline.exposureShare)} sub="share of bars in a position" />
      </div>
    </LensFrame>
  );
}

function formatNumberPf(value: number): string {
  return `${value.toFixed(3)}×`;
}
