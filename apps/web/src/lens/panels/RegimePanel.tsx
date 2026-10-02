/**
 * RegimePanel — V7: does the model only work in one kind of market? Share of
 * rows per regime, and per-regime performance with a caution when a regime
 * has too few trades to trust.
 */

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { LensRegime, LensRegimes } from "@shared/lens/types";
import { LensFrame } from "../Frame";
import { CaptionRow, regimeColorVar, regimeGlyph, regimeLabel } from "./common";
import { formatEstimate, formatInt, formatNumber, formatPercent, formatUsdSigned, LENS_CHART_AXIS, LENS_CHART_GRID, LENS_CHART_TOOLTIP_STYLE } from "./format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";

export interface RegimePanelProps {
  regimes: LensRegimes;
}

const REGIME_ORDER: LensRegime[] = ["bull", "bear", "sideways"];
const MIN_TRUSTED_TRADES = 30;

export function RegimePanel({ regimes }: RegimePanelProps) {
  const shareData = REGIME_ORDER.map((regime) => ({
    regime,
    label: `${regimeGlyph(regime)} ${regimeLabel(regime)}`,
    share: regimes.share[regime] ?? 0,
  }));

  const perf = REGIME_ORDER.map((regime) => regimes.performance.find((p) => p.regime === regime)).filter(
    (p): p is NonNullable<typeof p> => p !== undefined,
  );

  const thin = perf.filter((p) => p.tradeCount > 0 && p.tradeCount < MIN_TRUSTED_TRADES);

  return (
    <LensFrame
      resizeKey="regime"
      defaultHeight={620}
      title="Regime performance"
      question="Does the model only work in one kind of market?"
      basis={`lookback ${formatInt(regimes.lookbackBars)} bars · threshold ${formatNumber(regimes.threshold, 2)}σ · ${formatInt(regimes.segments.length)} segments`}
      testId="lens-regime"
    >
      <div className="flex flex-col gap-3">
        <CaptionRow>{regimes.definition}</CaptionRow>

        <ResponsiveContainer width="100%" height={110}>
          <BarChart data={shareData} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid {...LENS_CHART_GRID} horizontal={false} />
            <XAxis type="number" domain={[0, 1]} tickFormatter={(v: number) => formatPercent(v, 0)} {...LENS_CHART_AXIS} />
            <YAxis type="category" dataKey="label" {...LENS_CHART_AXIS} width={80} />
            <Tooltip {...LENS_CHART_TOOLTIP_STYLE} formatter={(value: number) => [formatPercent(value), "share of bars"]} />
            <Bar dataKey="share" isAnimationActive={false}>
              {shareData.map((d) => (
                <Cell key={d.regime} fill={regimeColorVar(d.regime)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Regime</TableHead>
              <TableHead className="text-right">Bars</TableHead>
              <TableHead className="text-right">Trades</TableHead>
              <TableHead className="text-right">Hit rate</TableHead>
              <TableHead className="text-right">Mean trade net</TableHead>
              <TableHead className="text-right">Profit factor</TableHead>
              <TableHead className="text-right">Total net</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {perf.map((row) => {
              const hitRate = formatEstimate(row.hitRate, (v) => formatPercent(v), 0.5);
              const meanTrade = formatEstimate(row.meanTradeNetUsd, (v) => formatUsdSigned(v), 0, 0.005);
              return (
                <TableRow key={row.regime} data-testid={`lens-regime-row-${row.regime}`}>
                  <TableCell className="font-medium">
                    <span style={{ color: regimeColorVar(row.regime) }}>{regimeGlyph(row.regime)}</span> {regimeLabel(row.regime)}
                  </TableCell>
                  <TableCell className="text-right font-mono tnum tabular-nums">{formatInt(row.barCount)}</TableCell>
                  <TableCell className="text-right font-mono tnum tabular-nums">{formatInt(row.tradeCount)}</TableCell>
                  <TableCell className="text-right font-mono tnum tabular-nums" title={hitRate.title}>
                    {hitRate.display}
                  </TableCell>
                  <TableCell className="text-right font-mono tnum tabular-nums" title={meanTrade.title}>
                    {meanTrade.display}
                  </TableCell>
                  <TableCell className="text-right font-mono tnum tabular-nums">
                    {row.profitFactor === null ? "—" : `${row.profitFactor.toFixed(3)}×`}
                  </TableCell>
                  <TableCell className="text-right font-mono tnum tabular-nums">{formatUsdSigned(row.totalNetUsd)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {thin.length > 0 && (
          <p className="text-[11px] text-(--color-data-warn)" data-testid="lens-regime-caution">
            ⚠ Caution: {thin.map((p) => `${regimeLabel(p.regime)} (${formatInt(p.tradeCount)} trades)`).join(", ")} — under {MIN_TRUSTED_TRADES} trades, too few to trust.
          </p>
        )}
      </div>
    </LensFrame>
  );
}
