import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import type { Client } from '@notionhq/client';
import { NotionCaptureRepository } from '../src/tracker/notion-repository.js';
import { manifest } from '../scripts/benchmark/fixture.js';

describe('portable tracker', () => {
  it('refuses a partial fresh dashboard and an incomplete pagination cursor', async () => {
    for (const page of [
      { results: [{ object: 'page', id: 'partial' }], has_more: false, next_cursor: null },
      { results: [], has_more: true, next_cursor: null },
    ]) {
      const notion = { dataSources: { query: async () => page } } as unknown as Client;
      await expect(
        new NotionCaptureRepository(notion, manifest).loadDashboard('2026-09-03'),
      ).rejects.toThrow();
    }
  });
  it('bundles the actual repository and capture service for Chrome without Node adapters', async () => {
    const result = await build({
      stdin: {
        contents: `export { CaptureService } from './src/tracker/capture-service.ts'; export { NotionCaptureRepository } from './src/tracker/notion-repository.ts';`,
        resolveDir: process.cwd(),
      },
      bundle: true,
      platform: 'browser',
      target: 'chrome142',
      write: false,
      metafile: true,
    });
    expect(
      Object.keys(result.metafile!.inputs).some((path) =>
        /notion-repository-node|dotenv|node:/.test(path),
      ),
    ).toBe(false);
  });
});
