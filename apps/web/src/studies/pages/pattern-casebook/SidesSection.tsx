/**
 * Section 3: every pattern side on the chosen candles, year and exit candle:
 * mean net dollars per trade (the marker) against the range 90% of random-bar
 * sets of the same size land in (the grey bar). ▲ orange above it, ● grey
 * inside, ▼ blue below; the dashed line is zero.
 */

import { useState } from "react";
import { ColumnGrid, Finding, OKABE, Section, fmtInt, fmtPercent } from "@/studies/kit";
import { MINIMUM_TRADES_SHOWN, againstRandom, type AgainstRandom, type SideRow } from "@shared/studies/pattern-casebook";
import type { Controls } from "./controls";
import { niceTicks, signedDollars, useWidth } from "./format";
import { glyphPath, Glyph, type GlyphName } from "./glyphs";

const CLASS_STYLE: Record<AgainstRandom, { colour: string; glyph: GlyphName }> = {
  "above random bars": { colour: OKABE.orange, glyph: "triangle-up" },
  "inside random bars": { colour: OKABE.grey, glyph: "circle" },
  "below random bars": { colour: OKABE.blue, glyph: "triangle-down" },
};
const ROW = 16;
const LABEL = 230;
const MARGIN = { top: 8, right: 16, bottom: 30 };

export function SidesSection({ controls, rows }: { controls: Controls; rows: SideRow[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hovered, setHovered] = useState<string | null>(null);
  const shown = rows
    .filter((row) => row.candle === controls.candle && row.trade_count >= MINIMUM_TRADES_SHOWN)
    .map((row) => ({ row, label: `${row.pattern} — ${row.side} (${row.trade_direction})`, ...againstRandom(row) }))
    .sort((a, b) => b.row.net_dollars_per_trade_mean - a.row.net_dollars_per_trade_mean);
  const counts = (Object.keys(CLASS_STYLE) as AgainstRandom[]).map((against) => ({ against, count: shown.filter((entry) => entry.against === against).length }));
  const paying = shown.filter((entry) => entry.row.net_dollars_per_trade_mean > 0).length;
  const values = shown.flatMap((entry) => [entry.low, entry.high, entry.row.net_dollars_per_trade_mean, 0]);
  const low = values.length ? Math.min(...values) : -1;
  const high = values.length ? Math.max(...values) : 1;
  const pad = (high - low) * 0.04 || 1;
  const plotWidth = Math.max(40, width - LABEL - MARGIN.right);
  const height = MARGIN.top + MARGIN.bottom + ROW * shown.length;
  const x = (value: number) => LABEL + ((value - (low - pad)) / (high - low + 2 * pad)) * plotWidth;
  const active = shown.find((entry) => entry.label === hovered);

  return (
    <Section
      title="3 · Every pattern side this year, in dollars per trade"
      question={`The chosen candles (${controls.timeframe}), year (${controls.year}) and exit candle (${controls.candle}); rows need ${MINIMUM_TRADES_SHOWN} trades. Sorted best to worst.`}
    >
      {shown.length === 0 ? (
        <p className="text-xs text-neutral-400">No pattern side has {MINIMUM_TRADES_SHOWN} trades here.</p>
      ) : (
        <>
          <Finding>
            <strong>{shown.length} pattern sides:</strong>{" "}
            {counts.map((entry, index) => (
              <span key={entry.against}>
                {index > 0 && ", "}
                <Glyph name={CLASS_STYLE[entry.against].glyph} colour={CLASS_STYLE[entry.against].colour} /> {entry.count} {entry.against}
              </span>
            ))}
            ; <strong>{paying}</strong> averaged a profit after costs. With this many rows, a few land outside the random range by chance alone.
          </Finding>
          <div ref={ref} className="relative mt-2 min-w-0" onMouseLeave={() => setHovered(null)}>
            {width > 0 && (
              <svg width={width} height={height} role="img" aria-label="mean dollars per trade against the random-bar range">
                {niceTicks(low - pad, high + pad, 6).map((tick) => (
                  <g key={tick}>
                    <line x1={x(tick)} x2={x(tick)} y1={MARGIN.top} y2={height - MARGIN.bottom} stroke="#1f1f1f" />
                    <text x={x(tick)} y={height - MARGIN.bottom + 12} textAnchor="middle" fontSize={10} fill="#a3a3a3">{tick}</text>
                  </g>
                ))}
                <text x={LABEL + plotWidth / 2} y={height - 4} textAnchor="middle" fontSize={10} fill="#a3a3a3">net dollars per trade, one contract</text>
                <line x1={x(0)} x2={x(0)} y1={MARGIN.top} y2={height - MARGIN.bottom} stroke="#e5e5e5" strokeDasharray="4 3" />
                {shown.map((entry, index) => {
                  const middle = MARGIN.top + ROW * index + ROW / 2;
                  const style = CLASS_STYLE[entry.against];
                  return (
                    <g key={entry.label} onMouseEnter={() => setHovered(entry.label)}>
                      <rect x={0} y={middle - ROW / 2} width={width} height={ROW} fill={hovered === entry.label ? "#262626" : "transparent"} />
                      <text x={LABEL - 6} y={middle} dy="0.32em" textAnchor="end" fontSize={10} fill="#d4d4d4">{entry.label}</text>
                      <line x1={x(entry.low)} x2={x(entry.high)} y1={middle} y2={middle} stroke={OKABE.grey} strokeOpacity={0.45} strokeWidth={6} />
                      <path d={glyphPath(style.glyph, x(entry.row.net_dollars_per_trade_mean), middle, 5)} fill={style.colour} stroke="#0a0a0a" strokeWidth={0.6} />
                    </g>
                  );
                })}
              </svg>
            )}
            {active && (
              <div className="pointer-events-none absolute right-2 top-2 max-w-xs rounded border border-neutral-700 bg-neutral-900/95 px-2 py-1 text-[11px] text-neutral-200">
                <div className="font-semibold">{active.label}</div>
                <div>trades {fmtInt(active.row.trade_count)} · {active.against}</div>
                <div>mean {signedDollars(active.row.net_dollars_per_trade_mean)} · median {signedDollars(active.row.net_dollars_per_trade_median)}</div>
                <div>share net positive {fmtPercent(active.row.share_of_trades_net_positive)}</div>
                <div>total {signedDollars(active.row.total_net_dollars, 0)}</div>
                <div>every bar the same way {signedDollars(active.row.every_bar_same_direction_net_dollars_per_trade)}</div>
                <div>random bars per trade {signedDollars(active.low)} to {signedDollars(active.high)}</div>
                <div className="text-neutral-400">{active.row.random_band_method}</div>
              </div>
            )}
          </div>
        </>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] text-neutral-400">Every column of the pattern-side table for {controls.timeframe} {controls.year} (all exit candles, at least 20 trades)</summary>
        <div className="mt-2">
          <ColumnGrid rows={rows as unknown as Array<Record<string, unknown>>} title="pattern_side_dollars" />
        </div>
      </details>
    </Section>
  );
}
