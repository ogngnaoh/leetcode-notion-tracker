import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import config from '../playwright.config.js';

it('keeps the default check browser-free while retaining build and security checks', () => {
  const { scripts } = JSON.parse(readFileSync('package.json', 'utf8'));
  const commands: string[] = [];
  const visit = (name: string, seen = new Set<string>()) => {
    if (seen.has(name)) return;
    seen.add(name);
    const command = scripts[name];
    if (!command) return;
    commands.push(command);
    visit(`pre${name}`, seen);
    for (const match of command.matchAll(/npm run ([\w:-]+)/g)) visit(match[1], seen);
    visit(`post${name}`, seen);
  };
  visit('check');
  expect(commands.join('\n')).not.toMatch(/playwright|test:browser/);
  expect(commands.join('\n')).toContain('scripts/build-extension.mjs');
  expect(commands.join('\n')).toContain('scripts/scan-secrets.mjs');
});

it('limits browser discovery to current MV3 tests and stops on the first failure', () => {
  expect(config.testMatch).toEqual(['mv3-capture.spec.ts', 'notion-lifecycle.spec.ts']);
  expect(config.workers).toBe(1);
  expect(config.retries).toBe(0);
  expect(config.maxFailures).toBe(1);
});
