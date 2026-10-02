/**
 * Section 5: inside the network. Every leaf module in the order the tensor
 * moves through it: how wide its output is, how much of it sits at exactly
 * zero, how much gradient reached back. Read the columns together: healthy
 * activations with a vanishing gradient is a layer learning nothing. The
 * gradient axis is symmetric-log (log(1 + g)) so a layer at 1e-4 and one at
 * 1 are both visible; bars and tooltips carry the real numbers. Below, the
 * real 32 x 32 slice of any layer's activations.
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, ColumnGrid, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SelectControl, SliderControl, StudyState, TOOLTIP, fmt, fmtInt, fmtPercent } from "@/studies/kit";
import { COLLAPSED_BELOW, layerHealth, nearestEpoch, type ActivationsBody, type LayerReadingRow } from "@shared/studies/training-environment";
import { CanvasHeatmap } from "./CanvasHeatmap";
import { usePart, type SetControl, type TrainingControls } from "./shared";

const ROW = 18;

function names(rows: readonly LayerReadingRow[]): string {
  return rows.slice(0, 4).map((row) => row.layer_name).join(", ");
}

export function NetworkSection({ layers, controls, set }: { layers: readonly LayerReadingRow[]; controls: TrainingControls; set: SetControl }) {
  const epochs = [...new Set(layers.map((row) => row.epoch))].sort((a, b) => a - b);
  const newest = epochs[epochs.length - 1] ?? 0;
  const wanted = controls.layerEpoch > 0 ? controls.layerEpoch : newest;
  const epoch = nearestEpoch(epochs, wanted);
  const readings = layers.filter((row) => row.epoch === epoch).sort((a, b) => a.layer_order - b.layer_order);
  const layerNames = readings.map((row) => row.layer_name);
  const activationLayer = layerNames.includes(controls.activationLayer) ? controls.activationLayer : (layerNames[0] ?? "");
  const activations = usePart<ActivationsBody>("activations", controls, { epoch: epoch ?? 0, layer: activationLayer });
  const slice = activations.data?.data;

  if (readings.length === 0) {
    return (
      <Section title="5 · Inside the network" question="What came out of each layer, how much is dead, and how much gradient reached back.">
        <p className="py-4 text-xs text-neutral-400">No layer capture in this run — rerun it to record one.</p>
      </Section>
    );
  }

  const health = layerHealth(readings);
  const chartRows = readings.map((row) => ({
    ...row,
    gradient_axis: Math.log1p(Math.max(0, row.gradient_norm)),
    zero_percent: (row.zero_fraction ?? 0) * 100,
  }));
  const height = ROW * readings.length + 40;
  const common = { layout: "vertical" as const, data: chartRows, margin: { top: 4, right: 14, left: 4, bottom: 18 }, barCategoryGap: 2 };
  const parameterised = readings.filter((row) => row.parameter_count > 0).length;

  return (
    <Section title="5 · Inside the network" question="Every leaf module, in the order the tensor actually moves through it. Read the columns together: healthy activations with a vanishing gradient is a layer learning nothing.">
      <div className="space-y-3">
        <ControlBar>
          <SliderControl
            label="Layer capture at epoch"
            value={epoch ?? wanted}
            min={Math.min(...epochs)}
            max={Math.max(...epochs)}
            onChange={(value) => set("layerEpoch", value)}
            format={(value) => `epoch ${fmtInt(value)}`}
            hint={`Captured epochs: ${epochs.join(", ")}. A value between captures shows the nearest.`}
          />
        </ControlBar>
        <Finding>
          {fmtInt(readings.length)} layers captured at epoch {fmtInt(epoch)}.{" "}
          {health.starved.length > 0 && <strong>{health.starved.length} layer(s) with parameters took no gradient — {names(health.starved)}. </strong>}
          {health.collapsed.length > 0 && <strong>{health.collapsed.length} layer(s) output almost no variation — {names(health.collapsed)}. </strong>}
          {health.starved.length === 0 && health.collapsed.length === 0 && "Every layer with parameters is taking gradient, and no layer's output has collapsed to a constant."}
        </Finding>

        <div className="grid gap-2 md:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={height}>
              <BarChart {...common}>
                <CartesianGrid {...GRID} horizontal={false} />
                <XAxis type="number" {...AXIS} label={{ value: "output standard deviation", position: "insideBottom", offset: -8, fill: "#8a8a8a", fontSize: 10 }} />
                <YAxis type="category" dataKey="layer_name" width={200} interval={0} tick={{ fontSize: 9, fill: "#a3a3a3" }} />
                <Tooltip
                  {...TOOLTIP}
                  formatter={(value: number) => [fmt(value, 5), "output standard deviation"]}
                  labelFormatter={(label, payload) => {
                    const row = payload?.[0]?.payload as LayerReadingRow | undefined;
                    return row ? `${label} · ${row.module_type} ${row.output_shape} · mean ${fmt(row.mean, 4)} · min ${fmt(row.minimum, 3)} · max ${fmt(row.maximum, 3)}` : String(label);
                  }}
                />
                <Bar dataKey="standard_deviation" fill={OKABE.blue} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={height}>
              <BarChart {...common}>
                <CartesianGrid {...GRID} horizontal={false} />
                <XAxis type="number" {...AXIS} tickFormatter={(value: number) => `${value}%`} label={{ value: "outputs at exactly zero", position: "insideBottom", offset: -8, fill: "#8a8a8a", fontSize: 10 }} />
                <YAxis type="category" dataKey="layer_name" hide />
                <Tooltip {...TOOLTIP} formatter={(value: number) => [`${value.toFixed(3)}%`, "dead units"]} labelFormatter={(label, payload) => `${label} · saturated ${fmtPercent((payload?.[0]?.payload as LayerReadingRow | undefined)?.saturated_fraction, 3)}`} />
                <Bar dataKey="zero_percent" fill={OKABE.grey} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="min-w-0">
            <ResponsiveContainer width="100%" height={height}>
              <BarChart {...common}>
                <CartesianGrid {...GRID} horizontal={false} />
                <XAxis type="number" {...AXIS} tickFormatter={(value: number) => fmt(Math.expm1(value), 3)} label={{ value: "gradient norm (symlog)", position: "insideBottom", offset: -8, fill: "#8a8a8a", fontSize: 10 }} />
                <YAxis type="category" dataKey="layer_name" hide />
                <Tooltip {...TOOLTIP} formatter={(_value: number, _name, item) => [fmt((item.payload as LayerReadingRow).gradient_norm, 6), "gradient norm"]} labelFormatter={(label, payload) => `${label} · ${fmtInt((payload?.[0]?.payload as LayerReadingRow | undefined)?.parameter_count)} parameters`} />
                <Bar dataKey="gradient_axis" fill={OKABE.orange} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <ColumnGrid rows={readings} exclude={["epoch", "layer_order"]} title={`Every numeric column of the layer readings at epoch ${epoch}`} />

        <FormulaCard
          tex={String.raw`\text{starved}_\ell:\ |P_\ell|>0\ \wedge\ \lVert\nabla_\ell\rVert\le 0,\qquad \text{collapsed}_\ell:\ \mathrm{sd}(y_\ell)<10^{-4},\qquad d_\ell=\frac{\#\{y_\ell=0\}}{|y_\ell|}`}
          symbols={[
            { tex: "\\ell", name: "a leaf module, in forward order", value: `${fmtInt(readings.length)} layers` },
            { tex: "|P_\\ell|", name: "number of parameters the layer owns", value: `${fmtInt(parameterised)} layers have some` },
            { tex: "\\lVert\\nabla_\\ell\\rVert", name: "gradient norm that reached the layer's parameters", value: `${fmtInt(health.starved.length)} starved` },
            { tex: "y_\\ell", name: "the layer's output tensor on the captured batch", value: "shape in the tooltip" },
            { tex: "\\mathrm{sd}(y_\\ell)", name: "standard deviation of that output", value: `${fmtInt(health.collapsed.length)} below ${COLLAPSED_BELOW}` },
            { tex: "d_\\ell", name: "share of outputs at exactly zero: dead units", value: `largest ${fmtPercent(Math.max(...readings.map((row) => row.zero_fraction ?? 0)), 2)}` },
          ]}
        />

        <ControlBar>
          <SelectControl label="Look at the actual activations of" value={activationLayer} options={layerNames.map((name) => ({ value: name, label: name }))} onChange={(value) => set("activationLayer", value)} />
        </ControlBar>
        <StudyState isLoading={activations.isLoading} error={activations.error}>
          {slice && slice.values.length > 0 ? (
            <>
              <Finding>
                {slice.layer}: a {slice.values.length} x {slice.values[0]?.length ?? 0} slice of the real activations at epoch {fmtInt(slice.epoch)}. A vertical stripe is a unit that does the same thing whatever the input — it has stopped carrying information. A row that is flat across every unit is an input the layer cannot tell apart from any other.
              </Finding>
              <CanvasHeatmap
                matrix={slice.values}
                rowLabels={slice.values.map((_, index) => `row ${index}`)}
                scale="shared"
                rowHeight={Math.min(14, Math.max(6, Math.floor(420 / slice.values.length)))}
                valueName="activation"
                showRowLabels={false}
                columnLabel={(column) => `unit ${column}`}
              />
            </>
          ) : (
            <p className="text-xs text-neutral-400">No activation slice stored for {activationLayer}.</p>
          )}
        </StudyState>
      </div>
    </Section>
  );
}
