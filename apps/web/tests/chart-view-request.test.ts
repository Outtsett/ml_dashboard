import { describe, expect, it } from "vitest";
import { requestChartView, subscribeChartView } from "@/market/lib/useNotebookOverlays";
import type { ChartView } from "@shared/chartLink";

describe("jump to the most recent candle", () => {
  it("hands a 'latest' request to the page that owns the bars, and stops after unsubscribing", () => {
    const seen: ChartView[] = [];
    const unsubscribe = subscribeChartView((view) => seen.push(view));
    requestChartView({ target: "latest" });
    expect(seen).toEqual([{ target: "latest" }]);
    unsubscribe();
    requestChartView({ target: "latest" });
    expect(seen).toHaveLength(1);
  });
});
