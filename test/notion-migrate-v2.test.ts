import { access, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NotionManifest } from '../src/shared/contract.js';
import {
  classifyV2MigrationShape,
  migrateNotionV2,
  toCalendarDate,
  toSolvedStreak,
  toV2State,
  type NotionMigrationClient,
} from '../src/notion/migrate-v2.js';
import {
  DIFFICULTY_OPTION_NAMES,
  INTERMEDIATE_ATTEMPTS_TYPES,
  INTERMEDIATE_PROBLEMS_TYPES,
  REQUIRED_ATTEMPTS_TYPES,
  REQUIRED_PROBLEMS_TYPES,
  RESULT_OPTIONS,
  STATE_OPTIONS,
  V1_ATTEMPTS_TYPES,
  V1_PROBLEMS_TYPES,
} from '../src/notion/schema.js';

const manifestV1: NotionManifest = {
  version: 1,
  notionApiVersion: '2026-03-11',
  createdAt: '2026-07-20T12:00:00.000Z',
  parentPageId: 'parent-page',
  problems: { databaseId: 'problems-db', dataSourceId: 'problems-source' },
  attempts: { databaseId: 'attempts-db', dataSourceId: 'attempts-source' },
};

function property(type: string, value: unknown, id: string): any {
  if (type === 'title' || type === 'rich_text') {
    return {
      id,
      type,
      [type]: value === null || value === '' ? [] : [{ plain_text: String(value) }],
    };
  }
  if (type === 'select') {
    return { id, type, select: value === null || value === '' ? null : { name: String(value) } };
  }
  if (type === 'date') {
    return { id, type, date: value === null ? null : { start: String(value) } };
  }
  if (type === 'relation') {
    return { id, type, relation: Array.isArray(value) ? value.map((item) => ({ id: item })) : [] };
  }
  if (type === 'multi_select') {
    return {
      id,
      type,
      multi_select: Array.isArray(value) ? value.map((item) => ({ name: item })) : [],
    };
  }
  return { id, type, [type]: value };
}

function page(
  id: string,
  types: Record<string, string>,
  values: Record<string, unknown>,
): { object: string; id: string; properties: Record<string, any> } {
  return {
    object: 'page',
    id,
    properties: Object.fromEntries(
      Object.entries(types).map(([name, type]) => [
        name,
        property(type, values[name] ?? null, `${id}-${name}`),
      ]),
    ),
  };
}

function schema(types: Record<string, string>, target: 'problems' | 'attempts'): any {
  return {
    object: 'data_source',
    id: `${target}-source`,
    properties: Object.fromEntries(
      Object.entries(types).map(([name, type]) => [
        name,
        {
          id: `${target}-${name}`,
          name,
          type,
          [type]:
            type === 'relation'
              ? {
                  data_source_id: target === 'problems' ? 'attempts-source' : 'problems-source',
                  type: 'dual_property',
                  dual_property: {},
                }
              : type === 'select'
                ? {
                    options: structuredClone(
                      name === 'Result'
                        ? RESULT_OPTIONS
                        : name === 'Difficulty'
                          ? DIFFICULTY_OPTION_NAMES.map((optionName) => ({
                              name: optionName,
                              color: 'default',
                            }))
                          : name === 'Practice State' || name === 'Resulting State'
                            ? STATE_OPTIONS
                            : [],
                    ),
                  }
                : {},
        },
      ]),
    ),
  };
}

const problemValues = {
  Problem: 'Two Sum',
  'External Key': 'leetcode:two-sum',
  Slug: 'two-sum',
  Number: 1,
  URL: 'https://leetcode.com/problems/two-sum/',
  Difficulty: 'Easy',
  'Primary Pattern': 'Hash map',
  Mastery: 'Green',
  'Green Count': 9,
  'Next Review': '2026-07-24T04:00:00.000Z',
  'Last Attempt': '2026-07-20T08:30:00-04:00',
  'Extension Managed': true,
  Attempts: ['attempt-1'],
};

const attemptValues = {
  Attempt: 'Two Sum — 2026-07-20',
  'Client Event ID': 'eb9fdc89-8098-4f76-9a68-26e94dc75fc6',
  Problem: ['problem-1'],
  'Problem Key': 'leetcode:two-sum',
  'Attempted At': '2026-07-20T08:30:00-04:00',
  'Source URL': 'https://leetcode.com/problems/two-sum/',
  Language: 'Python',
  'Submission Result': 'Accepted',
  Outcome: 'Green',
  'Cold Attempt': false,
  'Help Used': 'None',
  'Failure Code': null,
  'Total Minutes': 0,
  'Primary Pattern': 'Hash map',
  Notes: 'Used complements',
  'Resulting Mastery': 'Mastered',
  'Resulting Green Count': 12,
  'Resulting Next Review': '2026-07-30T15:45:00.000Z',
  'Extension Managed': true,
  'Created Time': '2026-07-20T12:30:00.000Z',
};

