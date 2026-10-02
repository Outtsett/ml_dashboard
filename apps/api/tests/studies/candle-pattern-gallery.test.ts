// @vitest-environment jsdom
/**
 * candle-pattern-gallery: the handler against a fake lake (the SQL it writes,
 * what it does when the tables are not landed, the pattern fallback), the pure
 * arithmetic the server and the page share (the chart-CNN's input image, held
 * to the pixels chart_cnn's render.py draws for a real MNQ window), and the
 * page rendering a body.
 */

import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../web/tests/setup";
import Page from "@/studies/pages/candle-pattern-gallery/Page";
import { meta } from "@/studies/pages/candle-pattern-gallery/meta";
import handler, { EXAMPLES_VIEW, SUMMARY_VIEW, WINDOW_BARS_VIEW } from "../../studies/handlers/candle-pattern-gallery";
import {
  EMPTY_BODY, MODEL_INPUT, formatStamp, groupWindows, modelInputRow, modelInputScale, modelInputVolumeRows, renderModelInput,
  type GalleryBar, type GalleryBody, type GalleryExample, type GallerySummaryRow, type WindowBarRow,
} from "@shared/studies/candle-pattern-gallery";
import type { StudyContext, StudyLake } from "../../studies/types";

const ALL_VIEWS = [SUMMARY_VIEW, EXAMPLES_VIEW, WINDOW_BARS_VIEW];

function summaryRow(name: string, overrides: Partial<GallerySummaryRow> = {}): GallerySummaryRow {
  return {
    talib_function: name, pattern_bar_count: 2, real_hit_count: 100, bullish_real_hit_count: 60, bearish_real_hit_count: 40,
    real_example_count: 24, random_search_synthetic_example_count: 0, textbook_synthetic_example_count: 0, example_count: 24, ...overrides,
  };
}

function fakeLake(present: readonly string[], log: string[]): StudyLake {
  return {
    async hasView(name) {
      return present.includes(name);
    },
    async columns() {
      return [];
    },
    async query<T>(sql: string): Promise<T[]> {
      log.push(sql);
      const rows: unknown[] =
        sql.includes(`FROM "${SUMMARY_VIEW}"`) ? [summaryRow("CDLENGULFING"), summaryRow("CDLKICKING", { real_hit_count: 0, bullish_real_hit_count: 0, bearish_real_hit_count: 0, real_example_count: 0, random_search_synthetic_example_count: 5, textbook_synthetic_example_count: 12, example_count: 17 })]
        : sql.includes(`FROM "${EXAMPLES_VIEW}"`) ? [
            { example_id: "20200101_0935_bull", pattern_side: "bullish", is_synthetic: false, example_source: "real_mnq_5m", bar_index: 100n, pattern_bar_count: 2, bar_timestamp_ms: 1577871300000n },
            { example_id: "syn001_60_bear_synthetic", pattern_side: "bearish", is_synthetic: true, example_source: "random_search_synthetic", bar_index: null, pattern_bar_count: 2, bar_timestamp_ms: null },
          ]
        : sql.includes(`FROM "${WINDOW_BARS_VIEW}"`) ? [
            { example_id: "20200101_0935_bull", bars_before_firing: -1, is_pattern_bar: true, bar_timestamp_ms: 1577871000000n, absolute_open_price: 10, absolute_high_price: 12, absolute_low_price: 9, absolute_close_price: 11, volume: 50n },
            { example_id: "20200101_0935_bull", bars_before_firing: 0, is_pattern_bar: true, bar_timestamp_ms: 1577871300000n, absolute_open_price: 11, absolute_high_price: 13, absolute_low_price: 10, absolute_close_price: 12.5, volume: 70n },
            { example_id: "syn001_60_bear_synthetic", bars_before_firing: 0, is_pattern_bar: true, bar_timestamp_ms: null, absolute_open_price: 100, absolute_high_price: 101, absolute_low_price: 99, absolute_close_price: 99.5, volume: 200n },
          ]
        : [];
      return rows as T[];
    },
  };
}

async function run(present: readonly string[], input: Record<string, unknown> = {}) {
  const log: string[] = [];
  const context: StudyContext = { lake: fakeLake(present, log), notes: [] };
  const body = await handler.run(handler.query.parse(input), context);
  return { body, log, notes: context.notes };
}

