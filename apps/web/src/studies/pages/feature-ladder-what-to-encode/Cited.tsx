/**
 * What the notebook states that no lake table computes: shown as cited, with
 * where each figure came from, never as a number this page measured.
 */

import { Finding, OKABE } from "@/studies/kit";
import { CITED_FIGURES } from "@shared/studies/feature-ladder-what-to-encode";

const FIGURES: Array<{ figure: string; value: string; source: string }> = [
  { figure: "Mean quoted spread on MNQ", value: `${CITED_FIGURES.quotedSpreadPoints} points = ${CITED_FIGURES.quotedSpreadTicks} ticks, from ${CITED_FIGURES.quotedTickCount.toLocaleString("en-US")} quoted ticks`, source: "the notebook's Panel D table; no script in datalake/scripts produces it" },
  { figure: "Notebook's gap-to-spread ratio", value: `${CITED_FIGURES.notebookGapToSpreadRatio}`, source: "0.5009 points over 0.51054 points; the histogram above shows what the 0.5009 is made of" },
  { figure: "Volume and range correlation", value: "+0.803", source: "the notebook's prose (analytics/docs/VOLUME_RANGE_FINDINGS.md)" },
  { figure: "Marginal information, volume with the signed body", value: "0.0616 nats", source: "the earlier report this page's ladder corrects" },
  { figure: "Signed volume with its own bar's return; tick imbalance", value: "+0.64; +0.53, on 646,932 one-minute bars", source: "analytics/flow, Lee-Ready on one-second closes (a coarse proxy)" },
  { figure: "Next-bar range R squared in volrange", value: "0.6677", source: "analytics/volrange/forecast.py, not normalised by the ten-bar average range, so not comparable with the ladder's levels" },
  { figure: "Quantile band coverage", value: "79.30% against 80% nominal; median width 24.14 ticks; 554,261 out-of-sample bars", source: "analytics/volrange/forecast.py" },
  { figure: "Conformal band coverage with order flow", value: "80.4% and 80.5%", source: "analytics/flow/band.py" },
  { figure: "Volume and range already overlap as conditioners", value: "within-decile range spread 2.868× (volume), 3.406× (trailing volatility), 2.563× (both): 10.6% better than volume alone", source: "analytics/docs/VOLUME_RANGE_FINDINGS.md, census2d.py" },
];

export function CitedFigures() {
  return (
    <div className="space-y-2">
      <Finding>
        These figures come from other notebooks' work or from a measurement that was never landed. They are quoted, not recomputed, and they are the reason the spread rule in the gap section is drawn dashed and labelled cited.
      </Finding>
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-neutral-500">
            <th className="py-0.5 text-left font-normal">figure</th>
            <th className="py-0.5 text-left font-normal">value as quoted</th>
            <th className="py-0.5 text-left font-normal">where it came from</th>
          </tr>
        </thead>
        <tbody>
          {FIGURES.map((entry) => (
            <tr key={entry.figure} className="border-t border-neutral-900 align-top">
              <td className="py-1 pr-2 text-neutral-300">{entry.figure}</td>
              <td className="py-1 pr-2 font-mono text-neutral-100">{entry.value}</td>
              <td className="py-1 text-neutral-500">{entry.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MonteCarloPanel() {
  return (
    <div className="space-y-2">
      <Finding>
        Simulating cannot add information. A Monte Carlo path is a random draw from whatever engine you fit, so with infinitely many paths it converges to the conditional distribution that engine already describes, plus sampling noise for any finite number. If the engine is a model of volatility conditioned on your three variables, the simulator is a slow, noisy way of asking that model for its own answer.
      </Finding>
      <ul className="max-w-prose list-disc space-y-1 pl-5 text-[12px] text-neutral-300">
        <li>
          <span style={{ color: OKABE.sky }}>One-step question</span> (where will the next open be?): one conditional distribution. Do not simulate; fit the quantiles directly.
        </li>
        <li>
          <span style={{ color: OKABE.orange }}>Path-dependent question</span> (does price touch my stop before my target?): simulate; there is no closed form once volatility is state-dependent.
        </li>
        <li>The move is to add the two surviving features as columns to the existing quantile ladder in analytics/volrange and analytics/flow, not to build a simulator.</li>
        <li>Volume on top of range memory has been measured twice for next-bar range, at +0.000853 and +0.0012 out-of-sample R squared, both inside their own fold-to-fold noise; the gap magnitude is the target where the volume-conditioned body is worth trying.</li>
        <li>Score a distribution with the Continuous Ranked Probability Score and a Probability Integral Transform histogram: R squared grades only the middle, and a well-calibrated wide band beats a miscalibrated narrow one.</li>
      </ul>
    </div>
  );
}

export function DataPanel() {
  return (
    <div className="space-y-2">
      <Finding>
        Every number on this page is built from bars, and a bar is a summary written after the fact. The same-time relationship inside a bar is real and strong (signed volume +0.64 and tick imbalance +0.53 against the bar's own return), yet the next-bar area under the curve stays at 0.50 to 0.514: the information is fully incorporated within the bar it happens in, and an intra-bar process cannot be recovered from its own summary.
      </Finding>
      <ul className="max-w-prose list-disc space-y-1 pl-5 text-[12px] text-neutral-300">
        <li>The notebook reports Databento mbp-1 (10.44 GB, 688 files: top-of-book quotes and trades) and mbp-10 (0.42 GB, 26 files: ten levels of depth) landed on 2026-09-08 and not promoted into any queryable table. That is stated by the notebook and not checked by this page.</li>
        <li>The signed volume used in this workspace is a proxy: the Lee-Ready tick rule applied to one-second bar closes, so every burst inside a second collapses to one sign.</li>
        <li>The solution line: promote mbp-1 into an Iceberg <code>market.quotes</code> table with a trade-level Lee-Ready sign, then re-run this ladder with real order-flow imbalance as a seventh block, the one block that could plausibly move the direction target.</li>
      </ul>
    </div>
  );
}
