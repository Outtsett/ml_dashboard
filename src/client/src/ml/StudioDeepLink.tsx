/**
 * StudioDeepLink — `/ml-studio?model=<key>` lands on the Train stage with that
 * model selected.
 *
 * The Model Catalog hands a spec over with this link rather than training it
 * through a path of its own. The key is an ML Studio model key (the catalog
 * resolves a spec to its wired runner before linking), so the only work here is
 * to check it is real, select it, and step to Train. `ArchitectureComposer`
 * seeds the default hyperparameters itself once the model type changes.
 *
 * Consumed once: the param is removed after it is applied, so a reload or a
 * later visit does not re-select over whatever you have done since.
 */

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useTrainableCatalog } from "@/ml/lib/useModelCatalog";
import { useMLStudio } from "./MLStudioContext";

function readModelFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("model");
}

function clearModelFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("model");
  window.history.replaceState(null, "", url);
}

export function StudioDeepLink() {
  const [requested, setRequested] = useState<string | null>(readModelFromUrl);
  const { data: catalog } = useTrainableCatalog();
  const { state, dispatch } = useMLStudio();

  useEffect(() => {
    if (!requested || !catalog) return;

    if (!(requested in catalog)) {
      toast.error("Unknown model", { description: `ML Studio has no model "${requested}".` });
    } else {
      if (requested !== state.modelType) {
        // The same three writes the Train stage's own picker makes.
        dispatch({ type: "setModelType", modelType: requested });
        dispatch({ type: "setHyperparameters", hyperparameters: {} });
        dispatch({ type: "setComposition", config: { kind: "atomic", params: {}, subPicks: [] } });
      }
      dispatch({ type: "setActiveStage", stage: "train" });
    }

    clearModelFromUrl();
    setRequested(null);
  }, [requested, catalog, state.modelType, dispatch]);

  return null;
}
