import { createHash } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { NotionManifestSchema, type NotionManifest } from '../shared/contract.js';
import { writeJsonAtomic } from './io.js';
import { toCalendarDate, type LegacyValue, type PreparedPage } from './migrate-v2-values.js';

export interface MigrationJournal {
  version: 1;
  migration: 'notion-v1-to-v2';
  notionApiVersion: '2026-03-11';
  createdAt: string;
  manifest: NotionManifest;
  backupPath: string;
  backupSha256: string;
  originalShapes: { problems: 'v1' | 'intermediate'; attempts: 'v1' | 'intermediate' };
  pages: { problems: PreparedPage[]; attempts: PreparedPage[] };
}

const PROBLEM_LEGACY_KEYS = ['Primary Pattern', 'Mastery', 'Green Count'];
const ATTEMPT_LEGACY_KEYS = [
  'Submission Result',
  'Outcome',
  'Cold Attempt',
  'Help Used',
  'Failure Code',
  'Total Minutes',
  'Primary Pattern',
  'Notes',
  'Resulting Mastery',
  'Resulting Green Count',
  'Resulting Next Review',
];
const PROBLEM_EXPECTED_KEYS = [
  'Topics',
  'Practice State',
  'Solved Streak',
  'Next Review',
  'Last Attempt',
];
const ATTEMPT_EXPECTED_KEYS = [
  'Result',
  'Resulting State',
  'Resulting Solved Streak',
  'Resulting Next Review',
];
const STATES = ['New', 'Couldn’t solve', 'Needed help', 'Solved', 'Mastered'];
const RESULTS = ['Couldn’t solve', 'Needed help', 'Solved'];

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function validLegacyValue(value: unknown): value is LegacyValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (Array.isArray(value) && value.every((entry) => typeof entry === 'string'))
  );
}

function validCalendarDate(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string' || value.includes('T')) return false;
  try {
    return toCalendarDate(value) === value;
  } catch {
    return false;
  }
}

function validTimestamp(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' &&
      /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      !Number.isNaN(Date.parse(value)))
  );
}

function validLegacy(
  legacy: unknown,
  keys: readonly string[],
): legacy is Record<string, LegacyValue> {
  return (
    isRecord(legacy) && exactKeys(legacy, keys) && Object.values(legacy).every(validLegacyValue)
  );
}

function validProblemPage(page: unknown): page is PreparedPage {
  if (!isRecord(page) || !exactKeys(page, ['id', 'legacy', 'backfill', 'expected'])) return false;
  if (typeof page.id !== 'string' || !validLegacy(page.legacy, PROBLEM_LEGACY_KEYS)) return false;
  const expected = page.expected;
  if (!isRecord(expected) || !exactKeys(expected, PROBLEM_EXPECTED_KEYS)) return false;
  if (
    !Array.isArray(expected.Topics) ||
    expected.Topics.length !== 0 ||
    !STATES.includes(expected['Practice State']) ||
    !Number.isInteger(expected['Solved Streak']) ||
    expected['Solved Streak'] < 0 ||
    expected['Solved Streak'] > 5 ||
    !validCalendarDate(expected['Next Review']) ||
    !validTimestamp(expected['Last Attempt'])
  ) {
    return false;
  }
  const canonical = {
    Topics: { multi_select: [] },
    'Practice State': { select: { name: expected['Practice State'] } },
    'Solved Streak': { number: expected['Solved Streak'] },
    'Next Review': expected['Next Review']
      ? { date: { start: expected['Next Review'] } }
      : { date: null },
    'Last Attempt': expected['Last Attempt']
      ? { date: { start: expected['Last Attempt'] } }
      : { date: null },
  };
  return isRecord(page.backfill) && JSON.stringify(page.backfill) === JSON.stringify(canonical);
}

function validAttemptPage(page: unknown): page is PreparedPage {
  if (!isRecord(page) || !exactKeys(page, ['id', 'legacy', 'backfill', 'expected'])) return false;
  if (typeof page.id !== 'string' || !validLegacy(page.legacy, ATTEMPT_LEGACY_KEYS)) return false;
  const expected = page.expected;
  if (!isRecord(expected) || !exactKeys(expected, ATTEMPT_EXPECTED_KEYS)) return false;
  if (
    !RESULTS.includes(expected.Result) ||
    !STATES.includes(expected['Resulting State']) ||
    !Number.isInteger(expected['Resulting Solved Streak']) ||
    expected['Resulting Solved Streak'] < 0 ||
    expected['Resulting Solved Streak'] > 5 ||
    !validCalendarDate(expected['Resulting Next Review'])
  ) {
    return false;
  }
  const canonical = {
    Result: { select: { name: expected.Result } },
    'Resulting State': { select: { name: expected['Resulting State'] } },
    'Resulting Solved Streak': { number: expected['Resulting Solved Streak'] },
    'Resulting Next Review': expected['Resulting Next Review']
      ? { date: { start: expected['Resulting Next Review'] } }
      : { date: null },
  };
  return isRecord(page.backfill) && JSON.stringify(page.backfill) === JSON.stringify(canonical);
}

