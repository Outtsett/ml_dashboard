/**
 * AttributionPanel — V6: which kinds of information drive the model's calls?
 * Family bars, per-feature ranked bars, a stacked signed contribution-over-time
 * area chart, and a beeswarm of the top features colored by feature value.
 */

import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { DATA_COLORS } from "@/shared/theme/dataColors";
import type { LensAttribution } from "@shared/lens/types";
import { LensFrame } from "../Frame";
import { CaptionRow, SectionHeading } from "./common";
import {
  FAMILY_COLORS,
  FAMILY_ORDER,
  familyLabel,
  formatInt,
  formatNumber,
  formatPercent,
  formatTimestamp,
  formatTimestampShort,
  LENS_CHART_AXIS,
  LENS_CHART_GRID,
  LENS_CHART_TOOLTIP_STYLE,
  sequentialColor,
} from "./format";

export interface AttributionPanelProps {
  attribution: LensAttribution;
}

export function AttributionPanel({ attribution }: AttributionPanelProps) {
  if (!attribution.available) {
    return (
      <LensFrame
        title="Attribution"
        question="Which kinds of information drive the model's calls?"
        unavailableReason={attribution.reason ?? "no attribution artifact for this model"}
        testId="lens-attribution"
      />
    );
  }

  const familyData = FAMILY_ORDER.map((family) => {
    const found = attribution.families.find((f) => f.family === family);
    return {
      family,
      label: familyLabel(family),
      meanAbsoluteShap: found?.meanAbsoluteShap ?? 0,
      share: found?.share ?? 0,
      featureCount: found?.featureCount ?? 0,
    };
  });

  const topFeatures = attribution.features.slice(0, 15);
  const timelineData = attribution.timeline.map((point) => ({
    ts: point.timestampSeconds,
    ...point.contributions,
  }));
  const beeswarmFeatures = attribution.beeswarm.slice(0, 8);
  // Some artifacts store contributions without the values they were computed
  // from. Colouring by a value that does not exist, and captioning it, would
  // show information the model never gave us.
  const hasFeatureValues = beeswarmFeatures.some((entry) =>
    entry.points.some((point) => Number.isFinite(point.featureValue)),
  );

  const basis = `${formatInt(attribution.features.length)} features across ${familyData.filter((f) => f.featureCount > 0).length} families · method: mean |SHAP| in log-odds of up · ${attribution.timeline.length ? `${formatInt(attribution.timeline.length)} timeline steps` : "no timeline"}`;

  return (
    <LensFrame
      resizeKey="attribution"
      defaultHeight={620}
      title="Attribution"
      question="Which kinds of information drive the model's calls?"
      basis={basis}
      testId="lens-attribution"
    >
      <div className="flex flex-col gap-4">
        <div>
          <SectionHeading>Mean |SHAP| by feature family</SectionHeading>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={familyData} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid {...LENS_CHART_GRID} horizontal={false} />
              <XAxis type="number" tickFormatter={(v: number) => formatNumber(v, 3)} {...LENS_CHART_AXIS} />
              <YAxis type="category" dataKey="label" {...LENS_CHART_AXIS} width={90} />
              <Tooltip
                {...LENS_CHART_TOOLTIP_STYLE}
                formatter={(value: number, _name, entry) => {
                  const p = entry?.payload as { featureCount: number; share: number } | undefined;
                  return [
                    `${formatNumber(value, 4)} · ${p ? formatPercent(p.share) : ""} share · ${p ? p.featureCount : "?"} features`,
                    "mean |SHAP|",
                  ];
                }}
              />
              <Bar dataKey="meanAbsoluteShap" isAnimationActive={false}>
                {familyData.map((f) => (
                  <Cell key={f.family} fill={FAMILY_COLORS[f.family]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {familyData
            .filter((f) => f.featureCount === 0)
            .map((f) => (
              <p key={f.family} className="text-[11px] text-muted-foreground">
                {f.label}: 0 features in this model.
              </p>
            ))}
        </div>

        <div>
          <SectionHeading>Top features (ranked by mean |SHAP|, colored by family)</SectionHeading>
          <ResponsiveContainer width="100%" height={Math.max(120, topFeatures.length * 22)}>
            <BarChart data={topFeatures} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
              <CartesianGrid {...LENS_CHART_GRID} horizontal={false} />
              <XAxis type="number" tickFormatter={(v: number) => formatNumber(v, 3)} {...LENS_CHART_AXIS} />
              <YAxis type="category" dataKey="name" {...LENS_CHART_AXIS} width={140} tick={{ fontSize: 10 }} />
              <Tooltip
                {...LENS_CHART_TOOLTIP_STYLE}
                formatter={(value: number, _name, entry) => {
                  const p = entry?.payload as { family: string; rank: number } | undefined;
                  return [`${formatNumber(value, 4)} · ${p ? familyLabelSafe(p.family) : ""} · rank ${p?.rank ?? "?"}`, "mean |SHAP|"];
                }}
              />
              <Bar dataKey="meanAbsoluteShap" isAnimationActive={false}>
                {topFeatures.map((f) => (
                  <Cell key={f.name} fill={FAMILY_COLORS[f.family]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="mt-1 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            {FAMILY_ORDER.map((family) => (
              <span key={family} className="flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: FAMILY_COLORS[family] }} />
                {familyLabel(family)}
              </span>
            ))}
          </p>
        </div>

        <div>
          <SectionHeading>Signed family contribution over time (log-odds of up)</SectionHeading>
          {timelineData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={timelineData} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                <CartesianGrid {...LENS_CHART_GRID} />
                <XAxis dataKey="ts" tickFormatter={formatTimestampShort} {...LENS_CHART_AXIS} minTickGap={40} />
                <YAxis tickFormatter={(v: number) => formatNumber(v, 2)} {...LENS_CHART_AXIS} width={44} />
                <Tooltip
                  {...LENS_CHART_TOOLTIP_STYLE}
                  labelFormatter={(ts: number) => formatTimestamp(ts)}
                  formatter={(value: number, name: string) => [formatNumber(value, 4), familyLabelSafe(name)]}
                />
                {FAMILY_ORDER.map((family) => (
                  <Area
                    key={family}
                    type="monotone"
                    dataKey={family}
                    stackId="contrib"
                    stroke={FAMILY_COLORS[family]}
                    fill={FAMILY_COLORS[family]}
                    fillOpacity={0.55}
                    isAnimationActive={false}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <CaptionRow>No timeline points were produced for this record.</CaptionRow>
          )}
        </div>

        <div>
          <SectionHeading>
            {hasFeatureValues
              ? "Beeswarm — top features (x = SHAP, color = feature value, low → high)"
              : "Beeswarm — top features (x = SHAP)"}
          </SectionHeading>
          {beeswarmFeatures.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={Math.max(140, beeswarmFeatures.length * 34)}>
                <ScatterChart margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
                  <CartesianGrid {...LENS_CHART_GRID} />
                  <XAxis type="number" dataKey="shap" tickFormatter={(v: number) => formatNumber(v, 2)} {...LENS_CHART_AXIS} name="SHAP" />
                  <YAxis
                    type="category"
                    dataKey="feature"
                    allowDuplicatedCategory={false}
                    {...LENS_CHART_AXIS}
                    width={140}
                    tick={{ fontSize: 10 }}
                  />
                  <ZAxis range={[14, 14]} />
                  <Tooltip {...LENS_CHART_TOOLTIP_STYLE} formatter={(value: number, name: string) => [formatNumber(value, 4), name === "shap" ? "SHAP" : "feature value"]} />
                  {beeswarmFeatures.map((entry) => {
                    const values = entry.points
                      .map((p) => p.featureValue)
                      .filter((v): v is number => v !== null && Number.isFinite(v));
                    const lo = values.length ? Math.min(...values) : 0;
                    const hi = values.length ? Math.max(...values) : 1;
                    const span = hi - lo || 1;
                    return (
                      <Scatter
                        key={entry.feature}
                        data={entry.points.map((p, i) => ({
                          feature: entry.feature,
                          shap: p.shap,
                          featureValue: p.featureValue,
                          jitter: ((i % 7) - 3) * 0.06,
                          t: p.featureValue !== null ? (p.featureValue - lo) / span : null,
                        }))}
                        isAnimationActive={false}
                      >
                        {entry.points.map((p, i) => (
                          <Cell
                            key={i}
                            // No value behind this contribution: draw it in the
                            // neutral ink rather than mid-scale, which would read
                            // as a measured middling value.
                            fill={p.featureValue !== null ? sequentialColor((p.featureValue - lo) / span) : DATA_COLORS.neutral}
                            fillOpacity={0.75}
                          />
                        ))}
                      </Scatter>
                    );
                  })}
                </ScatterChart>
              </ResponsiveContainer>
              {hasFeatureValues ? (
                <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>feature value:</span>
                  <span
                    className="h-2 w-24 rounded"
                    style={{ background: `linear-gradient(90deg, ${sequentialColor(0)}, ${sequentialColor(0.5)}, ${sequentialColor(1)})` }}
                  />
                  <span>low → high</span>
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Each point is one bar&apos;s contribution. This model&apos;s artifact stores contributions without the
                  feature values they were computed from, so the points carry no value colouring.
                </p>
              )}
            </>
          ) : (
            <CaptionRow>No beeswarm sample was produced for this record.</CaptionRow>
          )}
        </div>
      </div>
    </LensFrame>
  );
}

function familyLabelSafe(name: string): string {
  return FAMILY_ORDER.includes(name as (typeof FAMILY_ORDER)[number]) ? familyLabel(name as (typeof FAMILY_ORDER)[number]) : name;
}
