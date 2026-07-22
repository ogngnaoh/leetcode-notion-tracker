import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { NotionManifest } from '../src/shared/contract.js';
import { migrateNotionV4 } from '../src/notion/migrate-v4.js';
import {
  LEGACY_RESULT_OPTIONS,
  LEGACY_STATE_OPTIONS,
  REQUIRED_ATTEMPTS_TYPES,
  REQUIRED_PROBLEMS_TYPES,
  RESULT_OPTIONS,
  STATE_OPTIONS,
  V3_REQUIRED_PROBLEMS_TYPES,
} from '../src/notion/schema.js';
import { DIFFICULTY_OPTIONS } from '../src/notion/presentation.js';

const manifest: NotionManifest = {
  version: 3,
  notionApiVersion: '2026-03-11',
  createdAt: '2026-07-20T12:00:00.000Z',
  parentPageId: 'parent',
  problems: { databaseId: 'problems-db', dataSourceId: 'problems-source' },
  attempts: { databaseId: 'attempts-db', dataSourceId: 'attempts-source' },
};

type Row = { object: 'page'; id: string; properties: Record<string, any> };

function property(type: string, id: string, options?: readonly { name: string; color: string }[]) {
  return {
    id,
    type,
    [type]:
      type === 'select'
        ? { options: options ?? [] }
        : type === 'relation'
          ? {
              data_source_id: id.startsWith('Attempts') ? 'attempts-source' : 'problems-source',
              type: 'dual_property',
              dual_property: {},
            }
          : {},
  };
}

function source(
  types: Record<string, string>,
  selects: Record<string, readonly { name: string; color: string }[]>,
): any {
  return {
    object: 'data_source',
    properties: Object.fromEntries(
      Object.entries(types).map(([name, type]) => [
        name,
        property(
          type,
          name === 'First Solved' ? 'first-timestamp-id' : `${name}-id`,
          name === 'Difficulty' ? DIFFICULTY_OPTIONS : selects[name],
        ),
      ]),
    ),
  };
}

function problem(
  id: string,
  practiceState: string,
  firstTimestamp: { name: 'First Solved' | 'First Attempt'; value: string | null } = {
    name: 'First Solved',
    value: null,
  },
): Row {
  return {
    object: 'page',
    id,
    properties: {
      [firstTimestamp.name]: {
        type: 'date',
        date: firstTimestamp.value ? { start: firstTimestamp.value } : null,
      },
      'Practice State': { type: 'select', select: { name: practiceState } },
      'Solved Streak': { type: 'number', number: 0 },
      'Next Review': { type: 'date', date: { start: '2026-07-21' } },
      'Last Attempt': { type: 'date', date: { start: '2026-07-21T09:00:00-04:00' } },
    },
  };
}

function attempt(
  id: string,
  problemId: string,
  attemptedAt: string,
  result: string,
  resultingState = result,
): Row {
  return {
    object: 'page',
    id,
    properties: {
      Problem: { type: 'relation', relation: [{ id: problemId }] },
      'Attempted At': { type: 'date', date: { start: attemptedAt } },
      Result: { type: 'select', select: { name: result } },
      'Resulting State': { type: 'select', select: { name: resultingState } },
      'Resulting Solved Streak': { type: 'number', number: 0 },
      'Resulting Next Review': { type: 'date', date: { start: '2026-07-21' } },
      'Client Event ID': { type: 'rich_text', rich_text: [{ plain_text: `${id}-event` }] },
    },
  };
}

