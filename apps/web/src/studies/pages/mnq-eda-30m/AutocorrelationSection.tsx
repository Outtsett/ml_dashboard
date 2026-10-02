/**
 * Section 5: autocorrelation. ACF and PACF of the log returns and the ACF of the squared
 * returns (volatility clustering) with the confidence band. A bar outside the band is hatched
 * orange, one inside is plain blue: the pattern carries the significance, not the colour.
 * The notebook printed "mean-reverting signal at lag-1" whatever the data said; the finding
 * here is read off the numbers.
 */

import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SliderControl, Stat, StudyNotes, StudyState, TOOLTIP, fmt, fmtInt, useStudyControls } from "@/studies/kit";
import type { AutocorrelationBody } from "@shared/studies/mnq-eda-30m";
import { signed } from "./format";
import { useSection, type SeriesChoice } from "./use";

function AcfChart({ title, values, band, id }: { title: string; values: number[]; band: number; id: string }) {
  const data = values.map((value, lag) => ({ lag, value, outside: lag > 0 && Math.abs(value) > band }));
  return (
    <div className="min-w-0 space-y-1">
      <h4 className="text-xs font-semibold text-neutral-200">{title}</h4>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data.slice(1)} margin={{ top: 8, right: 8, left: 0, bottom: 4 }} barCategoryGap={1}>
          <defs>
            <pattern id={`hatch-${id}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="5" fill={OKABE.orange} />
              <line x1="0" y1="0" x2="0" y2="5" stroke="#000" strokeWidth="1.6" />
            </pattern>
          </defs>
          <CartesianGrid {...GRID} vertical={false} />
          <XAxis dataKey="lag" {...AXIS} label={{ value: "lag (bars)", position: "insideBottom", offset: -2, fill: "#9ca3af", fontSize: 10 }} />
          <YAxis {...AXIS} width={48} tickFormatter={(v: number) => fmt(v, 3)} domain={[(min: number) => Math.min(min, -band * 1.3), (max: number) => Math.max(max, band * 1.3)]} />
          <Tooltip
            {...TOOLTIP}
            formatter={(value: number, _name, item) => [`${signed(value, 4)} · ${(item.payload as { outside: boolean }).outside ? "outside the band (hatched)" : "inside the band"}`, "correlation"]}
            labelFormatter={(lag) => `lag ${lag}`}
          />
          <ReferenceLine y={band} stroke={OKABE.yellow} strokeDasharray="5 3" label={{ value: `+${fmt(band, 4)}`, fill: OKABE.yellow, fontSize: 9, position: "insideTopRight" }} />
          <ReferenceLine y={-band} stroke={OKABE.yellow} strokeDasharray="5 3" />
          <ReferenceLine y={0} stroke="#737373" />
          <Bar dataKey="value" isAnimationActive={false}>
            {data.slice(1).map((row) => (
              <Cell key={row.lag} fill={row.outside ? `url(#hatch-${id})` : OKABE.blue} stroke={row.outside ? OKABE.orange : undefined} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function AutocorrelationSection({ choice }: { choice: SeriesChoice }) {
  const [controls, set, reset] = useStudyControls({ lags: 40, confidencePercent: 95 });
  const { query, notes, body, unavailable } = useSection<AutocorrelationBody>("autocorrelation", choice, controls);

  const lagOne = body?.autocorrelation[1] ?? null;
  const lagOneSquared = body?.squaredAutocorrelation[1] ?? null;
  const band = body?.band ?? 0;

  return (
    <Section title="5 · Autocorrelation" question="Does a return predict the next return, or only the next return's size?">
      <div className="space-y-3">
        <ControlBar onReset={reset}>
          <SliderControl label="Lags" value={controls.lags} min={5} max={100} onChange={(v) => set("lags", v)} />
          <SegmentControl label="Confidence band" value={controls.confidencePercent} options={[{ value: 90, label: "90 %" }, { value: 95, label: "95 %" }, { value: 99, label: "99 %" }]} onChange={(v) => set("confidencePercent", v)} hint="The band is z / √n around zero" />
        </ControlBar>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={notes} />
          {unavailable || !body ? (
            <p className="text-xs text-neutral-500">The bars are not in the lake for this selection.</p>
          ) : (
            <>
              <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
                <Stat label="Lag-1 correlation of returns" value={signed(lagOne, 4)} tone={lagOne !== null && Math.abs(lagOne) > band ? OKABE.orange : OKABE.blue} hint={`${fmt(band, 4)} is the ${controls.confidencePercent} % band`} />
                <Stat label="Lag-1 correlation of squared returns" value={signed(lagOneSquared, 4)} tone={lagOneSquared !== null && Math.abs(lagOneSquared) > band ? OKABE.orange : OKABE.blue} />
                <Stat label={`Band (±, ${controls.confidencePercent} %)`} value={fmt(band, 5)} hint={`n = ${fmtInt(body.observationCount)} returns`} />
                <Stat label="Squared-return lags outside the band" value={`${body.significantLags.squaredAutocorrelation} of ${body.lags}`} />
              </div>
              <Finding>
                Returns: lag 1 is {signed(lagOne, 4)}, {lagOne !== null && Math.abs(lagOne) > band ? "outside" : "inside"} the ±{fmt(band, 4)} band, and {body.significantLags.autocorrelation} of {body.lags} lags are outside it (about {fmt(body.lags * (1 - body.confidenceLevel), 1)} would be by chance).{" "}
                {lagOne !== null && Math.abs(lagOne) <= band ? "There is no linear signal at lag 1; the notebook's fixed sentence calling it a mean-reverting signal does not follow from these data. " : lagOne !== null && lagOne < 0 ? "A negative lag 1 outside the band is mean reversion. " : "A positive lag 1 outside the band is momentum. "}
                Squared returns: {body.significantLags.squaredAutocorrelation} of {body.lags} lags outside the band, lag 1 at {signed(lagOneSquared, 3)}, and the correlations sum to {fmt(body.squaredAutocorrelationSum, 2)} over the lags shown: volatility clusters strongly, so the size of the next move is forecastable even though its sign is not.
              </Finding>
              <div className="grid gap-3 xl:grid-cols-2">
                <AcfChart title="ACF of log returns" values={body.autocorrelation} band={band} id="acf" />
                <AcfChart title="PACF of log returns (Yule-Walker)" values={body.partialAutocorrelation} band={band} id="pacf" />
                <div className="xl:col-span-2">
                  <AcfChart title="ACF of squared log returns (volatility clustering)" values={body.squaredAutocorrelation} band={band} id="acf-squared" />
                </div>
              </div>
              <FormulaCard
                tex={String.raw`\rho_k=\frac{\sum_{t=1}^{n-k}(x_t-\bar x)(x_{t+k}-\bar x)}{\sum_{t=1}^{n}(x_t-\bar x)^2},\qquad \text{band}=\pm\frac{z}{\sqrt{n}}`}
                caption="The autocorrelation at lag k; the partial autocorrelation removes the effect of the lags between. The squared-return ACF is the same formula with x = r²."
                symbols={[
                  { tex: String.raw`\rho_k`, name: "correlation of a bar's return with the one k bars earlier", value: `ρ₁ = ${signed(lagOne, 4)}` },
                  { tex: "x_t", name: "log return of bar t (or its square)", value: "series" },
                  { tex: String.raw`\bar x`, name: "mean of the series", value: "≈ 0" },
                  { tex: "n", name: "number of returns", value: fmtInt(body.observationCount) },
                  { tex: "z", name: `normal quantile for ${controls.confidencePercent} % confidence`, value: fmt(band * Math.sqrt(body.observationCount), 3) },
                  { tex: String.raw`\pm z/\sqrt n`, name: "the band", value: fmt(band, 5) },
                ]}
              />
            </>
          )}
        </StudyState>
      </div>
    </Section>
  );
}
