import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['apps/*/tests/**/*.test.{ts,tsx}', 'packages/*/tests/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    exclude: ['node_modules/**', '.git/**', '.worktrees/**', 'Trading/quant.worktrees/**'],
    testTimeout: 30000,
    pool: 'forks',
    reporters: ['default'],
    environmentMatchGlobs: [
      ['apps/web/tests/**/*.test.tsx', 'jsdom'],
      ['apps/web/tests/**/*.test.ts', 'jsdom'],
    ],
    coverage: {
      provider: 'v8',
      include: ['apps/api/src/**/*.ts', 'packages/shared/src/**/*.ts', 'apps/web/src/**/*.tsx'],
      exclude: ['**/*.test.ts', '**/*.test.tsx', '**/types.ts', '**/*.d.ts'],
      thresholds: { statements: 11, branches: 6, functions: 7, lines: 11 },
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, 'packages', 'shared', 'src'),
      '@': path.resolve(import.meta.dirname, 'apps', 'web', 'src'),
    },
  },
});
