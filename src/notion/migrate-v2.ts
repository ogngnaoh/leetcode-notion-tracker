import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { NotionManifest } from '../shared/contract.js';
import { writeManifestAtomic } from './io.js';
import {
  readMigrationJournal,
  removeMigrationJournal,
  validateJournalBackup,
  validateJournalManifest,
  writeMigrationJournal,
  type MigrationJournal,
} from './migrate-v2-journal.js';
import {
  ATTEMPT_REMOVED_FIELDS,
  blockText,
  expectedLegacyLabels,
  LEGACY_MARKER,
  legacyBlockCount,
  legacyChildren,
  prepareAttempt,
  prepareProblem,
  PROBLEM_LEGACY_FIELDS,
  propertyValue,
  type PreparedPage,
  type UnknownRecord,
} from './migrate-v2-values.js';
export { toCalendarDate, toSolvedStreak, toV2State } from './migrate-v2-values.js';
import {
  ATTEMPTS_PROPERTIES,
  DIFFICULTY_OPTION_NAMES,
  INTERMEDIATE_ATTEMPTS_TYPES,
  INTERMEDIATE_PROBLEMS_TYPES,
  PROBLEMS_PROPERTIES,
  V2_REQUIRED_ATTEMPTS_TYPES as REQUIRED_ATTEMPTS_TYPES,
  V2_REQUIRED_PROBLEMS_TYPES as REQUIRED_PROBLEMS_TYPES,
  LEGACY_RESULT_OPTIONS as RESULT_OPTIONS,
  LEGACY_STATE_OPTIONS as STATE_OPTIONS,
  V1_ATTEMPTS_TYPES,
  V1_PROBLEMS_TYPES,
} from './schema.js';
import { verifyV2DataSource } from './verify-data-source.js';

type MigrationShape = 'v1' | 'intermediate' | 'v2';
type SchemaLabel = 'Problems' | 'Attempts';

export interface NotionMigrationClient {
  dataSources: {
    retrieve(args: { data_source_id: string }): Promise<unknown>;
    query(args: {
      data_source_id: string;
      page_size: number;
      start_cursor?: string;
    }): Promise<{ results: unknown[]; has_more: boolean; next_cursor: string | null }>;
    update(args: {
      data_source_id: string;
      properties: Record<string, unknown | null>;
    }): Promise<unknown>;
  };
  pages: {
    update(args: { page_id: string; properties: Record<string, unknown> }): Promise<unknown>;
    properties: {
      retrieve(args: {
        page_id: string;
        property_id: string;
        page_size: number;
        start_cursor?: string;
      }): Promise<unknown>;
    };
  };
  blocks: {
    children: {
      list(args: {
        block_id: string;
        page_size: number;
        start_cursor?: string;
      }): Promise<{ results: unknown[]; has_more: boolean; next_cursor: string | null }>;
      append(args: {
        block_id: string;
        children: Array<Record<string, unknown>>;
      }): Promise<unknown>;
    };
  };
}

export interface MigrationOptions {
  notion: NotionMigrationClient;
  manifest: NotionManifest;
  manifestPath: string;
  backupDirectory: string;
  journalPath?: string;
  apply: boolean;
  now?: () => Date;
  writeManifest?: (path: string, manifest: NotionManifest) => Promise<void>;
}

function sameShape(actual: Record<string, string>, expected: Record<string, string>): boolean {
  const actualEntries = Object.entries(actual).sort(([left], [right]) => left.localeCompare(right));
  const expectedEntries = Object.entries(expected).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return JSON.stringify(actualEntries) === JSON.stringify(expectedEntries);
}

export function classifyV2MigrationShape(
  actual: Record<string, string>,
  label: SchemaLabel,
): MigrationShape {
  const candidates =
    label === 'Problems'
      ? [V1_PROBLEMS_TYPES, INTERMEDIATE_PROBLEMS_TYPES, REQUIRED_PROBLEMS_TYPES]
      : [V1_ATTEMPTS_TYPES, INTERMEDIATE_ATTEMPTS_TYPES, REQUIRED_ATTEMPTS_TYPES];
  const names: MigrationShape[] = ['v1', 'intermediate', 'v2'];
  const index = candidates.findIndex((candidate) => sameShape(actual, candidate));
  if (index < 0) throw new Error(`Refusing migration: unknown ${label} schema shape.`);
  return names[index]!;
}

