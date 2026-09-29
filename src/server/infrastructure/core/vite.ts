import { type Express, type Request } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../../../../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

/** Extensions the module graph and asset pipeline own — never index.html. */
const MODULE_OR_ASSET =
  /\.(?:[cm]?[jt]sx?|css|json|wasm|map|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|wav)$/i;

/** True only for a top-level navigation — the one case the SPA shell answers. */
function wantsDocument(req: Request): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (!(req.headers.accept ?? "").includes("text/html")) return false;
  return !MODULE_OR_ASSET.test(req.path);
}

export async function setupVite(server: Server, app: Express) {
  const serverOptions = {
    // Preserve vite.config.ts `server` block — critically `watch.ignored`
    // (the gigabyte-scale ML-artifact-dir exclusions) and `fs`. Without the
    // spread, middleware mode silently drops them and chokidar can rescan
    // data/models, data/parquet, optuna_studies, etc. on every save.
    // The middleware-mode keys below intentionally override config `hmr`/`port`
    // (a Vite HTTP server is never created here; HMR must bind to `server`).
    ...viteConfig.server,
    middlewareMode: true,
    hmr: { server, path: "/vite-hmr" },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        // Do NOT process.exit(1) here in local mode, otherwise the server crashes
        // and the dashboard loses connection on every syntax error during dev.
        console.warn('[vite] Error detected, but keeping server alive for HMR.');
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);

  // SPA fallback — navigation requests ONLY.
  //
  // Vite has already had its chance at this URL. Anything reaching here that
  // wants a MODULE rather than a document (`Accept: */*`, or a path carrying a
  // JS/CSS/asset extension) is a request Vite declined or failed to transform,
  // and answering it with index.html hides the fault: the browser receives
  // `text/html` for a `<script type="module">` and reports a MIME error instead
  // of the real one. A dead `vite:esbuild` service presents in exactly that
  // shape — every .ts/.tsx transform throws "The service was stopped" while CSS
  // and pre-bundled deps keep serving — so the app stops booting with nothing on
  // screen naming the cause. Falling through is the honest answer.
  app.use(async (req, res, next) => {
    if (!wantsDocument(req)) return next();

    const url = req.originalUrl;

    try {
      // Anchor on Vite's resolved `root` (absolute, from vite.config.ts), NOT
      // on this file's directory depth. `import.meta.dirname`-relative `..`
      // counting is what broke when the god-file refactor relocated this file
      // deeper — re-anchoring here makes the template path immune to future
      // moves (change vite.config.ts `root` only).
      const clientTemplate = path.resolve(vite.config.root, "index.html");

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
