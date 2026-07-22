import { createHash } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { NotionManifest } from '../shared/contract.js';
import { writeJsonAtomic, writeManifestAtomic } from './io.js';
import { DIFFICULTY_OPTIONS } from './presentation.js';
import {
  LEGACY_RESULT_OPTIONS,
  LEGACY_STATE_OPTIONS,
  REQUIRED_ATTEMPTS_TYPES,
  REQUIRED_PROBLEMS_TYPES,
  RESULT_OPTIONS,
  STATE_OPTIONS,
  V3_REQUIRED_PROBLEMS_TYPES,
} from './schema.js';
import { verifyV2DataSource } from './verify-data-source.js';

type Page = { id: string; properties: Record<string, unknown> };
type Option = { readonly name: string; readonly color: string };

interface PreparedProblem {
  id: string;
  firstAttempt: string | null;
  expectedFirstAttempt: string | null;
  practiceState: string;
  expectedPracticeState: string;
  preservedSha256: string;
}

interface PreparedAttempt {
  id: string;
  problemId: string;
  attemptedAt: string;
  result: string;
  expectedResult: string;
  resultingState: string;
  expectedResultingState: string;
  preservedSha256: string;
  bodySha256: string;
}

interface Journal {
  version: 1;
  migration: 'notion-v3-to-v4';
  manifest: NotionManifest & { version: 3 };
  backupPath: string;
  backupSha256: string;
  firstTimestampPropertyId: string;
  pages: {
    problems: PreparedProblem[];
    attempts: PreparedAttempt[];
  };
}

export interface NotionV4MigrationClient {
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
  blocks: {
    children: {
      list(args: {
        block_id: string;
        page_size: number;
        start_cursor?: string;
      }): Promise<{ results: unknown[]; has_more: boolean; next_cursor: string | null }>;
    };
  };
}

export interface V4MigrationOptions {
  notion: NotionV4MigrationClient;
  manifest: NotionManifest;
  manifestPath: string;
  backupDirectory: string;
  journalPath?: string;
  apply: boolean;
  now?: () => Date;
  writeManifest?: (path: string, manifest: NotionManifest) => Promise<void>;
}

const TimestampSchema = z.string().datetime({ offset: true });
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const IdPairSchema = z
  .object({ databaseId: z.string().min(1), dataSourceId: z.string().min(1) })
  .strict();
const V3ManifestSchema = z
  .object({
    version: z.literal(3),
    notionApiVersion: z.literal('2026-03-11'),
    createdAt: TimestampSchema,
    parentPageId: z.string().min(1),
    problems: IdPairSchema,
    attempts: IdPairSchema,
  })
  .strict();
const ProblemJournalSchema = z
  .object({
    id: z.string().min(1),
    firstAttempt: TimestampSchema.nullable(),
    expectedFirstAttempt: TimestampSchema.nullable(),
    practiceState: z.enum(['New', 'Couldn’t solve', 'Needed help', 'Solved', 'Mastered']),
    expectedPracticeState: z.enum(['New', 'Needed help', 'Solved', 'Mastered']),
    preservedSha256: DigestSchema,
  })
  .strict();
const AttemptJournalSchema = z
  .object({
    id: z.string().min(1),
    problemId: z.string().min(1),
    attemptedAt: TimestampSchema,
    result: z.enum(['Couldn’t solve', 'Needed help', 'Solved']),
    expectedResult: z.enum(['Needed help', 'Solved']),
    resultingState: z.enum(['New', 'Couldn’t solve', 'Needed help', 'Solved', 'Mastered']),
    expectedResultingState: z.enum(['New', 'Needed help', 'Solved', 'Mastered']),
    preservedSha256: DigestSchema,
    bodySha256: DigestSchema,
  })
  .strict();
const PagesSchema = z
  .object({
    problems: z.array(ProblemJournalSchema),
    attempts: z.array(AttemptJournalSchema),
  })
  .strict();
