import { test, expect } from '@playwright/test';

/**
 * Contract tests for the API surface the client depends on.
 *
 * These assert SHAPE and STATUS, never row counts. The dashboard reads a live
 * Iceberg lake whose contents change daily, so an assertion like "returns 904
 * symbols" is a test that fails for the wrong reason every time data lands. What
 * must not change is that the endpoint answers, answers as JSON, and answers
 * with the fields the client destructures.
 *
 * Endpoints that need an external service the CI runner does not have are tagged
 * `@lake`, so `npm run test:e2e:hermetic` can exclude them.
 */

/** Assert a response is JSON with the expected status, and return the body. */
async function json(res: import('@playwright/test').APIResponse, expected = 200) {
  expect(
    res.status(),
    `${res.url()} returned ${res.status()}: ${(await res.text()).slice(0, 300)}`,
  ).toBe(expected);
  expect(res.headers()['content-type']).toContain('application/json');
  return res.json();
}

test.describe('catalog endpoints', () => {
  test('GET /api/instruments returns the symbol catalog', { tag: ['@backend'] }, async ({ request }) => {
    const body = await json(await request.get('/api/instruments'));

    expect(Array.isArray(body), '/api/instruments must return an array').toBe(true);
    expect(body.length, 'instrument catalog is empty — the symbol picker will be unusable').toBeGreaterThan(0);

    // The fields the market toolbar and chart actually read. Checked on the
    // first row rather than all, because the assertion is about the contract.
    expect(body[0]).toEqual(
      expect.objectContaining({
        id: expect.anything(),
        symbol: expect.any(String),
        assetType: expect.any(String),
      }),
    );

    // tickSize drives price formatting; a null here renders prices as NaN.
    for (const row of body.slice(0, 25)) {
      expect(row.symbol, 'an instrument has an empty symbol').toBeTruthy();
      expect(
        typeof row.tickSize,
        `instrument ${row.symbol} has a non-numeric tickSize (${row.tickSize})`,
      ).toBe('number');
    }
  });

  test('GET /api/models returns the model registry', { tag: ['@backend'] }, async ({ request }) => {
    // 200, not "200 or 500". Accepting 500 and returning early meant a registry
    // that threw and a registry that was merely unconfigured produced the same
    // green test — the endpoint could be completely broken and this would pass.
    const body = await json(await request.get('/api/models'));
    const rows = Array.isArray(body) ? body : (body.models ?? body.data);
    expect(Array.isArray(rows), '/api/models must return an array or {models|data:[]}').toBe(true);
  });

  test('GET /api/marimo/notebooks scans the configured roots', { tag: ['@backend'] }, async ({
    request,
  }) => {
    const body = await json(await request.get('/api/marimo/notebooks'));

    // The notebook catalog is the surface the global rule makes mandatory
    // ("all analytics lands in the ML Dashboard"), so an empty catalog is a
    // real regression on this machine — but a clean CI checkout legitimately
    // has no notebook roots, so emptiness is not itself the failure.
    const rows = Array.isArray(body) ? body : (body.notebooks ?? body.data ?? []);
    expect(Array.isArray(rows), '/api/marimo/notebooks must return a list').toBe(true);

    if (rows.length > 0) {
      expect(rows[0]).toEqual(
        expect.objectContaining({ relativePath: expect.any(String) }),
      );
    }
  });

  test('GET /api/settings returns dashboard settings', { tag: ['@backend'] }, async ({ request }) => {
    const body = await json(await request.get('/api/settings'));
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
  });
});

