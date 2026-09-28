// @vitest-environment jsdom
/**
 * The Model Cycle Metrics tab (src/client/src/cycle/report/) on the real report of a
 * finished tuned run (tests/fixtures/cycle_report_mnq_5m_xgboost.json, read from
 * GET /api/training/cycle/:modelId/metrics): the metric matrices put the run and
 * each fold across, sizes show unsigned, undefined values show "—" with the reason,
 * and the scope and segment pickers change the tables below them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CycleReportPanel } from "@/cycle/report/ReportPanel";
import { useCycleStore } from "@/cycle/store";
import { cycleReportSchema } from "@shared/cycle/report";
import report from "../fixtures/cycle_report_mnq_5m_xgboost.json";

const MODEL_ID = "MNQ_5m_xgboost+walk_forward_cycle_20260927T094307";

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CycleReportPanel />
    </QueryClientProvider>,
  );
}

function respond(status: number, body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  useCycleStore.getState().reset();
  act(() => useCycleStore.setState({ modelId: MODEL_ID, status: "complete" }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CycleReportPanel", () => {
  it("the fixture is a valid report", () => {
    expect(cycleReportSchema.safeParse(report).success).toBe(true);
  });

  it("asks for the open run's tables", async () => {
    const fetchSpy = respond(200, report);
    renderPanel();
    await screen.findByTestId("cycle-report");
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(`/api/training/cycle/${encodeURIComponent(MODEL_ID)}/metrics`);
  });

  it("puts the run and every fold across the metric matrices", async () => {
    respond(200, report);
    renderPanel();
    await screen.findByTestId("report-model");
    expect(screen.getByTestId("report-model-accuracy-run").textContent).toBe("49.0%");
    expect(screen.getByTestId("report-model-accuracy-0").textContent).toBe("49.1%");
    expect(screen.getByTestId("report-model-accuracy-1").textContent).toBe("49.0%");
    expect(screen.getByTestId("report-trading-net_profit_usd-run").textContent).toBe("-$839.60");
    // a size is unsigned: a drawdown reads as how deep, not as a gain
    expect(screen.getByTestId("report-trading-maximum_drawdown_usd-run").textContent).toBe("$1,537.76");
    // every family has its block, in order
    const families = ["returns", "risk_adjusted", "drawdown", "trades", "exposure", "costs", "baseline"];
    const titles = families.map((family) => screen.getByTestId(`report-trading-family-${family}`).textContent);
    expect(titles).toEqual(["Returns", "Risk-adjusted", "Drawdown", "Trades", "Exposure", "Costs", "Baselines"]);
    for (const family of ["coverage", "classification", "probability", "calibration", "baseline", "price_forecast"]) {
      expect(screen.getByTestId(`report-model-family-${family}`)).toBeTruthy();
    }
  });

  it("shows an undefined value as a dash with its reason, never 0", async () => {
    respond(200, report);
    renderPanel();
    await screen.findByTestId("report-trading");
    const cell = screen.getByTestId("report-trading-maximum_drawdown_recovery_bars-run");
    expect(cell.textContent).toBe("—");
    expect(cell.querySelector("span")!.getAttribute("title")).toContain("Undefined: the scope ended before the equity regained its peak");
  });

  it("the scope picker switches the per-scope tables to one fold", async () => {
    respond(200, report);
    renderPanel();
    await screen.findByTestId("report-scope");
    expect(screen.getByTestId("report-distribution-trade_net_profit_usd-all trades").textContent).toContain("145");
    fireEvent.click(within(screen.getByTestId("report-scope")).getByRole("radio", { name: "Fold 1" }));
    expect(screen.getByTestId("report-distribution-trade_net_profit_usd-all trades").textContent).toContain("115");
    expect(screen.getByTestId("report-confusion-up-up").textContent).toContain("570");
    expect(screen.getByTestId("report-confusion-down-up").textContent).toContain("533");
  });

  it("the segment picker splits the trades by exit reason", async () => {
    respond(200, report);
    renderPanel();
    await screen.findByTestId("report-segment-kind");
    fireEvent.click(within(screen.getByTestId("report-segment-kind")).getByRole("radio", { name: "Exit reason" }));
    expect(screen.getByTestId("report-segments-opposite signal-trade_count").textContent).toBe("143");
    expect(screen.getByTestId("report-segments-fold end-trade_count").textContent).toBe("2");
  });

  it("lists every session day", async () => {
    respond(200, report);
    renderPanel();
    await screen.findByTestId("report-daily");
    expect(screen.getAllByTestId(/^report-day-/)).toHaveLength(report.dailyResults.length);
  });

  it("a run with no tables yet says when they arrive", async () => {
    respond(404, { error: "No metric tables" });
    act(() => useCycleStore.setState({ status: "running" }));
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("report-empty").textContent).toContain("end of the first fold"));
  });
});
