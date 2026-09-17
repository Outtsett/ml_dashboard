import { test as base, expect, type ConsoleMessage, type Page, type Request } from '@playwright/test';

/**
 * Shared fixtures for the ML Dashboard end-to-end suite.
 *
 * The point of these is that an HTTP 200 proves almost nothing about this app.
 * The server answers every navigation with the same SPA shell — `index.html`,
 * 2KB, `<div id="root"></div>` — so a route whose component throws on its first
 * render still returns 200 with a correctly-typed body, and a spec that checks
 * only the status code passes against a blank white page. What actually
 * distinguishes a working route from a broken one is: did React mount anything
 * into `#root`, did the console stay clean, and did the API calls the page fired
 * come back without a 5xx.
 *
 * So every test gets those three checks by default, and opts out explicitly when
 * a failure is the thing under test.
 */

/** A console message or uncaught exception captured during a test. */
export interface CapturedError {
  kind: 'console' | 'pageerror';
  text: string;
  location?: string;
}

/** A same-origin request that came back 4xx/5xx, or never came back at all. */
export interface CapturedRequestFailure {
  method: string;
  url: string;
  status: number | null;
  detail: string;
}

/**
 * Console noise that is real but not a defect. Each entry needs a reason — an
 * unexplained mute here is how a genuine regression gets permanently hidden.
 */
const BENIGN_CONSOLE_PATTERNS: Array<{ pattern: RegExp; because: string }> = [
  {
    pattern: /Download the React DevTools/i,
    because: 'React prints this on every dev-ish build; it is advice, not an error.',
  },
  {
    pattern: /\[vite\] connect(ing|ed)/i,
    because: 'Vite HMR client chatter — only present if a spec is pointed at a dev server.',
  },
  {
    pattern: /Content-Security-Policy|Permissions-Policy/i,
    because: 'Header policy warnings from Chrome about the Electron-oriented CSP, not page faults.',
  },
  {
    // `concretePath()` in support/routes.ts fills a `:param` with `e2e-<name>`,
    // so /hpo/:sessionId is swept as /hpo/e2e-sessionId. No such session exists
    // and the API correctly answers 404 — that IS the behaviour under test. The
    // marker is specific enough that it cannot mask a real URL.
    pattern: /\/e2e-[A-Za-z][A-Za-z0-9]*/,
    because: 'A synthetic id the route sweep invented for a parameterized route; 404 is the correct answer.',
  },
];

/**
 * KNOWN DEFECTS — real bugs, currently tolerated so the suite is usable.
 *
 * These are NOT noise. Each one is an application fault this guard found the
 * moment it started working, listed here with where it lives and what it would
 * take to fix, because failing every affected spec on day one would make the
 * whole suite unrunnable and it would be switched off within a week.
 *
 * The difference from `BENIGN_CONSOLE_PATTERNS` is intent: this list is meant to
 * reach zero. A test whose page hits one of these is annotated so the report
 * shows it rather than hiding it.
 *
 * Do not add to this list to make a build green. Adding an entry means choosing
 * to ship a known fault.
 */
const KNOWN_DEFECT_PATTERNS: Array<{ pattern: RegExp; defect: string }> = [
  {
    pattern: /<line> attribute x[12]: Expected length, "NaN"/i,
    defect:
      'Lens RollingPanel renders ReferenceLines at a NaN null-band. ' +
      'src/shared/lens/rolling.ts:40-44 — `Math.max(1, Math.floor(params.rollingWindowBars))` ' +
      'returns NaN when rollingWindowBars is non-finite, because Math.max propagates NaN; ' +
      '`half` is then NaN and both nullBand bounds reach SVG as NaN coordinates ' +
      '(src/client/src/lens/panels/RollingPanel.tsx:93-94). ' +
      'The same NaN already shows up in tests/client/lens/panels.test.tsx, which passes anyway. ' +
      'Fix: reject a non-finite window at the top of computeRolling rather than relying on Math.max.',
  },
  {
    pattern: /\/api\/experiments(\?|$|\s)/i,
    defect:
      'GET /api/experiments answers 500 when PostgreSQL is not running, and the /operate page ' +
      'calls it on load. Postgres is OPTIONAL in this architecture — ARCHITECTURE.md and the ' +
      'deployment checklist both say the core dashboard does not need it — so its absence is a ' +
      'known, expected state, not an internal server error. A 500 here is indistinguishable ' +
      'from a genuine fault and makes the page look broken on a machine that is configured ' +
      'exactly as documented. Fix: return 503 with a reason, or an empty ledger, when the ' +
      'experiments store is unconfigured (src/server/ml/experiments.router.ts).',
  },
  {
    pattern: /Failed to load resource.*?\/api\/training\/models\/.*?\/assignments|\/api\/training\/models\/.*?\/assignments/i,
    defect:
      'The market page requests label assignments for a model that has none and the server ' +
      'answers 404, which Chrome logs as a console error. Either the client should not request ' +
      'assignments for an unbuilt model, or the endpoint should return an empty list rather ' +
      'than 404 — an absent assignment set is a normal state, not an error.',
  },
];

