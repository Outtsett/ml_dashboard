/**
 * The card that opens when a candlestick-pattern arrow is hovered.
 *
 * Two small drawings side by side, on the same visual rules as the chart:
 * the TEXTBOOK version of the pattern in the direction that fired, and the
 * candles it ACTUALLY fired on. The pattern's own bars are drawn solid under a
 * bracket and numbered; the bars before them are faded, because most patterns
 * only mean something after a trend and the fade keeps that trend visible
 * without competing with the pattern.
 */

import { CANDLE_UP_COLOR, CANDLE_DOWN_COLOR } from '@/market/components/chartConfig';
import { CONTEXT_BARS, type MiniBar, type PatternHoverInfo } from '@/market/lib/patternHover';

// ── Mini candle drawing ────────────────────────────────────────────────────

const DRAW_WIDTH = 150;
const DRAW_HEIGHT = 104;
const PAD_TOP = 6;
const PAD_BOTTOM = 18;

interface MiniCandlesProps {
  context: MiniBar[];
  pattern: MiniBar[];
  title: string;
  testId: string;
}

function MiniCandles({ context, pattern, title, testId }: MiniCandlesProps) {
  const bars = [...context, ...pattern];
  if (bars.length === 0) return null;

  let low = Infinity;
  let high = -Infinity;
  for (const bar of bars) {
    if (bar.low < low) low = bar.low;
    if (bar.high > high) high = bar.high;
  }
  const span = high - low || 1;
  const plotHeight = DRAW_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const y = (price: number) => PAD_TOP + ((high - price) / span) * plotHeight;

  const slot = DRAW_WIDTH / bars.length;
  const bodyWidth = Math.max(3, Math.min(14, slot * 0.6));
  const patternStartX = context.length * slot;

  return (
    <figure className="flex flex-col items-center gap-1" data-testid={testId}>
      <figcaption className="text-[10px] uppercase tracking-wider text-muted-foreground">{title}</figcaption>
      <svg
        width={DRAW_WIDTH}
        height={DRAW_HEIGHT}
        viewBox={`0 0 ${DRAW_WIDTH} ${DRAW_HEIGHT}`}
        role="img"
        aria-label={title}
        className="rounded bg-black/40"
      >
        {/* The pattern's bars sit on a faint band so they read as one group. */}
        <rect
          x={patternStartX}
          y={0}
          width={DRAW_WIDTH - patternStartX}
          height={DRAW_HEIGHT - PAD_BOTTOM + 2}
          fill="rgba(255,255,255,0.05)"
        />
        {bars.map((bar, i) => {
          const isPattern = i >= context.length;
          const rising = bar.close >= bar.open;
          const colour = rising ? CANDLE_UP_COLOR : CANDLE_DOWN_COLOR;
          const cx = slot * i + slot / 2;
          const top = y(Math.max(bar.open, bar.close));
          const bottom = y(Math.min(bar.open, bar.close));
          return (
            <g key={i} opacity={isPattern ? 1 : 0.35}>
              <line x1={cx} x2={cx} y1={y(bar.high)} y2={y(bar.low)} stroke={colour} strokeWidth={1.2} />
              <rect
                x={cx - bodyWidth / 2}
                y={top}
                width={bodyWidth}
                // A doji has no body; a hairline keeps its open/close visible.
                height={Math.max(1.2, bottom - top)}
                fill={colour}
              />
              {isPattern && (
                <text
                  x={cx}
                  y={DRAW_HEIGHT - 4}
                  textAnchor="middle"
                  fontSize={9}
                  fill="rgba(255,255,255,0.7)"
                >
                  {i - context.length + 1}
                </text>
              )}
            </g>
          );
        })}
        {/* Bracket under the pattern bars. */}
        <path
          d={`M ${patternStartX + 2} ${DRAW_HEIGHT - PAD_BOTTOM + 3} v 3 H ${DRAW_WIDTH - 2} v -3`}
          fill="none"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth={1}
        />
      </svg>
    </figure>
  );
}

// ── Card ───────────────────────────────────────────────────────────────────

const DIRECTION_TEXT = {
  bullish: { glyph: '▲', word: 'Bullish', colour: CANDLE_UP_COLOR },
  bearish: { glyph: '▼', word: 'Bearish', colour: CANDLE_DOWN_COLOR },
  neutral: { glyph: '●', word: 'No direction', colour: '#808A99' },
} as const;

const TYPE_TEXT: Record<string, string> = {
  reversal: 'reversal',
  continuation: 'continuation',
  indecision: 'indecision',
  colour_line: 'single body',
};

export const PATTERN_CARD_WIDTH = 348;

interface PatternHoverCardProps {
  info: PatternHoverInfo;
  left: number;
  top: number;
}

function formatUtc(seconds: number): string {
  return `${new Date(seconds * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function PatternHoverCard({ info, left, top }: PatternHoverCardProps) {
  const direction = DIRECTION_TEXT[info.direction];
  const { entry, template, window } = info;

  return (
    <div
      className="pointer-events-none absolute z-40 rounded-md border border-white/10 bg-popover/95 p-3 shadow-xl backdrop-blur-sm"
      style={{ left, top, width: PATTERN_CARD_WIDTH }}
      role="tooltip"
      data-testid="pattern-hover-card"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">{entry.displayName}</span>
        <span className="text-xs font-semibold" style={{ color: direction.colour }}>
          {direction.glyph} {direction.word}
        </span>
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground">
        {entry.candleCount}-bar {TYPE_TEXT[entry.patternType] ?? entry.patternType}
        {' · '}{entry.talibFunction}
        {' · completes '}{formatUtc(info.patternEndTime)}
      </div>
      {info.isConfirmation && (
        <div className="mt-1 text-[10px] text-amber-300/90">
          This arrow is TA-Lib&apos;s confirmation, {formatUtc(info.barTime)}, of the pattern drawn below.
        </div>
      )}

      <div className="mt-2 flex justify-between gap-2">
        {template ? (
          <MiniCandles
            context={template.context.slice(-CONTEXT_BARS)}
            pattern={template.patternBars}
            title="Textbook"
            testId="pattern-card-textbook"
          />
        ) : (
          <div className="flex w-[150px] items-center justify-center text-center text-[10px] text-muted-foreground">
            No textbook drawing for this direction.
          </div>
        )}
        <MiniCandles
          context={window.context}
          pattern={window.pattern}
          title="On the chart"
          testId="pattern-card-actual"
        />
      </div>

      {template && (
        <>
          <ol className="mt-2 space-y-0.5 text-[11px] leading-snug text-foreground/90">
            {template.candleCaptions.map((caption, i) => (
              <li key={i} className="flex gap-1.5">
                <span className="text-muted-foreground">{i + 1}</span>
                <span>{caption}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{template.reading}</p>
        </>
      )}
    </div>
  );
}
