/** Run rows a server restart left saying "running": which are stopped, which are removed. */
import { describe, expect, it } from "vitest";

import { classifyOrphanRuns } from "@shared/runs/orphans";

describe("classifyOrphanRuns", () => {
  it("leaves a live run alone, stops one with a record, removes one with nothing", () => {
    const actions = classifyOrphanRuns(
      ["live_run", "has_folds", "died_in_fold_one"],
      new Set(["live_run"]),
      new Set(["has_folds", "an_older_finished_run"]),
    );
    expect(actions).toEqual({ stop: ["has_folds"], remove: ["died_in_fold_one"] });
  });

  it("does nothing when no row says running", () => {
    expect(classifyOrphanRuns([], new Set(), new Set(["x"]))).toEqual({ stop: [], remove: [] });
  });

  it("a run both live and recorded (its first fold has landed) is still live", () => {
    expect(classifyOrphanRuns(["a"], new Set(["a"]), new Set(["a"]))).toEqual({ stop: [], remove: [] });
  });
});
