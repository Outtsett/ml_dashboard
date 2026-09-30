/**
 * `GET /api/studies` and `GET /api/studies/:slug` (src/server/studies/studies.router.ts)
 * on a bare app with a fake lake: listing with served flags, query parsing,
 * the Map lookup refusing `constructor`, caching, a missing view degrading to
 * a note, and a throwing handler answering 500.
 */

import type { Server } from "http";
import type { AddressInfo } from "net";
import express from "express";
import { z } from "zod";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStudiesRouter } from "../../../src/server/studies/studies.router";
import { missingViews } from "../../../src/server/studies/views";
import { ident, num, text } from "../../../src/server/studies/sql";
import type { StudyHandler, StudyLake } from "../../../src/server/studies/types";

let queries = 0;
const lake: StudyLake = {
  async query<T>(): Promise<T[]> {
    queries += 1;
    return [{ value: 7 }] as T[];
  },
  async hasView(name) {
    return name === "derived_present";
  },
  async columns() {
    return [];
  },
};

const echo: StudyHandler = {
  slug: "echo",
  datasets: ["derived_present", "derived_absent"],
  query: z.object({ bins: z.coerce.number().int().min(1).max(10).default(3) }),
  async run(query, context) {
    const rows = await context.lake.query<{ value: number }>("SELECT 7 AS value");
    return { bins: query.bins, value: rows[0]?.value };
  },
};

const missing: StudyHandler = {
  slug: "missing",
  datasets: ["derived_absent"],
  query: z.object({}),
  async run(_query, context) {
    if ((await missingViews(context, ["derived_absent"])).length > 0) return { rows: [] };
    return { rows: [1] };
  },
};

const broken: StudyHandler = {
  slug: "broken",
  datasets: [],
  query: z.object({}),
  cacheSeconds: 0,
  async run() {
    throw new Error("boom");
  },
};

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use("/api", createStudiesRouter([echo, missing, broken], lake));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.close();
});

describe("studies router", () => {
  it("lists every study with whether each dataset is served", async () => {
    const body = await (await fetch(`${base}/studies`)).json();
    const listed = body.studies.find((study: { slug: string }) => study.slug === "echo");
    expect(listed.datasets).toEqual([
      { name: "derived_present", served: true },
      { name: "derived_absent", served: false },
    ]);
  });

  it("parses the query and returns { slug, notes, data }", async () => {
    const body = await (await fetch(`${base}/studies/echo?bins=5`)).json();
    expect(body).toEqual({ slug: "echo", notes: [], data: { bins: 5, value: 7 } });
  });

  it("refuses a query outside its schema", async () => {
    const response = await fetch(`${base}/studies/echo?bins=99`);
    expect(response.status).toBe(400);
  });

  it("answers 404 for an unknown slug, including object-prototype names", async () => {
    expect((await fetch(`${base}/studies/nope`)).status).toBe(404);
    expect((await fetch(`${base}/studies/constructor`)).status).toBe(404);
  });

  it("serves a repeated query from the cache", async () => {
    await fetch(`${base}/studies/echo?bins=2`);
    const before = queries;
    await fetch(`${base}/studies/echo?bins=2`);
    expect(queries).toBe(before);
  });

  it("turns a missing view into a note, not an error", async () => {
    const response = await fetch(`${base}/studies/missing`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({ rows: [] });
    expect(body.notes[0]).toContain("derived_absent");
  });

  it("answers 500 with the handler's message when it throws", async () => {
    const response = await fetch(`${base}/studies/broken`);
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain("boom");
  });
});

describe("study SQL quoting", () => {
  it("quotes identifiers and refuses anything else", () => {
    expect(ident("derived_x")).toBe('"derived_x"');
    expect(() => ident('x"; DROP')).toThrow();
  });

  it("doubles quotes in literals and refuses non-finite numbers", () => {
    expect(text("it's")).toBe("'it''s'");
    expect(() => num(Number.NaN)).toThrow();
  });
});
