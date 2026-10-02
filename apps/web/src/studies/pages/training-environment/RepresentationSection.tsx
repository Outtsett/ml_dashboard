/**
 * Section 4: the representation, moving. A 2-D principal-component projection
 * of the bar tokens at one snapshot epoch, refitted on that epoch's own tokens,
 * so the axes mean something different every snapshot: read it for separation,
 * not for shape. Points differ by colour AND marker shape.
 */

import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SelectControl, SliderControl, StudyState, TOOLTIP, fmt, fmtInt, fmtPercent } from "@/studies/kit";
import type { EmbeddingBody, EmbeddingEpochRow, EmbeddingPoint } from "@shared/studies/training-environment";
import { usePart, type SetControl, type TrainingControls } from "./shared";

type ColourBy = "barrier outcome" | "a pattern fired" | "nothing";
const COLOUR_OPTIONS: ReadonlyArray<{ value: ColourBy; label: string }> = [
  { value: "barrier outcome", label: "barrier outcome" },
  { value: "a pattern fired", label: "a pattern fired" },
  { value: "nothing", label: "nothing" },
];

interface Group {
  name: string;
  colour: string;
  shape: "circle" | "triangle" | "diamond";
  points: EmbeddingPoint[];
}

function groupsFor(colourBy: ColourBy, points: readonly EmbeddingPoint[]): Group[] {
  if (colourBy === "barrier outcome") {
    return [
      { name: "up first", colour: OKABE.orange, shape: "circle", points: points.filter((point) => point.barrier_outcome === "up first") },
      { name: "down first", colour: OKABE.blue, shape: "triangle", points: points.filter((point) => point.barrier_outcome === "down first") },
    ];
  }
  if (colourBy === "a pattern fired") {
    return [
      { name: "fired", colour: OKABE.orange, shape: "diamond", points: points.filter((point) => point.pattern_fired === "fired") },
      { name: "none fired", colour: OKABE.blue, shape: "circle", points: points.filter((point) => point.pattern_fired === "none fired") },
    ];
  }
  return [{ name: "bar", colour: OKABE.grey, shape: "circle", points: [...points] }];
}

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

export function RepresentationSection({ epochs, controls, set }: { epochs: readonly EmbeddingEpochRow[]; controls: TrainingControls; set: SetControl }) {
  const available = epochs.map((row) => row.epoch);
  const newest = available[available.length - 1] ?? 0;
  const wanted = controls.embeddingEpoch > 0 ? controls.embeddingEpoch : newest;
  const query = usePart<EmbeddingBody>("embedding", controls, { epoch: wanted });
  const body = query.data?.data;
  const colourBy = (COLOUR_OPTIONS.find((option) => option.value === controls.colourBy)?.value ?? "barrier outcome") as ColourBy;
  const groups = groupsFor(colourBy, body?.points ?? []);

  if (epochs.length === 0) {
    return (
      <Section title="4 · The representation, moving" question="Where the bar tokens sit, epoch by epoch.">
        <p className="py-4 text-xs text-neutral-400">This run has no embedding snapshot yet.</p>
      </Section>
    );
  }

  return (
    <Section title="4 · The representation, moving" question="A 2-D projection of the bar tokens at one epoch. Read it for separation, not for shape.">
      <div className="space-y-3">
        <ControlBar>
          <SliderControl
            label="Scrub the epoch"
            value={body?.epoch ?? wanted}
            min={Math.min(...available)}
            max={Math.max(...available)}
            onChange={(value) => set("embeddingEpoch", value)}
            format={(value) => `epoch ${fmtInt(value)}`}
            hint={`Snapshot epochs: ${available.join(", ")}. A value between two snapshots shows the nearest.`}
          />
          <SelectControl label="Colour by" value={colourBy} options={COLOUR_OPTIONS} onChange={(value) => set("colourBy", value)} />
        </ControlBar>
        <StudyState isLoading={query.isLoading} error={query.error}>
          <Finding>
            Bar tokens at epoch {fmtInt(body?.epoch)}: {fmtPercent(body?.variance_explained, 1)} of variance in these two axes ({fmtInt(body?.points.length)} points).
          </Finding>
          <ResponsiveContainer width="100%" height={380}>
            <ScatterChart margin={{ top: 8, right: 16, left: 4, bottom: 24 }}>
              <CartesianGrid {...GRID} />
              <XAxis type="number" dataKey="component_1" name="component_1" {...AXIS} tickFormatter={(value: number) => fmt(value, 1)} label={{ value: "principal component 1", position: "insideBottom", offset: -12, fill: "#8a8a8a", fontSize: 10 }} />
              <YAxis type="number" dataKey="component_2" name="component_2" {...AXIS} width={44} tickFormatter={(value: number) => fmt(value, 1)} label={{ value: "principal component 2", angle: -90, position: "insideLeft", fill: "#8a8a8a", fontSize: 10 }} />
              <ZAxis range={[22, 22]} />
              <Tooltip {...TOOLTIP} cursor={{ strokeDasharray: "3 3" }} formatter={(value: number, name: string) => [fmt(value, 4), name]} />
              {groups.map((group) => (
                <Scatter key={group.name} name={`${group.name} (${fmtInt(group.points.length)})`} data={group.points} fill={group.colour} fillOpacity={0.55} shape={group.shape} isAnimationActive={false} />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap gap-3 text-[11px] text-neutral-300">
            {groups.map((group) => (
              <span key={group.name} className="inline-flex items-center gap-1">
                <svg width="12" height="12" aria-hidden="true">
                  {group.shape === "triangle" ? <polygon points="6,1 1,11 11,11" fill={group.colour} /> : group.shape === "diamond" ? <polygon points="6,0 12,6 6,12 0,6" fill={group.colour} /> : <circle cx="6" cy="6" r="5" fill={group.colour} />}
                </svg>
                {group.name}: {fmtInt(group.points.length)} points, mean component 1 {fmt(mean(group.points.map((point) => point.component_1)), 3)}, component 2 {fmt(mean(group.points.map((point) => point.component_2)), 3)}
              </span>
            ))}
          </div>
          <Finding>
            The projection is refitted on each epoch&apos;s own tokens, so the axes mean something different every snapshot — a fixed projection would show the cloud rotating and it would read as structure appearing. If colouring by barrier outcome never separates, the representation does not carry the thing the head is being asked to predict, and no amount of training the head will change that.
          </Finding>
          <FormulaCard
            tex={String.raw`v=\frac{\sigma_1^{2}+\sigma_2^{2}}{\sum_{k}\sigma_k^{2}}`}
            caption="Principal components by singular-value decomposition of the centred tokens."
            symbols={[
              { tex: "\\sigma_k", name: "k-th singular value of the centred token matrix (bars x model dimension)", value: "from this epoch's tokens" },
              { tex: "\\sigma_1,\\sigma_2", name: "the two largest: the two axes drawn", value: "component 1 and component 2" },
              { tex: "v", name: "share of the tokens' variance those two axes hold", value: fmtPercent(body?.variance_explained, 2) },
            ]}
          />
        </StudyState>
      </div>
    </Section>
  );
}
