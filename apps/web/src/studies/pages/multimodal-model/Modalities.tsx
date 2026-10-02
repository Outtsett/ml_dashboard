/**
 * Modalities: which block of inputs adds AUC. The ablation is measured on the
 * test quarter (fusion: the block's token zeroed; gradient-boosted trees: the
 * block's columns shuffled), the gain share is how much of the trees' split
 * gain each block earned. Both are averaged over the chosen trial's quarters.
 */

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ablationMeans, type GainRow, type MultimodalBody } from "@shared/studies/multimodal-model";
import { AXIS, ColumnGrid, ControlBar, Empty, Finding, GRID, OKABE, Section, TOOLTIP, fmt, fmtInt } from "@/studies/kit";
import type { TabProps } from "./controls";
import { HEADS, headStyle } from "./parts";
import { TrialPicker, WindowControl } from "./TrialDetail";

const MODALITY_ORDER = ["price", "flow", "cross", "time", "context", "calendar", "news", "sequence"];

function orderOf(modality: string): number {
  const index = MODALITY_ORDER.indexOf(modality);
  return index === -1 ? MODALITY_ORDER.length : index;
}

function HorizontalPanel({
  head, rows, valueKey, colorFor, unit, decimals,
}: {
  head: string;
  rows: Array<{ modality: string; value: number; detail?: string }>;
  valueKey: "value";
  colorFor: (value: number) => string;
  unit: string;
  decimals: number;
}) {
  const style = headStyle(head);
  const sorted = [...rows].sort((a, b) => orderOf(a.modality) - orderOf(b.modality));
  return (
    <div className="min-w-0 rounded-md border border-neutral-800 bg-neutral-900/40 p-2">
      <div className="mb-1 text-[11px] font-medium text-neutral-200">
        <span style={{ color: style.color }}>{style.glyph}</span> {style.label}
      </div>
      <ResponsiveContainer width="100%" height={Math.max(120, 24 * sorted.length + 24)}>
        <BarChart data={sorted} layout="vertical" margin={{ top: 4, right: 52, left: 4, bottom: 4 }}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" {...AXIS} tickFormatter={(value: number) => fmt(value, decimals > 3 ? 3 : decimals)} />
          <YAxis type="category" dataKey="modality" width={64} {...AXIS} interval={0} />
          <ReferenceLine x={0} stroke={OKABE.grey} />
          <Tooltip
            {...TOOLTIP}
            content={({ payload }) => {
              const row = payload?.[0]?.payload as (typeof sorted)[number] | undefined;
              if (!row) return null;
              return (
                <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                  <div className="font-semibold">{row.modality} · {style.label}</div>
                  <div>{unit}: {fmt(row.value, decimals)}</div>
                  {row.detail && <div>{row.detail}</div>}
                </div>
              );
            }}
          />
          <Bar dataKey={valueKey} isAnimationActive={false}>
            {sorted.map((row) => (
              <Cell key={row.modality} fill={colorFor(row.value)} />
            ))}
            <LabelList dataKey={valueKey} position="right" formatter={(value: number) => fmt(value, decimals)} fill="#ccc" fontSize={9} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Modalities({ controls, set, body }: TabProps & { body: MultimodalBody }) {
  const detail = body.detail;
  const picker = (
    <ControlBar>
      <TrialPicker trials={body.trials} selected={body.selectedRecipe} set={set} />
      <WindowControl controls={controls} set={set} />
    </ControlBar>
  );
  if (!detail) {
    return (
      <div className="space-y-3">
        {picker}
        <Empty>No importance record is landed for this trial.</Empty>
      </div>
    );
  }

  const means = ablationMeans(detail.ablationRows);
  const gainByHead = new Map<string, GainRow[]>();
  for (const row of detail.gain) {
    const rows = gainByHead.get(row.head) ?? [];
    rows.push(row);
    gainByHead.set(row.head, rows);
  }
  const strongest = [...means].sort((a, b) => b.meanAucDrop - a.meanAucDrop)[0];

  return (
    <div className="space-y-3">
      {picker}
      <Section
        title="Modality ablation: test-quarter AUC lost when one block is switched off"
        question="Fusion network: the block's token is zeroed. Gradient-boosted trees: the block's columns are shuffled. 0 = the block adds nothing; orange (▲) = the model loses AUC without it, blue (▼) = it does no worse, or better."
      >
        {means.length === 0 ? (
          <Empty>This trial recorded no ablation (a plain gradient-boosted-trees run records split gain instead).</Empty>
        ) : (
          <>
            <div className="grid min-w-0 gap-3 xl:grid-cols-2">
              {HEADS.filter((head) => means.some((row) => row.head === head)).map((head) => (
                <HorizontalPanel
                  key={head}
                  head={head}
                  valueKey="value"
                  unit="mean AUC drop"
                  decimals={4}
                  colorFor={(value) => (value > 0 ? OKABE.orange : OKABE.blue)}
                  rows={means.filter((row) => row.head === head).map((row) => ({ modality: row.modality, value: row.meanAucDrop, detail: `${row.foldCount} quarters` }))}
                />
              ))}
            </div>
            {strongest && (
              <Finding>
                The largest mean AUC drop is {fmt(strongest.meanAucDrop, 4)} ({strongest.modality}, {headStyle(strongest.head).label}); an AUC of 0.5 is a coin flip, so a drop of a few thousandths is the size of the noise in a single quarter.
              </Finding>
            )}
          </>
        )}
      </Section>

      <Section title="Share of the gradient-boosted trees' split gain, per block" question="How much of the gain the trees earned came from each block's columns, summed over the block and averaged over the quarters. It says what the trees used, not what helped.">
        {gainByHead.size === 0 ? (
          <Empty>This trial has no split-gain record (a fusion network has no trees).</Empty>
        ) : (
          <div className="grid min-w-0 gap-3 xl:grid-cols-2">
            {HEADS.filter((head) => gainByHead.has(head)).map((head) => (
              <HorizontalPanel
                key={head}
                head={head}
                valueKey="value"
                unit="share of split gain"
                decimals={3}
                colorFor={() => OKABE.sky}
                rows={(gainByHead.get(head) ?? []).map((row) => ({ modality: row.modality, value: row.gain_share ?? 0 }))}
              />
            ))}
          </div>
        )}
      </Section>

      {detail.topFeatures.length > 0 && (
        <Section title="The fifteen columns the trees used most" question="Mean share of split gain per column, over quarters and heads.">
          <ResponsiveContainer width="100%" height={Math.max(220, 20 * detail.topFeatures.length)}>
            <BarChart data={detail.topFeatures} layout="vertical" margin={{ top: 4, right: 52, left: 4, bottom: 4 }}>
              <CartesianGrid {...GRID} horizontal={false} />
              <XAxis type="number" {...AXIS} tickFormatter={(value: number) => fmt(value, 3)} />
              <YAxis type="category" dataKey="feature" width={230} {...AXIS} interval={0} />
              <Tooltip {...TOOLTIP} formatter={(value: number) => [fmt(value, 4), "mean share of split gain"]} />
              <Bar dataKey="mean_gain_share" fill={OKABE.sky} isAnimationActive={false}>
                <LabelList dataKey="mean_gain_share" position="right" formatter={(value: number) => fmt(value, 3)} fill="#ccc" fontSize={9} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Section>
      )}

      {detail.ablationRows.length > 0 && (
        <Section title="Every numeric column of the ablation record" question={`${fmtInt(detail.ablationRows.length)} rows (quarter × head × block).`}>
          <ColumnGrid rows={detail.ablationRows} title="Ablation columns" />
        </Section>
      )}
      {detail.gainShareSample.length > 0 && (
        <Section title="The split-gain column" question={`${fmtInt(detail.gainShareSample.length)} of the trees' per-column gain shares (every k-th by a hash of its own key).`}>
          <ColumnGrid rows={detail.gainShareSample} title="Gain share" />
        </Section>
      )}
    </div>
  );
}