function schemaTypes(response: unknown, label: SchemaLabel): Record<string, string> {
  const properties = (response as UnknownRecord)?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error(`Notion returned an invalid ${label} data source.`);
  }
  return Object.fromEntries(
    Object.entries(properties).map(([name, config]) => {
      const type = (config as UnknownRecord)?.type;
      if (typeof type !== 'string') {
        throw new Error(`Notion returned an invalid ${label}.${name} property.`);
      }
      return [name, type];
    }),
  );
}

function fullPage(value: unknown): { id: string; properties: Record<string, UnknownRecord> } {
  const page = value as UnknownRecord;
  if (
    page?.object !== 'page' ||
    typeof page.id !== 'string' ||
    !page.properties ||
    typeof page.properties !== 'object'
  ) {
    throw new Error('Notion returned a partial or invalid page during migration.');
  }
  return page as { id: string; properties: Record<string, UnknownRecord> };
}

async function queryAllPages(
  notion: NotionMigrationClient,
  dataSourceId: string,
): Promise<Array<{ id: string; properties: Record<string, UnknownRecord> }>> {
  const pages: Array<{ id: string; properties: Record<string, UnknownRecord> }> = [];
  let cursor: string | undefined;
  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    pages.push(...response.results.map(fullPage));
    if (response.has_more && !response.next_cursor) {
      throw new Error('Notion pagination indicated more pages without returning a cursor.');
    }
    cursor = response.has_more ? response.next_cursor! : undefined;
  } while (cursor);
  return pages;
}

const PAGINATED_PROPERTY_TYPES = new Set(['title', 'rich_text', 'relation']);

async function hydrateLegacyProperties(
  notion: NotionMigrationClient,
  pages: Array<{ id: string; properties: Record<string, UnknownRecord> }>,
  fields: readonly string[],
): Promise<void> {
  for (const page of pages) {
    for (const name of fields) {
      const property = page.properties[name];
      if (
        !property ||
        typeof property.id !== 'string' ||
        typeof property.type !== 'string' ||
        !PAGINATED_PROPERTY_TYPES.has(property.type)
      ) {
        continue;
      }
      const items: unknown[] = [];
      let cursor: string | undefined;
      do {
        const response = (await notion.pages.properties.retrieve({
          page_id: page.id,
          property_id: property.id,
          page_size: 100,
          ...(cursor ? { start_cursor: cursor } : {}),
        })) as UnknownRecord;
        if (response.object !== 'list' || !Array.isArray(response.results)) {
          throw new Error(`Notion returned invalid property items for ${page.id}.${name}.`);
        }
        for (const result of response.results) {
          const item = result as UnknownRecord;
          if (item.type !== property.type || !(property.type in item)) {
            throw new Error(`Notion returned an invalid property item for ${page.id}.${name}.`);
          }
          items.push(item[property.type]);
        }
        if (response.has_more === true && typeof response.next_cursor !== 'string') {
          throw new Error(
            `Notion property pagination indicated more items without a cursor for ${page.id}.${name}.`,
          );
        }
        cursor = response.has_more === true ? response.next_cursor : undefined;
      } while (cursor);
      page.properties[name] = { ...property, [property.type]: items };
    }
  }
}

function expectedTypes(label: SchemaLabel, shape: MigrationShape): Record<string, string> {
  if (label === 'Problems') {
    return shape === 'v1'
      ? V1_PROBLEMS_TYPES
      : shape === 'intermediate'
        ? INTERMEDIATE_PROBLEMS_TYPES
        : REQUIRED_PROBLEMS_TYPES;
  }
  return shape === 'v1'
    ? V1_ATTEMPTS_TYPES
    : shape === 'intermediate'
      ? INTERMEDIATE_ATTEMPTS_TYPES
      : REQUIRED_ATTEMPTS_TYPES;
}

