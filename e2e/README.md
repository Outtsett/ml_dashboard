# End-to-end suite

Playwright specs that drive the real dashboard — the production server serving
the production client bundle — in a real browser.

```bash
npm run test:e2e          # build, then run everything
npm run test:e2e:only     # run against the dist/ you already have
npm run test:e2e:smoke    # the @smoke subset
npm run test:e2e:ui       # Playwright's watch UI
npm run test:e2e:report   # open the last HTML report
```

## What this suite is for

The dashboard is a single-page app served by a single Express process, and that
shape defeats the obvious tests. **Every route returns the same 2 KB
`index.html`**, so the server cannot tell you whether a route works: `/glossary`
and `/this-route-does-not-exist` are byte-identical 200s. A route whose component
throws on first render still returns a perfectly valid response.

So the assertions here are about what ends up on screen:

1. React mounted something into `#root`
2. what it mounted is not an error boundary
3. the console stayed clean — no errors, no uncaught exceptions
4. no same-origin `/api/*` request came back 4xx/5xx

Points 3 and 4 are automatic. `e2e/fixtures/app.ts` attaches the listeners and
asserts in `afterEach`, so a spec cannot forget them. A spec that *expects* an
error opts out explicitly with `test.use({ allowPageErrors: true })` and says
why.

That fixture is the reason this suite is worth having. A React page that blows up
in a `useEffect` renders blank and returns HTTP 200; only the console knows.

## The guards were inert once — check them if you change them

The console/network guards are the reason this suite is worth running, and they
spent their first hour doing nothing at all.

Playwright instantiates a fixture the first time something asks for it. No spec
body references `capturedErrors` — that is the whole point — so the first request
came from the `afterEach`, which runs *after* the test body. The listeners
attached to a page that had already finished, the array was always empty, and
every test passed. `auto: true` on both guard fixtures is what fixes it.

If you touch `e2e/fixtures/app.ts`, re-prove them with a throwaway spec that
calls `console.error` on purpose and fetches a deliberate 404. Both must FAIL,
and a clean page must still pass. A guard that only ever passes proves nothing.

## Known defects

`KNOWN_DEFECT_PATTERNS` in `e2e/fixtures/app.ts` lists real application faults
the guards found the moment they started working. They are recorded, not
silenced: a test whose page hits one is annotated so the HTML report names it,
and the test still passes so the suite stays runnable.

This list is meant to reach zero. Do not add to it to make a build green.

| defect | where |
|---|---|
| Lens RollingPanel draws ReferenceLines at a NaN null-band — `Math.max(1, NaN)` returns NaN | `src/shared/lens/rolling.ts:40-44` |
| `/api/experiments` answers 500 when PostgreSQL is absent, though Postgres is optional | `src/server/ml/experiments.router.ts` |
| The market page 404s requesting label assignments for a model that has none | `/api/training/models/:id/assignments` |

## Layout

```
e2e/
  fixtures/app.ts              console + network guards, mount-aware navigation
  support/routes.ts            the route table, as data
  specs/
    smoke/routes.spec.ts             all 25 routes render
    smoke/route-table-drift.spec.ts  the table still matches App.tsx
    api/health.api.spec.ts           the four health endpoints and how they differ
    api/contract.api.spec.ts         API shape, OHLC invariants, SSE handshake
    journeys/navigation.spec.ts      all 16 sidebar links actually navigate
```

## Projects

| project | what it runs | browser |
|---|---|---|
| `api` | `*.api.spec.ts` | none — HTTP only |
| `chromium` | everything else | Chromium |

The `api` project needs no browser, so the API contract stays gated even where
installing Chromium is not worth the minutes.

## Tags

Specs are tagged by what they need, so a run can be scoped to an environment.

| tag | needs | runs in CI? |
|---|---|---|
| `@static` | nothing — renders with no server data | yes |
| `@backend` | the API and SQLite | yes |
| `@stream` | an SSE or WebSocket connection | yes |
| `@lake` | the Iceberg lake at `E:\lake` via DuckDB | **no** |
| `@smoke` | fast subset, spans the others | yes |
| `@nav` | sidebar navigation journeys | yes |

`@lake` is excluded on GitHub runners (`--grep-invert @lake`), because those
specs read real market data that only exists on Tyler's machine. Excluding them
is honest; asserting them loosely enough to pass without data would not be.

## Ports, and why never 5000

The suite runs the server on `E2E_PORT` (default **5099**) and never 5000.
Tyler's dashboard lives on 5000 all day, and `EADDRINUSE` is a hard
`process.exit(1)` in the server — a test run must not be able to take the real
instance down, or inherit its state.

`playwright.config.ts` passes the port through `webServer.env`, which wins over
the `PORT=5000` line in `.env`: the server reads `process.env.PORT` and `dotenv`
does not overwrite a variable that is already set.

> This is the setting that surfaced a real production bug. The CORS allow-list in
> `main.ts` was written as a literal `http://127.0.0.1:5000`, so on any other port
> the server rejected **its own** origin and answered every `/assets/*` request
> with 500 — the page rendered blank while `/health` stayed green. Module scripts
> and stylesheets are fetched in CORS mode and do send `Origin`. The allow-list is
> now derived from the configured port.

## Selectors

Prefer `data-testid`. The repo has ~210 of them already.

Do **not** select sidebar links by their text: the label span is conditional on
the rail being expanded (`LeftSidebar.tsx`), so a text selector passes today and
breaks the moment anyone collapses it. Nav links carry
`data-testid="nav-<slug>"`, derived from the href, which is stable in both
states.

## Adding a route

Two edits, on purpose:

1. the `<AppRoute>` in `src/client/src/App.tsx`
2. an entry in `e2e/support/routes.ts` with the right tier

`route-table-drift.spec.ts` reads App.tsx and fails if you do only the first —
naming the route. The duplication is deliberate: importing the real table would
make the sweep agree with any change automatically, so deleting a route would
silently delete its own test.

## Debugging a failure

Traces, videos and screenshots are written on failure only.

```bash
npx playwright show-trace test-results/<spec>/trace.zip
E2E_SERVER_STDOUT=pipe npm run test:e2e:only   # see the server's own log
```

The server's request log is suppressed by default — it is ~400 KB per run and
buries the results.
