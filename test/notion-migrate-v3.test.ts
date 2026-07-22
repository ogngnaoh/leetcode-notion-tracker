import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { NotionManifest } from '../src/shared/contract.js';
import { migrateNotionV3 } from '../src/notion/migrate-v3.js';
import { REQUIRED_ATTEMPTS_TYPES, V2_REQUIRED_PROBLEMS_TYPES } from '../src/notion/schema.js';

const manifest: NotionManifest = {
  version: 2,
  notionApiVersion: '2026-03-11',
  createdAt: '2026-07-20T12:00:00.000Z',
  parentPageId: 'parent',
  problems: { databaseId: 'problems-db', dataSourceId: 'problems-source' },
  attempts: { databaseId: 'attempts-db', dataSourceId: 'attempts-source' },
};

function source(types: Record<string, string>) {
  return {
    object: 'data_source',
    properties: Object.fromEntries(
      Object.entries(types).map(([name, type]) => [name, { id: `${name}-id`, type, [type]: {} }]),
    ),
  };
}

function page(id: string, properties: Record<string, unknown>) {
  return { object: 'page', id, properties };
}

describe('v2 to v3 migration', () => {
  it('paginates inventory, derives earliest solved attempts, backs up, and backfills idempotently', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-v3-'));
    const queries = new Map<string, number>();
    const notion: any = {
      dataSources: {
        retrieve: vi.fn(async ({ data_source_id }) =>
          source(
            data_source_id === 'problems-source'
              ? V2_REQUIRED_PROBLEMS_TYPES
              : REQUIRED_ATTEMPTS_TYPES,
          ),
        ),
        query: vi.fn(async ({ data_source_id, start_cursor }) => {
          queries.set(data_source_id, (queries.get(data_source_id) ?? 0) + 1);
          if (data_source_id === 'problems-source') {
            return start_cursor
              ? { results: [page('problem-2', {})], has_more: false, next_cursor: null }
              : {
                  results: [page('problem-1', {})],
                  has_more: true,
                  next_cursor: 'problem-next',
                };
          }
          return start_cursor
            ? {
                results: [
                  page('attempt-older', {
                    Problem: { type: 'relation', relation: [{ id: 'problem-1' }] },
                    Result: { type: 'select', select: { name: 'Solved' } },
                    'Attempted At': {
                      type: 'date',
                      date: { start: '2026-07-18T08:00:00-04:00' },
                    },
                  }),
                ],
                has_more: false,
                next_cursor: null,
              }
            : {
                results: [
                  page('attempt-newer', {
                    Problem: { type: 'relation', relation: [{ id: 'problem-1' }] },
                    Result: { type: 'select', select: { name: 'Solved' } },
                    'Attempted At': {
                      type: 'date',
                      date: { start: '2026-07-20T08:00:00-04:00' },
                    },
                  }),
                ],
                has_more: true,
                next_cursor: 'attempt-next',
              };
        }),
        update: vi.fn(),
      },
      pages: { update: vi.fn() },
      views: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn(), update: vi.fn() },
    };

    const result = await migrateNotionV3({
      notion,
      manifest,
      manifestPath: join(directory, 'manifest.json'),
      backupDirectory: directory,
      apply: false,
      now: () => new Date('2026-07-21T00:00:00.000Z'),
    });

    expect(result.mode).toBe('dry-run');
    expect(result.counts).toEqual({ problems: 2, attempts: 2, solvedProblems: 1 });
    expect(queries).toEqual(
      new Map([
        ['problems-source', 2],
        ['attempts-source', 2],
      ]),
    );
    const backup = JSON.parse(await readFile(result.backupPath, 'utf8'));
    expect(backup.pages.problems).toEqual([
      { id: 'problem-1', firstSolved: null, expectedFirstSolved: '2026-07-18T08:00:00-04:00' },
      { id: 'problem-2', firstSolved: null, expectedFirstSolved: null },
    ]);
    expect(notion.dataSources.update).not.toHaveBeenCalled();
    expect(notion.pages.update).not.toHaveBeenCalled();
  });
});
