/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  test: {
    include: ['src/tests/**/*.test.ts'],
    globals: true,
    testTimeout: 60_000,
  },
});