function verifySchemaConfiguration(
  response: unknown,
  label: SchemaLabel,
  shape: MigrationShape,
  manifest: NotionManifest,
): void {
  const isProblems = label === 'Problems';
  verifyV2DataSource(response, `LeetCode ${label}`, expectedTypes(label, shape), {
    relation: {
      name: isProblems ? 'Attempts' : 'Problem',
      dataSourceId: isProblems ? manifest.attempts.dataSourceId : manifest.problems.dataSourceId,
    },
    selects:
      shape === 'v1'
        ? {}
        : isProblems
          ? { 'Practice State': STATE_OPTIONS }
          : { Result: RESULT_OPTIONS, 'Resulting State': STATE_OPTIONS },
    selectNames: isProblems ? { Difficulty: DIFFICULTY_OPTION_NAMES } : {},
  });
}

async function childTexts(notion: NotionMigrationClient, pageId: string): Promise<string[]> {
  const texts: string[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    texts.push(...response.results.map(blockText));
    if (response.has_more && !response.next_cursor) {
      throw new Error(
        'Notion block pagination indicated more children without returning a cursor.',
      );
    }
    cursor = response.has_more ? response.next_cursor! : undefined;
  } while (cursor);
  return texts;
}

async function preserveAndVerifyLegacy(
  notion: NotionMigrationClient,
  pages: PreparedPage[],
): Promise<void> {
  for (const page of pages) {
    const expected = expectedLegacyLabels(page.legacy);
    if (expected.size === 0) continue;
    const before = await childTexts(notion, page.id);
    const hasMarker = before.includes(LEGACY_MARKER);
    const missing = new Set(
      [...expected.entries()]
        .filter(([, value]) => !before.includes(value))
        .map(([label]) => label),
    );
    if (!hasMarker || missing.size > 0) {
      const labelsToAppend = hasMarker ? missing : new Set(expected.keys());
      await notion.blocks.children.append({
        block_id: page.id,
        children: legacyChildren(page.legacy, !hasMarker, labelsToAppend),
      });
    }
    const after = await childTexts(notion, page.id);
    if (
      !after.includes(LEGACY_MARKER) ||
      [...expected.values()].some((value) => !after.includes(value))
    ) {
      throw new Error(`Page ${page.id} legacy preservation verification failed.`);
    }
  }
}

async function verifyLegacy(notion: NotionMigrationClient, pages: PreparedPage[]): Promise<void> {
  for (const page of pages) {
    const expected = expectedLegacyLabels(page.legacy);
    if (expected.size === 0) continue;
    const texts = await childTexts(notion, page.id);
    if (
      !texts.includes(LEGACY_MARKER) ||
      [...expected.values()].some((value) => !texts.includes(value))
    ) {
      throw new Error(`Page ${page.id} legacy preservation verification failed.`);
    }
  }
}

function addedProperties(
  shape: MigrationShape,
  properties: Record<string, unknown>,
  names: string[],
): Record<string, unknown> {
  if (shape !== 'v1') return {};
  return Object.fromEntries(names.map((name) => [name, properties[name]!]));
}

function verifyPageIds(
  actual: Array<{ id: string }>,
  expected: PreparedPage[],
  label: string,
): void {
  const actualIds = actual.map((page) => page.id).sort();
  const expectedIds = expected.map((page) => page.id).sort();
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error(`${label} page IDs do not match the v2 migration journal.`);
  }
}

function verifyPreparedPages(
  actualPages: Array<{ id: string; properties: Record<string, UnknownRecord> }>,
  expectedPages: PreparedPage[],
  label: string,
): void {
  verifyPageIds(actualPages, expectedPages, label);
  const actualById = new Map(actualPages.map((page) => [page.id, page]));
  for (const expected of expectedPages) {
    const actual = actualById.get(expected.id)!;
    for (const [name, value] of Object.entries(expected.expected)) {
      if (JSON.stringify(propertyValue(actual.properties, name)) !== JSON.stringify(value)) {
        throw new Error(`${label} backfill verification failed for ${expected.id}.${name}.`);
      }
    }
  }
}

