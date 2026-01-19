import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'threads',
    minWorkers: 1,
    maxWorkers: 4,
    testTimeout: 30000,
  },
});