/**
 * Classify a console message.
 *
 * Matched against the message text AND the URL it came from, joined. Chrome's
 * resource-failure message is generic — "Failed to load resource: the server
 * responded with a status of 404 (Not Found)" — and names the URL only in the
 * message's `location`. Matching on text alone therefore cannot tell one 404
 * from another, which is how a pattern written for a specific endpoint silently
 * matched nothing.
 */
function classifyConsole(text: string, locationUrl = ''): 'benign' | 'known-defect' | 'real' {
  const subject = `${text} ${locationUrl}`;
  if (BENIGN_CONSOLE_PATTERNS.some(({ pattern }) => pattern.test(subject))) return 'benign';
  if (KNOWN_DEFECT_PATTERNS.some(({ pattern }) => pattern.test(subject))) return 'known-defect';
  return 'real';
}

/** The known defect an observed message corresponds to, for reporting. */
function knownDefectFor(text: string, locationUrl = ''): string | undefined {
  const subject = `${text} ${locationUrl}`;
  return KNOWN_DEFECT_PATTERNS.find(({ pattern }) => pattern.test(subject))?.defect;
}

/** Requests the app is expected to make and expected to sometimes fail. */
const TOLERATED_REQUEST_FAILURES: RegExp[] = [
  // Aborted in-flight fetches are the normal consequence of navigating away
  // mid-request; Playwright reports them as failures, the app handles them.
  /net::ERR_ABORTED/,
];

interface AppFixtures {
  /** Known defects observed during the test, surfaced in the report. */
  observedKnownDefects: string[];
  /**
   * Errors seen on the page so far. Present so a spec can assert ON them
   * (`expect(capturedErrors).toHaveLength(0)` is already automatic) or inspect
   * them while debugging.
   */
  capturedErrors: CapturedError[];
  /** Same-origin API requests that failed during the test. */
  capturedRequestFailures: CapturedRequestFailure[];
  /**
   * Set to `true` inside a spec that deliberately provokes an error, to stop the
   * automatic end-of-test assertion from failing it:
   *   `test('renders an error state', async ({ page, allowPageErrors }) => {...})`
   * Override per-file with `test.use({ allowPageErrors: true })`.
   */
  allowPageErrors: boolean;
  /** Same, for expected API failures. */
  allowRequestFailures: boolean;
  /** Navigation helpers that wait for React to actually mount. */
  app: AppHelper;
}

/**
 * Navigation helper. Every route in this SPA returns the same shell, so
 * "the page loaded" has to mean "React mounted and painted something".
 */
export class AppHelper {
  constructor(private readonly page: Page) {}

  /**
   * Navigate to a client route and wait until the React tree has mounted.
   *
   * `waitUntil: 'domcontentloaded'` rather than `'networkidle'` on purpose: the
   * dashboard holds open SSE streams (`/api/events/...`) and a metrics
   * WebSocket, so the network is never idle and `networkidle` would burn the
   * full navigation timeout on every single call.
   */
  async goto(path: string): Promise<void> {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    await this.waitForMount();
  }

  /** Resolves once `#root` has rendered at least one element. */
  async waitForMount(timeout = 45_000): Promise<void> {
    await this.page
      .locator('#root > *')
      .first()
      .waitFor({ state: 'attached', timeout });
  }

  /**
   * The visible text of the app shell. Used to assert a route rendered
   * *something* without coupling to a specific component's markup.
   */
  async rootText(): Promise<string> {
    return (await this.page.locator('#root').innerText()).trim();
  }

  /**
   * True when the page is showing a React error boundary / crash screen rather
   * than content. Checked by name so a route that "renders" an error is not
   * counted as a healthy route.
   */
  async hasCrashed(): Promise<boolean> {
    const text = await this.rootText();
    return /something went wrong|application error|unexpected error|chunkloaderror/i.test(text);
  }
}

