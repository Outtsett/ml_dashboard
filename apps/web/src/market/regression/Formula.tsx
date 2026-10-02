/**
 * The fitted line and its two bands, typeset, with every symbol defined in
 * plain words and carrying the value it holds for the panel on screen.
 */

import { useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import type { RegressionFit } from "@shared/regression/types";
import { formatValue } from "./scales";

function Tex({ source, display = false }: { source: string; display?: boolean }) {
  // Sources are fixed strings built in this file, never user input.
  const html = katex.renderToString(source, { displayMode: display, throwOnError: false, output: "htmlAndMathml" });
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

interface FormulaSymbol {
  key: string;
  tex: string;
  name: string;
  meaning: string;
  value: string;
}

interface FormulaProps {
  fit: RegressionFit;
  xLabel: string;
  yLabel: string;
  /** Where along X the band widths below are evaluated. */
  probeX: number;
  onProbeXChange: (value: number) => void;
}

export function Formula({ fit, xLabel, yLabel, probeX, onProbeXChange }: FormulaProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const level = Math.round(fit.confidenceLevel * 100);
  const distance = ((probeX - fit.meanX) * (probeX - fit.meanX)) / fit.sumSquaresX;
  const center = fit.intercept + fit.slope * probeX;
  const meanHalfWidth = fit.tCritical * fit.residualStandardError * Math.sqrt(1 / fit.n + distance);
  const predictionHalfWidth = fit.tCritical * fit.residualStandardError * Math.sqrt(1 + 1 / fit.n + distance);

  const symbols: FormulaSymbol[] = [
    { key: "yhat", tex: "\\hat{y}", name: "fitted value", meaning: `The line's estimate of ${yLabel} at this X.`, value: formatValue(center) },
    { key: "a", tex: "a", name: "intercept", meaning: "Where the line crosses X = 0.", value: formatValue(fit.intercept) },
    { key: "b", tex: "b", name: "slope", meaning: `Change in ${yLabel} per one unit of ${xLabel}.`, value: formatValue(fit.slope) },
    { key: "x0", tex: "x_0", name: "probe X", meaning: "The X the bands are being read at — drag the slider.", value: formatValue(probeX) },
    { key: "xbar", tex: "\\bar{x}", name: "mean of X", meaning: "Average X over the fit; bands are narrowest here.", value: formatValue(fit.meanX) },
    { key: "n", tex: "n", name: "points", meaning: "Bars in the fit.", value: fit.n.toLocaleString() },
    { key: "Sxx", tex: "S_{xx}", name: "spread of X", meaning: "Σ (x − x̄)²: how widely X ranges. More spread, tighter slope.", value: formatValue(fit.sumSquaresX) },
    { key: "s", tex: "s", name: "residual standard error", meaning: `Typical miss of the line, in ${yLabel} units, √(RSS ÷ (n − 2)).`, value: formatValue(fit.residualStandardError) },
    { key: "t", tex: `t_{${(1 - (1 - fit.confidenceLevel) / 2).toFixed(3)},\\,n-2}`, name: "t critical value", meaning: `Student t quantile giving ${level}% coverage with n − 2 degrees of freedom.`, value: formatValue(fit.tCritical, 5) },
  ];

  const highlight = (key: string) => (hovered === key ? "bg-[#E69F00]/15" : "");

  return (
    <div className="rounded-md border border-white/[0.07] bg-white/[0.015] p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] text-foreground/90">
        <span>
          <Tex source={"\\hat{y} = a + b\\,x_0"} />
          <span className="ml-2 font-mono text-[11px] text-muted-foreground">
            = {formatValue(fit.intercept)} + {formatValue(fit.slope)} × {formatValue(probeX)} = <span className="text-[#E69F00]">{formatValue(center)}</span>
          </span>
        </span>
      </div>
      <div className="mb-1 text-[12px] text-foreground/85">
        <span className="mr-2 inline-block w-[150px] text-[10px] uppercase tracking-wide text-muted-foreground">{level}% confidence band</span>
        <Tex source={"\\hat{y} \\pm t\\,s\\sqrt{\\tfrac{1}{n} + \\tfrac{(x_0-\\bar{x})^2}{S_{xx}}}"} />
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">= ± {formatValue(meanHalfWidth)}</span>
      </div>
      <div className="mb-3 text-[12px] text-foreground/85">
        <span className="mr-2 inline-block w-[150px] text-[10px] uppercase tracking-wide text-muted-foreground">{level}% prediction band</span>
        <Tex source={"\\hat{y} \\pm t\\,s\\sqrt{1 + \\tfrac{1}{n} + \\tfrac{(x_0-\\bar{x})^2}{S_{xx}}}"} />
        <span className="ml-2 font-mono text-[11px] text-muted-foreground">= ± {formatValue(predictionHalfWidth)}</span>
      </div>

      <label className="mb-3 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="shrink-0">probe <Tex source="x_0" /></span>
        <input
          type="range"
          min={fit.minimumX}
          max={fit.maximumX}
          step={(fit.maximumX - fit.minimumX) / 400 || 1}
          value={probeX}
          onChange={(event) => onProbeXChange(Number(event.target.value))}
          className="w-full accent-[#E69F00]"
          aria-label="Probe X for the band widths"
        />
        <span className="w-20 shrink-0 text-right font-mono tabular-nums text-foreground/80">{formatValue(probeX)}</span>
      </label>
      <p className="mb-2 text-[10px] leading-snug text-muted-foreground/80">
        The confidence band is where the <em>average</em> {yLabel} at this X probably is. The prediction band is where a
        <em> single new bar</em> probably lands — always wider, because it adds the bar's own scatter (the 1 under the root).
        Both widen as x₀ moves away from x̄.
      </p>

      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-left text-[9px] uppercase tracking-wide text-muted-foreground/70">
            <th className="w-14 pb-1 font-medium">symbol</th>
            <th className="pb-1 font-medium">name</th>
            <th className="pb-1 font-medium">what it holds</th>
            <th className="pb-1 text-right font-medium">now</th>
          </tr>
        </thead>
        <tbody>
          {symbols.map((entry) => (
            <tr
              key={entry.key}
              className={`border-t border-white/[0.04] ${highlight(entry.key)}`}
              onMouseEnter={() => setHovered(entry.key)}
              onMouseLeave={() => setHovered(null)}
            >
              <td className="py-0.5"><Tex source={entry.tex} /></td>
              <td className="py-0.5 text-foreground/85">{entry.name}</td>
              <td className="py-0.5 text-muted-foreground">{entry.meaning}</td>
              <td className="py-0.5 text-right font-mono tabular-nums text-foreground/90">{entry.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
