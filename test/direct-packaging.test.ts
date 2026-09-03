import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);
const builtins = [...new Set(builtinModules.map((name) => name.replace(/^node:/, '')))]
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const nodeImport = new RegExp(
  String.raw`(?:from\s*|import\s*\(|(?:__)?require\s*\()\s*["'](?:node:)?(?:${builtins})(?:/[^"']*)?["']`,
);

describe('direct extension packaging', () => {
  it('allows only Notion and LeetCode hosts and disables incognito', async () => {
    const manifest = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
    expect(manifest.host_permissions).toEqual([
      'https://leetcode.com/problems/*',
      'https://api.notion.com/*',
    ]);
    expect(manifest.incognito).toBe('not_allowed');
    expect(manifest.content_security_policy.extension_pages).toContain(
      'connect-src https://api.notion.com',
    );
    expect(manifest.permissions).not.toContain('nativeMessaging');
    expect(await readFile('extension/src/background.ts', 'utf8')).toContain('new NotionRuntime(');
  });

  it('ships browser-only JavaScript with no Node builtin import or dynamic require', async () => {
    await execute(process.execPath, ['scripts/build-extension.mjs']);
    for (const name of [
      'background.js',
      'content.js',
      'leetcode-model-bridge.js',
      'sidepanel.js',
      'options.js',
    ]) {
      expect(await readFile(`dist/extension/${name}`, 'utf8'), name).not.toMatch(nodeImport);
    }
  });
});
