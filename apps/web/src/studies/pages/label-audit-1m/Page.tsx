/**
 * Label audit, MNQ 1m. The horizon, flat threshold, bucket scheme, histogram,
 * zero-range policy and shift are server controls (live SQL over the stored
 * labels); the smoothing factor, the walk-through bar, the probe and the
 * swing configuration are browser controls over the returned body.
 */

import { ColumnGrid, Empty, OKABE, Section, SegmentControl, Stat, StudyNotes, StudyState, fmt, fmtInt, fmtPercent, useStudyControls, useStudyQuery, ControlBar } from "@/studies/kit";
import type { LabelAuditBody } from "@shared/studies/label-audit-1m";
import { DirectionSection } from "./DirectionSection";
import { RangeSection } from "./RangeSection";
import { CausalitySection, FindingsSection, InventorySection, ProvenanceSection } from "./RecordSections";
import { BarrierSection, SwingSection } from "./SweepSection";
import { VolatilitySection } from "./VolatilitySection";

const FRAMES = [
  { value: "horizons", label: "direction by horizon" },
  { value: "years", label: "direction by year" },
  { value: "flat", label: "flat dead zone" },
  { value: "range", label: "range buckets" },
  { value: "baselines", label: "persistence baselines" },
  { value: "barrier", label: "barrier sweep" },
  { value: "swing", label: "swing sweep" },
] as const;

function frameRows(body: LabelAuditBody, frame: string): Array<Record<string, unknown>> {
  switch (frame) {
    case "years": return body.direction.years as unknown as Array<Record<string, unknown>>;
    case "flat": return body.direction.flatCurve as unknown as Array<Record<string, unknown>>;
    case "range": return body.range.occupancy as unknown as Array<Record<string, unknown>>;
    case "baselines": return body.volatility.baselines as unknown as Array<Record<string, unknown>>;
    case "barrier": return body.barrier as unknown as Array<Record<string, unknown>>;
    case "swing": return body.swing as unknown as Array<Record<string, unknown>>;
    default: return body.direction.horizons as unknown as Array<Record<string, unknown>>;
  }
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    horizon: 1440,
    flatThreshold: 0,
    bucketSize: 2,
    bucketCount: 21,
    bins: 120,
    cutoff: -5,
    policy: "floored",
    shiftBars: 7,
    smoothing: "0.9",
    sampleStep: 60,
    probe: 1.75,
    swingPick: 2,
    frame: "horizons",
  });
  const query = useStudyQuery<LabelAuditBody>("label-audit-1m", {
    horizon: controls.horizon,
    flatThreshold: controls.flatThreshold,
    bucketSize: controls.bucketSize,
    bucketCount: controls.bucketCount,
    bins: controls.bins,
    cutoff: controls.cutoff,
    policy: controls.policy,
    shiftBars: controls.shiftBars,
  });
  const body = query.data?.data;
  const direction = body?.direction.horizons ?? [];
  const oneBar = direction.find((row) => row.horizon_bars === 1);
  const oneDay = direction.find((row) => row.horizon_bars === 1440);
  const shippedBarrier = body?.barrier.find((row) => row.is_shipped_default_before_fix);
  const summary = body?.volatility.summary;

  return (
    <div className="min-w-0 space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {body && !body.labelsServed && !body.recordServed ? (
          <Empty>Neither mnq_labels_1m nor the landed study tables are served. Run packages/ml-engine/src/studies/label_audit_1m/build.py, then refresh the derived views.</Empty>
        ) : body ? (
          <>
            <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
              <Stat label="Majority baseline at H = 1 · H = 1440" value={`${fmt(oneBar?.majority_baseline, 4)} ▼ · ${fmt(oneDay?.majority_baseline, 4)} ▲`} hint="Down is the majority one bar ahead, up is the majority one day ahead" />
              <Stat label="Range centre bucket (2.0 pts)" value={fmtPercent(body.range.pinned.find((row) => row.bucket_index === 10)?.share, 1)} hint="Free accuracy from the centre bucket alone, pinned scheme" />
              <Stat label="Barrier timeout at the shipped clock" value={fmtPercent(shippedBarrier?.vertical_timeout_share, 2)} tone={OKABE.blue} hint="1.5 ATR, 60 bars: the third class is dead" />
              <Stat label="Floor's cost to the persistence R²" value={summary ? `${fmt(summary.best_floored_r_squared, 4)} → ${fmt(summary.best_masked_r_squared, 4)}` : "—"} tone={OKABE.orange} hint={summary ? `${fmtInt(summary.zero_range_bar_count)} zero-range bars floored vs masked` : undefined} />
            </div>

            <ControlBar onReset={reset}>
              <span className="self-center text-[11px] text-neutral-400">Every control is in the link; Reset returns the notebook's pinned parameters.</span>
            </ControlBar>

            <ProvenanceSection body={body} />
            <InventorySection rows={body.inventory} />
            <DirectionSection
              direction={body.direction}
              horizon={controls.horizon}
              onHorizon={(value) => set("horizon", value)}
              flatThreshold={controls.flatThreshold}
              onFlatThreshold={(value) => set("flatThreshold", value)}
            />
            <VolatilitySection
              volatility={body.volatility}
              controls={{ policy: controls.policy, cutoff: controls.cutoff, bins: controls.bins, smoothing: controls.smoothing, sampleStep: controls.sampleStep }}
              set={{
                policy: (value) => set("policy", value),
                cutoff: (value) => set("cutoff", value),
                bins: (value) => set("bins", value),
                smoothing: (value) => set("smoothing", value),
                sampleStep: (value) => set("sampleStep", value),
              }}
            />
            <RangeSection
              range={body.range}
              bucketSize={controls.bucketSize}
              bucketCount={controls.bucketCount}
              probe={controls.probe}
              set={{ bucketSize: (value) => set("bucketSize", value), bucketCount: (value) => set("bucketCount", value), probe: (value) => set("probe", value) }}
            />
            <BarrierSection rows={body.barrier} />
            <SwingSection rows={body.swing} pick={controls.swingPick} onPick={(value) => set("swingPick", value)} />
            <CausalitySection rows={body.purgeAudit} shift={body.shift} shiftBars={controls.shiftBars} onShiftBars={(value) => set("shiftBars", value)} />
            <FindingsSection rows={body.findings} />

            <Section title="Every column of every frame" question="Each frame the audit profiles, every numeric column as its own histogram with its eight numbers.">
              <ControlBar>
                <SegmentControl label="Frame" value={controls.frame} options={FRAMES.map((frame) => ({ value: frame.value, label: frame.label }))} onChange={(value) => set("frame", value)} />
              </ControlBar>
              <div className="mt-2">
                <ColumnGrid rows={frameRows(body, controls.frame)} title={FRAMES.find((frame) => frame.value === controls.frame)?.label ?? "frame"} />
              </div>
            </Section>
          </>
        ) : null}
      </StudyState>
    </div>
  );
}
