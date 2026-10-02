/**
 * The two formulas behind the page's numbers, typeset, with every symbol
 * defined in words and carrying the value it holds for what is on screen.
 */

import { FormulaCard, fmt, fmtInt } from "@/studies/kit";
import type { FamilySummaryRow, InventoryTotals } from "@shared/studies/storage-format-inventory";
import { familyLabel, formatBytes } from "./formats";

export function ParquetShareFormula({ totals }: { totals: InventoryTotals }) {
  return (
    <FormulaCard
      tex={String.raw`\text{parquet share}=100\times\frac{B_{\text{parquet}}}{B_{\text{total}}}\qquad \text{GiB}=\frac{B}{1024^{3}}`}
      caption="The headline number. A gibibyte is 1,024 x 1,024 x 1,024 bytes, as the notebook and the tables here count it."
      symbols={[
        { tex: String.raw`B_{\text{parquet}}`, name: "bytes in files whose is_parquet flag is true", value: `${formatBytes(totals.parquetBytes)} (${fmtInt(totals.parquetBytes)} B)` },
        { tex: String.raw`B_{\text{total}}`, name: "bytes in every file the controls leave in", value: `${formatBytes(totals.totalBytes)} (${fmtInt(totals.totalBytes)} B)` },
        { tex: String.raw`\text{parquet share}`, name: "percent of the bytes that sit in parquet", value: totals.parquetSharePercent === null ? "—" : `${fmt(totals.parquetSharePercent, 2)} %` },
        { tex: String.raw`\text{GiB}`, name: "gibibytes held by the files that are not parquet", value: `${fmt(totals.nonParquetBytes / 1024 ** 3, 3)} GiB` },
      ]}
    />
  );
}

export function MomentsFormula({ row }: { row: FamilySummaryRow | undefined }) {
  const summary = row?.mebibytes;
  return (
    <FormulaCard
      tex={String.raw`\begin{aligned}G_1&=\frac{n\sqrt{n-1}}{n-2}\,\frac{\sum_{i=1}^{n}(x_i-\bar x)^{3}}{\bigl(\sum_{i=1}^{n}(x_i-\bar x)^{2}\bigr)^{3/2}}\\[6pt]G_2&=\frac{n(n+1)}{(n-1)(n-2)(n-3)}\,\frac{\sum_{i=1}^{n}(x_i-\bar x)^{4}}{s^{4}}-\frac{3(n-1)^{2}}{(n-2)(n-3)}\end{aligned}`}
      caption={`Why the page reports skewness and kurtosis beside the mean: file sizes are nothing like a bell curve, and these two say how far a few huge files pull the mean away from the typical one.${row ? ` Values shown are for ${familyLabel(row.format_family)}.` : ""}`}
      symbols={[
        { tex: "n", name: "number of files in the family", value: summary ? fmtInt(summary.count) : "—" },
        { tex: "i", name: "file index, 1 to n", value: summary ? `1 … ${fmtInt(summary.count)}` : "—" },
        { tex: "x_i", name: "size of file i, in mebibytes", value: "one per file" },
        { tex: String.raw`\bar x`, name: "mean file size, in mebibytes", value: summary ? fmt(summary.mean, 4) : "—" },
        { tex: "s", name: "sample standard deviation of file size (divides by n - 1), in mebibytes", value: summary ? fmt(summary.standardDeviation, 4) : "—" },
        { tex: "G_1", name: "skewness: positive means a long tail of large files", value: summary ? fmt(summary.skewness, 3) : "—" },
        { tex: "G_2", name: "excess kurtosis: how heavy the tails are beyond a bell curve (0)", value: summary ? fmt(summary.kurtosis, 3) : "—" },
      ]}
    />
  );
}