const JournalSchema = z
  .object({
    version: z.literal(1),
    migration: z.literal('notion-v3-to-v4'),
    manifest: V3ManifestSchema,
    backupPath: z.string().min(1),
    backupSha256: DigestSchema,
    firstTimestampPropertyId: z.string().min(1),
    pages: PagesSchema,
  })
  .strict();
const BackupSchema = z
  .object({
    migration: z.literal('notion-v3-to-v4'),
    createdAt: TimestampSchema,
    dryRun: z.boolean(),
    manifest: V3ManifestSchema,
    counts: z
      .object({
        problems: z.number().int().nonnegative(),
        attempts: z.number().int().nonnegative(),
      })
      .strict(),
    firstTimestampPropertyId: z.string().min(1),
    pages: PagesSchema,
  })
  .strict();

function schemaTypes(source: unknown): Record<string, string> {
  const properties = (source as any)?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error('Invalid data source.');
  }
  return Object.fromEntries(
    Object.entries(properties).map(([name, property]: [string, any]) => {
      if (typeof property?.type !== 'string' || typeof property?.id !== 'string') {
        throw new Error(`Invalid property ${name}.`);
      }
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

function selectOptions(source: unknown, name: string): Array<{ name: string; color: string }> {
  const property = (source as any)?.properties?.[name];
  if (property?.type !== 'select' || !Array.isArray(property.select?.options)) {
    throw new Error(`${name} must be a select with options.`);
  }
  return property.select.options.map((option: any) => {
    if (typeof option?.name !== 'string' || typeof option?.color !== 'string') {
      throw new Error(`${name} contains an invalid select option.`);
    }
    return { name: option.name, color: option.color };
  });
}

function sameOptions(actual: Array<{ name: string; color: string }>, expected: readonly Option[]) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function requireKnownOptions(
  source: unknown,
  name: string,
  legacy: readonly Option[],
  current: readonly Option[],
): 'legacy' | 'current' {
  const actual = selectOptions(source, name);
  if (sameOptions(actual, legacy)) return 'legacy';
  if (sameOptions(actual, current)) return 'current';
  throw new Error(`Refusing migration: unknown ${name} select options.`);
}

function propertyId(source: unknown, name: string): string {
  const id = (source as any)?.properties?.[name]?.id;
  if (typeof id !== 'string' || !id) throw new Error(`${name} has no stable property ID.`);
  return id;
}

function fullPage(value: unknown): Page {
  const page = value as any;
  if (page?.object !== 'page' || typeof page.id !== 'string' || !page.properties) {
    throw new Error('Notion returned a partial page during v4 migration.');
  }
  return page;
}

async function queryAll(notion: NotionV4MigrationClient, dataSourceId: string): Promise<Page[]> {
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
      throw new Error('Notion pagination returned no cursor during v4 migration.');
    }
    cursor = response.has_more ? response.next_cursor! : undefined;
  } while (cursor);
  return pages;
}

async function queryAllBlocks(notion: NotionV4MigrationClient, pageId: string): Promise<unknown[]> {
  const blocks: unknown[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    blocks.push(...response.results);
    if (response.has_more && !response.next_cursor) {
      throw new Error('Notion block pagination returned no cursor during v4 migration.');
    }
    cursor = response.has_more ? response.next_cursor! : undefined;
  } while (cursor);
  return blocks;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

function preservedProperties(page: Page, excluded: readonly string[]): string {
  return digest(
    Object.fromEntries(
      Object.entries(page.properties).filter(([name]) => !excluded.includes(name)),
    ),
  );
}

function nullableTimestamp(page: Page, names: readonly string[]): string | null {
  const name = names.find((candidate) => page.properties[candidate] !== undefined);
  if (!name) return null;
  const property = page.properties[name] as any;
  if (property.type !== 'date') throw new Error(`${page.id}.${name} must be a date.`);
  if (property.date === null) return null;
  const value = property.date?.start;
  if (!TimestampSchema.safeParse(value).success) {
    throw new Error(`${page.id}.${name} must contain an ISO timestamp with an offset.`);
  }
  return value;
}

function requiredTimestamp(page: Page, name: string): string {
  const value = nullableTimestamp(page, [name]);
  if (value === null)
    throw new Error(`${page.id}.${name} must contain an ISO timestamp with an offset.`);
  return value;
}

function requiredSelect(page: Page, name: string, allowed: readonly string[]): string {
  const property = page.properties[name] as any;
  const value = property?.type === 'select' ? property.select?.name : undefined;
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error(`${page.id}.${name} contains an unknown value.`);
  }
  return value;
}

function requiredProblemId(attempt: Page): string {
  const relation = attempt.properties.Problem as any;
  const ids = relation?.type === 'relation' ? relation.relation : undefined;
  if (!Array.isArray(ids) || ids.length !== 1 || typeof ids[0]?.id !== 'string') {
    throw new Error(`${attempt.id}.Problem must contain exactly one relation.`);
  }
  return ids[0].id;
}

function reclassified(value: string): string {
  return value === 'Couldn’t solve' ? 'Needed help' : value;
}

async function prepare(notion: NotionV4MigrationClient, problems: Page[], attempts: Page[]) {
  const allowedStates = ['New', 'Couldn’t solve', 'Needed help', 'Solved', 'Mastered'];
  const allowedResults = ['Couldn’t solve', 'Needed help', 'Solved'];
  const bodyHashes = new Map(
    await Promise.all(
      attempts.map(async ({ id }) => [id, digest(await queryAllBlocks(notion, id))] as const),
    ),
  );
  const preparedAttempts: PreparedAttempt[] = attempts.map((attempt) => {
    const problemId = requiredProblemId(attempt);
    const attemptedAt = requiredTimestamp(attempt, 'Attempted At');
    const result = requiredSelect(attempt, 'Result', allowedResults);
    const resultingState = requiredSelect(attempt, 'Resulting State', allowedStates);
    return {
      id: attempt.id,
      problemId,
      attemptedAt,
      result,
      expectedResult: reclassified(result),
      resultingState,
      expectedResultingState: reclassified(resultingState),
      preservedSha256: preservedProperties(attempt, ['Result', 'Resulting State']),
      bodySha256: bodyHashes.get(attempt.id)!,
    };
  });
  const problemIds = new Set(problems.map(({ id }) => id));
  const earliest = new Map<string, string>();
  for (const attempt of preparedAttempts) {
    if (!problemIds.has(attempt.problemId)) {
      throw new Error(`Attempt ${attempt.id} references unknown Problem ${attempt.problemId}.`);
    }
    const current = earliest.get(attempt.problemId);
    if (!current || Date.parse(attempt.attemptedAt) < Date.parse(current))
      earliest.set(attempt.problemId, attempt.attemptedAt);
  }
  const preparedProblems: PreparedProblem[] = problems.map((problem) => {
    const practiceState = requiredSelect(problem, 'Practice State', allowedStates);
    return {
      id: problem.id,
      firstAttempt: nullableTimestamp(problem, ['First Attempt', 'First Solved']),
      expectedFirstAttempt: earliest.get(problem.id) ?? null,
      practiceState,
      expectedPracticeState: reclassified(practiceState),
      preservedSha256: preservedProperties(problem, [
        'First Attempt',
        'First Solved',
        'Practice State',
      ]),
    };
  });
  return { problems: preparedProblems, attempts: preparedAttempts };
}

function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function writeBackup(directory: string, date: Date, payload: unknown) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `notion-v3-to-v4-${safeTimestamp(date)}.json`);
  const encoded = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(path, encoded, { encoding: 'utf8', flag: 'wx' });
  return { path, sha256: createHash('sha256').update(encoded).digest('hex') };
}

