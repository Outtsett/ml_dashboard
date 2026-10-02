/**
 * Every column of the frame the notebook profiles: the 32 z-scored features of
 * the run, one histogram each with its eight numbers (ColumnGrid). The pattern
 * flags have only two levels, so a histogram says nothing; they get a table of
 * their two levels and how often the flag fires instead, so no column goes
 * unseen.
 */

import { ColumnGrid, Section, fmt, fmtInt, fmtPercent } from "@/studies/kit";
import type { VectorSpaceBody } from "@shared/studies/vector-space-explained";
import { blockColour, blockGlyph } from "./blocks";

export function FeatureColumns({ body }: { body: VectorSpaceBody }) {
  const rows = body.barIndex.map((_, bar) => {
    const row: Record<string, number> = {};
    body.featureNames.forEach((name, index) => {
      row[name] = (body.values[index] as number[])[bar] as number;
    });
    return row;
  });

  const twoLevel = body.featureNames
    .map((name, index) => {
      const values = body.values[index] as number[];
      const distinct = [...new Set(values)].sort((a, b) => a - b);
      return { name, block: body.featureBlocks[index] as string, distinct, values };
    })
    .filter((entry) => entry.distinct.length <= 2)
    .map((entry) => {
      const high = entry.distinct[entry.distinct.length - 1] as number;
      const firing = entry.values.filter((value) => value === high).length;
      return { ...entry, low: entry.distinct[0] as number, high, firing, share: firing / entry.values.length };
    });

  return (
    <Section
      title="Every feature of the run"
      question={`All ${fmtInt(body.featureNames.length)} z-scored features over ${fmtInt(body.barIndex.length)} bars, each its own histogram with the eight numbers.`}
    >
      <ColumnGrid rows={rows} title="Z-scored features" />
      {twoLevel.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-[11px] text-neutral-400">
            {twoLevel.length} features take only two values (a pattern flag is 0 or 1 before z-scoring), so a histogram is two bars; here are the two levels and how often the flag fires.
          </p>
          <table className="w-full max-w-[640px] border-collapse text-[11px] font-mono tnum">
            <thead>
              <tr className="text-neutral-500">
                <th className="py-0.5 text-left font-normal">feature</th>
                <th className="py-0.5 text-right font-normal">level when off</th>
                <th className="py-0.5 text-right font-normal">level when on</th>
                <th className="py-0.5 text-right font-normal">bars on</th>
                <th className="py-0.5 text-right font-normal">share on</th>
              </tr>
            </thead>
            <tbody>
              {twoLevel.map((entry) => (
                <tr key={entry.name}>
                  <td className="py-0.5 text-left"><span style={{ color: blockColour(entry.block) }}>{blockGlyph(entry.block)}</span> {entry.name}</td>
                  <td className="py-0.5 text-right">{fmt(entry.low, 3)}</td>
                  <td className="py-0.5 text-right">{fmt(entry.high, 3)}</td>
                  <td className="py-0.5 text-right">{fmtInt(entry.firing)}</td>
                  <td className="py-0.5 text-right">{fmtPercent(entry.share, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
