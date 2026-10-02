/**
 * Leaderboard — completed experiments ranked by cost-adjusted Sharpe.
 *
 * Updates as folds complete, via the same MLStudio state the ledger table
 * reads. Rank movement is shown with DeltaValue so a model overtaking another
 * mid-run is visible rather than something you notice later by re-reading the
 * table.
 *
 * Selection is shared with the comparison matrix: picking cards here drives
 * what the matrix compares, so the two views are one workflow rather than two
 * places to repeat the same choice.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Trophy } from "lucide-react";
import { useMLStudio } from "../MLStudioContext";
import { DeltaValue } from "../telemetry/DeltaValue";
import { ExperimentCard } from "./ExperimentCard";
import { rankExperiments, rankDelta, rankSnapshot } from "./ranking";

export interface LeaderboardProps {
  /** Cards shown before the "show all" affordance. */
  limit?: number;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  className?: string;
}

export function Leaderboard({
  limit = 6,
  selectedIds = [],
  onToggleSelect,
  className = "",
}: LeaderboardProps) {
  const { state } = useMLStudio();
  const [showAll, setShowAll] = useState(false);

  const ranked = useMemo(() => rankExperiments(state.experiments), [state.experiments]);

  // Previous ranking, for movement. A ref rather than state: writing it must
  // not itself schedule a render, or every rank change costs two passes.
  const previous = useRef<Map<string, number>>(new Map());
  const deltas = useMemo(
    () => rankDelta(ranked, previous.current),
    [ranked],
  );
  useEffect(() => {
    previous.current = rankSnapshot(ranked);
  }, [ranked]);

  if (ranked.length === 0) return null;

  const visible = showAll ? ranked : ranked.slice(0, limit);
  const selected = new Set(selectedIds);

  return (
    <section className={`flex flex-col gap-2 ${className}`} aria-label="Experiment leaderboard">
      <header className="flex items-center justify-between gap-2 px-0.5">
        <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-muted-foreground/70">
          <Trophy className="h-3 w-3" aria-hidden="true" />
          Leaderboard · cost-adjusted Sharpe
        </span>
        {ranked.length > limit && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[10px] text-primary hover:underline"
          >
            {showAll ? "Show top" : `Show all ${ranked.length}`}
          </button>
        )}
      </header>

      <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]">
        {visible.map((entry) => {
          const movement = deltas.get(entry.experiment.id);
          return (
            <div key={entry.experiment.id} className="flex flex-col gap-1">
              <ExperimentCard
                entry={entry}
                selected={selected.has(entry.experiment.id)}
                onToggle={onToggleSelect}
              />
              {/* Only rendered once an experiment has actually moved — a new
                  entrant has no movement to report. */}
              {movement != null && movement !== 0 && (
                <DeltaValue
                  value={-entry.rank}
                  label="rank"
                  format={(v) => `#${Math.abs(v)}`}
                  formatDelta={(d) => `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(0)}`}
                  className="px-1"
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