async function retrieveSchemas(notion: NotionMigrationClient, manifest: NotionManifest) {
  const [problems, attempts] = await Promise.all([
    notion.dataSources.retrieve({ data_source_id: manifest.problems.dataSourceId }),
    notion.dataSources.retrieve({ data_source_id: manifest.attempts.dataSourceId }),
  ]);
  const shapes = {
    problems: classifyV2MigrationShape(schemaTypes(problems, 'Problems'), 'Problems'),
    attempts: classifyV2MigrationShape(schemaTypes(attempts, 'Attempts'), 'Attempts'),
  };
  return { problems, attempts, shapes };
}

async function verifyCurrentState(
  notion: NotionMigrationClient,
  manifest: NotionManifest,
  prepared: { problems: PreparedPage[]; attempts: PreparedPage[] },
  allowedShapes: { problems: MigrationShape; attempts: MigrationShape },
): Promise<void> {
  const sources = await retrieveSchemas(notion, manifest);
  if (
    sources.shapes.problems !== allowedShapes.problems ||
    sources.shapes.attempts !== allowedShapes.attempts
  ) {
    throw new Error(
      `Migration verification expected Problems=${allowedShapes.problems}, Attempts=${allowedShapes.attempts}; ` +
        `received Problems=${sources.shapes.problems}, Attempts=${sources.shapes.attempts}.`,
    );
  }
  verifySchemaConfiguration(sources.problems, 'Problems', sources.shapes.problems, manifest);
  verifySchemaConfiguration(sources.attempts, 'Attempts', sources.shapes.attempts, manifest);
  const [problems, attempts] = await Promise.all([
    queryAllPages(notion, manifest.problems.dataSourceId),
    queryAllPages(notion, manifest.attempts.dataSourceId),
  ]);
  verifyPreparedPages(problems, prepared.problems, 'Problems');
  verifyPreparedPages(attempts, prepared.attempts, 'Attempts');
}

function safeTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function writeBackup(
  directory: string,
  now: Date,
  payload: Record<string, unknown>,
): Promise<{ path: string; sha256: string }> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `notion-v1-to-v2-${safeTimestamp(now)}.json`);
  const encoded = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(path, encoded, { encoding: 'utf8', flag: 'wx' });
  return { path, sha256: createHash('sha256').update(encoded).digest('hex') };
}

function backupPayload(
  now: Date,
  dryRun: boolean,
  manifest: NotionManifest,
  shapes: { problems: MigrationShape; attempts: MigrationShape },
  prepared: { problems: PreparedPage[]; attempts: PreparedPage[] },
) {
  return {
    migration: 'notion-v1-to-v2',
    createdAt: now.toISOString(),
    dryRun,
    manifest,
    shapes,
    counts: { problems: prepared.problems.length, attempts: prepared.attempts.length },
    pages: {
      problems: prepared.problems.map((page) => ({ id: page.id, legacy: page.legacy })),
      attempts: prepared.attempts.map((page) => ({ id: page.id, legacy: page.legacy })),
    },
  };
}

