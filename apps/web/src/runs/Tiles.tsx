/** A section's headline numbers, each beside the value it has to beat and, when the model declares it, how the number stands for this model. */
import { howComputed } from "@/runs/howComputed";
import type { RunMetricTile } from "@shared/runs/types";
import { formatValue, standingOf } from "@/runs/format";
import type { RunMetricStanding } from "@/ml/metrics/rows";

const STANDING = {
  beats: { color: "#E69F00", glyph: "▲", word: "beats" },
  misses: { color: "#0072B2", glyph: "▼", word: "does not beat" },
} as const;

/** How the model's own metrics record ranks a tile's metric (`packages/shared/src/cycle/metrics.ts`). */
const FOR_THIS_MODEL: Record<RunMetricStanding["standing"], { glyph: string; color: string; words: string }> = {
  primary: { glyph: "●", color: "#E69F00", words: "primary for this model" },
  secondary: { glyph: "◆", color: "#56B4E9", words: "secondary for this model" },
  diagnostic: { glyph: "○", color: "#999999", words: "diagnostic for this model" },
  not_meaningful: { glyph: "⊘", color: "#999999", words: "not meaningful for this model" },
};

export function Tiles({ tiles, standing }: { tiles: RunMetricTile[]; standing?: Map<string, RunMetricStanding> }) {
  if (tiles.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4">
      {tiles.map((tile) => {
        const against = standingOf(tile);
        const forModel = standing?.get(tile.name);
        const mark = forModel ? FOR_THIS_MODEL[forModel.standing] : null;
        const title = forModel ? `${howComputed(tile.name, tile.label)}\n\nFor this model (${mark!.words}): ${forModel.why}` : howComputed(tile.name, tile.label);
        return (
          <div
            key={tile.name}
            className={`cursor-help rounded-md border border-border bg-card/60 px-3 py-2 ${forModel?.standing === "not_meaningful" ? "opacity-60" : ""}`}
            data-testid={`tile-${tile.name}`}
            data-standing={forModel?.standing ?? "unclassified"}
            title={title}
          >
            <div className="font-mono text-[10px] uppercase text-muted-foreground">{tile.label} <span className="text-[9px] normal-case text-muted-foreground/70">· hover: how it is computed</span></div>
            <div className="font-mono text-lg font-semibold tabular-nums text-foreground">{formatValue(tile.value, tile.unit)}</div>
            {tile.baseline && (
              <div className="font-mono text-[10px] leading-tight text-muted-foreground">
                {against !== "none" && (
                  <span style={{ color: STANDING[against].color }} className="font-bold">
                    {STANDING[against].glyph} {STANDING[against].word}{" "}
                  </span>
                )}
                {formatValue(tile.baseline.value, tile.unit)} ({tile.baseline.label})
              </div>
            )}
            {mark && (
              <div className="font-mono text-[10px] leading-tight" style={{ color: mark.color }}>
                {mark.glyph} <span className="text-muted-foreground">{mark.words}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
