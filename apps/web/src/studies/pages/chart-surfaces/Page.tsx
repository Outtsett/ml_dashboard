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
  DEAD_STATE,
  DEAD_TAB_BAR,
  PUBLISHER,
  SOURCE,
  STUDIO_CHROME,
  SURFACES,
  type Channel,
  type Surface,
} from "./data";

const MODEL = { TODAY: "today", PROPOSED: "proposed" } as const;
type Model = (typeof MODEL)[keyof typeof MODEL];

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

function Plumbing({ model, focus, showDead, onPick }: {
  model: Model; focus: string; showDead: boolean; onPick: (id: string) => void;
}) {
  const plumbed = model === MODEL.PROPOSED;
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
        const dead = !plumbed && channel.id !== "pair";
        const y = PIPE_Y[channel.id];
        return (
          <g key={channel.id}>
            <line x1={PIPE_X0} y1={y} x2={PIPE_X1} y2={y} stroke={dead ? OKABE.grey : channel.color}
              strokeWidth={dead ? 1.2 : 2} strokeDasharray={dead ? "6 5" : undefined} opacity={dead ? 0.5 : 0.95} />
            <text x={PIPE_X1} y={y - 7} fontSize={9.5} textAnchor="end" fill={dead ? OKABE.grey : channel.color}>
              <tspan fontWeight={700}>{channel.glyph}</tspan>
              {`  ${channel.label}${dead ? " — plumbed to nothing here" : ""}`}
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
              if (!taken && !plumbed) return null;
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

      {showDead && (
        <g>
          <rect x={SOURCE_X} y={BUCKET_Y + 6} width={SOURCE_W + 40} height={68} rx={7} fill="#140f0f"
            stroke={OKABE.vermillion} strokeWidth={1.5} strokeDasharray="6 4" />
          <text x={SOURCE_X + 12} y={BUCKET_Y + 26} fontSize={11} fontWeight={700} fill={OKABE.vermillion}>IntegratedTabs.tsx</text>
          <text x={SOURCE_X + 12} y={BUCKET_Y + 42} fontSize={9.5} fill={OKABE.grey}>{DEAD_TAB_BAR.lines} lines, {DEAD_TAB_BAR.importers} importers</text>
          <text x={SOURCE_X + 12} y={BUCKET_Y + 58} fontSize={9.5} fill={OKABE.vermillion}>writes tab state nothing reads</text>
          <line x1={SOURCE_X + SOURCE_W + 40} y1={BUCKET_Y + 40} x2={SOURCE_X + SOURCE_W + 66} y2={BUCKET_Y + 40}
            stroke={OKABE.vermillion} strokeWidth={1.5} />
          <text x={SOURCE_X + SOURCE_W + 70} y={BUCKET_Y + 44} fontSize={13} fill={OKABE.vermillion}>✕</text>
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
  const [model, setModel] = useState<Model>(MODEL.TODAY);
  const [focus, setFocus] = useState<string>(ANY);
  const [showDead, setShowDead] = useState(true);

  const focused = SURFACES.find((surface) => surface.id === focus) ?? null;
  const totals = CHANNELS.map((channel) => ({
    channel,
    count: SURFACES.filter((surface) => has(surface, channel.id)).length,
  }));
  const liveChannels = SURFACES.filter((surface) => surface.channels.length > 0).length;

  return (
    <div className="space-y-4">
      <Finding>
        <strong>Problem.</strong> The Market chart and the surfaces a reader thinks of as its other tabs
        are eight separate routes with three different navigation idioms, and only one of them knows
        what the chart is looking at. <strong>Context.</strong> The chart already publishes the
        symbol, the timeframe, the visible window and the clicked bar; the tab strip that used to
        hold these surfaces together was replaced by a three-pane grid and its state machine was
        left behind. <strong>Objectives.</strong> Measure which surfaces receive which of the three
        published channels, name what is dead, and order the changes that would make them tabs.
      </Finding>

      <ControlBar onReset={() => { setModel(MODEL.TODAY); setFocus(ANY); setShowDead(true); }}>
        <SegmentControl
          label="model"
          value={model}
          onChange={setModel}
          options={[{ value: MODEL.TODAY, label: "today" }, { value: MODEL.PROPOSED, label: "all three plumbed" }]}
          hint="Today draws the window and the selected bar as pipes nothing is connected to. The other setting draws them reaching every surface."
        />
        <SelectControl
          label="surface"
          value={focus}
          onChange={setFocus}
          options={[{ value: ANY, label: "all surfaces" }, ...SURFACES.map((surface) => ({ value: surface.id, label: surface.label }))]}
          hint="Focus one surface to read what it follows, what it defines for itself, and where that was read."
        />
        <SwitchControl label="show the dead tab bar" checked={showDead} onChange={setShowDead}
          hint="IntegratedTabs.tsx: 225 lines, no importer anywhere in the repository." />
      </ControlBar>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="surfaces measured" value={String(SURFACES.length)} hint="Everything beside the chart that a reader could call a tab." />
        <Stat label="take any channel" value={`${liveChannels} of ${SURFACES.length}`}
          hint="Analytics, Regression, the Cycle tab and ML Studio all follow the symbol and timeframe. Only the notebooks read more." />
        <Stat label="read the window or the bar" value={String(totals.filter((row) => row.channel.id !== "pair").reduce((sum, row) => sum + row.count, 0))}
          tone={OKABE.orange} hint="Surfaces that know which bars the chart is showing, or which bar was clicked." />
        <Stat label="dead lines left behind" value={String(DEAD_TAB_BAR.lines)} tone={OKABE.vermillion}
          hint="IntegratedTabs.tsx plus the activeTab state three call sites still write to." />
      </div>

      <Section
        title="The chart's context, and who receives it"
        question={
          model === MODEL.TODAY
            ? "Today: three pipes leave the chart, and only the first is connected to anything. Dashed means published and unread."
            : "With the window and the selected bar plumbed through: every surface is a view of the same bars and the same clicked bar."
        }
      >
        <Plumbing model={model} focus={focus} showDead={showDead} onPick={(id) => setFocus(id === ANY ? ANY : id)} />
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

      <Section title="What is true today" question="Five facts read out of the code, each with the line it was read from.">
        <div className="space-y-3">
          <div>
            <p className="text-[12px] font-semibold text-neutral-100">1. The other tabs do not know what you were looking at.</p>
            <Finding>
              The chart publishes {PUBLISHER.what.toLowerCase()} {PUBLISHER.evidence.length} places,
              {" "}but only notebooks subscribe. Analytics and Regression follow the symbol and the
              timeframe and then choose their own bars, so the same words — MNQ, 1m — name two
              different datasets depending on which surface is open.
            </Finding>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-neutral-100">2. The tab bar is gone; its keyboard shortcuts are not.</p>
            <Finding>
              {DEAD_STATE.what}. Keys 1, 2 and 3 and the toolbar's ML button all set it;{" "}
              <code className="font-mono text-[11px] text-neutral-300">Toolbar.tsx:89</code> destructures it
              to <code className="font-mono text-[11px] text-neutral-300">_activeTab</code> and drops it.
            </Finding>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-neutral-100">3. Model Cycle exists twice, one of them as a tab.</p>
            <Finding>
              <code className="font-mono text-[11px] text-neutral-300">AnalyticsPage.tsx:179-181</code> pushes the
              whole <code className="font-mono text-[11px]">CyclePage</code> into a TabsContent and pulls the
              margins back with <code className="font-mono text-[11px]">-mx-4 -mb-4</code>.{" "}
              <code className="font-mono text-[11px] text-neutral-300">/cycle</code> is the real route.
            </Finding>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-neutral-100">4. Three navigations, so nothing reads as a tab.</p>
            <Finding>{STUDIO_CHROME.what}:</Finding>
            <ul className="mt-1 space-y-0.5 border-l border-neutral-800 pl-3">
              {STUDIO_CHROME.evidence.map((line) => (
                <li key={line} className="font-mono text-[10.5px] leading-snug text-neutral-400">{line}</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[12px] font-semibold text-neutral-100">5. Every study but four answers 404.</p>
            <Finding>
              <code className="font-mono text-[11px] text-neutral-300">scripts/build_study_index.mjs:16</code>{" "}
              still writes the handler index to <code className="font-mono text-[11px]">src/server/studies/handlers/</code>,
              a path from before the <code className="font-mono text-[11px]">apps/</code> split, so 4 of the 55
              handlers on disk are registered. Measured just now: <code className="font-mono text-[11px]">GET /api/studies</code>{" "}
              answers 500 and <code className="font-mono text-[11px]">/api/studies/indicator-study</code> answers 404,
              which costs the index its “data ready” badges.
            </Finding>
          </div>
        </div>
      </Section>

      <Section title="Ordered changes" question="Highest value first. The first two are the ones that make the rest possible.">
        <ol className="space-y-2">
          {CHANGES.map((change) => (
            <li key={change.order} className="rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[12px] font-semibold text-neutral-100">
                  <span className="mr-2 font-mono text-neutral-500">{change.order}.</span>
                  {change.title}
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-mono text-[10.5px] text-neutral-500">{change.size}</span>
                  <Impact impact={change.impact} />
                </span>
              </div>
              <p className="mt-1 max-w-prose text-[11.5px] leading-relaxed text-neutral-400">{change.why}</p>
            </li>
          ))}
        </ol>
        <Finding>
          The one line that ties them together: the chart already publishes everything the other
          tabs need. They do not read it because the tab strip that would have passed it to them
          was replaced, and nothing was rewired in its place.
        </Finding>
      </Section>
    </div>
  );
}