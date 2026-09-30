/**
 * A typeset formula with every symbol defined beside it in plain words and
 * carrying the value it holds for what is on screen. Pages pass fixed TeX
 * strings they build themselves, never user input.
 */

import katex from "katex";
import "katex/dist/katex.min.css";

export function Tex({ source, display = false }: { source: string; display?: boolean }) {
  const html = katex.renderToString(source, { displayMode: display, throwOnError: false, output: "htmlAndMathml" });
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export interface FormulaSymbol {
  /** TeX for the symbol, e.g. "p_{(i)}". */
  tex: string;
  /** Full-word name, e.g. "the i-th smallest p-value". */
  name: string;
  /** Its current value with units, e.g. "0.0213". */
  value: string;
}

export function FormulaCard({ tex, symbols, caption }: { tex: string; symbols: readonly FormulaSymbol[]; caption?: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900/40 p-3">
      <div className="overflow-x-auto text-neutral-100">
        <Tex source={tex} display />
      </div>
      {caption && <p className="mt-1 text-[11px] text-neutral-400">{caption}</p>}
      <dl className="mt-2 grid gap-x-4 gap-y-1 text-[11px] grid-cols-[auto_1fr_auto]">
        {symbols.map((symbol) => (
          <div key={symbol.tex} className="contents">
            <dt className="text-neutral-100"><Tex source={symbol.tex} /></dt>
            <dd className="text-neutral-400">{symbol.name}</dd>
            <dd className="text-right font-mono tnum text-neutral-200">{symbol.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
