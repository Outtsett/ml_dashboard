/**
 * Model Cycle model browser: every model in the Cycle's registry
 * (`GET /api/training/cycle-models`), grouped by the user's catalog category
 * and subcategory, with the catalog specs the Cycle cannot run greyed out
 * beside the reason. Picking a runnable card hands its runner key
 * (`<key>+walk_forward_cycle`) to `ConfigForm`, which owns the parameters.
 *
 * Render only: the data comes from `useCycleModels` and the filtering from
 * the pure helpers in `useCycleCatalog.ts`. Laid out as one column so it reads
 * at the side panel's 380 px minimum.
 */
import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { BookOpen, ChevronDown, ChevronRight, Search } from "lucide-react";

import { cn } from "@/shared/utils/utils";
import { Badge } from "@/shared/ui/badge";
import { Input } from "@/shared/ui/input";
import type { CycleModelCard, CycleModelsResponse } from "@shared/cycle/models";

import {
  categoryOfRunnerKey,
  cycleModelsFromRunnerEntries,
  filterCycleModels,
  runnerKeyForCard,
  useCycleModels,
  type CycleCatalogEntry,
} from "@/cycle/useCycleCatalog";

// ─── Badges and chips ────────────────────────────────────────────────────────

/** Okabe-Ito tints per registry `kind`; the badge always carries the kind in words, so colour only reinforces it. */
const KIND_BADGE_CLASS: Record<string, string> = {
  Linear: "border-[#0072B2]/40 text-[#56B4E9] bg-[#0072B2]/10",
  "Tree ensemble": "border-[#009E73]/40 text-[#009E73] bg-[#009E73]/10",
  "Single tree": "border-dashed border-[#009E73]/50 text-[#009E73] bg-transparent",
  "Neural network": "border-[#E69F00]/40 text-[#E69F00] bg-[#E69F00]/10",
  "Sequence network": "border-[#CC79A7]/40 text-[#CC79A7] bg-[#CC79A7]/10",
  Margin: "border-[#D55E00]/40 text-[#D55E00] bg-[#D55E00]/10",
  "Nearest neighbors": "border-[#56B4E9]/40 text-[#56B4E9] bg-[#56B4E9]/10",
  Probabilistic: "border-[#F0E442]/40 text-[#F0E442] bg-[#F0E442]/10",
  "Ensemble of models": "border-dashed border-[#CC79A7]/50 text-[#CC79A7] bg-transparent",
};
const KIND_BADGE_FALLBACK = "border-white/20 text-neutral-300 bg-white/5";

const SPEED_WORDS: Record<NonNullable<CycleModelCard["speed"]>, string> = {
  fast: "Fast to train",
  medium: "Medium to train",
  slow: "Slow to train",
};

function Chip({ children, title, dashed = false }: { children: ReactNode; title?: string; dashed?: boolean }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-px text-[10px] leading-4 text-neutral-300",
        dashed ? "border-dashed border-white/25" : "border-white/15 bg-white/[0.04]",
      )}
    >
      {children}
    </span>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

interface CardState {
  selectable: boolean;
  /** Why the card cannot be picked; null when it can. */
  reason: string | null;
}

function cardState(card: CycleModelCard, runnerKeys: ReadonlySet<string>, runnersLoading: boolean, disabled: boolean): CardState {
  if (!card.runnable) return { selectable: false, reason: card.unavailableReason ?? "The Cycle cannot run this model." };
  const runnerKey = runnerKeyForCard(card);
  if (!runnerKey || !runnerKeys.has(runnerKey)) {
    return {
      selectable: false,
      reason: runnersLoading ? "Loading its parameters…" : "The server has no runner for this model yet, so its parameters cannot be set.",
    };
  }
  return { selectable: !disabled, reason: null };
}

