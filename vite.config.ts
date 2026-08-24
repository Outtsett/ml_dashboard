import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { compression } from "vite-plugin-compression2";
import { visualizer } from "rollup-plugin-visualizer";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isAnalyze = process.env.ANALYZE === "true";

/**
 * Vendor chunk grouping.
 *
 * Vite 8 narrowed Rollup's `manualChunks` type to the function form, so the
 * previous object literal (`{ "vendor-react": ["react", ...] }`) no longer
 * typechecks. The grouping is unchanged — it is just expressed as a lookup over
 * the module id instead of a package map.
 */
const VENDOR_CHUNKS: Record<string, readonly string[]> = {
  "vendor-react": ["react", "react-dom"],
  "vendor-lightweight-charts": ["lightweight-charts"],
  "vendor-recharts": ["recharts"],
  "vendor-3d": ["three", "@react-three/fiber", "@react-three/drei"],
  "vendor-ui": [
    "@radix-ui/react-dialog",
    "@radix-ui/react-dropdown-menu",
    "@radix-ui/react-popover",
    "@radix-ui/react-tabs",
    "@radix-ui/react-select",
    "@radix-ui/react-tooltip",
  ],
  "vendor-query": ["@tanstack/react-query"],
  "vendor-monaco": ["@monaco-editor/react", "monaco-editor"],
  "vendor-table": ["@tanstack/react-table"],
  "vendor-markdown": ["react-markdown", "remark-gfm"],
};

/**
 * Map a module id to its vendor chunk, or undefined to let Rollup decide.
 *
 * `lastIndexOf` rather than `indexOf`: with nested node_modules the innermost
 * package is the one that owns the module. The `pkg + "/"` boundary check keeps
 * `react` from swallowing `react-dom` and `react-markdown`, which a plain
 * `includes()` would.
 */
function vendorChunk(id: string): string | undefined {
  const normalized = id.split("\\").join("/");
  const marker = "/node_modules/";
  const at = normalized.lastIndexOf(marker);
  if (at === -1) return undefined;

  const rest = normalized.slice(at + marker.length);
  for (const [chunk, packages] of Object.entries(VENDOR_CHUNKS)) {
    for (const pkg of packages) {
      if (rest === pkg || rest.startsWith(pkg + "/")) return chunk;
    }
  }
  return undefined;
}

export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: ['babel-plugin-react-compiler'],
      },
    }),
    tailwindcss(),
    // Pre-compress static assets at build time (gzip + brotli)
    compression({ algorithms: ["gzip", "brotliCompress"], threshold: 1024, deleteOriginalAssets: false }),
    // Bundle analysis (opt-in via ANALYZE=true)
    ...(isAnalyze
      ? [visualizer({
          filename: path.resolve(__dirname, "dist", "bundle-analysis.html"),
          gzipSize: true,
          brotliSize: true,
          open: true,
        })]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src", "client", "src"),
      "@shared": path.resolve(__dirname, "src", "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  root: path.resolve(__dirname, "src", "client"),
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: vendorChunk,
      },
    },
  },
  optimizeDeps: {
    exclude: ["@monaco-editor/react", "monaco-editor"],
  },
  server: {
    host: "127.0.0.1",
    // Default to 5000 — same origin as the NestJS backend so the renderer
    // (loaded by Electron at http://127.0.0.1:5000) does HMR over the same
    // WebSocket. Standalone `vite dev --port 5000` also lands here.
    port: 5000,
    strictPort: false,
    hmr: {
      protocol: "ws",
      host: "127.0.0.1",
      // Omit explicit `port` so the HMR client uses the same port as the
      // HTTP server (whatever the CLI / middleware host resolved to).
      // Hardcoding here is what caused the silent HMR-WS-on-5173 break.
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
    // Vite's default watcher recursively scans `root` (src/client) BUT the
    // project also has gigabyte-scale ML artifact dirs at the project root
    // that get pulled in by IDE tooling and tsconfig path resolution. Ignore
    // them aggressively so saves stay sub-100ms.
    watch: {
      ignored: [
        "**/node_modules/**",
        "**/dist/**",
        "**/release/**",
        "**/data/.cache/**",
        "**/data/models/**",
        "**/data/parquet/**",
        "**/data/analysis/**",
        "**/optuna_studies/**",
        "**/logs/**",
        "**/.questdb/**",
        "**/.git/**",
      ],
    },
  },
});
