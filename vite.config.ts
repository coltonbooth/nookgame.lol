import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: { target: 'es2020' },
  test: {
    // core/ is pure — no DOM needed.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