function ModelCard({
  card,
  selected,
  state,
  onSelect,
}: {
  card: CycleModelCard;
  selected: boolean;
  state: CardState;
  onSelect: () => void;
}) {
  const testId = card.key ?? card.catalogSpecId ?? card.displayName;
  const showSpecLink = card.specAvailable && card.catalogSpecId !== null;
  return (
    <div
      data-testid={`cycle-model-card-${testId}`}
      className={cn(
        "rounded-lg border transition-colors",
        selected ? "border-[#E69F00] bg-[#E69F00]/10" : "border-white/10 bg-white/[0.02]",
        state.selectable && !selected && "hover:border-white/25",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={!state.selectable}
        aria-pressed={selected}
        className={cn(
          "block w-full rounded-lg p-3 pb-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0072B2]",
          !state.selectable && "cursor-not-allowed",
          state.reason !== null && "opacity-50",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
          <span className="min-w-0 break-words text-sm font-semibold text-neutral-100">{card.displayName}</span>
          {card.kind && (
            <Badge variant="outline" className={cn("shrink-0 text-[10px]", KIND_BADGE_CLASS[card.kind] ?? KIND_BADGE_FALLBACK)}>
              {card.kind}
            </Badge>
          )}
        </div>
        {card.summary && <p className="mt-1 text-[11px] leading-snug text-neutral-400">{card.summary}</p>}
        {(card.speed || card.hasPriceModel === false || card.sequence) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {card.speed && (
              <Chip title={card.estimatedTrainingTime ? `Estimated training time: ${card.estimatedTrainingTime}` : undefined}>
                {SPEED_WORDS[card.speed]}
              </Chip>
            )}
            {card.hasPriceModel === false && <Chip dashed>No price model — no forecast line</Chip>}
            {card.sequence && <Chip>Reads a window of bars</Chip>}
          </div>
        )}
        {card.implementationNote && <p className="mt-1.5 text-[10.5px] italic leading-snug text-neutral-500">{card.implementationNote}</p>}
      </button>
      {(state.reason !== null || showSpecLink) && (
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-3 pb-2">
          {state.reason !== null ? <p className="min-w-0 flex-1 text-[10.5px] leading-snug text-neutral-300">{state.reason}</p> : <span />}
          {showSpecLink && (
            <Link
              href={`/model-catalog?model=${encodeURIComponent(card.catalogSpecId!)}`}
              className="flex shrink-0 items-center gap-1 text-[10.5px] text-[#56B4E9] hover:underline"
              aria-label={`Open the ${card.displayName} spec in the model catalog`}
            >
              <BookOpen className="h-3 w-3" aria-hidden="true" /> spec
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Browser ─────────────────────────────────────────────────────────────────

export interface ModelBrowserProps {
  /** Runner key of the picked model, `"<key>+walk_forward_cycle"`. */
  selectedRunnerKey: string | null;
  onSelect: (runnerKey: string) => void;
  /** The runner entries (`useCycleCatalog`): a runnable card is selectable only when its runner is among them. */
  runnerEntries: CycleCatalogEntry[];
  runnersLoading?: boolean;
  disabled?: boolean;
}

export function ModelBrowser({ selectedRunnerKey, onSelect, runnerEntries, runnersLoading = false, disabled = false }: ModelBrowserProps) {
  const models = useCycleModels();
  const [search, setSearch] = useState("");
  /** Categories the user opened or closed by hand; the rest follow the default. */
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const registryFailed = models.isError;
  const response: CycleModelsResponse | undefined = models.data ?? (registryFailed ? cycleModelsFromRunnerEntries(runnerEntries) : undefined);
  const visible = response ? filterCycleModels(response, search) : undefined;
  const searching = search.trim().length > 0;
  const runnerKeys = new Set(runnerEntries.map((entry) => entry.key));

  const selectedCategory = response ? categoryOfRunnerKey(response, selectedRunnerKey) : null;
  const firstRunnableCategory = response?.categories.find((category) => category.runnableCount > 0)?.id ?? null;
  const isOpen = (id: string) => (searching ? true : toggled[id] ?? id === (selectedCategory ?? firstRunnableCategory));
  const toggle = (id: string) => setToggled((prev) => ({ ...prev, [id]: !isOpen(id) }));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest text-neutral-500">Model</span>
        {response && (
          <span className="text-[10px] text-neutral-500">
            {response.runnableCount} of {response.totalCount} runnable
          </span>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500" aria-hidden="true" />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, kind or category"
          aria-label="Search models"
          className="h-8 pl-7 text-sm"
        />
      </div>

      {models.isLoading && <p className="text-[11px] text-neutral-500">Loading models…</p>}
      {registryFailed && (
        <p className="rounded-md border border-dashed border-white/20 px-2 py-1.5 text-[11px] leading-snug text-neutral-400">
          The model registry did not load ({models.error instanceof Error ? models.error.message : "unknown error"}); showing the runners the server has, without their badges.
        </p>
      )}
      {response && !response.catalogAvailable && !registryFailed && (
        <p className="text-[10.5px] text-neutral-500">The model catalog folder is not on disk, so models are grouped by the registry&apos;s own labels.</p>
      )}
      {visible && visible.categories.length === 0 && (
        <p className="text-[11px] text-neutral-500">{searching ? `No model matches "${search.trim()}".` : "No models."}</p>
      )}

      {visible?.categories.map((category) => {
        const open = isOpen(category.id);
        const total = category.subcategories.reduce((sum, subcategory) => sum + subcategory.models.length, 0);
        return (
          <section key={category.id} className="rounded-lg border border-white/10">
            <button
              type="button"
              onClick={() => toggle(category.id)}
              aria-expanded={open}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0072B2]"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-neutral-500" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-neutral-500" aria-hidden="true" />}
                <span className="min-w-0 break-words text-xs font-semibold text-neutral-200">{category.label}</span>
              </span>
              <span className="shrink-0 text-[10px] text-neutral-500">
                {category.runnableCount} of {total} runnable
              </span>
            </button>
            {open && (
              <div className="space-y-3 border-t border-white/5 px-2 py-2">
                {category.subcategories.map((subcategory) => (
                  <div key={subcategory.id}>
                    <h4 className="mb-1.5 px-1 text-[10px] uppercase tracking-widest text-neutral-500">{subcategory.label}</h4>
                    <div className="space-y-1.5">
                      {subcategory.models.map((card) => {
                        const runnerKey = runnerKeyForCard(card);
                        return (
                          <ModelCard
                            key={`${card.key ?? "spec"}:${card.catalogSpecId ?? card.displayName}`}
                            card={card}
                            selected={runnerKey !== null && runnerKey === selectedRunnerKey}
                            state={cardState(card, runnerKeys, runnersLoading, disabled)}
                            onSelect={() => {
                              if (runnerKey) onSelect(runnerKey);
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
