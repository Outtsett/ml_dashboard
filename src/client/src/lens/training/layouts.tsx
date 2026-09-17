/**
 * Five ways to arrange the same ten stages.
 *
 * These are five different information architectures, not five skins — each one
 * is shaped by a different question:
 *
 *   pipeline       "walk me through it"        one card per stage, in order
 *   console        "is it healthy right now"   dense grid, everything above the fold
 *   focus          "explain THIS stage"        one stage large, the rest a rail
 *   contact-sheet  "compare the stages"        thumbnails, click to open
 *   split          "inputs versus internals"   resizable two-column
 *
 * Every layout renders the identical stage components against the identical run
 * data. Nothing here generates a number.
 */
import { useState, type ReactNode } from "react";
import { LensRow } from "../Row";

export type LayoutId = "pipeline" | "console" | "focus" | "contact-sheet" | "split";

export const LAYOUTS: { id: LayoutId; name: string; question: string }[] = [
  { id: "pipeline", name: "Pipeline", question: "Walk me through it, stage by stage" },
  { id: "console", name: "Console", question: "Is this run healthy right now?" },
  { id: "focus", name: "Focus", question: "Explain one stage properly" },
  { id: "contact-sheet", name: "Contact sheet", question: "Compare every stage at once" },
  { id: "split", name: "Split", question: "Inputs on the left, internals on the right" },
];

export interface StagePanel {
  id: string;
  /** Short label for rails, tabs and thumbnails. */
  label: string;
  /** Which half of the pipeline it belongs to, for the split layout. */
  side: "input" | "network";
  node: ReactNode;
}

// ── 1. Pipeline ──────────────────────────────────────────────────────────────

function PipelineLayout({ stages }: { stages: StagePanel[] }) {
  return <div className="space-y-3">{stages.map(s => <div key={s.id}>{s.node}</div>)}</div>;
}

// ── 2. Console ───────────────────────────────────────────────────────────────

/**
 * Two columns, every card clipped to a fixed height with its own scroll.
 *
 * The clip is the point: a console is for answering "is anything wrong" in one
 * screen, and a card that grows to fit its content pushes the next one off the
 * fold exactly when a run is busiest.
 */
function ConsoleLayout({ stages }: { stages: StagePanel[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      {stages.map(stage => (
        <div key={stage.id} className="max-h-[340px] overflow-auto rounded-md">
          {stage.node}
        </div>
      ))}
    </div>
  );
}

// ── 3. Focus ─────────────────────────────────────────────────────────────────

function FocusLayout({ stages }: { stages: StagePanel[] }) {
  const [active, setActive] = useState(stages[0]?.id ?? "");
  const current = stages.find(s => s.id === active) ?? stages[0];
  return (
    <div className="flex gap-3">
      <nav className="w-44 shrink-0 space-y-[2px]">
        {stages.map(stage => (
          <button key={stage.id} onClick={() => setActive(stage.id)}
                  className={`w-full rounded px-2 py-1.5 text-left font-mono text-[11px] transition-colors ${
                    stage.id === (current?.id ?? "")
                      ? "bg-[#E69F00]/15 text-[#E69F00]"
                      : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300"}`}>
            {stage.label}
          </button>
        ))}
      </nav>
      <div className="min-w-0 flex-1">{current?.node}</div>
    </div>
  );
}

// ── 4. Contact sheet ─────────────────────────────────────────────────────────

/**
 * Every stage at thumbnail scale, one expanded below.
 *
 * Scaled with a CSS transform rather than by re-rendering smaller: the panels
 * draw real matrices sized to their container, and asking each to re-layout at
 * thumbnail size on every hover is work for no gain. The transform keeps them
 * pixel-identical to the full-size version, just smaller.
 */
function ContactSheetLayout({ stages }: { stages: StagePanel[] }) {
  const [opened, setOpened] = useState(stages[0]?.id ?? "");
  const current = stages.find(s => s.id === opened);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 2xl:grid-cols-4">
        {stages.map(stage => (
          <button key={stage.id} onClick={() => setOpened(stage.id)}
                  className={`h-[190px] overflow-hidden rounded-md border text-left transition-colors ${
                    stage.id === opened
                      ? "border-[#E69F00]/50" : "border-white/5 hover:border-white/15"}`}>
            <div className="pointer-events-none origin-top-left scale-[0.52]"
                 style={{ width: "192%", height: "192%" }}>
              {stage.node}
            </div>
          </button>
        ))}
      </div>
      {current && <div>{current.node}</div>}
    </div>
  );
}

// ── 5. Split ─────────────────────────────────────────────────────────────────

function SplitLayout({ stages }: { stages: StagePanel[] }) {
  const inputs = stages.filter(s => s.side === "input");
  const network = stages.filter(s => s.side === "network");
  return (
    <LensRow
      id="training-split"
      defaultLeftPercent={46}
      left={<div className="space-y-3">{inputs.map(s => <div key={s.id}>{s.node}</div>)}</div>}
      right={<div className="space-y-3">{network.map(s => <div key={s.id}>{s.node}</div>)}</div>}
    />
  );
}

// ── Switch ───────────────────────────────────────────────────────────────────

export function StageLayout({ layout, stages }: { layout: LayoutId; stages: StagePanel[] }) {
  if (stages.length === 0) return null;
  switch (layout) {
    case "console": return <ConsoleLayout stages={stages} />;
    case "focus": return <FocusLayout stages={stages} />;
    case "contact-sheet": return <ContactSheetLayout stages={stages} />;
    case "split": return <SplitLayout stages={stages} />;
    default: return <PipelineLayout stages={stages} />;
  }
}

export function LayoutPicker({ value, onChange }: {
  value: LayoutId; onChange: (layout: LayoutId) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {LAYOUTS.map(layout => (
        <button key={layout.id} onClick={() => onChange(layout.id)} title={layout.question}
                className={`rounded px-2 py-1 font-mono text-[10px] transition-colors ${
                  layout.id === value
                    ? "bg-white/10 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"}`}>
          {layout.name}
        </button>
      ))}
    </div>
  );
}
