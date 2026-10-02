/**
 * "Why" — the diagnostic layer: where the errors and losses sit (hour, weekday,
 * probability decile, regime), whether the probabilities can be taken at face
 * value (calibration), which inputs drove the model, and the three largest
 * measured causes of loss.
 */

import type { LensAnalyticsWhy } from "@shared/lens/analytics";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui/table";
import { regimeColorVar, regimeGlyph, regimeLabel } from "../common";
import { formatInt, formatNumber, formatPercent } from "../format";
import { EstimateText, Explains, Heading, RateBar, RateLegend, Reason, SegmentTable, Sentence, SignedUsd } from "./parts";

export function WhyTab({ why, horizonBars }: { why: LensAnalyticsWhy; horizonBars: number }) {
  return (
    <div className="flex flex-col gap-2" data-testid="lens-analytics-why">
      <Explains>{why.explanation}</Explains>

      <Heading>Three largest measured causes of loss</Heading>
      <Explains>The biggest dollar losses the record can pin on one thing, each resting on at least 20 trades (or on every trade, for costs).</Explains>
      {why.lossCauses.length === 0 ? (
        <Reason>{why.lossCausesReason}</Reason>
      ) : (
        <ol className="list-decimal space-y-1 pl-5" data-testid="lens-analytics-loss-causes">
          {why.lossCauses.map((cause) => (
            <li key={cause.cause} className="text-sm">
              <span aria-hidden="true" className="mr-1 text-[10px]" style={{ color: "#0072B2" }}>
                ▼
              </span>
              {cause.sentence}
            </li>
          ))}
        </ol>
      )}

      <RateLegend referenceLabel="coin flip, 50%" />

      <Heading>By hour of the session</Heading>
      <Explains>How often the model called direction right, and how its trades did, by the hour the bar or trade started{why.byHour.clock ? ` (${why.byHour.clock})` : ""}.</Explains>
      {why.byHour.reason ? <Reason>{why.byHour.reason}</Reason> : <SegmentTable segments={why.byHour.segments} firstColumn="Hour" testId="lens-analytics-hours" />}

      <Heading>By day of the week</Heading>
      <Explains>The same split by trading-session day (a futures session that opens Sunday afternoon counts as Monday).</Explains>
      {why.byWeekday.reason ? <Reason>{why.byWeekday.reason}</Reason> : <SegmentTable segments={why.byWeekday.segments} firstColumn="Day" testId="lens-analytics-weekdays" />}

      <Heading>By confidence (probability deciles)</Heading>
      <Explains>Bars ranked by the model&apos;s probability of up and cut into ten equal groups: a model with an edge is right more often in the outer deciles.</Explains>
      {why.byConfidence.reason ? (
        <Reason>{why.byConfidence.reason}</Reason>
      ) : (
        <Table data-testid="lens-analytics-deciles">
          <TableHeader>
            <TableRow>
              <TableHead>Decile</TableHead>
              <TableHead>Probability of up</TableHead>
              <TableHead className="text-right">Bars</TableHead>
              <TableHead>Direction hit rate</TableHead>
              <TableHead>Share that went up</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {why.byConfidence.deciles.map((decile) => (
              <TableRow key={decile.decile}>
                <TableCell>{decile.decile}</TableCell>
                <TableCell className="font-mono text-[11px] tnum">
                  {formatNumber(decile.probabilityLow, 3)} to {formatNumber(decile.probabilityHigh, 3)}
                </TableCell>
                <TableCell className="text-right font-mono tnum">{formatInt(decile.rowCount)}</TableCell>
                <TableCell>
                  <RateBar rate={decile.directionHitRate} reason={decile.reason} reference={0.5} />
                </TableCell>
                <TableCell>
                  <RateBar rate={decile.upRate} reason={decile.reason} reference={0.5} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <p className="text-[11px] text-muted-foreground">Basis: {why.byConfidence.basis}; intervals use bars ÷ the {horizonBars}-bar horizon as the number of independent outcomes.</p>

      <Heading>By regime</Heading>
      <Explains>Performance split by the market regime at each bar (and at each trade&apos;s entry), from the lens&apos;s regime rule.</Explains>
      <Table data-testid="lens-analytics-regimes">
        <TableHeader>
          <TableRow>
            <TableHead>Regime</TableHead>
            <TableHead className="text-right">Bars</TableHead>
            <TableHead>Direction hit rate</TableHead>
            <TableHead className="text-right">Trades</TableHead>
            <TableHead>Mean net per trade</TableHead>
            <TableHead className="text-right">Total net</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {why.byRegime.rows.map((row) => (
              <TableRow key={row.regime}>
                <TableCell className="font-medium">
                  <span style={{ color: regimeColorVar(row.regime) }}>{regimeGlyph(row.regime)}</span> {regimeLabel(row.regime)}
                </TableCell>
                <TableCell className="text-right font-mono tnum">{formatInt(row.barCount)}</TableCell>
                <TableCell>
                  <RateBar rate={row.directionHitRate} reason={row.hitRateReason} reference={0.5} />
                </TableCell>
                <TableCell className="text-right font-mono tnum">{formatInt(row.tradeCount)}</TableCell>
                <TableCell>
                  <EstimateText estimate={row.meanTradeNetUsd} reason={row.meanReason} />
                </TableCell>
                <TableCell className="text-right">
                  <SignedUsd value={row.tradeCount > 0 ? row.totalNetUsd : null} />
                </TableCell>
              </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-[11px] text-muted-foreground">{why.byRegime.definition}</p>

      <Heading>Calibration</Heading>
      <Explains>Whether a stated probability means what it says: in each probability bin, how often the bars actually went up (tick) against the probability the model gave (◆).</Explains>
      <Sentence testId="lens-analytics-calibration">{why.calibration.sentence}</Sentence>
      <RateLegend referenceLabel="coin flip, 50%" withExpected />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Probability bin</TableHead>
            <TableHead className="text-right">Bars</TableHead>
            <TableHead>Observed share up, against the model&apos;s mean probability</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {why.calibration.bins
            .filter((bin) => bin.rowCount > 0)
            .map((bin) => (
              <TableRow key={bin.binLow}>
                <TableCell className="font-mono text-[11px] tnum">
                  {formatPercent(bin.binLow, 0)} to {formatPercent(bin.binHigh, 0)}
                </TableCell>
                <TableCell className="text-right font-mono tnum">{formatInt(bin.rowCount)}</TableCell>
                <TableCell>
                  <RateBar rate={bin.observedUpRate} reason={bin.reason} reference={0.5} expected={bin.meanProbability} />
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>

      <Heading>Feature attribution</Heading>
      <Explains>Which families of inputs moved the model&apos;s output most, by mean absolute SHAP contribution.</Explains>
      <Sentence testId="lens-analytics-attribution">{why.attribution.sentence}</Sentence>
      {why.attribution.available && (
        <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          {why.attribution.families.map((family) => (
            <li key={family.family} className="flex items-center gap-2">
              <span className="w-28 shrink-0">{family.label}</span>
              <span className="h-2 rounded-sm bg-[#56B4E9]" style={{ width: `${Math.max(1, family.share * 160)}px` }} aria-hidden="true" />
              <span className="font-mono tnum">{formatPercent(family.share)}</span>
              <span className="text-muted-foreground">({formatInt(family.featureCount)} features)</span>
            </li>
          ))}
          {why.attribution.topFeatures.map((feature) => (
            <li key={feature.name} className="font-mono text-[11px] text-muted-foreground">
              #{feature.rank} {feature.name} · {formatNumber(feature.meanAbsoluteShap, 4)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