export const test = base.extend<AppFixtures>({
  allowPageErrors: [false, { option: true }],
  allowRequestFailures: [false, { option: true }],

  /**
   * `auto: true` is load-bearing, not decoration.
   *
   * Playwright instantiates a fixture the first time something asks for it. No
   * spec body references `capturedErrors` — the whole point is that specs do not
   * have to — so without `auto` the first request came from the `afterEach`
   * below, which runs AFTER the test body. The listeners attached to a page that
   * had already finished doing everything it was going to do, the array was
   * always empty, and the guard passed every time.
   *
   * It was verified inert: a spec that called `console.error` on purpose and a
   * spec that fetched a deliberate 404 both went green. `auto` forces setup
   * before the test body, which is when the listeners have to exist.
   *
   * This fixture depends on `page`, so `auto` also forces a browser page for
   * every test that imports this file. That is correct here — the API specs
   * import `test` from `@playwright/test` directly and never touch these
   * fixtures, so they still run without a browser.
   */
  observedKnownDefects: [async ({}, use) => {
    await use([]);
  }, { auto: true }],

  capturedErrors: [async ({ page, observedKnownDefects }, use) => {
    const errors: CapturedError[] = [];
    const knownDefects = observedKnownDefects;

    const onConsole = (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();

      const loc = msg.location();

      const kind = classifyConsole(text, loc.url);
      if (kind === 'benign') return;
      if (kind === 'known-defect') {
        // Recorded, not silenced: the test still passes, but the report names
        // the fault so the list is visible and can be driven to zero.
        const defect = knownDefectFor(text, loc.url);
        if (defect && !knownDefects.includes(defect)) knownDefects.push(defect);
        return;
      }

      errors.push({
        kind: 'console',
        text,
        location: loc.url ? `${loc.url}:${loc.lineNumber}:${loc.columnNumber}` : undefined,
      });
    };

    const onPageError = (err: Error) => {
      errors.push({ kind: 'pageerror', text: err.stack ?? err.message });
    };

    page.on('console', onConsole);
    page.on('pageerror', onPageError);

    await use(errors);

    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }, { auto: true }],

  /** `auto` for the same reason as `capturedErrors` above. */
  capturedRequestFailures: [async ({ page, observedKnownDefects }, use) => {
    const failures: CapturedRequestFailure[] = [];
    const knownDefects = observedKnownDefects;

    const isOwnApi = (url: string) => {
      try {
        return new URL(url).pathname.startsWith('/api/');
      } catch {
        return false;
      }
    };

    const onResponse = async (res: import('@playwright/test').Response) => {
      const url = res.url();
      if (!isOwnApi(url) || res.status() < 400) return;
      // A URL matching a KNOWN_DEFECT pattern is recorded, not failed — the same
      // treatment its console counterpart gets, so one fault is not reported by
      // two guards.
      const known = knownDefectFor('Failed to load resource', url);
      if (known) {
        if (!knownDefects.includes(known)) knownDefects.push(known);
        return;
      }
      // Pushed BEFORE the body is read. `page.on('response')` handlers are
      // fire-and-forget — Playwright does not await them — so awaiting
      // `res.text()` first meant a late-resolving body could land the record
      // after the afterEach had already inspected the array, and the failure
      // would vanish. The detail is filled in asynchronously on the record that
      // is already in the list.
      const record: CapturedRequestFailure = {
        method: res.request().method(),
        url,
        status: res.status(),
        detail: '<body not read yet>',
      };
      failures.push(record);
      record.detail = await res
        .text()
        .catch(() => '<unreadable body>')
        .then((t) => t.slice(0, 400));
    };

    const onRequestFailed = (req: Request) => {
      const url = req.url();
      if (!isOwnApi(url)) return;
      const detail = req.failure()?.errorText ?? 'unknown failure';
      if (TOLERATED_REQUEST_FAILURES.some((p) => p.test(detail))) return;
      failures.push({ method: req.method(), url, status: null, detail });
    };

    page.on('response', onResponse);
    page.on('requestfailed', onRequestFailed);

    await use(failures);

    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);
  }, { auto: true }],

  app: async ({ page }, use) => {
    await use(new AppHelper(page));
  },
});

/**
 * The automatic assertions. These run after every test body, so a spec does not
 * have to remember to check them — and cannot quietly forget to.
 */
test.afterEach(async ({ capturedErrors, capturedRequestFailures, allowPageErrors, allowRequestFailures, observedKnownDefects }, testInfo) => {
  // Known defects never fail a test, but they are always reported — a tolerated
  // fault that nobody can see is indistinguishable from a fixed one.
  for (const defect of observedKnownDefects) {
    testInfo.annotations.push({ type: 'known-defect', description: defect });
  }

  // A test that already failed has its own, more useful, message. Piling a
  // console dump on top buries it.
  if (testInfo.status !== testInfo.expectedStatus) return;

  if (!allowPageErrors && capturedErrors.length > 0) {
    const rendered = capturedErrors
      .map((e, i) => `  ${i + 1}. [${e.kind}] ${e.text}${e.location ? `\n     at ${e.location}` : ''}`)
      .join('\n');
    throw new Error(
      `The page reported ${capturedErrors.length} console error(s)/exception(s):\n${rendered}\n\n` +
        `If this is expected, set \`test.use({ allowPageErrors: true })\` in the spec and say why.`,
    );
  }

  if (!allowRequestFailures && capturedRequestFailures.length > 0) {
    const rendered = capturedRequestFailures
      .map((f, i) => `  ${i + 1}. ${f.method} ${f.url} → ${f.status ?? 'no response'}\n     ${f.detail}`)
      .join('\n');
    throw new Error(
      `${capturedRequestFailures.length} same-origin API request(s) failed:\n${rendered}\n\n` +
        `If this is expected, set \`test.use({ allowRequestFailures: true })\` in the spec and say why.`,
    );
  }
});

export { expect };
