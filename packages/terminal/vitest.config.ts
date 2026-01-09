import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Run test files in parallel
    pool: 'threads',
    poolOptions: {
      threads: {
        // Use multiple threads
        minThreads: 1,
        maxThreads: 4,
      },
    },
    // Increase timeout for integration tests
    testTimeout: 30000,
  },
});
