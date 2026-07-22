import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { NotionManifest } from '../shared/contract.js';
import { writeJsonAtomic, writeManifestAtomic } from './io.js';
import {
  PROBLEMS_PROPERTIES,
  REQUIRED_ATTEMPTS_TYPES,
  REQUIRED_PROBLEMS_TYPES,
  V2_REQUIRED_PROBLEMS_TYPES,
} from './schema.js';

type Page = { id: string; properties: Record<string, any> };

export interface NotionV3MigrationClient {
  dataSources: {
    retrieve(args: { data_source_id: string }): Promise<unknown>;
    query(args: {
      data_source_id: string;
      page_size: number;
      start_cursor?: string;
    }): Promise<{ results: unknown[]; has_more: boolean; next_cursor: string | null }>;
    update(args: { data_source_id: string; properties: Record<string, unknown> }): Promise<unknown>;
  };
  pages: {
    update(args: { page_id: string; properties: Record<string, unknown> }): Promise<unknown>;
  };
}

interface Journal {
  version: 1;
  migration: 'notion-v2-to-v3';
  manifest: NotionManifest;
  backupPath: string;
  backupSha256: string;
  pages: Array<{ id: string; firstSolved: string | null; expectedFirstSolved: string | null }>;
}

export interface V3MigrationOptions {
  notion: NotionV3MigrationClient;
  manifest: NotionManifest;
  manifestPath: string;
  backupDirectory: string;
  journalPath?: string;
  apply: boolean;
  now?: () => Date;
  writeManifest?: (path: string, manifest: NotionManifest) => Promise<void>;
}

function schemaTypes(source: unknown): Record<string, string> {
  const properties = (source as any)?.properties;
  if (!properties || typeof properties !== 'object') throw new Error('Invalid data source.');
  return Object.fromEntries(
    Object.entries(properties).map(([name, property]: [string, any]) => {
      if (typeof property?.type !== 'string') throw new Error(`Invalid property ${name}.`);
      return [name, property.type];
    }),
  );
}

function sameTypes(actual: Record<string, string>, expected: Record<string, string>): boolean {
  return (
    JSON.stringify(Object.entries(actual).sort()) ===
    JSON.stringify(Object.entries(expected).sort())
  );
}

function fullPage(value: unknown): Page {
  const page = value as any;
  if (page?.object !== 'page' || typeof page.id !== 'string' || !page.properties) {
    throw new Error('Notion returned a partial page during v3 migration.');
  }
  return page;
}

async function queryAll(notion: NotionV3MigrationClient, dataSourceId: string): Promise<Page[]> {
  const pages: Page[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    pages.push(...response.results.map(fullPage));
    if (response.has_more && !response.next_cursor) {
      throw new Error('Notion pagination returned no cursor during v3 migration.');
    }
    cursor = response.has_more ? response.next_cursor! : undefined;
  } while (cursor);
  return pages;
}

