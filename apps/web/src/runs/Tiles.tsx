/** A section's headline numbers, each beside the value it has to beat. */
import type { RunMetricTile } from "@shared/runs/types";
import { formatValue, standingOf } from "@/runs/format";

const STANDING = {
  beats: { color: "#E69F00", glyph: "▲", word: "beats" },
  misses: { color: "#0072B2", glyph: "▼", word: "does not beat" },
} as const;

export function Tiles({ tiles }: { tiles: RunMetricTile[] }) {
  if (tiles.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4">
      {tiles.map((tile) => {
        const standing = standingOf(tile);
        return (
          <div key={tile.name} className="rounded-md border border-border bg-card/60 px-3 py-2" data-testid={`tile-${tile.name}`}>
            <div className="font-mono text-[10px] uppercase text-muted-foreground">{tile.label}</div>
            <div className="font-mono text-lg font-semibold tabular-nums text-foreground">{formatValue(tile.value, tile.unit)}</div>
            {tile.baseline && (
              <div className="font-mono text-[10px] leading-tight text-muted-foreground">
                {standing !== "none" && (
                  <span style={{ color: STANDING[standing].color }} className="font-bold">
                    {STANDING[standing].glyph} {STANDING[standing].word}{" "}
                  </span>
                )}
                {formatValue(tile.baseline.value, tile.unit)} ({tile.baseline.label})
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
