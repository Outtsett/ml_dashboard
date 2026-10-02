/**
 * Section A: what each representation of the vocabulary is worth on forward
 * realized volatility, alone and added to HAR-RV.
 */

import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SegmentControl, SelectControl, SliderControl, Stat, TOOLTIP,
  fmt, fmtInt, useStudyControls,
} from "@/studies/kit";
import {
  REPRESENTATION_LABELS, addedToHar, bestAddition, bitsKept, harBaseline, nonBaselineRows, type SequenceResultRow,
} from "@shared/studies/candle-vocabulary";
import { SortableTable, type TableColumn } from "./SortableTable";

function configKey(row: SequenceResultRow): string {
  return `${row.symbol} ${row.timeframe} · K=${row.code_count} · width ${row.width_bars} · horizon ${row.horizon_bars}`;
}

function signed(value: number | null | undefined, decimals = 4): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(decimals)}`;
}

/** Hatched blue for shape only, solid orange with magnitude: the two series differ by pattern as well as hue. */
function Patterns({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={`${id}-shape`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <rect width="6" height="6" fill={OKABE.blue} fillOpacity={0.22} />
        <line x1="0" y1="0" x2="0" y2="6" stroke={OKABE.blue} strokeWidth="3" />
      </pattern>
    </defs>
  );
}

function labelOf(value: unknown, decimals: number, withSign: boolean): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return withSign ? signed(value, decimals) : value.toFixed(decimals);
}

export function SequenceSection({ rows }: { rows: readonly SequenceResultRow[] }) {
  const [controls, set, reset] = useStudyControls({ run: "", channels: "both", formulaRow: "best", codeCount: 0 });
  const configs = [...new Set(rows.map(configKey))];
  const config = configs.includes(controls.run) ? controls.run : (configs[0] ?? "");
  const inRun = rows.filter((row) => configKey(row) === config);
  const showShape = controls.channels !== "magnitude";
  const showMagnitude = controls.channels !== "shape";

  const best = bestAddition(inRun);
  const representations = [...new Set(nonBaselineRows(inRun).map((row) => row.representation))];
  const chartData = representations.map((representation) => {
    const pick = (magnitude: boolean) => inRun.find((row) => row.representation === representation && row.with_magnitude_channels === magnitude);
    return {
      name: REPRESENTATION_LABELS[representation]?.short ?? representation,
      aloneShape: pick(false)?.out_of_sample_r_squared ?? null,
      aloneMagnitude: pick(true)?.out_of_sample_r_squared ?? null,
      addedShape: pick(false)?.added_to_har_r_squared ?? null,
      addedMagnitude: pick(true)?.added_to_har_r_squared ?? null,
    };
  });
  const shapeOnlyAdded = nonBaselineRows(inRun).filter((row) => !row.with_magnitude_channels && row.added_to_har_r_squared !== null).map((row) => row.added_to_har_r_squared as number);
  const shapeOnlyRange = shapeOnlyAdded.length > 0 ? `${signed(Math.min(...shapeOnlyAdded))} to ${signed(Math.max(...shapeOnlyAdded))}` : "no shape-only run";
  const harRunName = inRun[0]?.run_name ?? "";
  const harAlone = harBaseline(inRun, harRunName);

  const formulaChoices = nonBaselineRows(inRun);
  const formulaRow = controls.formulaRow === "best"
    ? best
    : (formulaChoices.find((row) => `${row.representation}|${row.with_magnitude_channels ? 1 : 0}` === controls.formulaRow) ?? best);
  const formulaHar = formulaRow ? harBaseline(inRun, formulaRow.run_name) : null;
  const storedK = best?.code_count ?? 24;
  const formulaK = controls.codeCount > 0 ? controls.codeCount : storedK;
  const recomputedFor = formulaRow ? (addedToHar(inRun).find((entry) => entry.row === formulaRow)?.added ?? null) : null;

  const columns: Array<TableColumn<SequenceResultRow>> = [
    { key: "representation", label: "representation", render: (row) => REPRESENTATION_LABELS[row.representation]?.short ?? row.representation, value: (row) => row.representation, hint: "stored as har, code_rand, code_book, latent_z" },
    { key: "magnitude", label: "channels", render: (row) => (row.with_magnitude_channels ? `▲ shape + magnitude (${row.channel_count})` : `△ shape only (${row.channel_count})`), value: (row) => Number(row.with_magnitude_channels) },
    { key: "alone", label: "R² alone", align: "right", render: (row) => signed(row.out_of_sample_r_squared), value: (row) => row.out_of_sample_r_squared, hint: "out-of-sample R² of the representation by itself, on log forward realized volatility" },
    { key: "plus", label: "R² with HAR-RV", align: "right", render: (row) => signed(row.har_plus_r_squared), value: (row) => row.har_plus_r_squared },
    { key: "added", label: "added to HAR-RV", align: "right", render: (row) => signed(row.added_to_har_r_squared), value: (row) => row.added_to_har_r_squared, hint: "R² with HAR-RV minus the HAR-RV row's own R² in the same run" },
    { key: "perplexity", label: "perplexity", align: "right", render: (row) => fmt(row.codebook_perplexity, 2), value: (row) => row.codebook_perplexity, hint: "effective number of codes in use, of K" },
  ];

  return (
    <Section title="A. Does the vocabulary add anything to HAR-RV?" question="Forward log realized volatility, held-out R². Alone, and added on top of the HAR-RV baseline.">
      <div className="space-y-3">
        <ControlBar onReset={reset}>
          <SelectControl
            label="Run"
            value={config}
            options={configs.map((value) => ({ value, label: value }))}
            onChange={(v) => set("run", v)}
            hint="The notebook kept only the first file per (model, scale); every stored run is selectable here"
          />
          <SegmentControl
            label="Channels"
            value={controls.channels}
            options={[{ value: "both", label: "both" }, { value: "shape", label: "△ shape only" }, { value: "magnitude", label: "▲ with magnitude" }]}
            onChange={(v) => set("channels", v)}
            hint="Shape only: five channels, each divided by the bar's own range. With magnitude: plus two causal z-scores of log range and log volume"
          />
        </ControlBar>

        <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
          <Stat label="HAR-RV alone" value={signed(harAlone)} hint="Out-of-sample R² of the HAR-RV baseline" />
          <Stat
            label="Best added to HAR-RV"
            value={best ? signed(best.added_to_har_r_squared) : "—"}
            tone={best && (best.added_to_har_r_squared ?? 0) > 0 ? OKABE.orange : OKABE.blue}
            hint={best ? `${REPRESENTATION_LABELS[best.representation]?.short}, ${best.with_magnitude_channels ? "with magnitude" : "shape only"}` : undefined}
          />
          <Stat label="Bits kept by K symbols" value={fmt(bitsKept(storedK), 2)} hint="log2 K" />
          <Stat label="Codes used" value={best ? `${fmtInt(best.codes_used_count)} of ${fmtInt(best.code_count)}` : "—"} hint={best ? `perplexity ${fmt(best.codebook_perplexity, 1)}` : undefined} />
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-1 text-[11px] text-neutral-400">Each representation ALONE (dashed: HAR-RV alone)</p>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} margin={{ top: 16, right: 8, left: 0, bottom: 4 }}>
                <Patterns id="alone" />
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="name" {...AXIS} interval={0} />
                <YAxis {...AXIS} domain={["auto", "auto"]} />
                <Tooltip {...TOOLTIP} formatter={(value, name) => [signed(Number(value)), String(name)]} />
                <ReferenceLine y={0} stroke={OKABE.grey} />
                {harAlone !== null && (
                  <ReferenceLine y={harAlone} stroke={OKABE.purple} strokeDasharray="5 3" label={{ value: `HAR-RV ${harAlone.toFixed(3)}`, fill: OKABE.purple, fontSize: 10, position: "insideTopRight" }} />
                )}
                {showShape && (
                  <Bar dataKey="aloneShape" name="△ shape only" fill="url(#alone-shape)" stroke={OKABE.blue} isAnimationActive={false}>
                    <LabelList dataKey="aloneShape" position="top" fontSize={9} fill={OKABE.blue} formatter={(v: unknown) => labelOf(v, 3, false)} />
                  </Bar>
                )}
                {showMagnitude && (
                  <Bar dataKey="aloneMagnitude" name="▲ with magnitude" fill={OKABE.orange} isAnimationActive={false}>
                    <LabelList dataKey="aloneMagnitude" position="top" fontSize={9} fill={OKABE.orange} formatter={(v: unknown) => labelOf(v, 3, false)} />
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[11px] text-neutral-400">What it ADDS on top of HAR-RV (R² with HAR-RV minus HAR-RV alone)</p>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} margin={{ top: 16, right: 8, left: 0, bottom: 4 }}>
                <Patterns id="added" />
                <CartesianGrid {...GRID} vertical={false} />
                <XAxis dataKey="name" {...AXIS} interval={0} />
                <YAxis {...AXIS} domain={["auto", "auto"]} />
                <Tooltip {...TOOLTIP} formatter={(value, name) => [signed(Number(value)), String(name)]} />
                <ReferenceLine y={0} stroke={OKABE.grey} />
                {showShape && (
                  <Bar dataKey="addedShape" name="△ shape only" fill="url(#added-shape)" stroke={OKABE.blue} isAnimationActive={false}>
                    <LabelList dataKey="addedShape" position="top" fontSize={9} fill={OKABE.blue} formatter={(v: unknown) => labelOf(v, 4, true)} />
                  </Bar>
                )}
                {showMagnitude && (
                  <Bar dataKey="addedMagnitude" name="▲ with magnitude" fill={OKABE.orange} isAnimationActive={false}>
                    <LabelList dataKey="addedMagnitude" position="top" fontSize={9} fill={OKABE.orange} formatter={(v: unknown) => labelOf(v, 4, true)} />
                  </Bar>
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <p className="text-[11px] text-neutral-400">
          <span style={{ color: OKABE.blue }}>△ hatched: shape only</span> · <span style={{ color: OKABE.orange }}>▲ solid: with magnitude</span>
        </p>

        {best ? (
          <Finding>
            Best so far: <strong>{REPRESENTATION_LABELS[best.representation]?.short}</strong> {best.with_magnitude_channels ? "with magnitude" : "shape only"} at{" "}
            <strong>{signed(best.added_to_har_r_squared)} R²</strong> over HAR-RV. Only the second chart decides whether the vocabulary is worth anything: a representation can be far weaker alone and still carry
            something the baseline does not have. Shape only adds nothing measurable ({shapeOnlyRange}) because the candle geometry divides each channel by the bar&apos;s own range, which makes an archetype
            comparable across price levels and deletes size entirely, so a pure-shape dictionary cannot express a magnitude target however it is embedded. Once the log range and log volume z-scores come back the
            order is code with random embedding &lt; code with codebook embedding &lt; continuous latent: rounding a window to one of K symbols keeps about {fmt(bitsKept(best.code_count), 1)} bits of what was a full
            float window, initialising the embedding from the fitted codebook recovers part of it, and skipping quantisation recovers more.
          </Finding>
        ) : (
          <Finding>No non-baseline rows for this run.</Finding>
        )}

        <SortableTable rows={inRun} columns={columns} rowKey={(row) => `${row.run_name}|${row.representation}`} highlight={(row) => row === best} />

        <div className="grid gap-3 xl:grid-cols-2">
          <div className="min-w-0 space-y-2">
            <ControlBar>
              <SelectControl
                label="Show the formula for"
                value={controls.formulaRow}
                options={[
                  { value: "best", label: "the best addition" },
                  ...formulaChoices.map((row) => ({
                    value: `${row.representation}|${row.with_magnitude_channels ? 1 : 0}`,
                    label: `${REPRESENTATION_LABELS[row.representation]?.short} · ${row.with_magnitude_channels ? "▲ magnitude" : "△ shape"}`,
                  })),
                ]}
                onChange={(v) => set("formulaRow", v)}
              />
            </ControlBar>
            <FormulaCard
              tex={"\\Delta R^2_X \\;=\\; R^2\\!\\left(\\text{HAR-RV} + X\\right) \\;-\\; R^2\\!\\left(\\text{HAR-RV}\\right)"}
              caption={
                formulaRow
                  ? `${REPRESENTATION_LABELS[formulaRow.representation]?.long}. Recomputed from the two stored R² values: ${signed(recomputedFor)}; stored column: ${signed(formulaRow.added_to_har_r_squared)}.`
                  : undefined
              }
              symbols={[
                { tex: "X", name: "the candle representation being tested", value: formulaRow ? (REPRESENTATION_LABELS[formulaRow.representation]?.short ?? formulaRow.representation) : "—" },
                { tex: "R^2(\\text{HAR-RV}+X)", name: "held-out R² of HAR-RV with X added to its regressors", value: signed(formulaRow?.har_plus_r_squared) },
                { tex: "R^2(\\text{HAR-RV})", name: "held-out R² of the HAR-RV baseline alone, same run", value: signed(formulaHar) },
                { tex: "\\Delta R^2_X", name: "what X adds: the only column that decides whether the vocabulary is worth anything", value: signed(recomputedFor) },
              ]}
            />
          </div>
          <div className="min-w-0 space-y-2">
            <ControlBar>
              <SliderControl
                label="Codes K"
                value={formulaK}
                min={2}
                max={512}
                step={1}
                onChange={(v) => set("codeCount", v)}
                hint="Drag K to see the bits a window keeps after rounding to one symbol. The stored runs use K = 24"
              />
            </ControlBar>
            <FormulaCard
              tex={"\\text{bits kept} \\;=\\; \\log_2 K"}
              caption={`Quantising a window to one of K symbols keeps log₂ K bits. ${formulaK === storedK ? "This is the stored vocabulary." : `The stored vocabulary has K = ${storedK}.`}`}
              symbols={[
                { tex: "K", name: "number of symbols (codes) in the vocabulary", value: String(formulaK) },
                { tex: "\\log_2 K", name: "bits that survive rounding a window to one symbol", value: fmt(bitsKept(formulaK), 3) },
                { tex: "C\\times W", name: "numbers in the window that was rounded (channels × bars)", value: best ? `${best.channel_count} × ${best.width_bars} = ${best.channel_count * best.width_bars}` : "—" },
              ]}
            />
          </div>
        </div>
      </div>
    </Section>
  );
}
