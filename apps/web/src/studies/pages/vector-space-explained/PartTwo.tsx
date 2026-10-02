/**
 * Part 2: HNSW. A greedy multi-layer walk over 220 real bars, then the
 * measured recall@12 and latency against exact search.
 */

import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ControlBar, Finding, GRID, OKABE, Section, SelectControl, SliderControl, SwitchControl, TOOLTIP, fmt, fmtInt, fmtPercent } from "@/studies/kit";
import {
  buildWalkWorld, greedyWalk, nearestLinks, pairAnalysis, queriesPerMiss, recallSummary,
} from "@shared/studies/vector-space-explained";
import { asBasis, featureIndex, type PartProps } from "./controls";
import { WalkPlot } from "./WalkPlot";

export function WalkSection({ body, controls, set }: PartProps) {
  const xi = featureIndex(body, controls.featureX, 0);
  const yi = featureIndex(body, controls.featureY, 1);
  const featureX = body.featureNames[xi] as string;
  const featureY = body.featureNames[yi] as string;
  const pair = pairAnalysis(body.values[xi] ?? [], body.values[yi] ?? []);
  const nodeCount = body.nodeLayers.length;
  const world = buildWalkWorld(pair, body.barIndex, nodeCount);
  const links = Math.min(8, Math.max(2, Math.round(controls.links)));
  const adjacency = nearestLinks(world, links);
  const walk = greedyWalk(world, adjacency, body.nodeLayers);
  const last = Math.max(0, walk.path.length - 1);
  const step = Math.min(Math.max(0, Math.round(controls.step)), last);
  const here = walk.path[step];
  const found = here?.node === walk.exactNearest;
  const total = world.x.length;
  const landedOnNearest = walk.path[last]?.node === walk.exactNearest;
  const layerCounts = [0, 1, 2].map((layer) => body.nodeLayers.filter((value) => value >= layer).length);

  const table: Array<[string, string]> = [
    ["step", `${step} of ${last}`],
    ["on layer", String(here?.layer ?? "n/a")],
    ["distance to query (squared)", fmt(here?.distance ?? null, 4)],
    ["distances computed so far", fmtInt(here?.computations ?? 0)],
    ["brute force would compute", fmtInt(total)],
  ];

  return (
    <Section
      title="2A. Watch HNSW walk"
      question="HNSW answers one question fast: given this bar, which are its nearest neighbours? Brute force measures the distance to every bar. HNSW wires each bar to a handful of nearby bars and walks that wiring downhill toward the query; upper layers hold few nodes with long links, lower layers hold everything with short links. Step it."
    >
      <ControlBar>
        <SliderControl label="Search step" value={step} min={0} max={last} onChange={(v) => set("step", v)} hint="how many hops of the walk to show" />
        <SliderControl label="M, links per node" value={links} min={2} max={8} onChange={(v) => set("links", v)} hint="each bar is wired to its M nearest bars" />
        <SwitchControl label="Show the links" checked={controls.showLinks} onChange={(v) => set("showLinks", v)} />
      </ControlBar>
      <div className="mt-3 grid gap-4 xl:grid-cols-[minmax(0,520px)_minmax(0,1fr)]">
        <WalkPlot world={world} layerOf={body.nodeLayers} links={adjacency} walk={walk} step={step} showLinks={controls.showLinks} featureX={featureX} featureY={featureY} />
        <div className="min-w-0 space-y-3">
          <p className="text-[12px] text-neutral-300">Searching for the neighbours of <b>bar {fmtInt(world.queryBar)}</b>, among {fmtInt(total)} real bars of the pair above.</p>
          <table className="w-full max-w-[360px] border-collapse text-[12px]">
            <tbody>
              {table.map(([label, value]) => (
                <tr key={label}>
                  <td className="py-0.5 pr-3 text-neutral-400">{label}</td>
                  <td className="py-0.5 text-right font-mono font-semibold tnum">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[12px]" style={{ color: found ? OKABE.orange : "#a3a3a3" }}>{found ? "Landed on the true nearest. ◇" : "Still walking downhill."}</p>
          <Finding>
            The whole search cost <b>{fmtInt(walk.computations)}</b> distance computations against brute force&apos;s <b>{fmtInt(total)}</b>, about <b>{fmt(total / Math.max(walk.computations, 1), 1)}×</b> fewer
            {landedOnNearest ? "," : ", and this walk ended off the true nearest,"} with {fmtInt(layerCounts[2] ?? 0)} nodes on layer 2, {fmtInt((layerCounts[1] ?? 0) - (layerCounts[2] ?? 0))} on layer 1 and{" "}
            {fmtInt(total - (layerCounts[1] ?? 0))} on layer 0 only. Big nodes live in the sparse upper layers and take the long strides; the walk drops to smaller, denser layers as it closes in.
            Raise <b>M</b> and each node gets more signposts: better odds of finding the true nearest, more memory and a slower build.
          </Finding>
          <p className="text-[10px] text-neutral-500">
            Each node&apos;s top layer is {body.run ? `the geometric draw (p = 0.5, seed ${body.run.walk_layer_seed}) the notebook used, clipped to layer 2` : "a geometric draw"}, landed so the walk is identical to the notebook&apos;s.
          </p>
        </div>
      </div>
    </Section>
  );
}

export function RecallSection({ body, controls, set, bases }: PartProps) {
  const basis = asBasis(controls.basis);
  const summary = recallSummary(body.recall, basis);
  const neighbours = body.recall.find((row) => row.basis === basis)?.neighbour_count ?? body.run?.neighbour_count ?? 12;
  const probes = body.run?.probe_count_inferred ?? null;
  const rows = body.recall.filter((row) => row.basis === basis).sort((a, b) => a.ef_search - b.ef_search).map((row) => ({
    ...row, label: row.ef_search === 0 ? "brute force" : `ef ${row.ef_search}`,
  }));
  const indexed = rows.filter((row) => row.ef_search > 0);
  const best = summary.best;
  const worst = summary.worst;
  const floor = worst ? Math.min(0.98, Math.floor((worst.recall_at_k - 0.002) * 1000) / 1000) : 0.98;
  const dimensions = basis === "full" ? bases.full.names.length : bases.continuous.names.length;

  if (rows.length === 0) {
    return (
      <Section title="2B. It is approximate: measured on your run" question="The recall measurement is not in the lake for this basis.">
        <p className="text-xs text-neutral-500">No neighbour_index_recall rows for the {basis} basis.</p>
      </Section>
    );
  }

  return (
    <Section
      title={`2B. It is approximate: recall@${neighbours} measured on your run`}
      question="Greedy walking can stop in a dead end, so HNSW can miss. ef_search is how many candidates the walk keeps in play at once: 1 is pure greedy, higher is wider, slower and likelier to be right. Recall is the fraction of the true nearest neighbours the index returned, checked against exact brute force computed independently in numpy."
    >
      <ControlBar>
        <SelectControl
          label="Basis"
          value={basis}
          options={[{ value: "continuous", label: `continuous (${bases.continuous.names.length} dimensions)` }, { value: "full", label: `full (${bases.full.names.length} dimensions)` }]}
          onChange={(v) => set("basis", v)}
        />
      </ControlBar>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-1 text-[11px] text-neutral-400">How often the index agrees with exact search</p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={indexed} margin={{ top: 6, right: 12, left: 8, bottom: 16 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="ef_search" {...AXIS} label={{ value: "ef_search (candidates kept in play)", position: "insideBottom", offset: -8, fill: "#a3a3a3", fontSize: 10 }} />
              <YAxis {...AXIS} width={56} domain={[floor, 1.001]} tickFormatter={(v: number) => fmtPercent(v, 1)} label={{ value: `recall@${neighbours}`, angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
              <ReferenceLine y={1} stroke={OKABE.blue} strokeDasharray="4 3" label={{ value: "exact = 100%", fill: "#a3a3a3", fontSize: 10, position: "insideBottomRight" }} />
              <Tooltip {...TOOLTIP} formatter={(value) => fmtPercent(Number(value), 3)} labelFormatter={(label) => `ef_search ${label}`} />
              <Line dataKey="recall_at_k" name="recall" stroke={OKABE.orange} strokeWidth={2} dot={{ r: 4, fill: OKABE.orange }} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-[11px] text-neutral-400">And what it costs</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={rows} margin={{ top: 6, right: 12, left: 8, bottom: 16 }}>
              <CartesianGrid {...GRID} vertical={false} />
              <XAxis dataKey="label" {...AXIS} interval={0} />
              <YAxis {...AXIS} width={48} tickFormatter={(v: number) => fmt(v, 1)} label={{ value: "milliseconds per query", angle: -90, position: "insideLeft", fill: "#a3a3a3", fontSize: 10 }} />
              <Tooltip {...TOOLTIP} formatter={(value) => `${fmt(Number(value), 3)} ms`} />
              <Bar dataKey="mean_query_milliseconds" name="milliseconds per query" isAnimationActive={false}>
                {rows.map((row) => <Cell key={row.label} fill={row.ef_search === 0 ? OKABE.blue : OKABE.orange} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-neutral-400"><span style={{ color: OKABE.orange }}>■</span> indexed (HNSW) · <span style={{ color: OKABE.blue }}>■</span> brute force, the exact scan</p>
        </div>
      </div>
      <Finding>
        On the <b>{basis}</b> basis ({dimensions} dimensions): recall runs <b>{fmtPercent(worst?.recall_at_k, 2)}</b> (ef_search {worst?.ef_search}) to <b>{fmtPercent(best?.recall_at_k, 2)}</b> (ef_search {best?.ef_search}).{" "}
        {summary.reachesPerfect
          ? `It reaches a perfect 100% from ef_search ${summary.firstPerfectEf} up: on ${dimensions} dimensions the approximation costs nothing once the search is wide enough.`
          : `It never reaches 100%, even at the widest ef_search (${fmtPercent(best?.recall_at_k, 2)}): roughly one query in ${fmt(queriesPerMiss(best?.recall_at_k ?? 1, neighbours), 0)} returns one wrong neighbour. More dimensions, worse approximation.`}
        {worst && worst.recall_at_k < 1 && ` The narrowest search misses: ef_search ${worst.ef_search} returns about one wrong neighbour in ${fmt(queriesPerMiss(worst.recall_at_k, neighbours), 0)} queries.`}
      </Finding>
      <Finding>
        <b>And the timing is the honest part.</b> Indexed queries run <b>{fmt(summary.fastestMilliseconds, 2)} to {fmt(summary.slowestMilliseconds, 2)} ms</b> against brute force&apos;s{" "}
        <b>{fmt(summary.brute?.mean_query_milliseconds, 2)} ms</b>, {summary.brute && summary.slowestMilliseconds !== null && summary.fastestMilliseconds !== null && summary.fastestMilliseconds >= summary.brute.mean_query_milliseconds * 0.5
          ? "indistinguishable"
          : "a real gap"}. At {fmtInt(body.barIndex.length)} bars the index buys no speed to speak of; it only starts paying once the table reaches the hundreds of thousands, where brute force grows linearly and the graph walk barely moves.
      </Finding>
      <p className="text-[10px] text-neutral-500">
        Measured once, on this machine, by Trading/quant/model/scripts/build_vector_space_study.py (DuckDB vss HNSW, squared L2, k = {neighbours}). The probe count is not stored; every recall is a whole
        number of hits over {neighbours} × probes, which makes the probe count a multiple of {probes ?? "n/a"} (the notebook says 120). The script&apos;s default of 200 cannot have produced these values. Timings are machine-specific.
      </p>
    </Section>
  );
}
