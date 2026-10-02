/**
 * Entity platform review: the kinds of thing the dashboard tracks, the links
 * between them that code already proves, and the verified suggestions for the
 * entity-centric platform, stepped in build order. Laid out problem ->
 * picture -> suggestions -> what to do first.
 */

import { useState } from "react";
import { ControlBar, Finding, OKABE, Section, SegmentControl, SelectControl, Stat, SwitchControl, fmtInt } from "@/studies/kit";
import { EDGES, KINDS, STEPS, SUGGESTIONS, type Impact, type KindEdge, type KindNode, type Store } from "./data";

const ALL_STEPS = 0;
const ANY = "any";

const STORE_STYLE: Record<Store, { color: string; label: string; glyph: string }> = {
  sqlite: { color: OKABE.sky, label: "SQLite row", glyph: "■" },
  lake: { color: OKABE.orange, label: "Lake object", glyph: "●" },
  files: { color: OKABE.purple, label: "File or config", glyph: "◆" },
};

const IMPACT_STYLE: Record<Impact, { color: string; glyph: string }> = {
  high: { color: OKABE.orange, glyph: "▲▲" },
  medium: { color: OKABE.yellow, glyph: "▲" },
  low: { color: OKABE.grey, glyph: "△" },
};

const NODE_WIDTH = 124;
const NODE_HEIGHT = 40;

function nodeOf(kind: string): KindNode | undefined {
  return KINDS.find((node) => node.kind === kind);
}