function parseJournal(value: unknown): MigrationJournal {
  const journal = value as Record<string, any>;
  if (
    !isRecord(journal) ||
    !exactKeys(journal, [
      'version',
      'migration',
      'notionApiVersion',
      'createdAt',
      'manifest',
      'backupPath',
      'backupSha256',
      'originalShapes',
      'pages',
    ]) ||
    journal.version !== 1 ||
    journal.migration !== 'notion-v1-to-v2' ||
    journal.notionApiVersion !== '2026-03-11' ||
    typeof journal.createdAt !== 'string' ||
    Number.isNaN(Date.parse(journal.createdAt)) ||
    !NotionManifestSchema.safeParse(journal.manifest).success ||
    journal.manifest.version !== 1 ||
    typeof journal.backupPath !== 'string' ||
    journal.backupPath.length === 0 ||
    typeof journal.backupSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(journal.backupSha256) ||
    !isRecord(journal.originalShapes) ||
    !exactKeys(journal.originalShapes, ['problems', 'attempts']) ||
    !['v1', 'intermediate'].includes(journal.originalShapes.problems) ||
    !['v1', 'intermediate'].includes(journal.originalShapes.attempts) ||
    !isRecord(journal.pages) ||
    !exactKeys(journal.pages, ['problems', 'attempts']) ||
    !Array.isArray(journal.pages.problems) ||
    !journal.pages.problems.every(validProblemPage) ||
    !Array.isArray(journal.pages.attempts) ||
    !journal.pages.attempts.every(validAttemptPage)
  ) {
    throw new Error('Invalid v2 migration journal.');
  }
  return journal as unknown as MigrationJournal;
}

export async function readMigrationJournal(path: string): Promise<MigrationJournal | null> {
  try {
    const raw = await readFile(path, 'utf8');
    try {
      return parseJournal(JSON.parse(raw));
    } catch {
      throw new Error('Invalid v2 migration journal.');
    }
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function validateJournalManifest(journal: MigrationJournal, manifest: NotionManifest): void {
  const same =
    journal.notionApiVersion === manifest.notionApiVersion &&
    journal.manifest.notionApiVersion === manifest.notionApiVersion &&
    journal.manifest.createdAt === manifest.createdAt &&
    journal.manifest.parentPageId === manifest.parentPageId &&
    journal.manifest.problems.databaseId === manifest.problems.databaseId &&
    journal.manifest.problems.dataSourceId === manifest.problems.dataSourceId &&
    journal.manifest.attempts.databaseId === manifest.attempts.databaseId &&
    journal.manifest.attempts.dataSourceId === manifest.attempts.dataSourceId;
  if (!same) throw new Error('The v2 migration journal does not match the current manifest.');
}

export async function validateJournalBackup(
  journal: MigrationJournal,
  backupDirectory: string,
): Promise<void> {
  const directory = resolve(backupDirectory);
  const backup = resolve(journal.backupPath);
  if (!backup.startsWith(`${directory}${sep}`)) {
    throw new Error(
      'The v2 migration journal backup path is outside the configured backup directory.',
    );
  }
  let raw: string;
  try {
    raw = await readFile(backup, 'utf8');
  } catch {
    throw new Error('The v2 migration journal original backup is missing.');
  }
  const digest = createHash('sha256').update(raw).digest('hex');
  if (digest !== journal.backupSha256) {
    throw new Error('The v2 migration backup SHA-256 does not match the journal.');
  }
  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid v2 migration backup content.');
  }
  const expectedPages = {
    problems: journal.pages.problems.map((page) => ({ id: page.id, legacy: page.legacy })),
    attempts: journal.pages.attempts.map((page) => ({ id: page.id, legacy: page.legacy })),
  };
  const valid =
    isRecord(parsed) &&
    exactKeys(parsed, [
      'migration',
      'createdAt',
      'dryRun',
      'manifest',
      'shapes',
      'counts',
      'pages',
    ]) &&
    parsed.migration === 'notion-v1-to-v2' &&
    parsed.createdAt === journal.createdAt &&
    parsed.dryRun === false &&
    JSON.stringify(parsed.manifest) === JSON.stringify(journal.manifest) &&
    JSON.stringify(parsed.shapes) === JSON.stringify(journal.originalShapes) &&
    JSON.stringify(parsed.counts) ===
      JSON.stringify({
        problems: journal.pages.problems.length,
        attempts: journal.pages.attempts.length,
      }) &&
    JSON.stringify(parsed.pages) === JSON.stringify(expectedPages);
  if (!valid) throw new Error('Invalid v2 migration backup content.');
}

export async function writeMigrationJournal(
  path: string,
  journal: MigrationJournal,
): Promise<void> {
  await writeJsonAtomic(path, journal);
}

export async function removeMigrationJournal(path: string): Promise<void> {
  await unlink(path).catch((error: any) => {
    if (error?.code !== 'ENOENT') throw error;
  });
}