export async function migrateNotionV2(options: MigrationOptions) {
  const { notion, manifest, manifestPath, backupDirectory, apply } = options;
  const now = (options.now ?? (() => new Date()))();
  const journalPath = options.journalPath ?? join(backupDirectory, 'notion-v2-journal.json');
  const writeManifest = options.writeManifest ?? writeManifestAtomic;
  const sources = await retrieveSchemas(notion, manifest);
  let journal = await readMigrationJournal(journalPath);
  if (journal) {
    validateJournalManifest(journal, manifest);
    await validateJournalBackup(journal, backupDirectory);
  }

  if (manifest.version === 2) {
    if (sources.shapes.problems !== 'v2' || sources.shapes.attempts !== 'v2') {
      throw new Error('Manifest version 2 requires exact v2 schemas.');
    }
    verifySchemaConfiguration(sources.problems, 'Problems', 'v2', manifest);
    verifySchemaConfiguration(sources.attempts, 'Attempts', 'v2', manifest);
    const [rawProblems, rawAttempts] = await Promise.all([
      queryAllPages(notion, manifest.problems.dataSourceId),
      queryAllPages(notion, manifest.attempts.dataSourceId),
    ]);
    let backupPath: string;
    if (journal) {
      verifyPreparedPages(rawProblems, journal.pages.problems, 'Problems');
      verifyPreparedPages(rawAttempts, journal.pages.attempts, 'Attempts');
      if (apply) {
        await preserveAndVerifyLegacy(notion, journal.pages.problems);
        await preserveAndVerifyLegacy(notion, journal.pages.attempts);
      } else {
        await verifyLegacy(notion, journal.pages.problems);
        await verifyLegacy(notion, journal.pages.attempts);
      }
      backupPath = journal.backupPath;
      if (apply) await removeMigrationJournal(journalPath);
    } else {
      const emptyPrepared = {
        problems: rawProblems.map((page) => ({
          id: page.id,
          legacy: {},
          backfill: {},
          expected: {},
        })),
        attempts: rawAttempts.map((page) => ({
          id: page.id,
          legacy: {},
          backfill: {},
          expected: {},
        })),
      };
      backupPath = (
        await writeBackup(
          backupDirectory,
          now,
          backupPayload(now, !apply, manifest, sources.shapes, emptyPrepared),
        )
      ).path;
    }
    return {
      mode: 'no-op' as const,
      backupPath,
      counts: { problems: rawProblems.length, attempts: rawAttempts.length, legacyBlocks: 0 },
      plannedOperations: {
        addProperties: 0,
        backfillPages: 0,
        appendLegacyBlocks: 0,
        removeProperties: 0,
        manifestVersion: 2,
      },
    };
  }

  if ((sources.shapes.problems === 'v2' || sources.shapes.attempts === 'v2') && !journal) {
    throw new Error(
      'Manifest version 1 contradicts an exact v2 schema without a matching journal.',
    );
  }
  if (
    (sources.shapes.problems === 'intermediate' || sources.shapes.attempts === 'intermediate') &&
    !journal
  ) {
    throw new Error('An intermediate v2 migration requires its matching journal.');
  }
  verifySchemaConfiguration(sources.problems, 'Problems', sources.shapes.problems, manifest);
  verifySchemaConfiguration(sources.attempts, 'Attempts', sources.shapes.attempts, manifest);

  const [rawProblems, rawAttempts] = await Promise.all([
    queryAllPages(notion, manifest.problems.dataSourceId),
    queryAllPages(notion, manifest.attempts.dataSourceId),
  ]);
  let prepared: { problems: PreparedPage[]; attempts: PreparedPage[] };
  if (journal) {
    prepared = journal.pages;
    verifyPageIds(rawProblems, prepared.problems, 'Problems');
    verifyPageIds(rawAttempts, prepared.attempts, 'Attempts');
  } else {
    await Promise.all([
      hydrateLegacyProperties(notion, rawProblems, PROBLEM_LEGACY_FIELDS),
      hydrateLegacyProperties(notion, rawAttempts, [
        ...ATTEMPT_REMOVED_FIELDS,
        'Resulting Next Review',
      ]),
    ]);
    prepared = {
      problems: rawProblems.map(prepareProblem),
      attempts: rawAttempts.map(prepareAttempt),
    };
  }

  const counts = {
    problems: prepared.problems.length,
    attempts: prepared.attempts.length,
    legacyBlocks: legacyBlockCount([...prepared.problems, ...prepared.attempts]),
  };
  const plannedOperations = {
    addProperties:
      (sources.shapes.problems === 'v1' ? 3 : 0) + (sources.shapes.attempts === 'v1' ? 3 : 0),
    backfillPages: prepared.problems.length + prepared.attempts.length,
    appendLegacyBlocks: counts.legacyBlocks,
    removeProperties: PROBLEM_LEGACY_FIELDS.length + ATTEMPT_REMOVED_FIELDS.length,
    manifestVersion: 2,
  };

  let backupPath: string;
  let backupSha256: string | undefined;
  if (!apply || !journal) {
    const backup = await writeBackup(
      backupDirectory,
      now,
      backupPayload(now, !apply, manifest, sources.shapes, prepared),
    );
    backupPath = backup.path;
    backupSha256 = backup.sha256;
  } else {
    backupPath = journal.backupPath;
  }
  if (!apply) return { mode: 'dry-run' as const, backupPath, counts, plannedOperations };

  if (!journal) {
    journal = {
      version: 1,
      migration: 'notion-v1-to-v2',
      notionApiVersion: manifest.notionApiVersion,
      createdAt: now.toISOString(),
      manifest,
      backupPath,
      backupSha256: backupSha256!,
      originalShapes: {
        problems: sources.shapes.problems as 'v1' | 'intermediate',
        attempts: sources.shapes.attempts as 'v1' | 'intermediate',
      },
      pages: prepared,
    } satisfies MigrationJournal;
    await writeMigrationJournal(journalPath, journal);
  }

  const newProblemProperties = addedProperties(sources.shapes.problems, PROBLEMS_PROPERTIES, [
    'Topics',
    'Practice State',
    'Solved Streak',
  ]);
  if (newProblemProperties['Practice State']) {
    newProblemProperties['Practice State'] = { select: { options: STATE_OPTIONS } };
  }
  const newAttemptProperties = addedProperties(sources.shapes.attempts, ATTEMPTS_PROPERTIES, [
    'Result',
    'Resulting State',
    'Resulting Solved Streak',
  ]);
  if (newAttemptProperties.Result) {
    newAttemptProperties.Result = { select: { options: RESULT_OPTIONS } };
  }
  if (newAttemptProperties['Resulting State']) {
    newAttemptProperties['Resulting State'] = { select: { options: STATE_OPTIONS } };
  }
  if (Object.keys(newProblemProperties).length > 0) {
    await notion.dataSources.update({
      data_source_id: manifest.problems.dataSourceId,
      properties: newProblemProperties,
    });
  }
  if (Object.keys(newAttemptProperties).length > 0) {
    await notion.dataSources.update({
      data_source_id: manifest.attempts.dataSourceId,
      properties: newAttemptProperties,
    });
  }

  if (sources.shapes.problems !== 'v2') {
    for (const page of prepared.problems) {
      await notion.pages.update({ page_id: page.id, properties: page.backfill });
    }
  }
  if (sources.shapes.attempts !== 'v2') {
    for (const page of prepared.attempts) {
      await notion.pages.update({ page_id: page.id, properties: page.backfill });
    }
  }

  await preserveAndVerifyLegacy(notion, prepared.problems);
  await preserveAndVerifyLegacy(notion, prepared.attempts);

  const beforeDeletionShapes = {
    problems: sources.shapes.problems === 'v2' ? ('v2' as const) : ('intermediate' as const),
    attempts: sources.shapes.attempts === 'v2' ? ('v2' as const) : ('intermediate' as const),
  };
  await verifyCurrentState(notion, manifest, prepared, beforeDeletionShapes);

  if (sources.shapes.problems !== 'v2') {
    await notion.dataSources.update({
      data_source_id: manifest.problems.dataSourceId,
      properties: Object.fromEntries(PROBLEM_LEGACY_FIELDS.map((name) => [name, null])),
    });
  }
  if (sources.shapes.attempts !== 'v2') {
    await notion.dataSources.update({
      data_source_id: manifest.attempts.dataSourceId,
      properties: Object.fromEntries(ATTEMPT_REMOVED_FIELDS.map((name) => [name, null])),
    });
  }

  await verifyCurrentState(notion, manifest, prepared, { problems: 'v2', attempts: 'v2' });
  await writeManifest(manifestPath, { ...manifest, version: 2 });
  await removeMigrationJournal(journalPath);
  return { mode: 'applied' as const, backupPath, counts, plannedOperations };
}
