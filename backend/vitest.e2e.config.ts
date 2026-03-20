import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['e2e/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    setupFiles: ['e2e/setup.ts']
  }
});
