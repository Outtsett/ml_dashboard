/**
 * Chart surfaces — what shares the Market chart's context, and what should.
 *
 * The chart publishes three things: the symbol and timeframe, the bars now on
 * screen, and the bar last clicked. This page draws those as three pipes and
 * every surface beside the chart as a bucket under them, so "which tab is
 * showing me the same data" is a picture rather than an argument. Switch the
 * model to see what the same diagram looks like when all three pipes reach
 * every surface.
 *
 * Laid out problem -> picture -> per-surface measurement -> findings ->
 * ordered changes. Every fact carries the file and line it was read from.
 */

import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AXIS, ControlBar, Finding, GRID, OKABE, Section, SegmentControl, SelectControl, Stat, SwitchControl, TOOLTIP } from "@/studies/kit";
import {
  CHANGES,
  CHANNELS,
  PUBLISHER,
  REMAINING,
  REMOVED,
  SOURCE,
  STUDIO_CHROME,
  SURFACES,
  type Channel,
  type Surface,
} from "./data";

const MODEL = { NOW: "now", NEXT: "next" } as const;
type Model = (typeof MODEL)[keyof typeof MODEL];

const MODEL_OPTIONS: Array<{ value: Model; label: string }> = [
  { value: MODEL.NOW, label: "now" },
  { value: MODEL.NEXT, label: "with the tab strip" },
];

/** In "now", only the selected bar is published and unread by everything but the notebooks. */
const UNPLUMBED: Record<Model, Channel[]> = { now: ["bar"], next: [] };

const ANY = "any";

const SOURCE_X = 24;
const SOURCE_Y = 44;
const SOURCE_W = 178;
const SOURCE_H = 74;
const PIPE_X0 = SOURCE_X + SOURCE_W;
const PIPE_X1 = 946;
const PIPE_Y: Record<Channel, number> = { pair: 176, window: 216, bar: 256 };
const BUCKET_Y = 330;
const BUCKET_W = 98;
const BUCKET_H = 76;
const BUCKET_GAP = 14;
const BUCKET_X0 = 46;

function bucketX(index: number): number {
  return BUCKET_X0 + index * (BUCKET_W + BUCKET_GAP);
}

function channelOf(id: string): (typeof CHANNELS)[number] {
  return CHANNELS.find((channel) => channel.id === id) ?? CHANNELS[0]!;
}

function has(surface: Surface, channel: Channel): boolean {
  return surface.channels.includes(channel);
}

function Impact({ impact }: { impact: string }) {
  const style =
    impact === "high"
      ? { color: OKABE.orange, glyph: "▲▲", label: "high" }
      : impact === "medium"
        ? { color: OKABE.sky, glyph: "▲", label: "medium" }
        : { color: OKABE.grey, glyph: "△", label: "low" };
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px]" style={{ color: style.color }}>
      <span aria-hidden="true">{style.glyph}</span>
      {style.label}
    </span>
  );
}

