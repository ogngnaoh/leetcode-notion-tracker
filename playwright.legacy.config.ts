import { defineConfig } from '@playwright/test';
import current from './playwright.config.js';

// Optional legacy bridge UI; never discovered by the current extension suite.
export default defineConfig({
  ...current,
  testDir: './test/legacy-browser',
  testMatch: 'dashboard.spec.ts',
  outputDir: 'build/playwright-legacy-results',
  projects: [{ name: 'legacy-dashboard' }],
});