function migrationFake(
  options: {
    verificationMismatch?: boolean;
    intermediateWithoutJournal?: boolean;
    renamedPropertyId?: string;
    preservationMismatch?: boolean;
  } = {},
) {
  let problemSource = source(V3_REQUIRED_PROBLEMS_TYPES, {
    'Practice State': LEGACY_STATE_OPTIONS,
  });
  let attemptSource = source(REQUIRED_ATTEMPTS_TYPES, {
    Result: LEGACY_RESULT_OPTIONS,
    'Resulting State': LEGACY_STATE_OPTIONS,
  });
  const problems = [problem('problem-1', 'Couldn’t solve'), problem('problem-2', 'Solved')];
  const attempts = [
    attempt('attempt-newer', 'problem-1', '2026-07-21T09:00:00-04:00', 'Couldn’t solve'),
    attempt('attempt-older', 'problem-1', '2026-07-19T08:00:00-04:00', 'Solved'),
    attempt('attempt-helped', 'problem-2', '2026-07-20T10:00:00-04:00', 'Needed help'),
  ];
  const bodies = new Map(
    attempts.map(({ id }) => [id, [{ object: 'block', id: `${id}-code`, type: 'code' }]]),
  );
  const calls: string[] = [];

  if (options.intermediateWithoutJournal) {
    const first = problemSource.properties['First Solved'];
    delete problemSource.properties['First Solved'];
    problemSource.properties['First Attempt'] = first;
    for (const row of problems) {
      row.properties['First Attempt'] = row.properties['First Solved'];
      delete row.properties['First Solved'];
    }
  }

  const notion: any = {
    dataSources: {
      retrieve: vi.fn(async ({ data_source_id }) =>
        data_source_id === 'problems-source' ? problemSource : attemptSource,
      ),
      query: vi.fn(async ({ data_source_id, start_cursor }) => {
        calls.push(`query:${data_source_id}:${start_cursor ?? 'first'}`);
        const rows = data_source_id === 'problems-source' ? problems : attempts;
        if (start_cursor) return { results: rows.slice(1), has_more: false, next_cursor: null };
        return { results: rows.slice(0, 1), has_more: true, next_cursor: 'next' };
      }),
      update: vi.fn(async ({ data_source_id, properties }) => {
        calls.push(`schema:${data_source_id}:${Object.keys(properties).join(',')}`);
        if (data_source_id === 'problems-source') {
          if (properties['First Solved']?.name === 'First Attempt') {
            const first = problemSource.properties['First Solved'];
            delete problemSource.properties['First Solved'];
            problemSource.properties['First Attempt'] = first;
            if (options.renamedPropertyId) {
              problemSource.properties['First Attempt'].id = options.renamedPropertyId;
            }
            for (const row of problems) {
              row.properties['First Attempt'] = row.properties['First Solved'];
              delete row.properties['First Solved'];
            }
          }
          if (properties['Practice State']?.select) {
            problemSource.properties['Practice State'].select.options = STATE_OPTIONS;
          }
        } else {
          if (properties.Result?.select)
            attemptSource.properties.Result.select.options = RESULT_OPTIONS;
          if (properties['Resulting State']?.select) {
            attemptSource.properties['Resulting State'].select.options = STATE_OPTIONS;
          }
        }
      }),
    },
    pages: {
      update: vi.fn(async ({ page_id, properties }) => {
        calls.push(`page:${page_id}:${Object.keys(properties).join(',')}`);
        const row = [...problems, ...attempts].find(({ id }) => id === page_id)!;
        for (const [name, value] of Object.entries(properties as Record<string, any>)) {
          const type = row.properties[name]?.type ?? ('date' in value ? 'date' : 'select');
          row.properties[name] = { type, ...value };
        }
        if (options.preservationMismatch) {
          problems[0]!.properties['Next Review'] = {
            type: 'date',
            date: { start: '2099-01-01' },
          };
          bodies.set('attempt-newer', [
            { object: 'block', id: 'attempt-newer-code', type: 'paragraph' },
          ]);
        }
      }),
    },
    blocks: {
      children: {
        list: vi.fn(async ({ block_id }) => ({
          results: bodies.get(block_id) ?? [],
          has_more: false,
          next_cursor: null,
        })),
      },
    },
  };

  if (options.verificationMismatch) {
    notion.pages.update.mockImplementation(async ({ page_id, properties }: any) => {
      calls.push(`page:${page_id}:${Object.keys(properties).join(',')}`);
    });
  }

  return { notion, problems, attempts, bodies, calls };
}