test.describe('observability endpoints', () => {
  test('GET /api/docs/json serves a valid OpenAPI document', { tag: ['@smoke'] }, async ({ request }) => {
    const body = await json(await request.get('/api/docs/json'));

    // Registered before registerRoutes so it answers even if a router throws.
    // A spec that has drifted to an empty `paths` is a silent documentation
    // outage, which is exactly what nobody notices.
    expect(body).toHaveProperty('openapi');
    expect(body).toHaveProperty('paths');
    expect(
      Object.keys(body.paths ?? {}).length,
      'the OpenAPI document declares zero paths',
    ).toBeGreaterThan(0);
  });

  test('GET /api/metrics reports pipeline and circuit-breaker state', { tag: ['@backend'] }, async ({
    request,
  }) => {
    const res = await request.get('/api/metrics');
    expect([200, 503]).toContain(res.status());
    if (res.status() !== 200) return;

    // `typeof x === 'object'` was the previous assertion, which is true of null
    // and of []. The title promises pipeline and circuit-breaker state, so the
    // body must actually be a non-null object with keys.
    const body = await res.json();
    expect(body, '/api/metrics returned null').not.toBeNull();
    expect(Array.isArray(body), '/api/metrics returned an array, not a metrics object').toBe(false);
    expect(
      Object.keys(body).length,
      '/api/metrics returned an empty object — it reports no metrics at all',
    ).toBeGreaterThan(0);
  });
});

test.describe('market data', () => {
  test('GET /api/ohlcv/:symbol returns bars from the lake', { tag: ['@lake'] }, async ({ request }) => {
    // Tagged @lake: this is the one endpoint that genuinely cannot work without
    // the Iceberg lake, so it is excluded from the hermetic run rather than
    // asserted loosely enough to pass without data.
    const instruments = await json(await request.get('/api/instruments'));
    const symbol = instruments.find((i: { assetType: string }) => i.assetType === 'futures')?.symbol
      ?? instruments[0]?.symbol;
    expect(symbol, 'no instrument to query bars for').toBeTruthy();

    // Asserted strictly. The previous version accepted 404 and 429 and then
    // returned early, and guarded the invariants behind `if (bars.length > 0)` —
    // so on a rate-limited or empty response the OHLC checks below, which are the
    // entire point of the test, silently never executed.
    const res = await request.get(`/api/ohlcv/${symbol}?timeframe=1m&limit=10`);
    const body = await json(res);

    const bars = Array.isArray(body) ? body : (body.bars ?? body.data ?? []);
    expect(Array.isArray(bars), '/api/ohlcv did not return a bar array').toBe(true);
    expect(
      bars.length,
      `/api/ohlcv returned zero bars for ${symbol} — this test is tagged @lake and only runs where the lake is present`,
    ).toBeGreaterThan(0);

    {
      const bar = bars[0];
      // OHLC invariants. These are the assertions worth having: a bar whose
      // high is below its low is corrupt data that every downstream model
      // silently trains on.
      expect(bar).toEqual(
        expect.objectContaining({
          open: expect.any(Number),
          high: expect.any(Number),
          low: expect.any(Number),
          close: expect.any(Number),
        }),
      );
      for (const b of bars) {
        expect(b.high, `bar high ${b.high} < low ${b.low}`).toBeGreaterThanOrEqual(b.low);
        expect(b.high, 'bar high is below its open').toBeGreaterThanOrEqual(b.open);
        expect(b.high, 'bar high is below its close').toBeGreaterThanOrEqual(b.close);
        expect(b.low, 'bar low is above its open').toBeLessThanOrEqual(b.open);
        expect(b.low, 'bar low is above its close').toBeLessThanOrEqual(b.close);
      }
    }
  });
});

/**
 * Read the opening frames of an SSE stream, then hang up.
 *
 * Playwright's `request` fixture buffers a whole response before resolving, and
 * an event stream has no end — `res.body()` on one blocks until the test times
 * out. So this uses Node's fetch, reads from the body's reader until it has seen
 * something or the budget expires, and aborts. Aborting is also what proves the
 * server tolerates a client disconnect, which is the leak the SSE handler's
 * cleanup path exists to prevent.
 */
