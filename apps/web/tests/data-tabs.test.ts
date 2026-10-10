/**
 * The Data page's URL state (`apps/web/src/data/tabs.ts`) and the way it writes
 * numbers (`packages/shared/src/stores/format.ts`):
 *  - an empty or unknown query opens the lake tab;
 *  - the left sidebar's `?dataset=` and `?feature=` links open the lake tab with
 *    that selection;
 *  - a selection survives a round trip through the URL;
 *  - counts are whole, shares are percentages, and nothing is written in
 *    scientific notation.
 */
import { describe, expect, it } from "vitest";
import { byteSize, cellText, measuredValue, percentage, storedValue, wholeDaysBetween, wholeNumber } from "@shared/stores/format";
import { dataHref, dataSelectionSearch, parseDataSelection } from "@/data/tabs";

describe("parseDataSelection", () => {
  it("opens the lake tab when nothing is asked for", () => {
    expect(parseDataSelection("")).toEqual({ tab: "lake", dataset: null, feature: null, view: "rows", table: null });
  });

  it("falls back to the lake tab for a tab it does not know", () => {
    expect(parseDataSelection("?tab=models").tab).toBe("lake");
    expect(parseDataSelection("?tab=constructor").tab).toBe("lake");
  });

  it("reads the sidebar's dataset link as the lake tab with that dataset", () => {
    const selection = parseDataSelection("?dataset=derived_labels");
    expect(selection.tab).toBe("lake");
    expect(selection.dataset).toBe("derived_labels");
  });

  it("reads the sidebar's feature link as the lake tab with that feature", () => {
    const selection = parseDataSelection("?feature=return_5");
    expect(selection.tab).toBe("lake");
    expect(selection.feature).toBe("return_5");
  });
});

describe("dataSelectionSearch", () => {
  it("round-trips a SQLite table", () => {
    const search = "?tab=sqlite&table=training_sessions";
    expect(dataSelectionSearch(parseDataSelection(search))).toBe(search);
  });

  it("round-trips a lake dataset shown as columns", () => {
    const search = "?dataset=mnq_ohlcv_1m&view=columns";
    expect(dataSelectionSearch(parseDataSelection(search))).toBe(search);
  });

  it("drops what the tab does not use", () => {
    expect(dataHref({ tab: "engine", dataset: "bars", feature: null, view: "columns", table: "users" })).toBe(
      "/databases?tab=engine",
    );
    expect(dataHref({ tab: "lake", dataset: null, feature: null, view: "rows", table: null })).toBe("/databases");
  });
});

describe("number formats", () => {
  it("writes counts whole with separators", () => {
    expect(wholeNumber(882665821)).toBe("882,665,821");
    expect(wholeNumber(null)).toBe("—");
  });

  it("writes a share as a percentage with at most one decimal", () => {
    expect(percentage(0.517)).toBe("51.7%");
    expect(percentage(1)).toBe("100%");
    expect(percentage(0)).toBe("0%");
  });

  it("writes a stored number as stored, so prices keep their tick", () => {
    expect(storedValue(7713.75)).toBe("7,713.75");
    expect(storedValue(1.12121)).toBe("1.12121");
    expect(storedValue(1.12162)).not.toBe(storedValue(1.12121));
    expect(storedValue(0.1 + 0.2)).toBe("0.3");
    expect(storedValue(0.0000001)).toBe("0.0000001");
    expect(storedValue(882665821)).toBe("882,665,821");
    expect(cellText(0.517, "null_fraction")).toBe("51.7%");
    expect(cellText(0.517, "close")).toBe("0.517");
  });

  it("never writes a statistic in scientific notation", () => {
    const samples = [0.00012345, -0.0000004, 0.5, 3.14159, 27543.25, 1e12, -42.06];
    for (const sample of samples) expect(measuredValue(sample)).not.toMatch(/e[-+]?\d/i);
    expect(measuredValue(1.12121)).toBe("1.121");
    expect(measuredValue(0.00012345)).toBe("0.000123");
    expect(measuredValue(27543.2)).toBe("27,543.2");
    expect(measuredValue(882665821.4)).toBe("882,665,821");
    expect(measuredValue(3.14159)).toBe("3.142");
  });

  it("writes sizes in whole megabytes and ages in whole days", () => {
    expect(byteSize(10 * 1024 * 1024)).toBe("10 megabytes");
    expect(byteSize(132 * 1024 * 1024 * 1024)).toBe("132.0 gigabytes");
    expect(wholeDaysBetween(0, 22.9 * 86_400_000)).toBe(22);
  });
});
