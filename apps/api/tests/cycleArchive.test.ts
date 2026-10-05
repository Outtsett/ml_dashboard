/**
 * Model Cycle archive: a run's identity and start time read back from its id.
 * A run landed before 2026-09-27 carries a NULL started_at_timestamp; its start
 * comes from the UTC stamp the runner writes into the run id.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../infrastructure/database/lake", () => ({
  derivedViews: () => [],
  queryLake: async () => [],
}));

import { recipeOfModelId, startedAtOfModelId } from "../training/cycleArchive";

describe("cycle archive run ids", () => {
  it("spells the runner key's plus sign as an underscore in the lake recipe", () => {
    expect(recipeOfModelId("MNQ_5m_xgboost+walk_forward_cycle_20260927T094307"))
      .toBe("MNQ_5m_xgboost_walk_forward_cycle_20260927T094307");
  });

  it("reads the UTC start stamped into a run id", () => {
    expect(startedAtOfModelId("MNQ_5m_xgboost+walk_forward_cycle_20260927T094307"))
      .toBe(Date.UTC(2026, 8, 27, 9, 43, 7));
    // the recipe spelling and a model key with underscores parse the same way
    expect(startedAtOfModelId("ES_15m_attention_weighted_forecast_stack_walk_forward_cycle_20260101T000001"))
      .toBe(Date.UTC(2026, 0, 1, 0, 0, 1));
  });

  it("gives no start for an id without a stamp", () => {
    expect(startedAtOfModelId("MNQ_5m_xgboost+walk_forward_cycle")).toBeNull();
    expect(startedAtOfModelId("not a run id")).toBeNull();
  });
});
