import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 30_000,
    reporters: ['verbose'],
  },
});
