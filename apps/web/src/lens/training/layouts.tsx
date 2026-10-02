/**
 * Three ways to arrange the stages, all built around one rule: a panel is
 * large enough to read without squinting.
 *
 *   theatre  "explain THIS stage"   one stage on a big stage, tabs above
 *   stack    "walk me through it"   every stage full width, in order
 *   two-up   "compare two stages"   pick a left and a right, side by side
 *
 * An earlier version offered a dense console grid and a thumbnail contact
 * sheet. Both shrank the panels to fit more of them on screen, which is the
 * opposite of what these views are for — a 4x4 attention matrix at thumbnail
 * scale shows that attention exists, not what it is attending to. They are
 * gone; the arrangements that survive differ in NAVIGATION, never in size.
 *
 * Every layout renders the identical stage components against the identical run
 * data. Nothing here generates a number.
 */
import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { LensRow } from "../Row";
import { LensFrameHeight } from "../Frame";

export type LayoutId = "theatre" | "stack" | "two-up";

export const LAYOUTS: { id: LayoutId; name: string; question: string }[] = [
  { id: "theatre", name: "Theatre", question: "Put one stage on a big stage and explain it properly" },
  { id: "stack", name: "Stack", question: "Walk me through every stage, full width, in order" },
  { id: "two-up", name: "Two-up", question: "Show me two stages side by side" },
];

/** How tall one stage gets in each arrangement, before any drag. */
const THEATRE_HEIGHT = 700;
const STACK_HEIGHT = 460;
const TWO_UP_HEIGHT = 560;

export interface StagePanel {
  id: string;
  /** Short label for the tab strip and the two-up pickers. */
  label: string;
  /** Which half of the pipeline it belongs to, for the two-up defaults. */
  side: "input" | "network";
  node: ReactNode;
}

// ── 1. Theatre ───────────────────────────────────────────────────────────────

/**
 * One stage, ~700px tall and the full width of the page, with a tab strip above
 * it. Switching stages costs one click and no scrolling, and the panel on
 * screen is big enough that the matrices inside it are legible.
 *
 * Only the selected stage is mounted. That is deliberate: each panel fetches
 * its own parquet snapshot, so keeping all seven alive would mean seven
 * requests per epoch to draw one of them.
 */
function TheatreLayout({ stages }: { stages: StagePanel[] }) {
  const [active, setActive] = useState(stages[0]!.id);
  const index = Math.max(0, stages.findIndex(s => s.id === active));
  const current = stages[index]!;
  const step = (delta: number) =>
    setActive(stages[(index + delta + stages.length) % stages.length]!.id);

  return (
    <div className="space-y-2">
      <div className="flex items-stretch gap-1 rounded-lg border border-border bg-card p-1">
        <StepButton label="Previous stage" onClick={() => step(-1)}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </StepButton>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {/* No tab index is drawn: each label already opens with its position
              in the ten-stage pipeline, and some panels cover two steps
              ("2/3 - Vectorize"), so a second running count would contradict
              the one that carries meaning. */}
          {stages.map(stage => {
            const selected = stage.id === current.id;
            return (
              <button
                key={stage.id}
                onClick={() => setActive(stage.id)}
                aria-current={selected ? "true" : undefined}
                title={stage.label}
                className={`min-w-0 flex-1 truncate whitespace-nowrap rounded px-2.5 py-2 text-left font-mono text-[11px] transition-colors ${
                  selected
                    ? "bg-[#E69F00]/15 text-[#E69F00]"
                    : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300"}`}
              >
                {stage.label}
              </button>
            );
          })}
        </div>
        <StepButton label="Next stage" onClick={() => step(1)}>
          <ChevronRight className="h-3.5 w-3.5" />
        </StepButton>
      </div>

      <LensFrameHeight height={THEATRE_HEIGHT} slot="theatre">
        <div key={current.id}>{current.node}</div>
      </LensFrameHeight>
    </div>
  );
}

function StepButton({ label, onClick, children }: {
  label: string; onClick: () => void; children: ReactNode;
}) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
            className="shrink-0 rounded px-1.5 text-zinc-500 transition-colors hover:bg-white/[0.03] hover:text-zinc-200">
      {children}
    </button>
  );
}

// ── 2. Stack ─────────────────────────────────────────────────────────────────

function StackLayout({ stages }: { stages: StagePanel[] }) {
  return (
    <LensFrameHeight height={STACK_HEIGHT} slot="stack">
      <div className="space-y-3">{stages.map(s => <div key={s.id}>{s.node}</div>)}</div>
    </LensFrameHeight>
  );
}

// ── 3. Two-up ────────────────────────────────────────────────────────────────

/**
 * Two stages the reader picks, side by side in a draggable split. The defaults
 * are the first input stage and the first network stage, because the comparison
 * this view exists for is "what went in" against "what the network did with it".
 */
function TwoUpLayout({ stages }: { stages: StagePanel[] }) {
  const [leftId, setLeftId] = useState(
    (stages.find(s => s.side === "input") ?? stages[0]!).id);
  const [rightId, setRightId] = useState(
    (stages.find(s => s.side === "network") ?? stages[stages.length - 1]!).id);
  const left = stages.find(s => s.id === leftId) ?? stages[0]!;
  const right = stages.find(s => s.id === rightId) ?? stages[stages.length - 1]!;

  const picker = (value: string, onChange: (id: string) => void) => (
    <select value={value} onChange={event => onChange(event.target.value)}
            className="w-full rounded border border-border bg-card px-2 py-1.5 font-mono text-[11px] text-zinc-300">
      {stages.map(stage => (
        <option key={stage.id} value={stage.id}>{stage.label}</option>
      ))}
    </select>
  );

  return (
    <LensFrameHeight height={TWO_UP_HEIGHT} slot="two-up">
      <LensRow
        id="training-two-up"
        defaultLeftPercent={50}
        left={<div className="space-y-2">{picker(left.id, setLeftId)}{left.node}</div>}
        right={<div className="space-y-2">{picker(right.id, setRightId)}{right.node}</div>}
      />
    </LensFrameHeight>
  );
}

// ── Switch ───────────────────────────────────────────────────────────────────

export function StageLayout({ layout, stages }: { layout: LayoutId; stages: StagePanel[] }) {
  if (stages.length === 0) return null;
  switch (layout) {
    case "stack": return <StackLayout stages={stages} />;
    case "two-up": return <TwoUpLayout stages={stages} />;
    default: return <TheatreLayout stages={stages} />;
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