function Plumbing({ model, focus, showRemoved, onPick }: {
  model: Model; focus: string; showRemoved: boolean; onPick: (id: string) => void;
}) {
  const unplumbed = UNPLUMBED[model];
  const lit = (id: string) => focus === ANY || focus === id;
  return (
    <svg viewBox="0 0 980 470" className="w-full" role="img"
      aria-label="The Market chart publishes symbol and timeframe, the visible window and the selected bar; each surface below takes the channels it consumes">
      <defs>
        <marker id="chart-tap" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
        </marker>
      </defs>

      <g>
        <rect x={SOURCE_X} y={SOURCE_Y} width={SOURCE_W} height={SOURCE_H} rx={7} fill="#141414" stroke={OKABE.grey} strokeWidth={1.6} />
        <text x={SOURCE_X + 12} y={SOURCE_Y + 22} fontSize={12} fontWeight={700} fill="#f5f5f5">{SOURCE.label}</text>
        <text x={SOURCE_X + 12} y={SOURCE_Y + 38} fontSize={9.5} fill={OKABE.grey}>{SOURCE.route} · the only publisher</text>
        <text x={SOURCE_X + 12} y={SOURCE_Y + 56} fontSize={9.5} fill={OKABE.sky}>publishes all three channels</text>
      </g>

      {CHANNELS.map((channel) => {
        const dead = unplumbed.includes(channel.id);
        const y = PIPE_Y[channel.id];
        return (
          <g key={channel.id}>
            <line x1={PIPE_X0} y1={y} x2={PIPE_X1} y2={y} stroke={dead ? OKABE.grey : channel.color}
              strokeWidth={dead ? 1.2 : 2} strokeDasharray={dead ? "6 5" : undefined} opacity={dead ? 0.5 : 0.95} />
            <text x={PIPE_X1} y={y - 7} fontSize={9.5} textAnchor="end" fill={dead ? OKABE.grey : channel.color}>
              <tspan fontWeight={700}>{channel.glyph}</tspan>
              {`  ${channel.label}${dead ? " — published, read by the notebooks only" : ""}`}
            </text>
          </g>
        );
      })}

      {SURFACES.map((surface, index) => {
        const x = bucketX(index);
        const centre = x + BUCKET_W / 2;
        const on = lit(surface.id);
        const picked = focus === surface.id;
        return (
          <g key={surface.id} opacity={on ? 1 : 0.2} className="cursor-pointer" role="button" tabIndex={0} aria-pressed={picked}
            onClick={() => onPick(picked ? ANY : surface.id)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onPick(picked ? ANY : surface.id); }}>
            <title>{`${surface.label} (${surface.route}) — takes ${surface.channels.length} of 3 channels`}</title>
            {CHANNELS.map((channel) => {
              const taken = has(surface, channel.id);
              if (!taken && unplumbed.includes(channel.id)) return null;
              return (
                <line key={channel.id} x1={centre} y1={PIPE_Y[channel.id]} x2={centre} y2={BUCKET_Y - 2}
                  stroke={channel.color} strokeWidth={taken ? 2 : 1} strokeDasharray={taken ? undefined : "3 4"}
                  opacity={taken ? 0.9 : 0.3} markerEnd={taken ? "url(#chart-tap)" : undefined} />
              );
            })}
            <rect x={x} y={BUCKET_Y} width={BUCKET_W} height={BUCKET_H} rx={6}
              fill={picked ? "#1c1c1c" : "#141414"} stroke={picked ? "#ffffff" : surface.channels.length === 0 ? OKABE.vermillion : "#3a3a3a"}
              strokeWidth={picked ? 2.4 : 1.3} strokeDasharray={surface.channels.length === 0 ? "5 4" : undefined} />
            <text x={x + 9} y={BUCKET_Y + 19} fontSize={10.5} fontWeight={600} fill="#f5f5f5">{surface.label}</text>
            <text x={x + 9} y={BUCKET_Y + 33} fontSize={8.5} fill={OKABE.grey}>{surface.route}</text>
            {CHANNELS.map((channel, slot) => {
              const taken = has(surface, channel.id);
              const sx = x + 9 + slot * 27;
              return (
                <g key={channel.id}>
                  <rect x={sx} y={BUCKET_Y + 44} width={22} height={13} rx={2}
                    fill={taken ? channel.color : "none"} stroke={taken ? channel.color : "#4a4a4a"}
                    strokeWidth={1} strokeDasharray={taken ? undefined : "2 2"} />
                  <text x={sx + 11} y={BUCKET_Y + 54} fontSize={9} textAnchor="middle" fontWeight={700}
                    fill={taken ? "#0d0d0d" : "#6a6a6a"}>{channel.glyph}</text>
                </g>
              );
            })}
            <text x={x + BUCKET_W / 2} y={BUCKET_Y + BUCKET_H + 14} fontSize={9.5} textAnchor="middle"
              fill={surface.channels.length === 0 ? OKABE.vermillion : OKABE.grey}>
              {surface.channels.length === 0 ? "shares nothing" : `${surface.channels.length} of 3`}
            </text>
          </g>
        );
      })}

      {showRemoved && (
        <g>
          <rect x={SOURCE_X} y={BUCKET_Y + 6} width={SOURCE_W + 40} height={68} rx={7} fill="#0f1412"
            stroke={OKABE.green} strokeWidth={1.5} strokeDasharray="6 4" />
          <text x={SOURCE_X + 12} y={BUCKET_Y + 26} fontSize={11} fontWeight={700} fill={OKABE.green}>IntegratedTabs.tsx</text>
          <text x={SOURCE_X + 12} y={BUCKET_Y + 42} fontSize={9.5} fill={OKABE.grey}>deleted · {REMOVED.lines} lines, 0 importers</text>
          <text x={SOURCE_X + 12} y={BUCKET_Y + 58} fontSize={9.5} fill={OKABE.green}>its tab state and its keys are gone</text>
          <line x1={SOURCE_X + SOURCE_W + 40} y1={BUCKET_Y + 40} x2={SOURCE_X + SOURCE_W + 66} y2={BUCKET_Y + 40}
            stroke={OKABE.green} strokeWidth={1.5} />
          <text x={SOURCE_X + SOURCE_W + 70} y={BUCKET_Y + 44} fontSize={13} fill={OKABE.green}>✓</text>
        </g>
      )}
    </svg>
  );
}

