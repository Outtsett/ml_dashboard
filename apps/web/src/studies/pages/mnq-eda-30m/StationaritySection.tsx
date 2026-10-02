/**
 * Section 4: stationarity. Augmented Dickey-Fuller (null: a unit root) and KPSS (null:
 * stationary) on the log returns, and the ADF on the prices as the sanity check that should
 * fail. The numbers come from the landed table (statsmodels, run by
 * packages/ml-engine/src/studies/mnq_eda_30m/build.py): the lag search is too long for a web request.
 */

import { Finding, FormulaCard, OKABE, Section, StudyNotes, StudyState, fmt, fmtInt } from "@/studies/kit";
import type { StationarityBody, StationarityRow } from "@shared/studies/mnq-eda-30m";
import { pText } from "./format";
import { useSection, type SeriesChoice } from "./use";

const TEST_NAME: Record<string, string> = { augmented_dickey_fuller: "Augmented Dickey-Fuller", kpss: "KPSS" };
const SERIES_NAME: Record<string, string> = { log_return: "log returns", close: "close prices" };

/** The statistic against its critical values on a number line, the rejection side hatched. */
function CriticalLine({ row }: { row: StationarityRow }) {
  const statistic = row.statistic;
  const critical = [
    ["1%", row.critical_value_1_percent],
    ["5%", row.critical_value_5_percent],
    ["10%", row.critical_value_10_percent],
  ].filter((entry): entry is [string, number] => typeof entry[1] === "number");
  if (statistic === null || critical.length === 0) return null;
  const isAdf = row.test === "augmented_dickey_fuller";
  const values = [statistic, ...critical.map(([, value]) => value)];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const pad = (high - low || 1) * 0.12;
  const from = low - pad;
  const to = high + pad;
  const x = (value: number) => 8 + ((value - from) / (to - from)) * 584;
  const reject5 = critical.find(([name]) => name === "5%")?.[1] ?? critical[0]![1];
  const id = `reject-${row.test}-${row.series}`;
  return (
    <svg viewBox="0 0 600 84" className="w-full max-w-xl" role="img" aria-label={`${TEST_NAME[row.test]} statistic ${fmt(statistic, 3)} against critical values`}>
      <defs>
        <pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="rgba(0,114,178,0.15)" />
          <line x1="0" y1="0" x2="0" y2="6" stroke={OKABE.blue} strokeWidth="2" />
        </pattern>
      </defs>
      <rect x={isAdf ? 8 : x(reject5)} y="18" width={isAdf ? x(reject5) - 8 : 592 - x(reject5)} height="22" fill={`url(#${id})`} />
      <line x1="8" y1="29" x2="592" y2="29" stroke="#525252" />
      {critical.map(([name, value], order) => (
        <g key={name}>
          <line x1={x(value)} y1="14" x2={x(value)} y2="44" stroke="#a3a3a3" strokeDasharray="3 3" />
          <text x={x(value)} y={56 + order * 11} textAnchor="middle" fontSize="9" fill="#a3a3a3">{name} {fmt(value, 3)}</text>
        </g>
      ))}
      <path d={`M ${x(statistic)} 8 l 6 10 l -6 10 l -6 -10 z`} fill={OKABE.orange} stroke="#000" strokeWidth="0.5" />
      <text x={x(statistic)} y="6" textAnchor="middle" fontSize="9" fill={OKABE.orange}>◆ {fmt(statistic, 3)}</text>
    </svg>
  );
}

function agree(rows: StationarityRow[]): string | null {
  const adf = rows.find((row) => row.series === "log_return" && row.test === "augmented_dickey_fuller");
  const kpss = rows.find((row) => row.series === "log_return" && row.test === "kpss");
  if (!adf || !kpss || adf.p_value === null || kpss.p_value === null) return null;
  const adfStationary = adf.p_value < 0.05;
  const kpssStationary = kpss.p_value > 0.05;
  if (adfStationary && kpssStationary) return "Both tests agree: the returns are stationary (ADF rejects the unit root, KPSS does not reject stationarity), so the model can learn from them without differencing them again.";
  if (!adfStationary && !kpssStationary) return "Both tests say the returns are not stationary.";
  return "The two tests disagree, which usually means a structural break or long memory: read the returns as only difference-stationary.";
}