async function readSseHead(
  url: string,
  { budgetMs = 10_000 }: { budgetMs?: number } = {},
): Promise<{ status: number; headers: Headers; head: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);

  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });

    if (!res.body) return { status: res.status, headers: res.headers, head: '' };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let head = '';

    // One frame is enough; the handshake is what is under test.
    while (head.length < 512) {
      const { done, value } = await reader.read();
      if (done) break;
      head += decoder.decode(value, { stream: true });
      if (head.includes('\n\n')) break; // a complete SSE frame
    }

    await reader.cancel().catch(() => undefined);
    return { status: res.status, headers: res.headers, head };
  } finally {
    clearTimeout(timer);
  }
}

test.describe('server-sent events', () => {
  test('GET /api/events/:channel opens a stream and announces the channel', { tag: ['@stream'] }, async ({
    baseURL,
  }) => {
    // The SSE contract: on attach the server emits `event: connected` with the
    // channel name, then domain events. The handshake is what the client's
    // reconnect logic keys on, so it is worth pinning even though the events
    // themselves are data-dependent.
    const { status, headers, head } = await readSseHead(`${baseURL}/api/events/pipeline`);

    expect(status).toBe(200);
    expect(headers.get('content-type')).toContain('text/event-stream');

    // Cache headers matter here specifically: a proxy or the compression
    // middleware buffering an SSE stream makes the dashboard look frozen.
    expect(headers.get('cache-control')).toContain('no-cache');

    expect(head, `SSE opening frame was: ${JSON.stringify(head)}`).toContain('event: connected');
    expect(head).toContain('pipeline');
  });

  test('abandoned SSE clients are actually unregistered', { tag: ['@stream'] }, async ({
    baseURL,
    request,
  }) => {
    // Every SSE handler registers listeners on the in-process event bus and must
    // remove them when the socket closes. A leak is invisible for hours, until
    // every emit fans out to hundreds of dead responses.
    //
    // This asserts the CLIENT COUNT, not liveness. An earlier version opened five
    // streams, abandoned them, and then checked `/health` still answered 200 —
    // which it always would: a leaked listener does not unbind the socket, so
    // that test could not detect the leak it was named for.
    const clientCount = async () => {
      const stats = await (await request.get('/api/events/stats')).json();
      return Number(stats.pipeline ?? 0);
    };

    const before = await clientCount();

    for (let i = 0; i < 5; i++) {
      await readSseHead(`${baseURL}/api/events/pipeline`, { budgetMs: 3_000 });
    }

    // The server notices a disconnect on its own schedule, so allow it to settle
    // rather than reading the instant the last socket closes.
    await expect(async () => {
      expect(await clientCount()).toBeLessThanOrEqual(before);
    }).toPass({ timeout: 20_000 });

    expect(
      (await request.get('/health')).status(),
      'the server stopped answering after repeated SSE disconnects',
    ).toBe(200);
  });

  test('an unknown SSE channel does not open a silent dead stream', { tag: ['@stream'] }, async ({
    baseURL,
  }) => {
    const { status, headers, head } = await readSseHead(`${baseURL}/api/events/not-a-channel`, {
      budgetMs: 6_000,
    });

    // Three acceptable answers: a 4xx, a non-stream 200, or a stream that at
    // least says something on attach. What must NOT happen is a 200
    // text/event-stream that never sends a byte — a client subscribing to a typo
    // would then wait forever with no error and no data.
    // The router validates the channel against {pipeline, training, system} and
    // answers 400 for anything else, so that is what is asserted. The earlier
    // version began `if (status >= 400) return;`, which fired on every run and
    // meant the test asserted nothing at all on the only path it ever took.
    if (status >= 400) {
      expect(status, 'an unknown SSE channel should be rejected with 400').toBe(400);
      return;
    }

    // If it ever stops rejecting, it must at least not open a silent dead stream:
    // a client subscribing to a typo would wait forever with no error and no data.
    expect(
      head.length,
      'an unknown channel opened an event stream and sent nothing — a typo in a channel name would hang a client silently',
    ).toBeGreaterThan(0);
  });
});
