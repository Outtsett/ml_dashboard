/**
 * Where a transformer looked: the attention of the chosen test bar over the
 * window it read, per layer and head, from the run's own explain artifacts
 * (`GET /api/training/cycle/:id/explain/bar`, the same per-bar reply the
 * Model Cycle's Inside view reads). The bar is chosen on the Terminal view's
 * chart, or stepped here through the fold's test span.
 */
import { useState } from "react";

import type { RunView } from "@shared/runs/types";
import { Chip } from "@/runs/learning";
import { foldForTimestamp, useExplainBar, useExplainManifest, useExplainStructure } from "@/cycle/inside/useExplain";
import { AttentionBars } from "@/cycle/inside/neural/AttentionBars";
import { attentionLayers } from "@/cycle/inside/neural/stages";
import { formatBarTime } from "@/runs/barTime";

export function AttentionPanel({ run, focusTime, onFocusTime }: { run: RunView; focusTime: number | null; onFocusTime: (seconds: number) => void }) {
  const live = run.status === "running";
  const manifestQuery = useExplainManifest(run.id, live);
  const manifest = manifestQuery.data;
  // with no bar chosen, the first test bar of the first fold whose model is saved
  const defaultFold = manifest?.folds.find((fold) => fold.direction === "ready") ?? null;
  const timestamp = focusTime ?? defaultFold?.testStart ?? null;
  const fold = foldForTimestamp(manifest, timestamp);
  const foldIndex = fold?.foldIndex ?? null;
  const ready = manifest?.available === true && fold !== null && fold.direction === "ready";
  const structureQuery = useExplainStructure(run.id, foldIndex, "direction", ready);
  const barQuery = useExplainBar(run.id, foldIndex, "direction", timestamp, ready);
  const [layer, setLayer] = useState<string>("");
  const hasAttention = structureQuery.data?.neural?.hasAttention === true;
  const bar = barQuery.data;
  const layers = bar ? attentionLayers(bar) : [];
  const selectedLayer = layers.some((entry) => entry.layer === layer) ? layer : layers[0]?.layer ?? "";
  const timestamps = bar?.inputs.window?.timestamps ?? null;
  const barLength = run.setup ? barSeconds(run.setup.timeframe) : 300;

  return (
    <div className="rounded-md border border-border bg-card/60 p-3" data-testid="attention-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[12px] font-semibold text-foreground">Where the model looked: attention over the window</div>
          <div className="text-[11px] leading-snug text-muted-foreground">
            For the chosen test bar, how much of each layer's attention fell on each bar of the window it read (oldest left, the predicted bar at the right edge); one row per head. Pick a bar on the Terminal view's chart, or step here.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Chip active={false} onClick={() => timestamp !== null && onFocusTime(timestamp - barLength)}>◀ bar</Chip>
          <span className="font-mono text-[11px] text-muted-foreground">{timestamp === null ? "no bar" : formatBarTime(timestamp)}{fold ? ` · fold ${fold.foldIndex + 1}` : ""}</span>
          <Chip active={false} onClick={() => timestamp !== null && onFocusTime(timestamp + barLength)}>bar ▶</Chip>
        </div>
      </div>
      <div className="mt-2">
        {manifest?.available === false || (manifestQuery.isError && !manifest) ? (
          <div className="text-[11px] text-muted-foreground">This run saved no explain artifacts, so its attention cannot be read back.</div>
        ) : !fold ? (
          <div className="text-[11px] text-muted-foreground">{manifestQuery.isLoading ? "Reading the run's artifacts." : "Choose a bar inside one of the run's test windows."}</div>
        ) : fold.direction !== "ready" ? (
          <div className="text-[11px] text-muted-foreground">Fold {fold.foldIndex + 1}'s model is {fold.direction === "training" ? "still training" : "not saved"}; attention lands when it is.</div>
        ) : structureQuery.data && !hasAttention ? (
          <div className="text-[11px] text-muted-foreground">This network records no attention weights per bar (only `transformer_encoder` and `attention_recurrent_network` do).</div>
        ) : layers.length === 0 ? (
          <div className="text-[11px] text-muted-foreground">{barQuery.isLoading || structureQuery.isLoading ? "Explaining the bar." : barQuery.isError ? `The bar could not be explained: ${(barQuery.error as Error).message}` : "No attention for this bar."}</div>
        ) : (
          <AttentionBars layers={layers} selectedLayer={selectedLayer} onSelectLayer={setLayer} timestamps={timestamps} />
        )}
      </div>
    </div>
  );
}

function barSeconds(timeframe: string): number {
  const match = /^(\d+)(m|h|d)$/.exec(timeframe);
  if (!match) return 300;
  const unit = { m: 60, h: 3600, d: 86_400 }[match[2] as "m" | "h" | "d"];
  return Number(match[1]) * unit;
}
