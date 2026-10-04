import { defineConfig } from '@playwright/test';
import current from './playwright.config.js';

// Measurement tooling, not a correctness or release gate.
export default defineConfig({
  ...current,
  testDir: './scripts/benchmark',
  testMatch: 'direct-performance.spec.ts',
  outputDir: 'build/playwright-benchmark-results',
  projects: [{ name: 'direct-benchmark' }],
});
