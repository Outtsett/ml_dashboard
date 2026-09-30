/**
 * The contract every study handler implements. A study is one analytic page
 * that replaced a marimo notebook: the page lives in
 * src/client/src/studies/pages/<slug>/, and its numbers come from one handler
 * here, `src/server/studies/handlers/<slug>.ts`, served at
 * `GET /api/studies/<slug>?<query>`.
 *
 * A handler reads only through `StudyContext.lake` (the dashboard's DuckDB
 * over the lake), so a test can hand it a fake lake, and it never builds SQL
 * from browser text: every value that reaches SQL is parsed by `query` first
 * and quoted by `./sql`.
 */

import type { z } from "zod";

export interface StudyLake {
  /** Run one read over the dashboard's DuckDB (views over the lake). */
  query<T = Record<string, unknown>>(sql: string, timeoutMs?: number): Promise<T[]>;
  /** Whether a view or table of this name is defined right now. */
  hasView(name: string): Promise<boolean>;
  /** The columns of a view, in order ([] when it does not exist). */
  columns(name: string): Promise<string[]>;
}

export interface StudyContext {
  lake: StudyLake;
  /**
   * Things the reader should know about this response: a dataset that is not
   * landed yet, a window that was capped, a number that could not be computed.
   * The page shows them above its sections.
   */
  notes: string[];
}

export interface StudyHandler<Query extends z.ZodTypeAny = z.ZodTypeAny, Body = unknown> {
  slug: string;
  /** The lake views this study reads, listed on the Studies index with whether each is served. */
  datasets: string[];
  /** Parses the request's query string; its output is what `run` receives. */
  query: Query;
  /** Seconds a response is reused for the same query (default 300). 0 disables the cache. */
  cacheSeconds?: number;
  /** Request timeout (default 120 s): a cold scan of a large view can pass the app's 30 s. */
  timeoutMs?: number;
  run(query: z.infer<Query>, context: StudyContext): Promise<Body>;
}

/** What `GET /api/studies/:slug` returns. */
export interface StudyResponse<Body = unknown> {
  slug: string;
  notes: string[];
  data: Body;
}

/** One row of `GET /api/studies`. */
export interface StudyListing {
  slug: string;
  datasets: Array<{ name: string; served: boolean }>;
}
