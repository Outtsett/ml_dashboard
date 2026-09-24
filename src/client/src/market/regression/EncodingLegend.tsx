/**
 * One legend for the whole grid: what a point's colour and size mean, with
 * the real values at the ends of each scale. Colour and size encode values of
 * the BAR (when it happened, its volatility, its volume), so the same legend
 * holds in every panel; the residual and group encodings are per panel and
 * say so.
 */

import type { OhlcvData } from "@/market/components/types";
import type { BarEncodings } from "./panels";
import {
  CLUSTER_COLORS,
  RESIDUAL_SATURATION,
  divergingColor,
  encodingPercentiles,
  sequentialColor,
  type ColorBy,
  type SizeBy,
} from "./encoding";
import { REGRESSION_COLORS, formatTimestamp, formatValue, type StampClock } from "./scales";

const STOPS = 9;

function Gradient({ stops, left, middle, right }: { stops: string[]; left: string; middle?: string; right: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono tabular-nums">{left}</span>
      <span className="relative inline-block h-2.5 w-32 rounded-sm" style={{ background: `linear-gradient(to right, ${stops.join(", ")})` }}>
        {middle && <span className="absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] tabular-nums">{middle}</span>}
      </span>
      <span className="font-mono tabular-nums">{right}</span>
    </span>
  );
}

export function EncodingLegend({
  colorBy,
  sizeBy,
  encodings,
  bars,
  clock,
}: {
  colorBy: ColorBy;
  sizeBy: SizeBy;
  encodings: BarEncodings | null;
  bars: ReadonlyArray<OhlcvData> | null;
  clock: StampClock;
}) {
  const fractions = Array.from({ length: STOPS }, (_, index) => index / (STOPS - 1));
  let colour: React.ReactNode = <span><span style={{ color: REGRESSION_COLORS.point }}>●</span> every ordinary bar</span>;
  if (colorBy === "time" && bars && bars.length > 1) {
    colour = (
      <Gradient
        stops={fractions.map((fraction) => sequentialColor("time", fraction))}
        left={`oldest ${formatTimestamp(bars[0]!.timestamp, clock)}`}
        right={`newest ${formatTimestamp(bars[bars.length - 1]!.timestamp, clock)}`}
      />
    );
  } else if ((colorBy === "volatility" || colorBy === "volume") && encodings) {
    const values = colorBy === "volatility" ? encodings.volatility : encodings.volume;
    const [low, median, high] = encodingPercentiles(values, [0, 0.5, 1]);
    const unit = colorBy === "volatility" ? " bp" : "";
    colour = (
      <Gradient
        stops={fractions.map((fraction) => sequentialColor(colorBy, fraction))}
        left={`${colorBy === "volatility" ? "calmest" : "quietest"} ${formatValue(low)}${unit}`}
        middle={`median ${formatValue(median)}${unit}`}
        right={`${colorBy === "volatility" ? "most volatile" : "busiest"} ${formatValue(high)}${unit}`}
      />
    );
  } else if (colorBy === "residual") {
    colour = (
      <Gradient
        stops={fractions.map((fraction) => divergingColor(fraction * 2 - 1))}
        left={`below the line (−${RESIDUAL_SATURATION})`}
        middle="on it"
        right={`above (+${RESIDUAL_SATURATION}) · studentized, per panel`}
      />
    );
  } else if (colorBy === "cluster") {
    colour = (
      <span className="inline-flex items-center gap-1.5">
        {CLUSTER_COLORS.map((color, index) => (
          <span key={color}><span style={{ color }}>●</span> {index + 1}</span>
        ))}
        <span>groups, found per panel (k 2–5 by silhouette)</span>
      </span>
    );
  }

  const sizeLabel =
    sizeBy === "volatility" ? "20-bar volatility percentile"
      : sizeBy === "volume" ? "volume percentile"
        : sizeBy === "residual" ? `|studentized residual|, full size at ${RESIDUAL_SATURATION}`
          : null;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-0.5 pb-1 text-[10px] text-muted-foreground" data-testid="regression-legend">
      <span className="inline-flex items-center gap-1.5">
        <span className="uppercase tracking-wide text-muted-foreground/70">colour</span>
        {colour}
      </span>
      {sizeLabel && (
        <span className="inline-flex items-center gap-1.5">
          <span className="uppercase tracking-wide text-muted-foreground/70">size</span>
          <svg width={34} height={10} aria-hidden>
            <circle cx={4} cy={5} r={1.2} fill={REGRESSION_COLORS.point} />
            <circle cx={14} cy={5} r={2.2} fill={REGRESSION_COLORS.point} />
            <circle cx={27} cy={5} r={3.4} fill={REGRESSION_COLORS.point} />
          </svg>
          low → high {sizeLabel}
        </span>
      )}
    </div>
  );
}
