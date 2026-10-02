/**
 * What PC1, PC2 and HNSW actually are: principal components and approximate
 * nearest-neighbour search, on the Lens run's own bars. Every control is
 * computed in the browser from the 4,000 x 32 z-scored matrix the server sends
 * once; the landed spectrum, loadings and recall sit beside the recomputed
 * numbers as a check.
 */

import { Empty, Section, Stat, StudyNotes, StudyState, fmt, fmtInt, fmtPercent, useStudyControls, useStudyQuery, Finding } from "@/studies/kit";
import { EMPTY_BODY, basisColumns, principalComponents, recallSummary, type Basis, type VectorSpaceBody } from "@shared/studies/vector-space-explained";
import { DEFAULTS, type BasisComponents } from "./controls";
import { FeatureColumns } from "./FeatureColumns";
import { ComponentsSection, PairSection } from "./PartOne";
import { RecallSection, WalkSection } from "./PartTwo";

const GLOSSARY: Array<[string, string, string]> = [
  ["PC1", "Principal Component 1", "the most important direction through your data"],
  ["PC2", "Principal Component 2", "the second most important direction, at right angles to the first"],
  ["PCA", "Principal Component Analysis", "the method that finds them"],
  ["HNSW", "Hierarchical Navigable Small World", "a layered graph you can steer through, where everything is a few hops from everything else"],
];

function basesOf(body: VectorSpaceBody): Record<Basis, BasisComponents> {
  const make = (basis: Basis): BasisComponents => {
    const { names, blocks, columns } = basisColumns(body, basis);
    return { names, blocks, principal: principalComponents(columns) };
  };
  return { continuous: make("continuous"), full: make("full") };
}

export default function Page() {
  const [controls, set, reset] = useStudyControls(DEFAULTS);
  const query = useStudyQuery<VectorSpaceBody>("vector-space-explained");
  const body = query.data?.data ?? EMPTY_BODY;
  const ready = body.featureNames.length > 1 && body.barIndex.length > 0;
  const bases = basesOf(body);
  const continuous = bases.continuous.principal;
  const topTwo = (continuous.cumulativeShares[1] ?? 0);
  const recall = recallSummary(body.recall, "continuous");

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!ready ? (
          <Empty>
            The vector-space tables are not in the lake yet. Land them with{" "}
            <code>E:/source/repos/datalake/.venv/Scripts/python.exe packages/ml-engine/src/studies/vector_space_explained/build.py</code>, then refresh the derived views.
          </Empty>
        ) : (
          <>
            <div className="grid gap-2 grid-cols-2 xl:grid-cols-5">
              <Stat label="Bars" value={fmtInt(body.barIndex.length)} hint={`the Lens run ${body.run?.source_run ?? ""}`} />
              <Stat label="Features" value={`${fmtInt(bases.full.names.length)} full / ${fmtInt(bases.continuous.names.length)} continuous`} hint="the continuous basis drops the pattern flags" />
              <Stat label="PC1 + PC2 (continuous)" value={fmtPercent(topTwo, 1)} hint="the share of the spread the Lens panel's two axes show" />
              <Stat label="Components for 90%" value={`${fmtInt(continuous.cumulativeShares.filter((share) => share < 0.9).length + 1)} of ${fmtInt(continuous.eigenvalues.length)}`} hint="continuous basis" />
              <Stat label="Worst HNSW recall (continuous)" value={recall.worst ? `${fmtPercent(recall.worst.recall_at_k, 2)} at ef ${recall.worst.ef_search}` : "n/a"} hint="recall@12 against exact search" />
            </div>

            <Section title="Start with the words" question="Both names do more intimidation than work; nothing here is harder than the words.">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="text-neutral-500">
                    <th className="py-0.5 text-left font-normal">short</th>
                    <th className="py-0.5 text-left font-normal">stands for</th>
                    <th className="py-0.5 text-left font-normal">reads as</th>
                  </tr>
                </thead>
                <tbody>
                  {GLOSSARY.map(([short, long, reads]) => (
                    <tr key={short} className="border-t border-neutral-800">
                      <td className="py-1 pr-3 font-mono font-semibold">{short}</td>
                      <td className="py-1 pr-3 text-neutral-200">{long}</td>
                      <td className="py-1 text-neutral-400">{reads}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Finding>
                <i>Principal</i> means chief, and a <i>component</i> is one of the directions the data is built out of. <i>Hierarchical</i> means built in layers, <i>navigable</i> means every hop can take
                you closer to what you are looking for, and <i>small world</i> is the network-science term for a graph where any point reaches any other in very few hops. So the two questions are:{" "}
                <b>PC1 / PC2</b>, where do I put a {fmtInt(bases.continuous.names.length)}-dimensional bar on a 2-dimensional screen? And <b>HNSW</b>, how do I find a bar&apos;s nearest neighbours without
                comparing it to everything? Both are taken apart below on your own MNQ run: the same {fmtInt(body.barIndex.length)} bars the Lens vector-space panel draws.
              </Finding>
            </Section>

            <h2 className="pt-1 text-sm font-semibold text-neutral-100">Part 1: PC1 and PC2 (Principal Component 1 and 2)</h2>
            <PairSection body={body} controls={controls} set={set} reset={reset} bases={bases} />
            <ComponentsSection body={body} controls={controls} set={set} reset={reset} bases={bases} />

            <h2 className="pt-1 text-sm font-semibold text-neutral-100">Part 2: HNSW (Hierarchical Navigable Small World)</h2>
            <WalkSection body={body} controls={controls} set={set} reset={reset} bases={bases} />
            <RecallSection body={body} controls={controls} set={set} reset={reset} bases={bases} />

            <Section title="The two answers, together">
              <Finding>
                <b>PC1 and PC2</b> are the two directions through your {fmtInt(bases.continuous.names.length)}-dimensional bar cloud that carry the most spread. They are how a {fmtInt(bases.continuous.names.length)}-D point
                gets a 2-D position, and they carry <b>{fmtPercent(topTwo, 1)}</b> of the spread, so the picture is honest but lossy. <b>HNSW</b> is the index that finds a bar&apos;s true neighbours without measuring
                against every other bar. It searches the <b>full</b> space, not the 2-D picture, which is why a neighbour can land far away on screen and still be correct (recall {recall.best ? fmtPercent(recall.best.recall_at_k, 1) : "n/a"} at its widest
                search, {fmt(recall.brute?.mean_query_milliseconds, 2)} ms for the exact scan). They do opposite jobs, and that is the point: the projection makes the space <i>visible</i>, the index keeps the <i>distances</i> honest.
              </Finding>
            </Section>

            <FeatureColumns body={body} />
          </>
        )}
      </StudyState>
    </div>
  );
}
