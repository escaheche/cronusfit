import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types/**'],
    },
    // Property-based test support: increase timeout for fast-check iterations
    testTimeout: 30_000,
    // Allow running property tests separately via --grep
    // Usage: npx vitest run --grep "property"
  },
});
