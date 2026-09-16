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
 * Console noise that is real but not a defect, and would otherwise fail every
 * spec. Each entry needs a reason — an unexplained mute here is how a genuine
 * regression gets permanently hidden.
 */
const IGNORED_CONSOLE_PATTERNS: Array<{ pattern: RegExp; because: string }> = [
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
];

function isIgnoredConsole(text: string): boolean {
  return IGNORED_CONSOLE_PATTERNS.some(({ pattern }) => pattern.test(text));
}

/** Requests the app is expected to make and expected to sometimes fail. */
const TOLERATED_REQUEST_FAILURES: RegExp[] = [
  // Aborted in-flight fetches are the normal consequence of navigating away
  // mid-request; Playwright reports them as failures, the app handles them.
  /net::ERR_ABORTED/,
];

interface AppFixtures {
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

  capturedErrors: async ({ page }, use) => {
    const errors: CapturedError[] = [];

    const onConsole = (msg: ConsoleMessage) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (isIgnoredConsole(text)) return;
      const loc = msg.location();
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
  },

  capturedRequestFailures: async ({ page }, use) => {
    const failures: CapturedRequestFailure[] = [];

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
      failures.push({
        method: res.request().method(),
        url,
        status: res.status(),
        detail: await res.text().catch(() => '<unreadable body>').then((t) => t.slice(0, 400)),
      });
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
  },

  app: async ({ page }, use) => {
    await use(new AppHelper(page));
  },
});

/**
 * The automatic assertions. These run after every test body, so a spec does not
 * have to remember to check them — and cannot quietly forget to.
 */
test.afterEach(async ({ capturedErrors, capturedRequestFailures, allowPageErrors, allowRequestFailures }, testInfo) => {
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
