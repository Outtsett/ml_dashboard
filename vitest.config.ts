import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    pool: 'forks',
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: ['src/server/**/*.ts', 'src/shared/**/*.ts'],
      exclude: ['**/*.test.ts', '**/types.ts', '**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, 'src', 'shared'),
      '@': path.resolve(import.meta.dirname, 'src', 'client', 'src'),
    },
  },
});