type Shape = 'v1' | 'intermediate' | 'v2';

class FakeNotion {
  readonly token = 'migration-client-secret-marker';
  readonly log: string[] = [];
  readonly blocks = new Map<string, Array<Record<string, any>>>();
  readonly dataSources: NotionMigrationClient['dataSources'];
  readonly pages: NotionMigrationClient['pages'];
  readonly blockApi: NotionMigrationClient['blocks'];
  private problemSchema: ReturnType<typeof schema>;
  private attemptSchema: ReturnType<typeof schema>;

  constructor(
    problemShape: Shape = 'v1',
    attemptShape: Shape = 'v1',
    readonly problemPages = [page('problem-1', V1_PROBLEMS_TYPES, problemValues)],
    readonly attemptPages = [page('attempt-1', V1_ATTEMPTS_TYPES, attemptValues)],
  ) {
    const problemTypes =
      problemShape === 'v1'
        ? V1_PROBLEMS_TYPES
        : problemShape === 'intermediate'
          ? INTERMEDIATE_PROBLEMS_TYPES
          : REQUIRED_PROBLEMS_TYPES;
    const attemptTypes =
      attemptShape === 'v1'
        ? V1_ATTEMPTS_TYPES
        : attemptShape === 'intermediate'
          ? INTERMEDIATE_ATTEMPTS_TYPES
          : REQUIRED_ATTEMPTS_TYPES;
    this.problemSchema = schema(problemTypes, 'problems');
    this.attemptSchema = schema(attemptTypes, 'attempts');
    this.dataSources = {
      retrieve: async ({ data_source_id }) => {
        this.log.push(`retrieve:${data_source_id}`);
        return data_source_id === 'problems-source' ? this.problemSchema : this.attemptSchema;
      },
      query: async ({ data_source_id, page_size, start_cursor }) => {
        this.log.push(`query:${data_source_id}:${page_size}:${start_cursor ?? 'first'}`);
        const rows = data_source_id === 'problems-source' ? this.problemPages : this.attemptPages;
        const index = start_cursor ? Number(start_cursor) : 0;
        return {
          results: rows.slice(index, index + 1),
          has_more: index + 1 < rows.length,
          next_cursor: index + 1 < rows.length ? String(index + 1) : null,
        };
      },
      update: async ({ data_source_id, properties }) => {
        const isProblems = data_source_id === 'problems-source';
        this.log.push(
          `schema-update:${isProblems ? 'problems' : 'attempts'}:${Object.keys(properties).join(',')}`,
        );
        const current = isProblems ? this.problemSchema : this.attemptSchema;
        for (const [name, config] of Object.entries(properties)) {
          if (config === null) {
            delete current.properties[name];
            const rows = isProblems ? this.problemPages : this.attemptPages;
            for (const row of rows) delete row.properties[name];
          } else if (!current.properties[name]) {
            const type = Object.keys(config as object).find((key) => key !== 'type')!;
            current.properties[name] = {
              id: `new-${name}`,
              name,
              type,
              [type]: structuredClone((config as Record<string, unknown>)[type]),
            };
          }
        }
        return current;
      },
    };
    this.pages = {
      update: async ({ page_id, properties }) => {
        this.log.push(`page-update:${page_id}`);
        const target = [...this.problemPages, ...this.attemptPages].find(
          (candidate) => candidate.id === page_id,
        )!;
        for (const [name, request] of Object.entries(properties)) {
          const type = Object.keys(request as object)[0]!;
          const current = target.properties[name];
          target.properties[name] = {
            id: current?.id ?? `${page_id}-${name}`,
            type,
            ...(request as object),
          };
        }
        return target;
      },
      properties: {
        retrieve: async ({ page_id, property_id, page_size, start_cursor }) => {
          this.log.push(
            `property:${page_id}:${property_id}:${page_size}:${start_cursor ?? 'first'}`,
          );
          const target = [...this.problemPages, ...this.attemptPages].find(
            (candidate) => candidate.id === page_id,
          )!;
          const value = Object.values(target.properties).find(
            (candidate) => candidate.id === property_id,
          )!;
          const source = value[value.type] as unknown[];
          const index = start_cursor ? Number(start_cursor) : 0;
          const results = source.slice(index, index + page_size).map((item) => ({
            object: 'property_item',
            type: value.type,
            [value.type]: item,
          }));
          return {
            object: 'list',
            results,
            has_more: index + results.length < source.length,
            next_cursor:
              index + results.length < source.length ? String(index + results.length) : null,
          };
        },
      },
    };
    this.blockApi = {
      children: {
        list: async ({ block_id, page_size, start_cursor }) => {
          this.log.push(`blocks-list:${block_id}:${page_size}:${start_cursor ?? 'first'}`);
          const children = this.blocks.get(block_id) ?? [];
          const index = start_cursor ? Number(start_cursor) : 0;
          return {
            results: children.slice(index, index + 1),
            has_more: index + 1 < children.length,
            next_cursor: index + 1 < children.length ? String(index + 1) : null,
          };
        },
        append: async ({ block_id, children }) => {
          this.log.push(`blocks-append:${block_id}`);
          this.blocks.set(block_id, [...(this.blocks.get(block_id) ?? []), ...children]);
          return { results: children, has_more: false, next_cursor: null };
        },
      },
    };
  }
}

