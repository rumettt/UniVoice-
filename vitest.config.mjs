import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each test file gets its own module registry so vi.mock() is fully isolated.
    isolate: true,
  },
});
