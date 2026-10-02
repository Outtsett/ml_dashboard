/**
 * RegimeTimeline — Color-coded strip showing regime assignments over time.
 */

import { getRegimeColor } from "./types";

export function RegimeTimeline({ assignments, n_regimes: _n_regimes }: { assignments: Array<{ regime: number }>; n_regimes: number }) {
  if (!assignments || assignments.length === 0) return null;

  // Downsample to max ~300 segments for rendering
  const maxSegments = 300;
  const step = Math.max(1, Math.floor(assignments.length / maxSegments));
  const segments: Array<{ regime: number; count: number }> = [];

  for (let i = 0; i < assignments.length; i += step) {
    const regime = assignments[i]!.regime;
    if (segments.length > 0 && segments[segments.length - 1]!.regime === regime) {
      segments[segments.length - 1]!.count += 1;
    } else {
      segments.push({ regime, count: 1 });
    }
  }

  const totalCount = segments.reduce((s, seg) => s + seg.count, 0);

  return (
    <div className="w-full h-3 rounded-full overflow-hidden flex">
      {segments.map((seg, i) => (
        <div
          key={i}
          style={{
            width: `${(seg.count / totalCount) * 100}%`,
            backgroundColor: getRegimeColor(seg.regime).hex,
            opacity: 0.7,
          }}
        />
      ))}
    </div>
  );
}
