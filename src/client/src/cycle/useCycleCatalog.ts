/**
 * The Model Cycle's slice of the trainable catalog: entries whose runner key
 * ends `+walk_forward_cycle`, one per model family, with hyperparameters
 * grouped in the display order the config form uses.
 */
import { useMemo } from "react";

import { useTrainableCatalog } from "@/ml/lib/useModelCatalog";
import { cycleModelFamilySchema, type CycleModelFamily } from "@shared/cycle/schema";
import type { HyperparameterDef } from "@shared/trainingTypes";

export const CYCLE_RUNNER_SUFFIX = "+walk_forward_cycle";

/** Display order for hyperparameter groups; a group outside this list is appended after, in catalog order. */
export const CYCLE_GROUP_ORDER = ["Model", "Walk-forward", "Labels", "Trading", "Tuning", "Replay", "Runtime"] as const;

export interface CycleParameterGroup {
  name: string;
  parameters: Array<{ key: string; def: HyperparameterDef }>;
}

export interface CycleCatalogEntry {
  /** Runner key, `"<family>+walk_forward_cycle"`. */
  key: string;
  family: CycleModelFamily;
  label: string;
  description?: string;
  groups: CycleParameterGroup[];
  hyperparameters: Record<string, HyperparameterDef>;
}

function groupEntry(key: string, family: CycleModelFamily, label: string, description: string | undefined, hyperparameters: Record<string, HyperparameterDef>): CycleCatalogEntry {
  const byGroup = new Map<string, Array<{ key: string; def: HyperparameterDef }>>();
  for (const [paramKey, def] of Object.entries(hyperparameters)) {
    const groupName = def.group && def.group.length > 0 ? def.group : "Model";
    if (!byGroup.has(groupName)) byGroup.set(groupName, []);
    byGroup.get(groupName)!.push({ key: paramKey, def });
  }
  const groups: CycleParameterGroup[] = [];
  for (const name of CYCLE_GROUP_ORDER) {
    const parameters = byGroup.get(name);
    if (parameters) groups.push({ name, parameters });
  }
  for (const [name, parameters] of byGroup) {
    if (!(CYCLE_GROUP_ORDER as readonly string[]).includes(name)) groups.push({ name, parameters });
  }
  return { key, family, label, description, groups, hyperparameters };
}

export function useCycleCatalog() {
  const query = useTrainableCatalog();

  const entries = useMemo<CycleCatalogEntry[]>(() => {
    if (!query.data) return [];
    const result: CycleCatalogEntry[] = [];
    for (const [key, model] of Object.entries(query.data)) {
      if (!key.endsWith(CYCLE_RUNNER_SUFFIX)) continue;
      const familyRaw = key.slice(0, key.length - CYCLE_RUNNER_SUFFIX.length);
      const parsedFamily = cycleModelFamilySchema.safeParse(familyRaw);
      if (!parsedFamily.success) continue;
      result.push(groupEntry(key, parsedFamily.data, model.name, model.description, model.defaultHyperparameters));
    }
    result.sort((a, b) => a.family.localeCompare(b.family));
    return result;
  }, [query.data]);

  const byFamily = useMemo(() => {
    const map = new Map<CycleModelFamily, CycleCatalogEntry>();
    for (const entry of entries) map.set(entry.family, entry);
    return map;
  }, [entries]);

  return { ...query, entries, byFamily };
}