function nullableDate(page: Page, name: string): string | null {
  const property = page.properties[name];
  if (!property) return null;
  if (property.type !== 'date') throw new Error(`${page.id}.${name} must be a date.`);
  const value = property.date?.start;
  if (property.date === null) return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${page.id}.${name} contains an invalid date.`);
  }
  return value;
}

function attemptSolve(attempt: Page): { problemId: string; attemptedAt: string } | null {
  const result = attempt.properties.Result;
  if (result?.type !== 'select') throw new Error(`${attempt.id}.Result must be select.`);
  if (result.select?.name !== 'Solved') return null;
  const relation = attempt.properties.Problem;
  const attemptedAt = attempt.properties['Attempted At'];
  const problemId = relation?.type === 'relation' ? relation.relation?.[0]?.id : undefined;
  const timestamp = attemptedAt?.type === 'date' ? attemptedAt.date?.start : undefined;
  if (
    typeof problemId !== 'string' ||
    typeof timestamp !== 'string' ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    throw new Error(`Solved Attempt ${attempt.id} has invalid Problem or Attempted At.`);
  }
  return { problemId, attemptedAt: timestamp };
}

function preparedProblems(problems: Page[], attempts: Page[]) {
  const earliest = new Map<string, string>();
  for (const attempt of attempts) {
    const solve = attemptSolve(attempt);
    if (!solve) continue;
    const current = earliest.get(solve.problemId);
    if (!current || Date.parse(solve.attemptedAt) < Date.parse(current)) {
      earliest.set(solve.problemId, solve.attemptedAt);
    }
  }
  const problemIds = new Set(problems.map(({ id }) => id));
  for (const problemId of earliest.keys()) {
    if (!problemIds.has(problemId))
      throw new Error(`Attempt references unknown Problem ${problemId}.`);
  }
  return problems.map((problem) => ({
    id: problem.id,
    firstSolved: nullableDate(problem, 'First Solved'),
    expectedFirstSolved: earliest.get(problem.id) ?? null,
  }));
}

function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function writeBackup(directory: string, date: Date, payload: unknown) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `notion-v2-to-v3-${safeTimestamp(date)}.json`);
  const encoded = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(path, encoded, { encoding: 'utf8', flag: 'wx' });
  return { path, sha256: createHash('sha256').update(encoded).digest('hex') };
}

async function readJournal(path: string): Promise<Journal | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Journal;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function validateJournal(journal: Journal, options: V3MigrationOptions): Promise<void> {
  if (
    journal.version !== 1 ||
    journal.migration !== 'notion-v2-to-v3' ||
    journal.manifest.problems.dataSourceId !== options.manifest.problems.dataSourceId ||
    journal.manifest.attempts.dataSourceId !== options.manifest.attempts.dataSourceId ||
    !Array.isArray(journal.pages) ||
    journal.pages.some(
      (page) =>
        Object.keys(page).sort().join(',') !== 'expectedFirstSolved,firstSolved,id' ||
        typeof page.id !== 'string',
    )
  ) {
    throw new Error('Invalid or contradictory v3 recovery journal.');
  }
  const backupRoot = `${resolve(options.backupDirectory)}${sep}`;
  const backupPath = resolve(journal.backupPath);
  if (!backupPath.startsWith(backupRoot))
    throw new Error('V3 journal backup path is outside build.');
  const encoded = await readFile(backupPath);
  if (createHash('sha256').update(encoded).digest('hex') !== journal.backupSha256) {
    throw new Error('V3 journal backup digest mismatch.');
  }
}

export async function migrateNotionV3(options: V3MigrationOptions) {
  if (options.manifest.version === 1) {
    throw new Error('Run npm run notion:migrate:v2 before npm run notion:migrate:v3.');
  }
  const now = (options.now ?? (() => new Date()))();
  const journalPath =
    options.journalPath ?? join(options.backupDirectory, 'notion-v3-journal.json');
  const [problemSource, attemptSource, problems, attempts] = await Promise.all([
    options.notion.dataSources.retrieve({ data_source_id: options.manifest.problems.dataSourceId }),
    options.notion.dataSources.retrieve({ data_source_id: options.manifest.attempts.dataSourceId }),
    queryAll(options.notion, options.manifest.problems.dataSourceId),
    queryAll(options.notion, options.manifest.attempts.dataSourceId),
  ]);
  const problemTypes = schemaTypes(problemSource);
  const v2Shape = sameTypes(problemTypes, V2_REQUIRED_PROBLEMS_TYPES);
  const v3Shape = sameTypes(problemTypes, REQUIRED_PROBLEMS_TYPES);
  if (!v2Shape && !v3Shape) throw new Error('Refusing migration: unknown Problems schema shape.');
  if (!sameTypes(schemaTypes(attemptSource), REQUIRED_ATTEMPTS_TYPES)) {
    throw new Error('Refusing migration: unknown Attempts schema shape.');
  }
  if (options.manifest.version === 3 && !v3Shape) {
    throw new Error('Manifest version 3 requires the exact v3 Problems schema.');
  }
  let pages = preparedProblems(problems, attempts);
  let journal = await readJournal(journalPath);
  if (journal) {
    await validateJournal(journal, options);
    const liveIds = pages.map(({ id }) => id).sort();
    const journalIds = journal.pages.map(({ id }) => id).sort();
    if (JSON.stringify(liveIds) !== JSON.stringify(journalIds)) {
      throw new Error('Problem page IDs do not match the v3 recovery journal.');
    }
    pages = journal.pages;
  }
  let backupPath: string;
  let backupSha256: string | undefined;
  if (journal) {
    backupPath = journal.backupPath;
  } else {
    const backup = await writeBackup(options.backupDirectory, now, {
      migration: 'notion-v2-to-v3',
      createdAt: now.toISOString(),
      dryRun: !options.apply,
      manifest: options.manifest,
      counts: { problems: problems.length, attempts: attempts.length },
      pages: { problems: pages, attempts: attempts.map(({ id }) => ({ id })) },
    });
    backupPath = backup.path;
    backupSha256 = backup.sha256;
  }
  const counts = {
    problems: problems.length,
    attempts: attempts.length,
    solvedProblems: pages.filter(({ expectedFirstSolved }) => expectedFirstSolved !== null).length,
  };
  const plannedOperations = {
    addProperties: v2Shape ? 1 : 0,
    backfillPages: pages.filter(
      ({ firstSolved, expectedFirstSolved }) => firstSolved !== expectedFirstSolved,
    ).length,
    manifestVersion: 3,
  };
  if (!options.apply) return { mode: 'dry-run' as const, backupPath, counts, plannedOperations };

  if (!journal) {
    journal = {
      version: 1,
      migration: 'notion-v2-to-v3',
      manifest: options.manifest,
      backupPath,
      backupSha256: backupSha256!,
      pages,
    };
    await writeJsonAtomic(journalPath, journal);
  }
  if (v2Shape) {
    await options.notion.dataSources.update({
      data_source_id: options.manifest.problems.dataSourceId,
      properties: { 'First Solved': PROBLEMS_PROPERTIES['First Solved'] },
    });
  }
  for (const page of pages) {
    if (page.firstSolved === page.expectedFirstSolved) continue;
    await options.notion.pages.update({
      page_id: page.id,
      properties: {
        'First Solved': page.expectedFirstSolved
          ? { date: { start: page.expectedFirstSolved } }
          : { date: null },
      },
    });
  }
  const refreshedSource = await options.notion.dataSources.retrieve({
    data_source_id: options.manifest.problems.dataSourceId,
  });
  if (!sameTypes(schemaTypes(refreshedSource), REQUIRED_PROBLEMS_TYPES)) {
    throw new Error('V3 Problems schema verification failed.');
  }
  const verified = preparedProblems(
    await queryAll(options.notion, options.manifest.problems.dataSourceId),
    attempts,
  );
  for (const expected of pages) {
    if (
      verified.find(({ id }) => id === expected.id)?.firstSolved !== expected.expectedFirstSolved
    ) {
      throw new Error(`First Solved backfill verification failed for ${expected.id}.`);
    }
  }
  await (options.writeManifest ?? writeManifestAtomic)(options.manifestPath, {
    ...options.manifest,
    version: 3,
  });
  await unlink(journalPath).catch((error: any) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  return { mode: 'applied' as const, backupPath, counts, plannedOperations };
}
