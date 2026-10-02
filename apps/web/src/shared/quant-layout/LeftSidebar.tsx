/**
 * Entity Browser Sidebar — persistent left panel for browsing and selecting
 * entities across the entire platform.
 *
 * Models are organized into collapsible category → subcategory groups using
 * the taxonomy from the Model Catalog. Model versions are nested under their
 * respective models.
 *
 * SRP: Renders the entity tree and dispatches selection to EntityContext.
 */

import { useState, useMemo } from "react";
import { cn } from "@/shared/utils/utils";
import {
  PanelLeftClose, PanelLeftOpen, BrainCircuit, Search,
  FlaskConical, Database, Sparkles, Target, ChevronDown, ChevronRight, Folder, GitMerge
} from "lucide-react";
import { useEntityStore, type EntityType } from "@/shared/contexts/EntityContext";
import {
  useEntityModels, useEntityStudies, useEntityDatasets,
  useEntityFeatures, useEntityStrategies, useModelVersions, type ModelVersionEntity
} from "@/shared/hooks/useEntityBrowser";
import { useCatalogTaxonomy } from "@/ml/lib/useModelCatalog";
import { categoryColor } from "@/ml/constants";
import type { CatalogModelSummary } from "@/ml/lib/catalog_types";

/** A category → subcategory → models[] tree for the sidebar. */
interface ModelGroup {
  category: string;
  categoryLabel: string;
  subcategories: {
    subcategory: string;
    label: string;
    models: CatalogModelSummary[];
  }[];
  totalCount: number;
}

/** Build the grouped tree from a flat model list + taxonomy labels. */
function groupModels(
  models: CatalogModelSummary[],
  categoryLabels: Record<string, string>
): ModelGroup[] {
  const map = new Map<string, Map<string, CatalogModelSummary[]>>();

  for (const m of models) {
    if (!map.has(m.category)) map.set(m.category, new Map());
    const subs = map.get(m.category)!;
    if (!subs.has(m.subcategory)) subs.set(m.subcategory, []);
    subs.get(m.subcategory)!.push(m);
  }

  const groups: ModelGroup[] = [];
  for (const [category, subs] of map) {
    const subcategories = [...subs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([subcategory, models]) => ({
        subcategory,
        label: subcategory.replace(/-/g, " "),
        models: models.sort((a, b) => a.name.localeCompare(b.name)),
      }));
    groups.push({
      category,
      categoryLabel: categoryLabels[category] ?? category.replace(/-/g, " "),
      subcategories,
      totalCount: subcategories.reduce((sum, s) => sum + s.models.length, 0),
    });
  }

  return groups.sort((a, b) => a.categoryLabel.localeCompare(b.categoryLabel));
}