async function readJournal(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function sameIds(left: Array<{ id: string }>, right: Array<{ id: string }>) {
  return (
    JSON.stringify(left.map(({ id }) => id).sort()) ===
    JSON.stringify(right.map(({ id }) => id).sort())
  );
}

function assertUniqueIds(pages: {
  problems: PreparedProblem[];
  attempts: PreparedAttempt[];
}): void {
  for (const [label, rows] of [
    ['Problem', pages.problems],
    ['Attempt', pages.attempts],
  ] as const) {
    if (new Set(rows.map(({ id }) => id)).size !== rows.length)
      throw new Error(`Duplicate ${label} IDs.`);
  }
}

function assertJournalSemantics(journal: Journal): void {
  assertUniqueIds(journal.pages);
  const problemIds = new Set(journal.pages.problems.map(({ id }) => id));
  const earliest = new Map<string, string>();
  for (const attempt of journal.pages.attempts) {
    if (!problemIds.has(attempt.problemId))
      throw new Error('Attempt references an unknown Problem.');
    if (
      attempt.expectedResult !== reclassified(attempt.result) ||
      attempt.expectedResultingState !== reclassified(attempt.resultingState)
    ) {
      throw new Error('Attempt reclassification is contradictory.');
    }
    const current = earliest.get(attempt.problemId);
    if (!current || Date.parse(attempt.attemptedAt) < Date.parse(current))
      earliest.set(attempt.problemId, attempt.attemptedAt);
  }
  for (const problem of journal.pages.problems) {
    if (
      problem.expectedPracticeState !== reclassified(problem.practiceState) ||
      problem.expectedFirstAttempt !== (earliest.get(problem.id) ?? null)
    ) {
      throw new Error('Problem migration expectation is contradictory.');
    }
  }
}

async function validateJournal(raw: unknown, options: V4MigrationOptions): Promise<Journal> {
  try {
    const journal = JournalSchema.parse(raw) as Journal;
    if (JSON.stringify(journal.manifest) !== JSON.stringify(options.manifest))
      throw new Error('Manifest mismatch.');
    assertJournalSemantics(journal);
    const backupRoot = `${resolve(options.backupDirectory)}${sep}`;
    const backupPath = resolve(journal.backupPath);
    if (!backupPath.startsWith(backupRoot))
      throw new Error('Backup path is outside its directory.');
    const encoded = await readFile(backupPath);
    if (createHash('sha256').update(encoded).digest('hex') !== journal.backupSha256)
      throw new Error('Backup digest mismatch.');
    const backup = BackupSchema.parse(JSON.parse(encoded.toString('utf8')));
    if (
      backup.dryRun ||
      backup.firstTimestampPropertyId !== journal.firstTimestampPropertyId ||
      JSON.stringify(backup.manifest) !== JSON.stringify(journal.manifest) ||
      JSON.stringify(backup.pages) !== JSON.stringify(journal.pages) ||
      backup.counts.problems !== journal.pages.problems.length ||
      backup.counts.attempts !== journal.pages.attempts.length
    ) {
      throw new Error('Backup content mismatch.');
    }
    return journal;
  } catch {
    throw new Error('Invalid v4 recovery journal.');
  }
}

function verifyExactV4SchemaForManifest(
  problemSource: unknown,
  attemptSource: unknown,
  manifest: NotionManifest,
): void {
  verifyV2DataSource(problemSource, 'LeetCode Problems', REQUIRED_PROBLEMS_TYPES, {
    relation: { name: 'Attempts', dataSourceId: manifest.attempts.dataSourceId },
    selects: { 'Practice State': STATE_OPTIONS, Difficulty: DIFFICULTY_OPTIONS },
  });
  verifyV2DataSource(attemptSource, 'LeetCode Attempts', REQUIRED_ATTEMPTS_TYPES, {
    relation: { name: 'Problem', dataSourceId: manifest.problems.dataSourceId },
    selects: { Result: RESULT_OPTIONS, 'Resulting State': STATE_OPTIONS },
  });
}

function assertVerified(
  verified: Awaited<ReturnType<typeof prepare>>,
  expected: Awaited<ReturnType<typeof prepare>>,
): void {
  if (
    !sameIds(verified.problems, expected.problems) ||
    !sameIds(verified.attempts, expected.attempts)
  ) {
    throw new Error('v4 row verification failed: page IDs changed.');
  }
  for (const target of expected.problems) {
    const live = verified.problems.find(({ id }) => id === target.id);
    if (live?.preservedSha256 !== target.preservedSha256)
      throw new Error(`v4 preservation verification failed for Problem ${target.id}.`);
    if (
      live.firstAttempt !== target.expectedFirstAttempt ||
      live.practiceState !== target.expectedPracticeState
    ) {
      throw new Error(`v4 row verification failed for Problem ${target.id}.`);
    }
  }
  for (const target of expected.attempts) {
    const live = verified.attempts.find(({ id }) => id === target.id);
    if (live?.preservedSha256 !== target.preservedSha256 || live.bodySha256 !== target.bodySha256) {
      throw new Error(`v4 preservation verification failed for Attempt ${target.id}.`);
    }
    if (
      live.result !== target.expectedResult ||
      live.resultingState !== target.expectedResultingState ||
      live.attemptedAt !== target.attemptedAt ||
      live.problemId !== target.problemId
    ) {
      throw new Error(`v4 row verification failed for Attempt ${target.id}.`);
    }
  }
}

export async function migrateNotionV4(options: V4MigrationOptions) {
  if (options.manifest.version < 3)
    throw new Error('Run npm run notion:migrate:v3 before npm run notion:migrate:v4.');
  const [problemSource, attemptSource] = await Promise.all([
    options.notion.dataSources.retrieve({ data_source_id: options.manifest.problems.dataSourceId }),
    options.notion.dataSources.retrieve({ data_source_id: options.manifest.attempts.dataSourceId }),
  ]);
  if (options.manifest.version === 4) {
    verifyExactV4SchemaForManifest(problemSource, attemptSource, options.manifest);
    return {
      mode: 'no-op' as const,
      backupPath: null,
      counts: { problems: 0, attempts: 0, reclassifiedProblems: 0, reclassifiedAttempts: 0 },
      plannedOperations: {
        renameFirstAttempt: 0,
        backfillProblems: 0,
        reclassifyProblems: 0,
        reclassifyAttempts: 0,
        removeObsoleteOptions: 0,
        manifestVersion: 4,
      },
    };
  }

  const journalPath =
    options.journalPath ?? join(options.backupDirectory, 'notion-v4-journal.json');
  const rawJournal = await readJournal(journalPath);
  const journal = rawJournal ? await validateJournal(rawJournal, options) : null;
  const problemTypes = schemaTypes(problemSource);
  const hasV3Names = sameTypes(problemTypes, V3_REQUIRED_PROBLEMS_TYPES);
  const hasV4Names = sameTypes(problemTypes, REQUIRED_PROBLEMS_TYPES);
  if (!hasV3Names && !hasV4Names)
    throw new Error('Refusing migration: unknown Problems schema shape.');
  if (!sameTypes(schemaTypes(attemptSource), REQUIRED_ATTEMPTS_TYPES))
    throw new Error('Refusing migration: unknown Attempts schema shape.');
  const problemOptions = requireKnownOptions(
    problemSource,
    'Practice State',
    LEGACY_STATE_OPTIONS,
    STATE_OPTIONS,
  );
  const resultOptions = requireKnownOptions(
    attemptSource,
    'Result',
    LEGACY_RESULT_OPTIONS,
    RESULT_OPTIONS,
  );
  const resultingStateOptions = requireKnownOptions(
    attemptSource,
    'Resulting State',
    LEGACY_STATE_OPTIONS,
    STATE_OPTIONS,
  );
  if (
    !journal &&
    (!hasV3Names ||
      problemOptions !== 'legacy' ||
      resultOptions !== 'legacy' ||
      resultingStateOptions !== 'legacy')
  ) {
    throw new Error(
      'Refusing migration: intermediate v4 schema requires a valid recovery journal.',
    );
  }
  verifyV2DataSource(
    problemSource,
    'LeetCode Problems',
    hasV3Names ? V3_REQUIRED_PROBLEMS_TYPES : REQUIRED_PROBLEMS_TYPES,
    {
      relation: { name: 'Attempts', dataSourceId: options.manifest.attempts.dataSourceId },
      selects: {
        'Practice State': problemOptions === 'legacy' ? LEGACY_STATE_OPTIONS : STATE_OPTIONS,
        Difficulty: DIFFICULTY_OPTIONS,
      },
    },
  );
  verifyV2DataSource(attemptSource, 'LeetCode Attempts', REQUIRED_ATTEMPTS_TYPES, {
    relation: { name: 'Problem', dataSourceId: options.manifest.problems.dataSourceId },
    selects: {
      Result: resultOptions === 'legacy' ? LEGACY_RESULT_OPTIONS : RESULT_OPTIONS,
      'Resulting State': resultingStateOptions === 'legacy' ? LEGACY_STATE_OPTIONS : STATE_OPTIONS,
    },
  });
  const firstTimestampPropertyId =
    journal?.firstTimestampPropertyId ?? propertyId(problemSource, 'First Solved');
  if (
    journal &&
    propertyId(problemSource, hasV3Names ? 'First Solved' : 'First Attempt') !==
      firstTimestampPropertyId
  ) {
    throw new Error('First Attempt property ID changed during v4 migration.');
  }
  const [problems, attempts] = await Promise.all([
    queryAll(options.notion, options.manifest.problems.dataSourceId),
    queryAll(options.notion, options.manifest.attempts.dataSourceId),
  ]);
  let prepared = await prepare(options.notion, problems, attempts);
  assertUniqueIds(prepared);
  if (journal) {
    if (
      !sameIds(prepared.problems, journal.pages.problems) ||
      !sameIds(prepared.attempts, journal.pages.attempts)
    ) {
      throw new Error('Live page IDs do not match the v4 recovery journal.');
    }
    prepared = journal.pages;
  }
  const now = (options.now ?? (() => new Date()))();
  let backupPath: string;
  let backupSha256: string | undefined;
  if (journal) backupPath = journal.backupPath;
  else {
    const backup = await writeBackup(options.backupDirectory, now, {
      migration: 'notion-v3-to-v4',
      createdAt: now.toISOString(),
      dryRun: !options.apply,
      manifest: options.manifest,
      counts: { problems: problems.length, attempts: attempts.length },
      firstTimestampPropertyId,
      pages: prepared,
    });
    backupPath = backup.path;
    backupSha256 = backup.sha256;
  }
  const counts = {
    problems: prepared.problems.length,
    attempts: prepared.attempts.length,
    reclassifiedProblems: prepared.problems.filter(
      ({ practiceState, expectedPracticeState }) => practiceState !== expectedPracticeState,
    ).length,
    reclassifiedAttempts: prepared.attempts.filter(
      ({ result, expectedResult, resultingState, expectedResultingState }) =>
        result !== expectedResult || resultingState !== expectedResultingState,
    ).length,
  };
  const plannedOperations = {
    renameFirstAttempt: hasV3Names ? 1 : 0,
    backfillProblems: prepared.problems.filter(
      ({ firstAttempt, expectedFirstAttempt }) => firstAttempt !== expectedFirstAttempt,
    ).length,
    reclassifyProblems: counts.reclassifiedProblems,
    reclassifyAttempts: counts.reclassifiedAttempts,
    removeObsoleteOptions:
      Number(problemOptions === 'legacy') +
      Number(resultOptions === 'legacy') +
      Number(resultingStateOptions === 'legacy'),
    manifestVersion: 4,
  };
  if (!options.apply) return { mode: 'dry-run' as const, backupPath, counts, plannedOperations };

  let activeJournal = journal;
  if (!activeJournal) {
    activeJournal = {
      version: 1,
      migration: 'notion-v3-to-v4',
      manifest: options.manifest as NotionManifest & { version: 3 },
      backupPath,
      backupSha256: backupSha256!,
      firstTimestampPropertyId,
      pages: prepared,
    };
    await writeJsonAtomic(journalPath, activeJournal);
  }
  if (hasV3Names) {
    await options.notion.dataSources.update({
      data_source_id: options.manifest.problems.dataSourceId,
      properties: { 'First Solved': { name: 'First Attempt' } },
    });
  }
  for (const page of prepared.problems) {
    const properties: Record<string, unknown> = {};
    if (page.firstAttempt !== page.expectedFirstAttempt)
      properties['First Attempt'] = page.expectedFirstAttempt
        ? { date: { start: page.expectedFirstAttempt } }
        : { date: null };
    if (page.practiceState !== page.expectedPracticeState)
      properties['Practice State'] = { select: { name: page.expectedPracticeState } };
    if (Object.keys(properties).length > 0)
      await options.notion.pages.update({ page_id: page.id, properties });
  }
  for (const page of prepared.attempts) {
    const properties: Record<string, unknown> = {};
    if (page.result !== page.expectedResult)
      properties.Result = { select: { name: page.expectedResult } };
    if (page.resultingState !== page.expectedResultingState)
      properties['Resulting State'] = { select: { name: page.expectedResultingState } };
    if (Object.keys(properties).length > 0)
      await options.notion.pages.update({ page_id: page.id, properties });
  }
  if (problemOptions === 'legacy') {
    await options.notion.dataSources.update({
      data_source_id: options.manifest.problems.dataSourceId,
      properties: { 'Practice State': { select: { options: [...STATE_OPTIONS] } } },
    });
  }
  const attemptOptionUpdates: Record<string, unknown> = {};
  if (resultOptions === 'legacy')
    attemptOptionUpdates.Result = { select: { options: [...RESULT_OPTIONS] } };
  if (resultingStateOptions === 'legacy')
    attemptOptionUpdates['Resulting State'] = { select: { options: [...STATE_OPTIONS] } };
  if (Object.keys(attemptOptionUpdates).length > 0) {
    await options.notion.dataSources.update({
      data_source_id: options.manifest.attempts.dataSourceId,
      properties: attemptOptionUpdates,
    });
  }

  const [verifiedProblemSource, verifiedAttemptSource, verifiedProblems, verifiedAttempts] =
    await Promise.all([
      options.notion.dataSources.retrieve({
        data_source_id: options.manifest.problems.dataSourceId,
      }),
      options.notion.dataSources.retrieve({
        data_source_id: options.manifest.attempts.dataSourceId,
      }),
      queryAll(options.notion, options.manifest.problems.dataSourceId),
      queryAll(options.notion, options.manifest.attempts.dataSourceId),
    ]);
  verifyExactV4SchemaForManifest(verifiedProblemSource, verifiedAttemptSource, options.manifest);
  if (propertyId(verifiedProblemSource, 'First Attempt') !== firstTimestampPropertyId) {
    throw new Error('First Attempt property ID changed during v4 migration.');
  }
  assertVerified(await prepare(options.notion, verifiedProblems, verifiedAttempts), prepared);
  await (options.writeManifest ?? writeManifestAtomic)(options.manifestPath, {
    ...options.manifest,
    version: 4,
  });
  await unlink(journalPath).catch((error: any) => {
    if (error?.code !== 'ENOENT') throw error;
  });
  return { mode: 'applied' as const, backupPath, counts, plannedOperations };
}