export function StationaritySection({ choice }: { choice: SeriesChoice }) {
  const { query, notes, body, unavailable } = useSection<StationarityBody>("stationarity", choice);
  const rows = body?.rows ?? [];
  const adfReturns = rows.find((row) => row.series === "log_return" && row.test === "augmented_dickey_fuller");
  const kpssReturns = rows.find((row) => row.series === "log_return" && row.test === "kpss");

  return (
    <Section title="4 · Stationarity tests" question="Are the returns stationary (learnable) while the prices are not?">
      <div className="space-y-3">
        <StudyState isLoading={query.isLoading} error={query.error}>
          <StudyNotes notes={notes} />
          {unavailable || rows.length === 0 ? (
            <p className="text-xs text-neutral-500">
              The unit-root tests are not landed for this selection. Run <span className="font-mono">packages/ml-engine/src/studies/mnq_eda_30m/build.py</span> (statsmodels, about twelve minutes) and refresh the derived views.
            </p>
          ) : (
            <>
              {agree(rows) && <Finding>{agree(rows)}</Finding>}
              <div className="overflow-x-auto">
                <table className="w-full text-[11px] font-mono tnum">
                  <thead>
                    <tr className="text-left text-neutral-500">
                      <th className="py-1 font-normal">series</th>
                      <th className="pl-3 font-normal">test</th>
                      <th className="pl-3 text-right font-normal">statistic</th>
                      <th className="pl-3 text-right font-normal">p-value</th>
                      <th className="pl-3 text-right font-normal">lags</th>
                      <th className="pl-3 text-right font-normal">observations</th>
                      <th className="pl-3 text-right font-normal">crit 1%</th>
                      <th className="pl-3 text-right font-normal">crit 5%</th>
                      <th className="pl-3 text-right font-normal">crit 10%</th>
                      <th className="pl-3 font-normal">verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={`${row.series}-${row.test}`} className="border-t border-neutral-900 align-top">
                        <td className="py-1 text-neutral-300">{SERIES_NAME[row.series] ?? row.series}</td>
                        <td className="pl-3 text-neutral-300">{TEST_NAME[row.test] ?? row.test}</td>
                        <td className="pl-3 text-right text-neutral-100">{fmt(row.statistic, 4)}</td>
                        <td className="pl-3 text-right text-neutral-100">
                          {row.p_value_is_table_edge ? `≥ ${pText(row.p_value)} *` : row.p_value === 0 && row.test === "augmented_dickey_fuller" ? "≈ 0 †" : pText(row.p_value)}
                        </td>
                        <td className="pl-3 text-right">{fmtInt(row.lags_used)}</td>
                        <td className="pl-3 text-right">{fmtInt(row.observations_used)}</td>
                        <td className="pl-3 text-right">{fmt(row.critical_value_1_percent, 3)}</td>
                        <td className="pl-3 text-right">{fmt(row.critical_value_5_percent, 3)}</td>
                        <td className="pl-3 text-right">{fmt(row.critical_value_10_percent, 3)}</td>
                        <td className="pl-3 font-sans text-neutral-300">{row.verdict}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-neutral-500">
                * statsmodels reads the KPSS p-value from a table that stops at 0.10, so the true p is larger. † The augmented Dickey-Fuller p of 0 is MacKinnon&apos;s approximation reaching its floor: the statistic is far below the 1 % critical value.
              </p>
              <div className="grid gap-3 xl:grid-cols-2">
                {[adfReturns, kpssReturns].map((row) =>
                  row ? (
                    <div key={row.test} className="min-w-0 space-y-1">
                      <h4 className="text-xs font-semibold text-neutral-200">
                        {TEST_NAME[row.test]} on the {SERIES_NAME[row.series]}: the statistic ◆ against its critical values
                      </h4>
                      <CriticalLine row={row} />
                      <p className="text-[10px] text-neutral-500">
                        Hatched: where the null ({row.test === "kpss" ? "stationary" : "unit root"}) is rejected at 5 %. {row.test === "kpss" ? "KPSS rejects when the statistic is above the critical value." : "ADF rejects when the statistic is below the critical value."}
                      </p>
                    </div>
                  ) : null,
                )}
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                <FormulaCard
                  tex={String.raw`\Delta y_t=\alpha+\gamma\,y_{t-1}+\sum_{i=1}^{p}\delta_i\,\Delta y_{t-i}+\varepsilon_t`}
                  caption="Augmented Dickey-Fuller: if γ is zero the series has a unit root; the statistic τ is γ̂ over its standard error. The lag count p is chosen by the Akaike information criterion."
                  symbols={[
                    { tex: String.raw`\tau`, name: "ADF statistic on the log returns", value: fmt(adfReturns?.statistic, 3) },
                    { tex: "p", name: "lagged differences included (AIC search)", value: fmtInt(adfReturns?.lags_used) },
                    { tex: "n", name: "observations used in the regression", value: fmtInt(adfReturns?.observations_used) },
                    { tex: String.raw`\tau_{5\%}`, name: "5 % critical value", value: fmt(adfReturns?.critical_value_5_percent, 3) },
                  ]}
                />
                <FormulaCard
                  tex={String.raw`\eta=\frac{1}{T^{2}\,\hat s^{2}(\ell)}\sum_{t=1}^{T}S_t^{2},\qquad S_t=\sum_{j\le t}\hat e_j`}
                  caption="KPSS: the partial sums S of the residuals around a constant stay small when the series is stationary; ŝ² is the long-run variance with ℓ Newey-West lags."
                  symbols={[
                    { tex: String.raw`\eta`, name: "KPSS statistic on the log returns", value: fmt(kpssReturns?.statistic, 4) },
                    { tex: String.raw`\ell`, name: "Newey-West lags (automatic)", value: fmtInt(kpssReturns?.lags_used) },
                    { tex: "T", name: "number of returns", value: fmtInt(kpssReturns?.observations_used) },
                    { tex: String.raw`\eta_{5\%}`, name: "5 % critical value", value: fmt(kpssReturns?.critical_value_5_percent, 3) },
                  ]}
                />
              </div>
            </>
          )}
        </StudyState>
      </div>
    </Section>
  );
}