describe("candle-pattern-gallery handler", () => {
  it("declares every view it reads and the slug equals the page folder", () => {
    expect(handler.slug).toBe("candle-pattern-gallery");
    expect(meta.slug).toBe(handler.slug);
    expect(handler.datasets).toEqual(ALL_VIEWS);
  });

  it("answers an empty body and a note when the tables are not landed, without touching the lake", async () => {
    const { body, log, notes } = await run([SUMMARY_VIEW]);
    expect(body).toEqual(EMPTY_BODY);
    expect(log).toEqual([]);
    expect(notes[0]).toContain(EXAMPLES_VIEW);
    expect(notes[0]).toContain(WINDOW_BARS_VIEW);
  });

  it("sends the summary and the selected pattern's examples with their windows grouped, bigint columns as numbers", async () => {
    const { body, log } = await run(ALL_VIEWS, { pattern: "CDLENGULFING" });
    expect(body.pattern).toBe("CDLENGULFING");
    expect(body.summary.map((row) => row.talib_function)).toEqual(["CDLENGULFING", "CDLKICKING"]);
    expect(body.examples.map((example) => example.example_id)).toEqual(["20200101_0935_bull", "syn001_60_bear_synthetic"]);
    const real = body.examples[0] as GalleryExample;
    expect(real.bar_timestamp_ms).toBe(1577871300000);
    expect(real.bar_index).toBe(100);
    expect(real.bars.map((bar) => bar.bar_offset)).toEqual([-1, 0]);
    expect(real.bars[1]).toMatchObject({ open: 11, close: 12.5, volume: 70, bar_timestamp_ms: 1577871300000 });
    expect(body.examples[1]?.bars[0]?.bar_timestamp_ms).toBeNull();
    const examplesSql = log.find((sql) => sql.includes(`FROM "${EXAMPLES_VIEW}"`)) ?? "";
    expect(examplesSql).toContain("WHERE talib_function = 'CDLENGULFING'");
    expect(examplesSql).toContain("epoch_ms(timezone('UTC', bar_timestamp))");
    expect(examplesSql).not.toMatch(/first\(|last\(/i);
  });

  it("refuses a pattern name that could carry SQL and falls back to a shown pattern for an unknown one", async () => {
    expect(() => handler.query.parse({ pattern: "x'; DROP TABLE y; --" })).toThrow();
    const { body, notes } = await run(ALL_VIEWS, { pattern: "CDLNOTAPATTERN" });
    expect(body.pattern).toBe("CDLENGULFING");
    expect(notes[0]).toContain("CDLNOTAPATTERN is not one of the 2 patterns");
  });
});

// A real window: the 48 MNQ 5-minute bars ending at CDL2CROWS's first example (20191002_1315_bear, bar_index 29323),
// and the image chart_cnn/pkg/render.py draws for it, measured in Python: 916 lit pixels, the sum of
// (row * 144 + column) over them 6,727,768, and the lit pixels in every row below.
const WINDOW = {
  o: [7563.25, 7565.75, 7580.0, 7583.25, 7584.0, 7573.25, 7579.75, 7575.5, 7576.25, 7561.75, 7571.25, 7566.75, 7555.75, 7550.0, 7546.0, 7547.25, 7544.0, 7546.25, 7548.75, 7555.75, 7559.5, 7557.75, 7557.75, 7558.25, 7560.0, 7557.75, 7550.5, 7559.75, 7559.25, 7558.5, 7555.25, 7562.0, 7562.5, 7564.0, 7566.5, 7567.0, 7568.75, 7571.5, 7570.75, 7570.5, 7570.25, 7567.0, 7567.75, 7561.75, 7559.75, 7558.75, 7565.0, 7564.75],
  h: [7569.25, 7583.5, 7588.75, 7591.0, 7587.75, 7583.75, 7584.0, 7584.75, 7579.75, 7572.75, 7571.25, 7571.75, 7556.25, 7551.5, 7550.25, 7547.5, 7547.25, 7548.5, 7556.0, 7556.5, 7560.75, 7559.75, 7559.75, 7560.25, 7562.25, 7557.75, 7560.5, 7561.25, 7560.5, 7559.25, 7564.25, 7564.25, 7565.25, 7568.25, 7570.75, 7569.25, 7573.5, 7575.25, 7571.25, 7572.5, 7570.75, 7568.25, 7567.75, 7563.0, 7561.0, 7565.0, 7565.5, 7565.25],
  l: [7561.5, 7565.75, 7575.75, 7576.5, 7572.5, 7566.25, 7572.25, 7573.5, 7559.5, 7555.0, 7559.75, 7555.0, 7541.25, 7541.75, 7542.75, 7543.0, 7543.25, 7544.75, 7548.25, 7552.0, 7551.75, 7556.5, 7556.75, 7558.0, 7557.25, 7550.25, 7549.5, 7558.0, 7558.75, 7551.0, 7554.75, 7561.25, 7560.0, 7563.25, 7565.5, 7566.5, 7568.5, 7571.25, 7567.75, 7569.25, 7566.75, 7564.0, 7559.0, 7558.25, 7552.25, 7557.5, 7561.75, 7560.75],
  c: [7565.75, 7579.5, 7583.5, 7583.75, 7573.5, 7580.5, 7575.5, 7575.75, 7562.5, 7571.5, 7566.0, 7555.5, 7550.25, 7546.0, 7547.5, 7544.0, 7545.5, 7548.5, 7555.5, 7554.5, 7557.75, 7558.0, 7558.5, 7560.25, 7557.75, 7551.0, 7559.25, 7559.25, 7559.0, 7554.75, 7561.5, 7562.0, 7563.75, 7567.0, 7566.25, 7568.5, 7571.75, 7571.5, 7570.5, 7570.0, 7567.5, 7567.5, 7561.25, 7559.25, 7559.0, 7564.0, 7564.5, 7561.75],
  v: [1797.0, 4059.0, 2851.0, 4095.0, 3154.0, 4003.0, 1958.0, 2155.0, 2761.0, 3804.0, 3411.0, 2050.0, 1374.0, 802.0, 230.0, 123.0, 159.0, 162.0, 189.0, 201.0, 307.0, 85.0, 64.0, 137.0, 130.0, 107.0, 239.0, 140.0, 78.0, 204.0, 185.0, 121.0, 138.0, 191.0, 340.0, 110.0, 297.0, 215.0, 168.0, 212.0, 105.0, 149.0, 422.0, 374.0, 468.0, 258.0, 242.0, 151.0],
};
const PYTHON_LIT_PER_ROW = [1, 1, 1, 1, 2, 3, 3, 3, 3, 4, 6, 9, 8, 7, 7, 8, 8, 10, 8, 8, 8, 8, 9, 9, 7, 9, 8, 9, 12, 14, 15, 11, 14, 15, 17, 18, 13, 15, 15, 17, 15, 15, 19, 17, 18, 22, 22, 19, 20, 11, 12, 15, 13, 9, 8, 8, 8, 7, 8, 8, 5, 7, 5, 8, 7, 9, 6, 6, 7, 5, 2, 2, 0, 0, 1, 3, 4, 4, 5, 6, 7, 8, 8, 8, 11, 12, 12, 13, 13, 13, 14, 15, 24, 48];

function windowBars(): GalleryBar[] {
  return WINDOW.o.map((open, index) => ({
    bar_offset: index - 47, is_pattern_bar: index >= 45, bar_timestamp_ms: 1570036500000 - (47 - index) * 300000,
    open, high: WINDOW.h[index] as number, low: WINDOW.l[index] as number, close: WINDOW.c[index] as number, volume: WINDOW.v[index] as number,
  }));
}

describe("the chart-CNN input image (render.py)", () => {
  it("has the image size render.py gives 48 bars", () => {
    expect(MODEL_INPUT).toMatchObject({ bars: 48, width: 144, height: 94, pricePixels: 72, volumePixels: 20 });
  });

  it("draws the same pixels as Python for a real MNQ window: count, position checksum and every row", () => {
    const pixels = renderModelInput(windowBars());
    let lit = 0;
    let checksum = 0;
    const perRow = new Array<number>(MODEL_INPUT.height).fill(0);
    for (let y = 0; y < MODEL_INPUT.height; y += 1) {
      for (let x = 0; x < MODEL_INPUT.width; x += 1) {
        if (pixels[y * MODEL_INPUT.width + x] === 255) {
          lit += 1;
          checksum += y * MODEL_INPUT.width + x;
          perRow[y] = (perRow[y] as number) + 1;
        }
      }
    }
    expect(lit).toBe(916);
    expect(checksum).toBe(6727768);
    expect(perRow).toEqual(PYTHON_LIT_PER_ROW);
  });

  it("places the window's low on the bottom price row and its high on the top, and volume by the tallest bar", () => {
    const bars = windowBars();
    const scale = modelInputScale(bars);
    expect(scale.windowLow).toBe(7541.25);
    expect(scale.windowHigh).toBe(7591.0);
    expect(modelInputRow(scale.windowHigh, scale.windowLow, scale.windowRange)).toBe(0);
    expect(modelInputRow(scale.windowLow, scale.windowLow, scale.windowRange)).toBe(MODEL_INPUT.pricePixels - 1);
    expect(modelInputVolumeRows(4095, scale.windowMaximumVolume)).toBe(MODEL_INPUT.volumePixels - 1);
    expect(modelInputVolumeRows(0, scale.windowMaximumVolume)).toBe(0);
  });

  it("does not divide by zero on a flat window and draws nothing for a window that is not 48 bars", () => {
    const flat = Array.from({ length: 48 }, (_, index) => ({ bar_offset: index - 47, is_pattern_bar: false, bar_timestamp_ms: null, open: 5, high: 5, low: 5, close: 5, volume: 0 }));
    expect(() => renderModelInput(flat)).not.toThrow();
    expect(renderModelInput(windowBars().slice(0, 10)).some((pixel) => pixel !== 0)).toBe(false);
  });
});

describe("window grouping and stamps", () => {
  it("groups rows under their example in the order given", () => {
    const rows: WindowBarRow[] = [
      { example_id: "a", bars_before_firing: -1, is_pattern_bar: true, bar_timestamp_ms: 1, absolute_open_price: 1, absolute_high_price: 2, absolute_low_price: 0, absolute_close_price: 1, volume: 5 },
      { example_id: "b", bars_before_firing: 0, is_pattern_bar: true, bar_timestamp_ms: null, absolute_open_price: 1, absolute_high_price: 2, absolute_low_price: 0, absolute_close_price: 1, volume: 5 },
      { example_id: "a", bars_before_firing: 0, is_pattern_bar: true, bar_timestamp_ms: 2, absolute_open_price: 1, absolute_high_price: 2, absolute_low_price: 0, absolute_close_price: 1, volume: 5 },
    ];
    const grouped = groupWindows(rows);
    expect([...grouped.keys()]).toEqual(["a", "b"]);
    expect(grouped.get("a")?.map((bar) => bar.bar_offset)).toEqual([-1, 0]);
  });

  it("reads a lake stamp as written, and a missing one as a dash", () => {
    expect(formatStamp(1570036500000)).toBe("2019-10-02 17:15");
    expect(formatStamp(null)).toBe("—");
  });
});

function syntheticBody(): GalleryBody {
  const bars = windowBars();
  const real: GalleryExample = { example_id: "20191002_1315_bear", pattern_side: "bearish", is_synthetic: false, example_source: "real_mnq_5m", bar_index: 29323, pattern_bar_count: 3, bar_timestamp_ms: 1570036500000, bars };
  const constructed: GalleryExample = {
    example_id: "textbook00_bull_synthetic", pattern_side: "bullish", is_synthetic: true, example_source: "textbook_synthetic", bar_index: null, pattern_bar_count: 3, bar_timestamp_ms: null,
    bars: bars.map((bar) => ({ ...bar, bar_timestamp_ms: null })),
  };
  return {
    summary: [
      summaryRow("CDL2CROWS", { pattern_bar_count: 3, real_hit_count: 12, bullish_real_hit_count: 0, bearish_real_hit_count: 12, real_example_count: 12, example_count: 13 }),
      summaryRow("CDLKICKING", { real_hit_count: 0, bullish_real_hit_count: 0, bearish_real_hit_count: 0, real_example_count: 0, textbook_synthetic_example_count: 12, example_count: 12 }),
    ],
    pattern: "CDL2CROWS",
    examples: [real, constructed],
  };
}

function renderPage(body: GalleryBody) {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ slug: "candle-pattern-gallery", notes: [], data: body }), { status: 200 }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(createElement(QueryClientProvider, { client }, createElement(Page)));
  return fetchMock;
}

