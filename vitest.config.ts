import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // `.tsx` included so React component tests are possible at all — every
    // client test before Stage 4 was logic-only, so the pattern never needed it
    // and a `.test.tsx` file was silently collected by nothing.
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    pool: 'forks',
    reporters: ['default'],
    // Component tests use jsdom via inline environment pragma:
    //   // @vitest-environment jsdom
    environmentMatchGlobs: [
      ['tests/client/**/*.test.tsx', 'jsdom'],
      ['tests/client/**/*.test.ts', 'jsdom'],
    ],
    coverage: {
      provider: 'v8',
      include: ['src/server/**/*.ts', 'src/shared/**/*.ts', 'src/client/src/**/*.tsx'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/types.ts', '**/*.d.ts'],
      // A ratchet, not an aspiration. These are the numbers the suite actually
      // produced on 2026-09-15, the first time coverage ran at all: the config
      // had declared 30% since it was written, but @vitest/coverage-v8 was never
      // installed, so every `--coverage` run died on a missing dependency and the
      // thresholds gated nothing. Measured over the gateable suite (server,
      // shared, ml, integration — tests/client is quarantined while the
      // architecture-explorer modules land). Raise these as coverage improves;
      // never lower them without saying why.
      thresholds: {
        statements: 11,
        branches: 6,
        functions: 7,
        lines: 11,
      },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, 'src', 'shared'),
      '@': path.resolve(import.meta.dirname, 'src', 'client', 'src'),
    },
  },
});