function EntityGraph({ lit, picked, overlay, onPick, onEdge }: {
  lit: Set<string>; picked: string; overlay: boolean; onPick: (kind: string) => void; onEdge: (edge: KindEdge | null) => void;
}) {
  const dimAll = lit.size > 0;
  return (
    <svg viewBox="0 0 780 410" className="w-full" role="img" aria-label="Kinds of entity and the links between them">
      <defs>
        <marker id="entity-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#8a8a8a" />
        </marker>
      </defs>
      {EDGES.map((edge) => {
        const from = nodeOf(edge.from);
        const to = nodeOf(edge.to);
        if (!from || !to) return null;
        const on = !dimAll || (lit.has(edge.from) && lit.has(edge.to));
        // Stop the line at the target box edge so the arrow head stays visible.
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const scale = Math.min(Math.abs(dx) > 0 ? (NODE_WIDTH / 2 + 4) / Math.abs(dx) : Infinity, Math.abs(dy) > 0 ? (NODE_HEIGHT / 2 + 4) / Math.abs(dy) : Infinity);
        const x2 = to.x - dx * scale;
        const y2 = to.y - dy * scale;
        return (
          <g key={`${edge.from}-${edge.to}`} onMouseEnter={() => onEdge(edge)} onMouseLeave={() => onEdge(null)} className="cursor-help">
            <line x1={from.x} y1={from.y} x2={x2} y2={y2} stroke="transparent" strokeWidth={12} />
            <line x1={from.x} y1={from.y} x2={x2} y2={y2} stroke={edge.gap ? OKABE.vermillion : "#8a8a8a"} strokeWidth={on ? 1.6 : 1}
              strokeDasharray={edge.gap ? "5 4" : undefined} opacity={on ? 0.95 : 0.2} markerEnd="url(#entity-arrow)" />
          </g>
        );
      })}
      {KINDS.map((node) => {
        const style = STORE_STYLE[node.store];
        const on = !dimAll || lit.has(node.kind);
        const isPicked = picked === node.kind;
        const verdict = overlay ? (node.keptAs ? "keep" : node.duplicatedBy ? "copy" : null) : null;
        return (
          <g key={node.kind} transform={`translate(${node.x - NODE_WIDTH / 2}, ${node.y - NODE_HEIGHT / 2})`} opacity={on ? 1 : 0.28}
            onClick={() => onPick(isPicked ? ANY : node.kind)} className="cursor-pointer" role="button" aria-pressed={isPicked} tabIndex={0}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onPick(isPicked ? ANY : node.kind); }}>
            <title>{`${node.label}: ${node.identity}`}</title>
            <rect width={NODE_WIDTH} height={NODE_HEIGHT} rx={6} fill="#141414" stroke={isPicked ? "#ffffff" : style.color} strokeWidth={isPicked ? 2.5 : 1.4} />
            {verdict && (
              <rect x={-4} y={-4} width={NODE_WIDTH + 8} height={NODE_HEIGHT + 8} rx={9} fill="none"
                stroke={verdict === "keep" ? OKABE.blue : OKABE.vermillion} strokeWidth={2} strokeDasharray={verdict === "copy" ? "6 4" : undefined} />
            )}
            <text x={8} y={16} fontSize={11} fill="#f5f5f5" fontWeight={600}>{node.label}</text>
            <text x={8} y={31} fontSize={9.5} fill={style.color}>
              {style.glyph} {style.label}{node.count === null ? "" : ` · ${fmtInt(node.count)}`}
            </text>
            {verdict && (
              <text x={NODE_WIDTH / 2} y={NODE_HEIGHT + 17} fontSize={9.5} textAnchor="middle" fill={verdict === "keep" ? OKABE.sky : OKABE.vermillion}>
                {verdict === "keep" ? "✓ new table kept" : "✕ new table is a copy"}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function EntityPlatformReviewPage() {
  const [step, setStep] = useState<number>(1);
  const [impact, setImpact] = useState<string>(ANY);
  const [kind, setKind] = useState<string>(ANY);
  const [overlay, setOverlay] = useState(false);
  const [defectsOnly, setDefectsOnly] = useState(false);
  const [edge, setEdge] = useState<KindEdge | null>(null);

  const inStep = SUGGESTIONS.filter((s) => step === ALL_STEPS || s.step === step);
  const shown = inStep.filter((s) => (impact === ANY || s.impact === impact) && (kind === ANY || s.kinds.includes(kind) || s.kinds.length === 0) && (!defectsOnly || s.defect));
  const lit = new Set<string>(step === ALL_STEPS ? [] : inStep.flatMap((s) => s.kinds));
  const stepInfo = STEPS.find((s) => s.step === step);
  const pickedNode = kind === ANY ? undefined : nodeOf(kind);
  const count = (test: (s: (typeof SUGGESTIONS)[number]) => boolean) => SUGGESTIONS.filter(test).length;
  const gaps = EDGES.filter((e) => e.gap).length;
  const copies = KINDS.filter((n) => n.duplicatedBy).length;
  const reset = () => { setStep(1); setImpact(ANY); setKind(ANY); setOverlay(false); setDefectsOnly(false); };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-neutral-800 px-6 py-3">
        <h1 className="text-base font-semibold text-neutral-50">Entity platform review — what to build, in what order</h1>
        <p className="mt-1 max-w-4xl text-xs text-neutral-400">
          <strong className="text-neutral-200">Problem.</strong> The entity-centric platform makes a model, study or dataset the thing every
          page follows. As built on 2026-10-01 it has one selection store, nine empty tables and a profile page whose requests the server does
          not answer. This page shows what the dashboard already knows about its entities and the {SUGGESTIONS.length} suggestions that survived
          a check against the source, in the order to do them.
        </p>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          <Stat label="Suggestions" value={fmtInt(SUGGESTIONS.length)} hint="47 findings from four research strands plus 8 from a completeness check, merged; 0 were refuted" />
          <Stat label="Broken today" value={fmtInt(count((s) => s.defect))} tone={OKABE.vermillion} hint="Defects live in the working tree now" />
          <Stat label="High impact" value={fmtInt(count((s) => s.impact === "high"))} tone={OKABE.orange} />
          <Stat label="Links already provable" value={fmtInt(EDGES.length)} tone={OKABE.sky} hint="Each is a column or file that exists today" />
          <Stat label="New tables that are copies" value="6 of 9" tone={OKABE.vermillion} hint="studies, datasets, dataset_versions, features, wfv_definitions, system_components" />
        </div>

        <ControlBar onReset={reset}>
          <SegmentControl label="Build step" value={step} onChange={setStep}
            options={[...STEPS.map((s) => ({ value: s.step as number, label: String(s.step) })), { value: ALL_STEPS, label: "all" }]} />
          <div className="flex gap-1 pb-0.5">
            <button type="button" disabled={step <= 1} onClick={() => setStep(step === ALL_STEPS ? STEPS.length : step - 1)}
              className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-neutral-500 disabled:opacity-40">◀ Back</button>
            <button type="button" disabled={step === STEPS.length} onClick={() => setStep(step === ALL_STEPS ? 1 : step + 1)}
              className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-neutral-500 disabled:opacity-40">Next step ▶</button>
          </div>
          <SelectControl label="Impact" value={impact} onChange={setImpact}
            options={[{ value: ANY, label: "any impact" }, { value: "high", label: "▲▲ high" }, { value: "medium", label: "▲ medium" }, { value: "low", label: "△ low" }]} />
          <SwitchControl label="Broken today only" checked={defectsOnly} onChange={setDefectsOnly} />
          <SwitchControl label="Overlay the nine new tables" checked={overlay} onChange={setOverlay} hint="Ring each kind a new SQLite table copies or is worth keeping for" />
        </ControlBar>

        <Section title={stepInfo ? `Step ${stepInfo.step} of ${STEPS.length}: ${stepInfo.title}` : "Every step"}
          question={stepInfo ? stepInfo.why : "All kinds are lit. Pick a step to see which kinds it touches."}>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div className="min-w-0">
              <EntityGraph lit={lit} picked={kind} overlay={overlay} onPick={setKind} onEdge={setEdge} />
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-neutral-400">
                {Object.values(STORE_STYLE).map((s) => <span key={s.label}><span style={{ color: s.color }}>{s.glyph}</span> {s.label}</span>)}
                <span><span className="text-neutral-300">──▶</span> link proven by a column or file</span>
                <span><span style={{ color: OKABE.vermillion }}>╌╌▶</span> link with a measured gap</span>
              </div>
              <p className="mt-2 min-h-[2.75rem] rounded border border-neutral-800 bg-neutral-900/50 px-2 py-1 text-[11px] text-neutral-300">
                {edge ? (
                  <>
                    <strong className="text-neutral-100">{nodeOf(edge.from)?.label} → {nodeOf(edge.to)?.label}.</strong> Proved by {edge.proof}.
                    {edge.gap && <span style={{ color: OKABE.vermillion }}> Gap: {edge.gap}.</span>}
                  </>
                ) : pickedNode ? (
                  <>
                    <strong className="text-neutral-100">{pickedNode.label}.</strong> Identity: {pickedNode.identity}.
                    {pickedNode.duplicatedBy && <span style={{ color: OKABE.vermillion }}> New table that copies it: {pickedNode.duplicatedBy}.</span>}
                    {pickedNode.keptAs && <span style={{ color: OKABE.sky }}> Keep: {pickedNode.keptAs}.</span>}
                  </>
                ) : (
                  <span className="text-neutral-500">Hover a link for the column that proves it. Click a box to keep only the suggestions that touch it.</span>
                )}
              </p>
            </div>
            <div className="min-w-0 space-y-2">
              <Finding>
                <strong>How to read it.</strong> Each box is a kind of thing the dashboard tracks, coloured and marked by where its identity
                lives; the number is how many exist. An arrow is a link that code or data already proves. Lit boxes are the kinds the
                current step changes. Counts were measured read-only on 2026-10-01; kinds that were not counted show no number.
              </Finding>
              <Finding>
                <strong>Central point.</strong> The graph already exists: {EDGES.length} links are provable today and {gaps} of them have
                measured gaps. The platform's job is to read those links through one identity, not to store a second copy;
                {" "}{copies} of the kinds here are copied by a new table, and only notes and hand-asserted links are new facts.
              </Finding>
              <Finding>
                <strong>Why it matters.</strong> Steps 1 and 2 decide whether selecting a model shows the right runs or silently shows
                none. Until both are done, every page that follows the entity is filtering on an id that does not match.
              </Finding>
            </div>
          </div>
        </Section>

        <Section title="Suggestions" question={`${shown.length} of ${SUGGESTIONS.length} shown${kind === ANY ? "" : `, touching ${pickedNode?.label ?? kind}`}. Each was reproduced against the cited lines by a second reviewer.`}>
          <div className="grid gap-2 lg:grid-cols-2">
            {shown.map((s) => (
              <article key={s.id} className="rounded border border-neutral-800 bg-neutral-900/40 p-2 text-[11px] text-neutral-300">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-neutral-500">{s.id}</span>
                  <h4 className="min-w-0 flex-1 text-xs font-semibold text-neutral-100">{s.title}</h4>
                  {s.defect && <span className="rounded border px-1.5 py-0.5 text-[10px]" style={{ borderColor: OKABE.vermillion, color: OKABE.vermillion }}>✕ broken today</span>}
                  <span className="rounded border px-1.5 py-0.5 text-[10px]" style={{ borderColor: IMPACT_STYLE[s.impact].color, color: IMPACT_STYLE[s.impact].color }}>
                    {IMPACT_STYLE[s.impact].glyph} {s.impact} impact
                  </span>
                  <span className="rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-400">{s.effort} change</span>
                </div>
                <p><span className="text-neutral-500">Today:</span> {s.today}</p>
                <p className="mt-1"><span className="text-neutral-500">Change:</span> <span className="text-neutral-100">{s.change}</span></p>
                <p className="mt-1 break-words font-mono text-[10px] text-neutral-500">{s.evidence}</p>
              </article>
            ))}
          </div>
          {shown.length === 0 && <p className="text-xs text-neutral-500">No suggestion matches these filters.</p>}
        </Section>
      </div>
    </div>
  );
}