describe("candle-pattern-gallery page", () => {
  // jsdom has no canvas; the raster's pixels are held by the tests above, so the page draws into nothing here.
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("asks for the default pattern and titles the gallery the way the notebook did", async () => {
    const fetchMock = renderPage(syntheticBody());
    await waitFor(() => expect(screen.getByText(/CDL2CROWS — 2 examples \(1 synthetic\)/)).toBeTruthy());
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("/api/studies/candle-pattern-gallery?pattern=CDLENGULFING");
    expect(screen.getByText("20191002_1315_bear")).toBeTruthy();
    expect(screen.getByText("textbook00_bull_synthetic")).toBeTruthy();
  });

  it("filters to the real examples and puts every symbol of the pixel formula on the page", async () => {
    renderPage(syntheticBody());
    await waitFor(() => expect(screen.getByText(/CDL2CROWS — 2 examples/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "real" }));
    await waitFor(() => expect(screen.getByText(/CDL2CROWS — 1 example \(0 synthetic\)/)).toBeTruthy());
    expect(screen.getByText("Inspect 20191002_1315_bear")).toBeTruthy();
    expect(screen.getByText("lowest low among the 48 bars")).toBeTruthy();
    expect(screen.getByText("7,541.2500")).toBeTruthy();
  });

  it("lists the patterns that never fire in the real data", async () => {
    renderPage(syntheticBody());
    await waitFor(() => expect(screen.getByText("Patterns with no real firing")).toBeTruthy());
    expect(screen.getByText(/CDLKICKING never fire on the real bars/)).toBeTruthy();
  });

  it("says nothing is landed instead of failing", async () => {
    renderPage({ summary: [], pattern: null, examples: [] });
    await waitFor(() => expect(screen.getByText("Patterns")).toBeTruthy());
    expect(screen.getByText(/No example matches/)).toBeTruthy();
  });
});