export function LeftSidebar({ collapsed = false, onToggle }: { collapsed?: boolean; onToggle?: () => void }) {
  const { setEntity, activeEntity } = useEntityStore();
  const [searchQuery, setSearchQuery] = useState("");

  const { data: models = [] } = useEntityModels();
  const { data: studies = [] } = useEntityStudies();
  const { data: datasets = [] } = useEntityDatasets();
  const { data: features = [] } = useEntityFeatures();
  const { data: strategies = [] } = useEntityStrategies();
  const { data: versionsData } = useModelVersions();
  const { data: taxonomyData } = useCatalogTaxonomy();

  const categoryLabels = taxonomyData?.categoryLabels ?? {};
  const versions = versionsData?.items || [];

  // Group versions by catalogId
  const versionsByModel = useMemo(() => {
    const map = new Map<string, ModelVersionEntity[]>();
    for (const v of versions) {
      if (!map.has(v.catalogId)) map.set(v.catalogId, []);
      map.get(v.catalogId)!.push(v);
    }
    // Sort versions by versionId desc
    for (const list of map.values()) {
      list.sort((a, b) => b.versionId - a.versionId);
    }
    return map;
  }, [versions]);

  // Expanded state: top-level entity types + model categories + subcategories
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    model: true,
    study: false,
    dataset: false,
    feature: false,
    strategy: false,
  });

  const toggle = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const q = searchQuery.toLowerCase();

  // Filter models and build grouped tree
  const filteredModels = useMemo(
    () => models.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q) ||
      m.subcategory.toLowerCase().includes(q)
    ),
    [models, q]
  );
  const modelTree = useMemo(() => groupModels(filteredModels, categoryLabels), [filteredModels, categoryLabels]);

  // Filter other entity types
  const filteredStudies = useMemo(() => studies.filter(s => s.title.toLowerCase().includes(q)), [studies, q]);
  const filteredDatasets = useMemo(() => datasets.filter(d => d.name.toLowerCase().includes(q)), [datasets, q]);
  const filteredFeatures = useMemo(() => features.filter(f => f.name.toLowerCase().includes(q)), [features, q]);
  const filteredStrategies = useMemo(() => strategies.filter(s => s.name.toLowerCase().includes(q)), [strategies, q]);

  // Entities carrying a category (Datasets, Features) are listed under their
  // category heading rather than one flat 79-row list. Categories are ordered by
  // size, so the group holding most of the entries reads first; an entity with no
  // category lands under "Other" rather than being dropped.
  const groupByCategory = (items: { id: string; name: string; category: string }[]) => {
    const byCategory = new Map<string, { id: string; name: string }[]>();
    for (const item of items) {
      const key = item.category || "Other";
      const bucket = byCategory.get(key);
      if (bucket) bucket.push({ id: item.id, name: item.name });
      else byCategory.set(key, [{ id: item.id, name: item.name }]);
    }
    return [...byCategory.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([category, entries]) => ({ id: category, name: category, entries }));
  };

  // Flat entity sections (non-model)
  const flatSections = [
    { id: "study" as EntityType, title: "Studies", icon: FlaskConical, items: filteredStudies.map(s => ({ id: s.slug, name: s.title })) },
    { id: "dataset" as EntityType, title: "Datasets", icon: Database, items: groupByCategory(filteredDatasets) },
    { id: "feature" as EntityType, title: "Features", icon: Sparkles, items: groupByCategory(filteredFeatures) },
    { id: "strategy" as EntityType, title: "Strategies", icon: Target, items: filteredStrategies.map(s => ({ id: s.id, name: s.name })) },
  ];

  return (
    <div className={cn(
      "h-full shrink-0 bg-neutral-950 border-r border-neutral-800 flex flex-col transition-all duration-300 overflow-hidden",
      collapsed ? "w-12" : "w-72"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-neutral-800 shrink-0">
        {!collapsed && <span className="text-xs font-semibold tracking-wider text-neutral-400 uppercase">Entities</span>}
        {onToggle && (
          <button
            type="button"
            onClick={onToggle}
            data-testid="nav-toggle"
            className="text-neutral-500 hover:text-neutral-200 transition-colors"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Search */}
      {!collapsed && (
        <div className="p-3 border-b border-neutral-800 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-neutral-500" />
            <input
              type="text"
              placeholder="Search entities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-neutral-900 border border-neutral-800 rounded-md pl-9 pr-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 transition-colors"
            />
          </div>
        </div>
      )}

      {/* Scrollable entity tree */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-1 p-2 scrollbar-thin">

        {/* ── Models Section (grouped by category → subcategory) ── */}
        {!collapsed && (
          <div className="flex flex-col">
            <button
              onClick={() => toggle("model")}
              className="flex items-center gap-2 px-2 py-1.5 w-full text-left rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 transition-colors group"
            >
              {expanded.model ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50 group-hover:opacity-100" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50 group-hover:opacity-100" />
              )}
              <BrainCircuit className="h-4 w-4 shrink-0" />
              <span className="text-sm font-medium flex-1">Models</span>
              <span className="text-xs font-mono bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded-sm">
                {filteredModels.length}
              </span>
            </button>

            {expanded.model && modelTree.length > 0 && (
              <div className="flex flex-col gap-0.5 mt-1 ml-3">
                {modelTree.map((group) => {
                  const catKey = `model-cat-${group.category}`;
                  const isCatExpanded = expanded[catKey] ?? false;

                  return (
                    <div key={group.category} className="flex flex-col">
                      {/* Category header */}
                      <button
                        onClick={() => toggle(catKey)}
                        className="flex items-center gap-2 px-2 py-1 w-full text-left rounded hover:bg-neutral-900 transition-colors group"
                      >
                        {isCatExpanded ? (
                          <ChevronDown className="h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100 text-neutral-500" />
                        ) : (
                          <ChevronRight className="h-3 w-3 shrink-0 opacity-50 group-hover:opacity-100 text-neutral-500" />
                        )}
                        <span className={cn("text-[11px] font-medium px-1.5 py-0.5 rounded border capitalize", categoryColor(group.category))}>
                          {group.categoryLabel}
                        </span>
                        <span className="text-[10px] font-mono text-neutral-500 ml-auto">
                          {group.totalCount}
                        </span>
                      </button>

                      {/* Subcategories + models */}
                      {isCatExpanded && (
                        <div className="flex flex-col gap-0.5 ml-3 mt-0.5 border-l border-neutral-800/50 pl-2">
                          {group.subcategories.map((sub) => {
                            const subKey = `model-sub-${group.category}-${sub.subcategory}`;
                            const isSubExpanded = expanded[subKey] ?? true;

                            return (
                              <div key={sub.subcategory} className="flex flex-col">
                                {/* Subcategory header — only show if multiple subcategories */}
                                {group.subcategories.length > 1 && (
                                  <button
                                    onClick={() => toggle(subKey)}
                                    className="flex items-center gap-1.5 px-1.5 py-0.5 w-full text-left rounded hover:bg-neutral-900 transition-colors group"
                                  >
                                    {isSubExpanded ? (
                                      <ChevronDown className="h-2.5 w-2.5 shrink-0 opacity-40 group-hover:opacity-100 text-neutral-600" />
                                    ) : (
                                      <ChevronRight className="h-2.5 w-2.5 shrink-0 opacity-40 group-hover:opacity-100 text-neutral-600" />
                                    )}
                                    <Folder className="h-3 w-3 shrink-0 text-neutral-600" />
                                    <span className="text-[11px] text-neutral-500 capitalize truncate">{sub.label}</span>
                                    <span className="text-[10px] font-mono text-neutral-600 ml-auto">{sub.models.length}</span>
                                  </button>
                                )}

                                {/* Model items */}
                                {(group.subcategories.length === 1 || isSubExpanded) && (
                                  <div className={cn("flex flex-col gap-0.5", group.subcategories.length > 1 && "ml-3 border-l border-neutral-800/30 pl-1.5")}>
                                    {sub.models.map((model) => {
                                      const isModelActive = activeEntity?.type === "model" && activeEntity?.id === model.id;
                                      const modelVersions = versionsByModel.get(model.id) || [];
                                      const hasVersions = modelVersions.length > 0;
                                      const modelKey = `model-item-${model.id}`;
                                      const isModelExpanded = expanded[modelKey] ?? false;

                                      return (
                                        <div key={model.id} className="flex flex-col">
                                          <div className={cn(
                                            "flex items-center gap-1.5 rounded transition-colors pr-2",
                                            isModelActive ? "bg-blue-500/10" : "hover:bg-neutral-800/50"
                                          )}>
                                            {hasVersions ? (
                                              <button
                                                onClick={() => toggle(modelKey)}
                                                className="p-1 hover:bg-neutral-700/50 rounded"
                                              >
                                                {isModelExpanded ? (
                                                  <ChevronDown className="h-3 w-3 text-neutral-500" />
                                                ) : (
                                                  <ChevronRight className="h-3 w-3 text-neutral-500" />
                                                )}
                                              </button>
                                            ) : (
                                              <div className="w-5 shrink-0" />
                                            )}
                                            <button
                                              onClick={() => {
                                                setEntity("model", model.id, model.name);
                                                if (hasVersions && !isModelExpanded) toggle(modelKey);
                                              }}
                                              className="flex-1 flex items-center gap-1.5 py-1 outline-none text-left min-w-0"
                                              title={`${model.name} — ${model.overview?.slice(0, 80) ?? ""}`}
                                            >
                                              <BrainCircuit className={cn("h-3 w-3 shrink-0", isModelActive ? "text-blue-500" : "text-neutral-600")} />
                                              <span className={cn("text-xs truncate", isModelActive ? "text-blue-400 font-medium" : "text-neutral-400 hover:text-neutral-200")}>
                                                {model.name}
                                              </span>
                                              {hasVersions && (
                                                <span className="text-[9px] bg-neutral-800 text-neutral-500 px-1 rounded ml-auto">
                                                  v{modelVersions.length}
                                                </span>
                                              )}
                                            </button>
                                          </div>
                                          
                                          {/* Nested Versions */}
                                          {hasVersions && isModelExpanded && (
                                            <div className="flex flex-col gap-0.5 ml-5 mt-0.5 mb-1 border-l border-neutral-800/50 pl-2">
                                              {modelVersions.map(v => {
                                                const isVersionActive = activeEntity?.type === "model" && activeEntity?.id === v.runnerKey;
                                                const vName = v.versionAlias || `v${v.versionId}`;
                                                return (
                                                  <button
                                                    key={v.versionId}
                                                    onClick={() => setEntity("model", v.runnerKey, `${model.name} (${vName})`)}
                                                    className={cn(
                                                      "flex items-center gap-1.5 px-2 py-0.5 rounded text-left transition-colors outline-none",
                                                      isVersionActive
                                                        ? "bg-blue-500/10 text-blue-400 font-medium"
                                                        : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/50"
                                                    )}
                                                  >
                                                    <GitMerge className={cn("h-2.5 w-2.5 shrink-0", isVersionActive ? "text-blue-500" : "text-neutral-600")} />
                                                    <span className="text-[11px] truncate flex-1">{vName}</span>
                                                    <span className="text-[9px] text-neutral-600 capitalize">{v.status}</span>
                                                  </button>
                                                )
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Flat entity sections (Studies, Datasets, Features, Strategies) ── */}
        {flatSections.map((section) => {
          const isExpanded = expanded[section.id] ?? false;
          const hasItems = section.items.length > 0;

          if (collapsed) {
            return (
              <div key={section.id} className="flex flex-col items-center py-2 gap-1">
                <div title={section.title} className="text-neutral-500">
                  <section.icon className="h-5 w-5" />
                </div>
              </div>
            );
          }

          if (q && !hasItems) return null;

          return (
            <div key={section.id} className="flex flex-col">
              <button
                onClick={() => toggle(section.id)}
                className="flex items-center gap-2 px-2 py-1.5 w-full text-left rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900 transition-colors group"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50 group-hover:opacity-100" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50 group-hover:opacity-100" />
                )}
                <section.icon className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium flex-1">{section.title}</span>
                <span className="text-xs font-mono bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded-sm">
                  {section.items.length}
                </span>
              </button>

              {isExpanded && hasItems && (
                <div className="flex flex-col gap-0.5 mt-1 mb-2 ml-4 border-l border-neutral-800/50 pl-2">
                  {section.items.map((item) => {
                    // A category entry carries `entries`; a flat entity does not.
                    const isGroup = 'entries' in item;
                    const isActive = !isGroup && activeEntity?.type === section.id && activeEntity?.id === item.id;
                    return (
                      <div key={item.id} className="flex flex-col">
                        <button
                          onClick={() => !isGroup && setEntity(section.id, item.id, item.name)}
                          className={cn(
                            "flex items-center px-2 py-1.5 rounded text-left transition-colors whitespace-nowrap outline-none",
                            isGroup ? "cursor-default" : "",
                            isActive
                              ? "bg-blue-500/10 text-blue-400 font-medium"
                              : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
                          )}
                          title={isGroup ? `${item.name} (${item.entries!.length})` : item.name}
                        >
                          <span className={cn("text-xs truncate", isGroup && "text-neutral-500 uppercase tracking-wide")}>
                            {item.name}
                          </span>
                          {isGroup && (
                            <span className="ml-auto pl-2 text-[10px] font-mono text-neutral-600">
                              {item.entries!.length}
                            </span>
                          )}
                        </button>
                        {isGroup && (
                          <div className="flex flex-col gap-0.5 ml-2 border-l border-neutral-800/40 pl-2">
                            {item.entries!.map((entry) => {
                              const entryActive = activeEntity?.type === section.id && activeEntity?.id === entry.id;
                              return (
                                <button
                                  key={entry.id}
                                  onClick={() => setEntity(section.id, entry.id, entry.name)}
                                  className={cn(
                                    "flex items-center px-2 py-1 rounded text-left transition-colors whitespace-nowrap outline-none",
                                    entryActive
                                      ? "bg-blue-500/10 text-blue-400 font-medium"
                                      : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
                                  )}
                                  title={entry.name}
                                >
                                  <span className="text-xs truncate">{entry.name}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Collapsed: show model icons only */}
        {collapsed && (
          <div className="flex flex-col items-center py-2 gap-1">
            <div title="Models" className="text-neutral-500 mb-1">
              <BrainCircuit className="h-5 w-5" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