function migrationClient(fake: FakeNotion): NotionMigrationClient {
  return {
    dataSources: fake.dataSources,
    pages: fake.pages,
    blocks: fake.blockApi,
  };
}

async function paths() {
  const root = await mkdtemp(join(tmpdir(), 'leetcode-notion-v2-'));
  const manifestPath = join(root, 'notion-manifest.json');
  const backupDirectory = join(root, 'backups');
  const journalPath = join(root, 'notion-v2-journal.json');
  await writeFile(manifestPath, `${JSON.stringify(manifestV1)}\n`, 'utf8');
  return { root, manifestPath, backupDirectory, journalPath };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function pausedBeforeFirstMutation() {
  const fake = new FakeNotion();
  const update = fake.dataSources.update;
  (fake as any).dataSources.update = async () => {
    throw new Error('pause before first mutation');
  };
  const artifacts = await paths();
  await expect(
    migrateNotionV2({
      notion: migrationClient(fake),
      manifest: manifestV1,
      manifestPath: artifacts.manifestPath,
      backupDirectory: artifacts.backupDirectory,
      journalPath: artifacts.journalPath,
      apply: true,
    }),
  ).rejects.toThrow('pause before first mutation');
  (fake as any).dataSources.update = update;
  fake.log.length = 0;
  return { fake, ...artifacts };
}

describe('v2 migration mappings and shape safety', () => {
  it.each([
    ['Unseen', 'New'],
    ['Red', 'Couldn’t solve'],
    ['Yellow', 'Needed help'],
    ['Green', 'Solved'],
    ['Mastered', 'Mastered'],
  ])('maps %s to %s', (legacy, expected) => {
    expect(toV2State(legacy)).toBe(expected);
  });

  it('caps Green streaks, gives Mastered five, and resets other states', () => {
    expect(toSolvedStreak('Green', 9)).toBe(4);
    expect(toSolvedStreak('Green', -2)).toBe(0);
    expect(toSolvedStreak('Mastered', 0)).toBe(5);
    expect(toSolvedStreak('Yellow', 4)).toBe(0);
  });

  it('converts timestamps to calendar dates and preserves null', () => {
    expect(toCalendarDate('2026-07-30T15:45:00.000Z')).toBe('2026-07-30');
    expect(toCalendarDate('2026-07-30')).toBe('2026-07-30');
    expect(toCalendarDate(null)).toBeNull();
  });

  it.each([
    '2026-02-29',
    '2026-04-31',
    '2026-07-30garbage',
    '2026-07-30T15:45:00',
    '2026-07-30T99:45:00Z',
  ])('rejects invalid or offset-free migration date %s', (value) => {
    expect(() => toCalendarDate(value)).toThrow('invalid Notion date');
  });

  it('recognizes only exact v1, intermediate, and v2 name/type shapes', () => {
    expect(classifyV2MigrationShape(V1_PROBLEMS_TYPES, 'Problems')).toBe('v1');
    expect(classifyV2MigrationShape(INTERMEDIATE_PROBLEMS_TYPES, 'Problems')).toBe('intermediate');
    expect(classifyV2MigrationShape(REQUIRED_PROBLEMS_TYPES, 'Problems')).toBe('v2');
    expect(() =>
      classifyV2MigrationShape({ ...V1_PROBLEMS_TYPES, Surprise: 'rich_text' }, 'Problems'),
    ).toThrow('unknown Problems schema shape');
    expect(() =>
      classifyV2MigrationShape({ ...V1_PROBLEMS_TYPES, Mastery: 'number' }, 'Problems'),
    ).toThrow('unknown Problems schema shape');
  });
});

describe('migrateNotionV2', () => {
  it('dry-runs without Notion mutations or manifest changes and writes a paginated token-free backup', async () => {
    const emptyProblem = page('problem-2', V1_PROBLEMS_TYPES, {
      ...problemValues,
      'Primary Pattern': '',
      Mastery: 'Unseen',
      'Green Count': null,
    });
    const fake = new FakeNotion('v1', 'v1', [
      page('problem-1', V1_PROBLEMS_TYPES, problemValues),
      emptyProblem,
    ]);
    const { manifestPath, backupDirectory } = await paths();

    const result = await migrateNotionV2({
      notion: migrationClient(fake),
      manifest: manifestV1,
      manifestPath,
      backupDirectory,
      apply: false,
      now: () => new Date('2026-07-20T14:00:00.000Z'),
    });

    expect(result).toMatchObject({
      mode: 'dry-run',
      counts: { problems: 2, attempts: 1, legacyBlocks: 3 },
      plannedOperations: {
        addProperties: 6,
        backfillPages: 3,
        appendLegacyBlocks: 3,
        removeProperties: 13,
        manifestVersion: 2,
      },
    });
    expect(fake.log).toContain('query:problems-source:100:1');
    expect(fake.log.some((entry) => /schema-update|page-update|blocks-append/.test(entry))).toBe(
      false,
    );
    expect(JSON.parse(await readFile(manifestPath, 'utf8')).version).toBe(1);
    const backup = JSON.parse(await readFile(result.backupPath, 'utf8'));
    expect(backup).toMatchObject({
      migration: 'notion-v1-to-v2',
      manifest: manifestV1,
      shapes: { problems: 'v1', attempts: 'v1' },
      counts: { problems: 2, attempts: 1 },
    });
    expect(backup.pages.problems.map((item: any) => item.id)).toEqual(['problem-1', 'problem-2']);
    expect(backup.pages.attempts[0].legacy).toMatchObject({
      'Cold Attempt': false,
      'Total Minutes': 0,
      'Resulting Next Review': '2026-07-30T15:45:00.000Z',
    });
    expect(JSON.stringify(backup)).not.toContain(fake.token);
    expect(await readdir(backupDirectory)).toHaveLength(1);
  });

  it('backs up every paginated legacy rich-text item before source fields can be deleted', async () => {
    const fake = new FakeNotion();
    const parts = Array.from({ length: 31 }, (_, index) => `segment-${index}|`);
    fake.attemptPages[0]!.properties.Notes = {
      id: 'attempt-notes',
      type: 'rich_text',
      rich_text: parts.slice(0, 25).map((plain_text) => ({ plain_text })),
    };
    const notion = migrationClient(fake) as NotionMigrationClient & {
      pages: NotionMigrationClient['pages'] & {
        properties: {
          retrieve(args: {
            page_id: string;
            property_id: string;
            page_size: number;
            start_cursor?: string;
          }): Promise<unknown>;
        };
      };
    };
    const retrieveProperty = notion.pages.properties.retrieve;
    notion.pages.properties = {
      retrieve: async (args) => {
        const { property_id, start_cursor } = args;
        if (property_id !== 'attempt-notes') return retrieveProperty(args);
        const index = start_cursor ? Number(start_cursor) : 0;
        const results = parts.slice(index, index + 20).map((plain_text) => ({
          object: 'property_item',
          type: 'rich_text',
          rich_text: { plain_text },
        }));
        return {
          object: 'list',
          results,
          has_more: index + results.length < parts.length,
          next_cursor:
            index + results.length < parts.length ? String(index + results.length) : null,
        };
      },
    };
    const { manifestPath, backupDirectory } = await paths();

    const result = await migrateNotionV2({
      notion,
      manifest: manifestV1,
      manifestPath,
      backupDirectory,
      apply: false,
    });

    const backup = JSON.parse(await readFile(result.backupPath, 'utf8'));
    expect(backup.pages.attempts[0].legacy.Notes).toBe(parts.join(''));
  });

  it('refuses unknown shapes before querying pages or writing a backup', async () => {
    const fake = new FakeNotion();
    (fake as any).dataSources.retrieve = async ({ data_source_id }: any) => {
      const current = schema(V1_PROBLEMS_TYPES, 'problems');
      current.properties.Surprise = {
        id: 'surprise',
        name: 'Surprise',
        type: 'rich_text',
        rich_text: {},
      };
      return data_source_id === 'problems-source' ? current : schema(V1_ATTEMPTS_TYPES, 'attempts');
    };
    const { manifestPath, backupDirectory } = await paths();

    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        apply: true,
      }),
    ).rejects.toThrow('unknown Problems schema shape');
    expect(fake.log.some((entry) => entry.startsWith('query:'))).toBe(false);
    await expect(readdir(backupDirectory)).rejects.toThrow();
  });

  it('refuses contradictory manifest/schema combinations before mutation', async () => {
    const fake = new FakeNotion('v1', 'v1');
    const { manifestPath, backupDirectory } = await paths();
    const manifestV2 = { ...manifestV1, version: 2 as const };

    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV2,
        manifestPath,
        backupDirectory,
        apply: true,
      }),
    ).rejects.toThrow('Manifest version 2 requires exact v2 schemas');
    expect(fake.log.some((entry) => /query|update|append/.test(entry))).toBe(false);
  });

  it('applies add/backfill/preserve/verify/remove/verify order and atomically bumps the manifest', async () => {
    const fake = new FakeNotion();
    const { manifestPath, backupDirectory } = await paths();

    const result = await migrateNotionV2({
      notion: migrationClient(fake),
      manifest: manifestV1,
      manifestPath,
      backupDirectory,
      apply: true,
      now: () => new Date('2026-07-20T14:00:00.000Z'),
    });

    expect(result.mode).toBe('applied');
    const problem = fake.problemPages[0]!.properties;
    expect(problem.Topics.multi_select).toEqual([]);
    expect(problem['Practice State'].select.name).toBe('Solved');
    expect(problem['Solved Streak'].number).toBe(4);
    expect(problem['Next Review'].date.start).toBe('2026-07-24');
    expect(problem['Last Attempt'].date.start).toBe('2026-07-20T08:30:00-04:00');
    expect(problem['Primary Pattern']).toBeUndefined();
    expect(problem.Mastery).toBeUndefined();
    expect(problem['Green Count']).toBeUndefined();

    const attempt = fake.attemptPages[0]!.properties;
    expect(attempt.Result.select.name).toBe('Solved');
    expect(attempt['Resulting State'].select.name).toBe('Mastered');
    expect(attempt['Resulting Solved Streak'].number).toBe(5);
    expect(attempt['Resulting Next Review'].date.start).toBe('2026-07-30');
    expect(attempt['Submission Result']).toBeUndefined();
    expect(attempt.Outcome).toBeUndefined();

    const problemBlocks = fake.blocks.get('problem-1')!;
    const attemptBlocks = fake.blocks.get('attempt-1')!;
    expect(problemBlocks[0]).toMatchObject({
      type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: 'Legacy v1 fields' } }] },
    });
    const serializedAttemptBlock = JSON.stringify(attemptBlocks);
    expect(serializedAttemptBlock).toContain('Cold Attempt: false');
    expect(serializedAttemptBlock).toContain('Total Minutes: 0');
    expect(serializedAttemptBlock).toContain('Resulting Next Review: 2026-07-30T15:45:00.000Z');

    const lastAppend = Math.max(
      fake.log.lastIndexOf('blocks-append:problem-1'),
      fake.log.lastIndexOf('blocks-append:attempt-1'),
    );
    const firstRemoval = fake.log.findIndex((entry) =>
      entry.startsWith('schema-update:problems:Primary Pattern,Mastery,Green Count'),
    );
    expect(lastAppend).toBeLessThan(firstRemoval);
    expect(
      fake.log
        .slice(lastAppend + 1, firstRemoval)
        .some((entry) => entry === 'query:problems-source:100:first'),
    ).toBe(true);

    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual({
      ...manifestV1,
      version: 2,
    });
    expect((await readdir(dirname(manifestPath))).some((name) => name.includes('.tmp'))).toBe(
      false,
    );
  });

  it('uses a pre-mutation journal to resume partial backfill with original timestamps', async () => {
    const secondAttempt = page('attempt-2', V1_ATTEMPTS_TYPES, {
      ...attemptValues,
      'Client Event ID': '89d87298-8df0-4236-bd42-ee5df42dc421',
    });
    const fake = new FakeNotion('v1', 'v1', undefined, [
      page('attempt-1', V1_ATTEMPTS_TYPES, attemptValues),
      secondAttempt,
    ]);
    const update = fake.pages.update;
    (fake as any).pages.update = async (args: any) => {
      if (args.page_id === 'attempt-2') throw new Error('simulated partial backfill');
      return update(args);
    };
    const { manifestPath, backupDirectory, journalPath } = await paths();

    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).rejects.toThrow('simulated partial backfill');
    expect(await exists(journalPath)).toBe(true);
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    expect(journal.pages.attempts[0].legacy['Resulting Next Review']).toBe(
      '2026-07-30T15:45:00.000Z',
    );
    expect(journal.originalShapes).toEqual({ problems: 'v1', attempts: 'v1' });
    expect(JSON.stringify(journal)).not.toContain(fake.token);
    expect(await exists(journal.backupPath)).toBe(true);

    (fake as any).pages.update = update;
    await migrateNotionV2({
      notion: migrationClient(fake),
      manifest: manifestV1,
      manifestPath,
      backupDirectory,
      journalPath,
      apply: true,
    });
    expect(JSON.stringify(fake.blocks.get('attempt-1'))).toContain(
      'Resulting Next Review: 2026-07-30T15:45:00.000Z',
    );
    expect(await exists(journalPath)).toBe(false);
  });

  it('resumes after Problems-only obsolete deletion with a matching journal', async () => {
    const fake = new FakeNotion();
    const update = fake.dataSources.update;
    (fake as any).dataSources.update = async (args: any) => {
      if (args.properties['Submission Result'] === null) {
        throw new Error('simulated Attempts deletion failure');
      }
      return update(args);
    };
    const { manifestPath, backupDirectory, journalPath } = await paths();

    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).rejects.toThrow('simulated Attempts deletion failure');
    expect(await exists(journalPath)).toBe(true);

    (fake as any).dataSources.update = update;
    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).resolves.toMatchObject({ mode: 'applied' });
    expect(await exists(journalPath)).toBe(false);
  });

  it('resumes after both deletions when the first manifest rename fails', async () => {
    const fake = new FakeNotion();
    const { manifestPath, backupDirectory, journalPath } = await paths();

    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
        writeManifest: async () => {
          throw new Error('simulated manifest rename failure');
        },
      }),
    ).rejects.toThrow('simulated manifest rename failure');
    expect(await exists(journalPath)).toBe(true);
    expect(JSON.parse(await readFile(manifestPath, 'utf8')).version).toBe(1);

    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).resolves.toMatchObject({ mode: 'applied' });
    expect(await exists(journalPath)).toBe(false);
  });

  it('refuses recovery from v2 shapes when the journal is invalid or mismatched', async () => {
    const fake = new FakeNotion('v2', 'v2');
    const { manifestPath, backupDirectory, journalPath } = await paths();
    await writeFile(journalPath, '{not-json', 'utf8');
    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).rejects.toThrow('Invalid v2 migration journal');

    await writeFile(
      journalPath,
      JSON.stringify({
        version: 1,
        migration: 'notion-v1-to-v2',
        notionApiVersion: '2026-03-11',
        createdAt: '2026-07-20T14:00:00.000Z',
        manifest: { ...manifestV1, problems: { ...manifestV1.problems, dataSourceId: 'wrong' } },
        backupPath: '/tmp/backup.json',
        backupSha256: '0'.repeat(64),
        originalShapes: { problems: 'v1', attempts: 'v1' },
        pages: { problems: [], attempts: [] },
      }),
      'utf8',
    );
    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).rejects.toThrow('does not match the current manifest');
  });

  it.each([
    [
      'protected backfill key',
      (journal: any) => {
        journal.pages.problems[0].backfill['External Key'] = {
          rich_text: [{ text: { content: 'attacker-controlled' } }],
        };
      },
    ],
    [
      'extra expected key',
      (journal: any) => {
        journal.pages.attempts[0].expected['Client Event ID'] = 'replaced';
      },
    ],
    [
      'invalid expected state',
      (journal: any) => {
        journal.pages.problems[0].expected['Practice State'] = 'Unknown state';
      },
    ],
    [
      'invalid backfill number shape',
      (journal: any) => {
        journal.pages.attempts[0].backfill['Resulting Solved Streak'] = { number: 'five' };
      },
    ],
  ])('rejects journal %s before any recovery mutation', async (_label, tamper) => {
    const { fake, manifestPath, backupDirectory, journalPath } = await pausedBeforeFirstMutation();
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    tamper(journal);
    await writeFile(journalPath, `${JSON.stringify(journal)}\n`, 'utf8');

    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).rejects.toThrow('Invalid v2 migration journal');
    expect(fake.log.some((entry) => /schema-update|page-update|blocks-append/.test(entry))).toBe(
      false,
    );
  });

  it('rejects a byte-tampered original backup before any recovery mutation', async () => {
    const { fake, manifestPath, backupDirectory, journalPath } = await pausedBeforeFirstMutation();
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    await writeFile(journal.backupPath, '{"tampered":true}\n', 'utf8');

    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).rejects.toThrow('backup SHA-256 does not match');
    expect(fake.log.some((entry) => /schema-update|page-update|blocks-append/.test(entry))).toBe(
      false,
    );
  });

  it('rejects forged backup content even when its journal digest is updated', async () => {
    const { fake, manifestPath, backupDirectory, journalPath } = await pausedBeforeFirstMutation();
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    const backup = JSON.parse(await readFile(journal.backupPath, 'utf8'));
    backup.pages.problems[0].legacy['External Key'] = 'attacker-controlled';
    const encoded = `${JSON.stringify(backup, null, 2)}\n`;
    await writeFile(journal.backupPath, encoded, 'utf8');
    journal.backupSha256 = createHash('sha256').update(encoded).digest('hex');
    await writeFile(journalPath, `${JSON.stringify(journal)}\n`, 'utf8');

    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).rejects.toThrow('Invalid v2 migration backup content');
    expect(fake.log.some((entry) => /schema-update|page-update|blocks-append/.test(entry))).toBe(
      false,
    );
  });

  it('refuses an intermediate retry without its authoritative journal', async () => {
    const problemPage = page('problem-1', INTERMEDIATE_PROBLEMS_TYPES, {
      ...problemValues,
      Topics: [],
      'Practice State': 'Solved',
      'Solved Streak': 4,
      'Next Review': '2026-07-24',
    });
    const attemptPage = page('attempt-1', INTERMEDIATE_ATTEMPTS_TYPES, {
      ...attemptValues,
      Result: 'Solved',
      'Resulting State': 'Mastered',
      'Resulting Solved Streak': 5,
      'Resulting Next Review': '2026-07-30',
    });
    const fake = new FakeNotion('intermediate', 'intermediate', [problemPage], [attemptPage]);
    fake.blocks.set('problem-1', [
      {
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ plain_text: 'Legacy v1 fields' }] },
      },
    ]);
    const { manifestPath, backupDirectory } = await paths();

    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        apply: true,
      }),
    ).rejects.toThrow('requires its matching journal');
    expect(fake.log).not.toContain('blocks-append:problem-1');
  });

  it('fills missing exact legacy labels under an existing marker and verifies them before deletion', async () => {
    const fake = new FakeNotion();
    const update = fake.dataSources.update;
    (fake as any).dataSources.update = async (args: any) => {
      if (args.properties['Primary Pattern'] === null) throw new Error('pause before deletion');
      return update(args);
    };
    const { manifestPath, backupDirectory, journalPath } = await paths();
    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).rejects.toThrow('pause before deletion');

    const attemptBlocks = fake.blocks.get('attempt-1')!;
    fake.blocks.set(
      'attempt-1',
      attemptBlocks.filter((block) => !JSON.stringify(block).includes('Total Minutes: 0')),
    );
    (fake as any).dataSources.update = update;
    await migrateNotionV2({
      notion: migrationClient(fake),
      manifest: manifestV1,
      manifestPath,
      backupDirectory,
      journalPath,
      apply: true,
    });

    const finalBlocks = fake.blocks.get('attempt-1')!;
    expect(
      finalBlocks.filter((block) => JSON.stringify(block).includes('Legacy v1 fields')),
    ).toHaveLength(1);
    expect(
      finalBlocks.filter((block) => JSON.stringify(block).includes('Total Minutes: 0')),
    ).toHaveLength(1);
  });

  it('appends a full legacy section when exact label text exists without the marker', async () => {
    const fake = new FakeNotion();
    fake.blocks.set('attempt-1', [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ plain_text: 'Total Minutes: 0' }] },
      },
    ]);
    const { manifestPath, backupDirectory, journalPath } = await paths();

    await migrateNotionV2({
      notion: migrationClient(fake),
      manifest: manifestV1,
      manifestPath,
      backupDirectory,
      journalPath,
      apply: true,
    });

    const texts = fake.blocks.get('attempt-1')!.map((block) => {
      const richText = block[block.type].rich_text;
      return richText.map((item: any) => item.plain_text ?? item.text?.content ?? '').join('');
    });
    expect(texts.filter((text) => text === 'Legacy v1 fields')).toHaveLength(1);
    expect(texts.filter((text) => text === 'Total Minutes: 0')).toHaveLength(2);
  });

  it('refuses deletion when appended legacy values cannot be read back', async () => {
    const fake = new FakeNotion();
    (fake as any).blockApi.children.append = async () => ({ results: [] });
    const { manifestPath, backupDirectory, journalPath } = await paths();

    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).rejects.toThrow('legacy preservation verification failed');
    expect(fake.log.some((entry) => entry.includes('Primary Pattern,Mastery,Green Count'))).toBe(
      false,
    );
  });

  it('chunks long legacy label values into Notion-sized rich-text objects', async () => {
    const longNotes = `${'x'.repeat(1_892)}😀${'y'.repeat(2_606)}`;
    const fake = new FakeNotion('v1', 'v1', undefined, [
      page('attempt-1', V1_ATTEMPTS_TYPES, { ...attemptValues, Notes: longNotes }),
    ]);
    const { manifestPath, backupDirectory, journalPath } = await paths();

    await migrateNotionV2({
      notion: migrationClient(fake),
      manifest: manifestV1,
      manifestPath,
      backupDirectory,
      journalPath,
      apply: true,
    });

    const notesBlock = fake.blocks
      .get('attempt-1')!
      .find((block) => JSON.stringify(block).includes('Notes:'))!;
    const chunks = notesBlock.bulleted_list_item.rich_text;
    expect(chunks.every((item: any) => item.text.content.length <= 1_900)).toBe(true);
    expect(chunks.map((item: any) => item.text.content).join('')).toBe(`Notes: ${longNotes}`);
    expect(chunks.every((item: any) => !/[\uD800-\uDBFF]$/.test(item.text.content as string))).toBe(
      true,
    );
    expect(chunks.every((item: any) => !/^[\uDC00-\uDFFF]/.test(item.text.content as string))).toBe(
      true,
    );
  });

  it('verifies intermediate colors and reciprocal relation config before deletion', async () => {
    const fake = new FakeNotion();
    const retrieve = fake.dataSources.retrieve;
    (fake as any).dataSources.retrieve = async (args: any) => {
      const response = (await retrieve(args)) as any;
      if (response.properties.Mastery && response.properties['Practice State']) {
        response.properties['Practice State'].select.options[0].color = 'red';
        response.properties.Attempts.relation = {
          data_source_id: 'attempts-source',
          type: 'single_property',
          single_property: {},
        };
      }
      return response;
    };
    const { manifestPath, backupDirectory, journalPath } = await paths();

    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).rejects.toThrow(/select options\/colors mismatch|reciprocal dual_property/);
    expect(fake.log.some((entry) => entry.includes('Primary Pattern,Mastery,Green Count'))).toBe(
      false,
    );
  });

  it('does not bump the manifest when final v2 option colors fail verification', async () => {
    const fake = new FakeNotion();
    const retrieve = fake.dataSources.retrieve;
    (fake as any).dataSources.retrieve = async (args: { data_source_id: string }) => {
      const response = (await retrieve(args)) as any;
      if (
        args.data_source_id === 'problems-source' &&
        !response.properties.Mastery &&
        response.properties['Practice State']
      ) {
        response.properties['Practice State'].select.options[0].color = 'red';
      }
      return response;
    };
    const { manifestPath, backupDirectory, journalPath } = await paths();

    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).rejects.toThrow('Practice State: select options/colors mismatch');
    expect(JSON.parse(await readFile(manifestPath, 'utf8')).version).toBe(1);
    expect(await exists(journalPath)).toBe(true);

    (fake as any).dataSources.retrieve = retrieve;
    ((await retrieve({ data_source_id: 'problems-source' })) as any).properties[
      'Practice State'
    ].select.options[0].color = 'gray';
    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).resolves.toMatchObject({ mode: 'applied' });
    expect(await exists(journalPath)).toBe(false);
  });

  it('treats a version-2 exact-v2 rerun as a successful no-op', async () => {
    const fake = new FakeNotion(
      'v2',
      'v2',
      [page('problem-1', REQUIRED_PROBLEMS_TYPES, {})],
      [page('attempt-1', REQUIRED_ATTEMPTS_TYPES, {})],
    );
    const { manifestPath, backupDirectory } = await paths();
    const manifestV2 = { ...manifestV1, version: 2 as const };
    await writeFile(manifestPath, `${JSON.stringify(manifestV2)}\n`, 'utf8');

    const result = await migrateNotionV2({
      notion: migrationClient(fake),
      manifest: manifestV2,
      manifestPath,
      backupDirectory,
      apply: true,
    });

    expect(result.mode).toBe('no-op');
    expect(fake.log.some((entry) => /schema-update|page-update|blocks-append/.test(entry))).toBe(
      false,
    );
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual(manifestV2);
  });

  it('fully verifies exact v2 no-op schemas and cleans a matching leftover journal', async () => {
    const fake = new FakeNotion();
    const { manifestPath, backupDirectory, journalPath } = await paths();
    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV1,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
        writeManifest: async () => {
          throw new Error('leave journal after verified v2');
        },
      }),
    ).rejects.toThrow('leave journal after verified v2');
    const manifestV2 = { ...manifestV1, version: 2 as const };
    await writeFile(manifestPath, `${JSON.stringify(manifestV2)}\n`, 'utf8');

    await expect(
      migrateNotionV2({
        notion: migrationClient(fake),
        manifest: manifestV2,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).resolves.toMatchObject({ mode: 'no-op' });
    expect(await exists(journalPath)).toBe(false);

    const broken = new FakeNotion('v2', 'v2');
    const brokenRetrieve = broken.dataSources.retrieve;
    (broken as any).dataSources.retrieve = async (args: any) => {
      const response = (await brokenRetrieve(args)) as any;
      if (args.data_source_id === 'problems-source') {
        response.properties['Practice State'].select.options[0].color = 'red';
      }
      return response;
    };
    await expect(
      migrateNotionV2({
        notion: migrationClient(broken),
        manifest: manifestV2,
        manifestPath,
        backupDirectory,
        journalPath,
        apply: true,
      }),
    ).rejects.toThrow('select options/colors mismatch');
  });
});