describe('v3 to v4 migration', () => {
  it('paginates both inventories and writes a token-free dry-run backup without mutation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-v4-dry-'));
    const { notion } = migrationFake();

    const result = await migrateNotionV4({
      notion,
      manifest,
      manifestPath: join(directory, 'manifest.json'),
      backupDirectory: directory,
      apply: false,
      now: () => new Date('2026-07-21T00:00:00.000Z'),
    });

    expect(result).toMatchObject({
      mode: 'dry-run',
      counts: { problems: 2, attempts: 3, reclassifiedProblems: 1, reclassifiedAttempts: 1 },
      plannedOperations: {
        renameFirstAttempt: 1,
        backfillProblems: 2,
        reclassifyProblems: 1,
        reclassifyAttempts: 1,
        removeObsoleteOptions: 3,
        manifestVersion: 4,
      },
    });
    expect(notion.dataSources.query).toHaveBeenCalledTimes(4);
    expect(notion.dataSources.update).not.toHaveBeenCalled();
    expect(notion.pages.update).not.toHaveBeenCalled();
    expect(result.backupPath).toEqual(expect.any(String));
    const backupText = await readFile(result.backupPath!, 'utf8');
    const backup = JSON.parse(backupText);
    expect(backup.pages.problems).toEqual([
      expect.objectContaining({
        id: 'problem-1',
        expectedFirstAttempt: '2026-07-19T08:00:00-04:00',
        practiceState: 'Couldn’t solve',
        expectedPracticeState: 'Needed help',
      }),
      expect.objectContaining({
        id: 'problem-2',
        expectedFirstAttempt: '2026-07-20T10:00:00-04:00',
      }),
    ]);
    expect(backupText).not.toMatch(/ntn_|secret_|Bearer|NOTION_TOKEN/);
  });

  it('journals, preserves the property ID, converts rows before options, verifies, then writes v4', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-v4-apply-'));
    const journalPath = join(directory, 'notion-v4-journal.json');
    const { notion, problems, attempts, calls } = migrationFake();
    const writeManifest = vi.fn(async () => {
      calls.push('manifest');
    });

    const result = await migrateNotionV4({
      notion,
      manifest,
      manifestPath: join(directory, 'manifest.json'),
      backupDirectory: directory,
      journalPath,
      apply: true,
      now: () => new Date('2026-07-21T00:00:00.000Z'),
      writeManifest,
    });

    expect(result.mode).toBe('applied');
    expect(notion.dataSources.update).toHaveBeenCalledWith({
      data_source_id: 'problems-source',
      properties: { 'First Solved': { name: 'First Attempt' } },
    });
    expect(problems[0]!.properties).toMatchObject({
      'First Attempt': { date: { start: '2026-07-19T08:00:00-04:00' } },
      'Practice State': { select: { name: 'Needed help' } },
      'Solved Streak': { type: 'number', number: 0 },
      'Next Review': { type: 'date', date: { start: '2026-07-21' } },
      'Last Attempt': { type: 'date', date: { start: '2026-07-21T09:00:00-04:00' } },
    });
    expect(attempts[0]!.properties).toMatchObject({
      Result: { select: { name: 'Needed help' } },
      'Resulting State': { select: { name: 'Needed help' } },
      'Resulting Solved Streak': { type: 'number', number: 0 },
      'Resulting Next Review': { type: 'date', date: { start: '2026-07-21' } },
      'Client Event ID': { type: 'rich_text', rich_text: [{ plain_text: 'attempt-newer-event' }] },
    });
    const firstOptionRemoval = calls.findIndex((call) => call.startsWith('schema:attempts-source'));
    const lastRowConversion = Math.max(
      ...calls.map((call, index) => (call.startsWith('page:') ? index : -1)),
    );
    expect(firstOptionRemoval).toBeGreaterThan(lastRowConversion);
    expect(calls.indexOf('manifest')).toBeGreaterThan(
      calls.map((call) => call.startsWith('query:')).lastIndexOf(true),
    );
    expect(writeManifest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ version: 4 }),
    );
    await expect(access(journalPath)).rejects.toThrow();
  });

  it('retains recovery artifacts across manifest failure and resumes without a new backup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-v4-recovery-'));
    const journalPath = join(directory, 'notion-v4-journal.json');
    const fake = migrationFake();
    const failingManifest = vi.fn(async () => {
      throw new Error('manifest disk failure');
    });
    const options = {
      notion: fake.notion,
      manifest,
      manifestPath: join(directory, 'manifest.json'),
      backupDirectory: directory,
      journalPath,
      apply: true,
      now: () => new Date('2026-07-21T00:00:00.000Z'),
    };

    await expect(migrateNotionV4({ ...options, writeManifest: failingManifest })).rejects.toThrow(
      'manifest disk failure',
    );
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    const originalBackup = await readFile(journal.backupPath, 'utf8');

    const writeManifest = vi.fn(async () => undefined);
    const resumed = await migrateNotionV4({ ...options, writeManifest });

    expect(resumed.mode).toBe('applied');
    expect(resumed.backupPath).toBe(journal.backupPath);
    expect(await readFile(journal.backupPath, 'utf8')).toBe(originalBackup);
    expect(writeManifest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ version: 4 }),
    );
    await expect(access(journalPath)).rejects.toThrow();
  });

  it('fails closed on an unknown schema before any mutation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-v4-unknown-'));
    const fake = migrationFake();
    fake.notion.dataSources.retrieve.mockResolvedValueOnce(
      source(
        { ...V3_REQUIRED_PROBLEMS_TYPES, Surprise: 'rich_text' },
        {
          'Practice State': LEGACY_STATE_OPTIONS,
        },
      ),
    );

    await expect(
      migrateNotionV4({
        notion: fake.notion,
        manifest,
        manifestPath: join(directory, 'manifest.json'),
        backupDirectory: directory,
        apply: true,
      }),
    ).rejects.toThrow('unknown Problems schema shape');
    expect(fake.notion.dataSources.update).not.toHaveBeenCalled();
    expect(fake.notion.pages.update).not.toHaveBeenCalled();
  });

  it('fails closed on an unjournaled intermediate schema', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-v4-intermediate-'));
    const fake = migrationFake({ intermediateWithoutJournal: true });

    await expect(
      migrateNotionV4({
        notion: fake.notion,
        manifest,
        manifestPath: join(directory, 'manifest.json'),
        backupDirectory: directory,
        apply: true,
      }),
    ).rejects.toThrow('intermediate v4 schema requires a valid recovery journal');
    expect(fake.notion.dataSources.update).not.toHaveBeenCalled();
    expect(fake.notion.pages.update).not.toHaveBeenCalled();
  });

  it('verifies reciprocal relations, Difficulty options, and the preserved timestamp property ID', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-v4-exact-schema-'));
    const journalPath = join(directory, 'notion-v4-journal.json');
    const fake = migrationFake({ renamedPropertyId: 'replacement-property-id' });
    const writeManifest = vi.fn();

    await expect(
      migrateNotionV4({
        notion: fake.notion,
        manifest,
        manifestPath: join(directory, 'manifest.json'),
        backupDirectory: directory,
        journalPath,
        apply: true,
        writeManifest,
      }),
    ).rejects.toThrow('First Attempt property ID changed during v4 migration');
    expect(writeManifest).not.toHaveBeenCalled();
    await expect(readFile(journalPath, 'utf8')).resolves.toContain('first-timestamp-id');

    const wrongRelations = migrationFake();
    const wrongProblemSource = source(V3_REQUIRED_PROBLEMS_TYPES, {
      'Practice State': LEGACY_STATE_OPTIONS,
    });
    wrongProblemSource.properties.Attempts.relation.data_source_id = 'wrong-source';
    wrongRelations.notion.dataSources.retrieve.mockResolvedValueOnce(wrongProblemSource);
    await expect(
      migrateNotionV4({
        notion: wrongRelations.notion,
        manifest,
        manifestPath: join(directory, 'other-manifest.json'),
        backupDirectory: directory,
        apply: false,
      }),
    ).rejects.toThrow('wrong relation target');
  });

  it('verifies all untouched row properties and Attempt code bodies before the manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-v4-preservation-'));
    const journalPath = join(directory, 'notion-v4-journal.json');
    const fake = migrationFake({ preservationMismatch: true });
    const writeManifest = vi.fn();

    await expect(
      migrateNotionV4({
        notion: fake.notion,
        manifest,
        manifestPath: join(directory, 'manifest.json'),
        backupDirectory: directory,
        journalPath,
        apply: true,
        writeManifest,
      }),
    ).rejects.toThrow('v4 preservation verification failed');
    expect(writeManifest).not.toHaveBeenCalled();
    await expect(readFile(journalPath, 'utf8')).resolves.toContain('preservedSha256');
  });

  it('strictly rejects a corrupted journal and matching rehashed backup before recovery mutation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-v4-corrupt-'));
    const journalPath = join(directory, 'notion-v4-journal.json');
    const fake = migrationFake();
    const options = {
      notion: fake.notion,
      manifest,
      manifestPath: join(directory, 'manifest.json'),
      backupDirectory: directory,
      journalPath,
      apply: true,
      now: () => new Date('2026-07-21T00:00:00.000Z'),
    };
    await expect(
      migrateNotionV4({
        ...options,
        writeManifest: async () => {
          throw new Error('pause after verification');
        },
      }),
    ).rejects.toThrow('pause after verification');

    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    const backup = JSON.parse(await readFile(journal.backupPath, 'utf8'));
    journal.pages.problems[0].expectedFirstAttempt = '2026-07-19';
    backup.pages.problems[0].expectedFirstAttempt = '2026-07-19';
    const encodedBackup = `${JSON.stringify(backup, null, 2)}\n`;
    journal.backupSha256 = createHash('sha256').update(encodedBackup).digest('hex');
    await writeFile(journal.backupPath, encodedBackup, 'utf8');
    await writeFile(journalPath, `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
    fake.notion.dataSources.update.mockClear();
    fake.notion.pages.update.mockClear();

    await expect(migrateNotionV4(options)).rejects.toThrow('Invalid v4 recovery journal');
    expect(fake.notion.dataSources.update).not.toHaveBeenCalled();
    expect(fake.notion.pages.update).not.toHaveBeenCalled();
  });

  it('rejects date-only Attempt timestamps before backup or mutation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-v4-date-'));
    const fake = migrationFake();
    fake.attempts[0]!.properties['Attempted At'].date.start = '2026-07-21';

    await expect(
      migrateNotionV4({
        notion: fake.notion,
        manifest,
        manifestPath: join(directory, 'manifest.json'),
        backupDirectory: directory,
        apply: false,
      }),
    ).rejects.toThrow('must contain an ISO timestamp with an offset');
    expect(fake.notion.dataSources.update).not.toHaveBeenCalled();
    expect(fake.notion.pages.update).not.toHaveBeenCalled();
  });

  it('retains the journal and refuses the manifest when exact row verification fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-v4-verify-'));
    const journalPath = join(directory, 'notion-v4-journal.json');
    const fake = migrationFake({ verificationMismatch: true });
    const writeManifest = vi.fn();

    await expect(
      migrateNotionV4({
        notion: fake.notion,
        manifest,
        manifestPath: join(directory, 'manifest.json'),
        backupDirectory: directory,
        journalPath,
        apply: true,
        writeManifest,
      }),
    ).rejects.toThrow('v4 row verification failed');
    expect(writeManifest).not.toHaveBeenCalled();
    await expect(readFile(journalPath, 'utf8')).resolves.toContain('notion-v3-to-v4');
  });

  it('treats an exact completed v4 rerun as a mutation-free no-op', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lc-v4-noop-'));
    const fake = migrationFake();
    fake.notion.dataSources.retrieve.mockImplementation(async ({ data_source_id }: any) =>
      data_source_id === 'problems-source'
        ? source(REQUIRED_PROBLEMS_TYPES, { 'Practice State': STATE_OPTIONS })
        : source(REQUIRED_ATTEMPTS_TYPES, {
            Result: RESULT_OPTIONS,
            'Resulting State': STATE_OPTIONS,
          }),
    );

    const result = await migrateNotionV4({
      notion: fake.notion,
      manifest: { ...manifest, version: 4 },
      manifestPath: join(directory, 'manifest.json'),
      backupDirectory: directory,
      apply: true,
    });

    expect(result).toMatchObject({ mode: 'no-op', plannedOperations: { manifestVersion: 4 } });
    expect(fake.notion.dataSources.update).not.toHaveBeenCalled();
    expect(fake.notion.pages.update).not.toHaveBeenCalled();
  });
});
