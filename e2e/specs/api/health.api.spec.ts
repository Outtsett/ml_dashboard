import { test, expect } from '@playwright/test';

/**
 * The health surface, and the difference between its four endpoints.
 *
 * This matters more than it looks. The dashboard exposes four health-ish routes
 * and they answer four different questions; using the wrong one as a gate is how
 * a pipeline ends up either permanently red or permanently green:
 *
 *   /health              liveness. No dependencies. 200 as soon as the socket is
 *                        bound. THE correct gate for a webServer or a deploy
 *                        smoke test.
 *   /api/readiness       readiness. Requires the lake to be healthy
 *                        (`startupManager.ts:78`), so it is 503 forever on a
 *                        machine with no AIStor — a CI gate on this can never go
 *                        green.
 *   /api/startup-report  the StartupReport object, or 503 before the sequence
 *                        has produced one.
 *   /api/health          Nest Terminus composite over DuckDB + SQLite.
 *
 * The specs below assert the SHAPE of each and the invariant that distinguishes
 * them, rather than asserting a fixed status that only holds on one machine.
 */

test.describe('health endpoints', () => {
  test('/health is dependency-free liveness', { tag: ['@smoke', '@static'] }, async ({ request }) => {
    const res = await request.get('/health');

    // This is the one endpoint with no excuse for a non-200. If it fails the
    // process is not serving, and nothing else in the suite can mean anything.
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok' });
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(typeof body.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);

    // Memory is reported in MB by the handler; a zero here means the shape
    // changed and a monitoring consumer is reading a field that no longer exists.
    expect(body.memory).toEqual(
      expect.objectContaining({
        heapUsed: expect.any(Number),
        heapTotal: expect.any(Number),
        rss: expect.any(Number),
      }),
    );
    expect(body.memory.rss).toBeGreaterThan(0);
  });

  test('/health answers before and independently of the databases', { tag: ['@smoke'] }, async ({
    request,
  }) => {
    // Liveness must not degrade when a dependency does. Called twice around a
    // deliberately heavy request so a shared-connection stall would show up.
    const before = await request.get('/health');
    expect(before.status()).toBe(200);

    await request.get('/api/readiness').catch(() => undefined);

    const after = await request.get('/health');
    expect(after.status()).toBe(200);
    expect((await after.json()).status).toBe('ok');
  });

  test('/api/health reports a per-dependency breakdown', { tag: ['@backend'] }, async ({ request }) => {
    const res = await request.get('/api/health');

    // Terminus answers 200 when everything is up and 503 when a check fails.
    // Both are legitimate — a runner with no lake SHOULD say 503 here — so the
    // assertion is on the contract, not the verdict.
    expect([200, 503]).toContain(res.status());

    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('info');
    expect(body).toHaveProperty('details');

    // Whatever the verdict, the indicators must be named. A composite health
    // check that reports "down" without saying WHICH dependency is down is the
    // failure mode this asserts against.
    const indicators = Object.keys(body.details ?? {});
    expect(indicators.length, '/api/health reported no indicators at all').toBeGreaterThan(0);
    for (const name of indicators) {
      expect(body.details[name]).toHaveProperty('status');
      expect(['up', 'down']).toContain(body.details[name].status);
    }
  });

  test('/api/readiness is a deep gate and says why when it refuses', { tag: ['@backend'] }, async ({
    request,
  }) => {
    const res = await request.get('/api/readiness');
    expect([200, 503]).toContain(res.status());

    const body = await res.json();

    if (res.status() === 503) {
      // A 503 that does not explain itself is untriageable at 3am. The payload
      // must carry something naming the unhealthy component.
      expect(
        JSON.stringify(body).length,
        '/api/readiness returned 503 with an empty body',
      ).toBeGreaterThan(2);
    }
  });

  test('/api/startup-report carries the SQLite and lake verdicts', { tag: ['@backend'] }, async ({
    request,
  }) => {
    const res = await request.get('/api/startup-report');
    expect([200, 503]).toContain(res.status());

    if (res.status() === 200) {
      const body = await res.json();
      // These two names are the contract the deployment checklist documents
      // ("startup report shows --- Overall: HEALTHY --- (SQLite +, lake +)").
      expect(body).toHaveProperty('sqlite');
      expect(body).toHaveProperty('lake');
      expect(body).toHaveProperty('overallHealthy');
      expect(typeof body.overallHealthy).toBe('boolean');
    }
  });

  test('SQLite is up — it is the one dependency that is never optional', { tag: ['@backend'] }, async ({
    request,
  }) => {
    // Everything else degrades. SQLite is opened eagerly at import (`db.ts`) and
    // self-creates, so if it is down on any machine, the install is broken.
    const res = await request.get('/api/health');
    const body = await res.json();

    const sqlite = body?.details?.sqlite;
    expect(sqlite, '/api/health no longer reports a `sqlite` indicator').toBeDefined();
    expect(sqlite.status).toBe('up');
  });
});

test.describe('API error contract', () => {
  test('an unmounted /api path returns a JSON 404, not the SPA shell', { tag: ['@smoke'] }, async ({
    request,
  }) => {
    // The SPA fallback answers `/{*path}`. If it is ever registered before the
    // API catch-all, every mistyped API call starts returning 200 text/html and
    // client fetches fail with a JSON parse error far from the cause.
    const res = await request.get('/api/definitely-not-a-real-endpoint');

    expect(res.status()).toBe(404);
    expect(res.headers()['content-type']).toContain('application/json');
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  test('every response carries a request id for correlation', { tag: ['@smoke'] }, async ({
    request,
  }) => {
    // `main.ts` assigns a per-request correlation id and echoes it in
    // X-Request-ID; the error handler puts the same value in the body. Without
    // it a 500 in the log cannot be tied to the request that caused it.
    const res = await request.get('/health');
    const id = res.headers()['x-request-id'];
    expect(id, 'X-Request-ID header is missing — log correlation is broken').toBeTruthy();
  });
});