function ChannelChart({ surfaces }: { surfaces: Surface[] }) {
  const rows = surfaces.map((surface) => ({
    name: surface.label,
    pair: has(surface, "pair") ? 1 : 0,
    window: has(surface, "window") ? 1 : 0,
    bar: has(surface, "bar") ? 1 : 0,
  }));
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-neutral-300">
        {CHANNELS.map((channel) => (
          <span key={channel.id} className="inline-flex items-center gap-1.5" title={channel.blurb}>
            <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: channel.color }} />
            <span className="font-mono font-bold">{channel.glyph}</span>
            {channel.label}
          </span>
        ))}
        <span className="text-neutral-500">0 = the surface never reads it, 1 = it does</span>
      </div>
      <ResponsiveContainer width="100%" height={Math.max(200, rows.length * 30 + 40)}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 40 }} barCategoryGap={4} barGap={1}>
          <CartesianGrid {...GRID} horizontal={false} />
          <XAxis type="number" domain={[0, 1]} ticks={[0, 1]} tickFormatter={(value) => (value === 1 ? "reads" : "ignores")} {...AXIS} />
          <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10, fill: "#d4d4d4" }} axisLine={false} tickLine={false} />
          <Tooltip {...TOOLTIP} />
          {CHANNELS.map((channel) => (
            <Bar key={channel.id} dataKey={channel.id} fill={channel.color} isAnimationActive={false} name={channel.label} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function ChartSurfaces() {
  const [model, setModel] = useState<Model>(MODEL.NOW);
  const [focus, setFocus] = useState<string>(ANY);
  const [showRemoved, setShowRemoved] = useState(true);

  const focused = SURFACES.find((surface) => surface.id === focus) ?? null;

  return (
    <div className="space-y-4">
      <Finding>
        <strong>Problem.</strong> The Market chart and the surfaces a reader thinks of as its other tabs
        are seven separate routes with three different navigation idioms, and each of them used to
        decide for itself which bars to show. <strong>Context.</strong> The chart publishes three
        things — the symbol and timeframe, the bars on screen, and the bar last clicked — and the tab
        strip that used to pass them along was replaced by a three-pane grid with its state machine
        left behind. <strong>Objectives.</strong> Make the chart's window mean one thing on every
        surface, remove what no longer had a target, and leave one decision to a person.
      </Finding>

      <ControlBar onReset={() => { setModel(MODEL.NOW); setFocus(ANY); setShowRemoved(true); }}>
        <SegmentControl
          label="model"
          value={model}
          options={MODEL_OPTIONS}
          onChange={setModel}
          hint="Now draws the selected bar as a pipe nothing but the notebooks is connected to. The other setting draws it reaching every surface, which is what the tab strip would buy."
        />
        <SelectControl
          label="surface"
          value={focus}
          onChange={setFocus}
          options={[{ value: ANY, label: "all surfaces" }, ...SURFACES.map((surface) => ({ value: surface.id, label: surface.label }))]}
          hint="Focus one surface to read what it follows, what it defines for itself, and where that was read."
        />
        <SwitchControl label="show what was removed" checked={showRemoved} onChange={setShowRemoved}
          hint={`${REMOVED.file}: ${REMOVED.lines} lines with no importer, deleted with its tab state.`} />
      </ControlBar>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="surfaces measured" value={String(SURFACES.length)} hint="Everything beside the chart that a reader could call a tab." />
        <Stat label="follow the chart's window" value={String(SURFACES.filter((surface) => has(surface, "window")).length)}
          tone={OKABE.orange}
          hint="Analytics and Regression both default to the bars the chart is showing, converted to the bar count each route accepts." />
        <Stat label="read the clicked bar" value={String(SURFACES.filter((surface) => has(surface, "bar")).length)}
          tone={OKABE.purple} hint="The notebooks only. Plumbing it to the rest is what the tab strip would add." />
        <Stat label="lines deleted" value={String(REMOVED.lines)} tone={OKABE.green}
          hint="IntegratedTabs.tsx, plus the activeTab state and the keys that wrote it." />
      </div>

      <Section
        title="The chart's context, and who receives it"
        question={
          model === MODEL.NOW
            ? "Now: three pipes leave the chart. Two are connected; the selected bar reaches the notebooks only, drawn dashed because it is published and unread."
            : "With the tab strip and the chart mounted underneath: every surface is a view of the same bars and the same clicked bar."
        }
      >
        <Plumbing model={model} focus={focus} showRemoved={showRemoved} onPick={(id) => setFocus(id === ANY ? ANY : id)} />
        <div className="mt-1 space-y-1">
          {CHANNELS.map((channel) => (
            <p key={channel.id} className="text-[11px] leading-snug text-neutral-400">
              <span className="font-mono font-bold" style={{ color: channel.color }}>{channel.glyph}</span>
              <span className="font-semibold text-neutral-200">{channel.label}</span> — {channel.blurb}
            </p>
          ))}
        </div>
      </Section>

      {focused ? (
        <Section title={focused.label} question={`${focused.route} · ${focused.idiom}`}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2 text-[12px] text-neutral-300">
              <p>
                <span className="text-neutral-500">takes from the chart: </span>
                {focused.channels.length === 0 ? (
                  <span className="font-semibold" style={{ color: OKABE.vermillion }}>nothing</span>
                ) : (
                  focused.channels.map((id) => channelOf(id).label).join(", ")
                )}
              </p>
              <p>
                <span className="text-neutral-500">defines its own window: </span>
                {focused.ownWindow ?? <span className="text-neutral-400">no — it inherits one</span>}
              </p>
              <p>{focused.verdict}</p>
            </div>
            <ul className="space-y-1 border-l border-neutral-800 pl-3">
              {focused.evidence.map((line) => (
                <li key={line} className="font-mono text-[10.5px] leading-snug text-neutral-400">{line}</li>
              ))}
            </ul>
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">Click the surface again, or choose “all surfaces”, to clear the focus.</p>
        </Section>
      ) : null}

      <Section title="Channels each surface receives" question="The same measurement as bars: one row per surface, one bar per channel, so a gap is a bar that is not there.">
        <ChannelChart surfaces={SURFACES} />
      </Section>

      <Section title="What changed, and what is still open" question="Six changes landed on 2026-10-04; one is a decision about navigation that belongs to a person.">
        <div className="space-y-3">
          <div>
            <p className="text-[12px] font-semibold text-neutral-100">1. Analytics and Regression now read the chart's window.</p>
            <Finding>
              One reader serves both — <code className="font-mono text-[11px]">useChartWindow.ts</code> — so
              the two surfaces can no longer disagree about what MNQ 1m means.{" "}
              {PUBLISHER.evidence.map((line) => (
                <span key={line} className="mt-1 block font-mono text-[10.5px] leading-snug text-neutral-500">{line}</span>
              ))}
            </Finding>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-neutral-100">2. The tab bar and its state machine are gone.</p>
            <Finding>{REMOVED.what} {REMOVED.givenARealTarget}</Finding>
            <ul className="mt-1 space-y-0.5 border-l border-neutral-800 pl-3">
              {REMOVED.alsoRemoved.map((line) => (
                <li key={line} className="font-mono text-[10.5px] leading-snug text-neutral-400">{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-neutral-100">3. Model Cycle has one home.</p>
            <Finding>
              The fifth Analytics tab is deleted along with its{" "}
              <code className="font-mono text-[11px]">-mx-4 -mb-4</code> escape hatch, and{" "}
              <code className="font-mono text-[11px]">/cycle</code> is now a sidebar entry, so the surface
              did not lose its place in the navigation when the duplicate went.
            </Finding>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-neutral-100">4. Three navigations still describe the dashboard three ways.</p>
            <Finding>{STUDIO_CHROME.what}:</Finding>
            <ul className="mt-1 space-y-0.5 border-l border-neutral-800 pl-3">
              {STUDIO_CHROME.evidence.map((line) => (
                <li key={line} className="font-mono text-[10.5px] leading-snug text-neutral-400">{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-neutral-100">5. The lake serving snapshot is down, which is why every study page errors.</p>
            <Finding>
              Measured just now: <code className="font-mono text-[11px]">GET /api/studies</code> answers 500
              and the cause is not the handler index —{" "}
              <code className="font-mono text-[11px]">connection.ts:336</code> reports{" "}
              <em>Lake serving snapshot s3://derived/recipe=lake_snapshot_2026-09-09/ is empty or
              unreachable</em>. All 55 handlers are registered now. The chart itself is unaffected:
              <code className="font-mono text-[11px]"> /api/charts/ohlcv</code> answered 200 with 200 bars.
            </Finding>
          </div>
        </div>
      </Section>

      <Section title="The ordered changes" question="Six done, one open. The open one is a navigation decision, not a defect.">
        <ol className="space-y-2">
          {CHANGES.map((change) => (
            <li key={change.order}
              className={`rounded-md border px-3 py-2 ${change.done ? "border-neutral-800 bg-neutral-900/40" : "border-[#E69F00]/40 bg-[#E69F00]/5"}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[12px] font-semibold text-neutral-100">
                  <span className="mr-2 font-mono text-neutral-500">{change.order}.</span>
                  {change.title}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[10.5px] text-neutral-500">{change.size}</span>
                  {change.done ? (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px]" style={{ color: OKABE.green }}>
                      <span aria-hidden="true">✓</span> done
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px]" style={{ color: OKABE.orange }}>
                      <span aria-hidden="true">◐</span> open
                    </span>
                  )}
                  <Impact impact={change.impact} />
                </span>
              </div>
              <p className="mt-1 max-w-prose text-[11.5px] leading-relaxed text-neutral-400">{change.why}</p>
            </li>
          ))}
        </ol>
        <Finding>
          <strong className="text-neutral-200">{REMAINING.title}.</strong> {REMAINING.why}
        </Finding>
      </Section>
    </div>
  );
}