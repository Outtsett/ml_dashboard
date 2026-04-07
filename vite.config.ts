import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { compression } from "vite-plugin-compression2";
import { visualizer } from "rollup-plugin-visualizer";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isAnalyze = process.env.ANALYZE === "true";

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
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-lightweight-charts": ["lightweight-charts"],
          "vendor-recharts": ["recharts"],
          "vendor-3d": ["three", "@react-three/fiber", "@react-three/drei"],
          "vendor-ui": ["@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-popover", "@radix-ui/react-tabs", "@radix-ui/react-select", "@radix-ui/react-tooltip"],
          "vendor-query": ["@tanstack/react-query"],
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    hmr: {
      protocol: "ws",
      host: "127.0.0.1",
    port: 5173,
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
