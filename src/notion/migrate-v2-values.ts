import { unicodeSafeTextChunks } from '../shared/text-chunks.js';

export type UnknownRecord = Record<string, any>;
export type LegacyValue = string | number | boolean | string[] | null;

export interface PreparedPage {
  id: string;
  legacy: Record<string, LegacyValue>;
  backfill: Record<string, unknown>;
  expected: Record<string, LegacyValue>;
}

export const LEGACY_MARKER = 'Legacy v1 fields';
export const PROBLEM_LEGACY_FIELDS = ['Primary Pattern', 'Mastery', 'Green Count'] as const;
export const ATTEMPT_REMOVED_FIELDS = [
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
] as const;
const ATTEMPT_LEGACY_FIELDS = [...ATTEMPT_REMOVED_FIELDS, 'Resulting Next Review'] as const;

export function toV2State(value: string): string {
  const mapped: Record<string, string> = {
    Unseen: 'New',
    Red: 'Couldn’t solve',
    Yellow: 'Needed help',
    Green: 'Solved',
    Mastered: 'Mastered',
  };
  const result = mapped[value];
  if (!result) throw new Error(`Cannot migrate unknown v1 state ${JSON.stringify(value)}.`);
  return result;
}

function toV2Result(value: string): string {
  const result = toV2State(value);
  if (!['Couldn’t solve', 'Needed help', 'Solved'].includes(result)) {
    throw new Error(`Cannot migrate v1 Outcome ${JSON.stringify(value)}.`);
  }
  return result;
}

export function toSolvedStreak(state: string, greenCount: number | null): number {
  if (state === 'Mastered') return 5;
  if (state !== 'Green') return 0;
  const safeCount = typeof greenCount === 'number' && Number.isFinite(greenCount) ? greenCount : 0;
  return Math.min(4, Math.max(0, Math.trunc(safeCount)));
}

export function toCalendarDate(value: string | null): string | null {
  if (value === null) return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.exec(value);
  if (!match) throw new Error(`Cannot migrate invalid Notion date ${JSON.stringify(value)}.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  const validCalendarDate =
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day;
  if (!validCalendarDate || (value.includes('T') && Number.isNaN(Date.parse(value)))) {
    throw new Error(`Cannot migrate invalid Notion date ${JSON.stringify(value)}.`);
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

export function propertyValue(
  properties: Record<string, UnknownRecord>,
  name: string,
): LegacyValue {
  const property = properties[name];
  if (!property || typeof property.type !== 'string') {
    throw new Error(`Page is missing migration property ${name}.`);
  }
  switch (property.type) {
    case 'title':
    case 'rich_text':
      return (property[property.type] as UnknownRecord[])
        .map((item) => item.plain_text ?? item.text?.content ?? '')
        .join('');
    case 'select':
      return property.select?.name ?? null;
    case 'date':
      return property.date?.start ?? null;
    case 'multi_select':
      return (property.multi_select as UnknownRecord[]).map((item) => String(item.name));
    case 'relation':
      return (property.relation as UnknownRecord[]).map((item) => String(item.id));
    case 'number':
    case 'checkbox':
    case 'url':
    case 'created_time':
      return property[property.type] ?? null;
    default:
      throw new Error(`Unsupported migration property type ${property.type} for ${name}.`);
  }
}

function legacyValues(
  properties: Record<string, UnknownRecord>,
  fields: readonly string[],
): Record<string, LegacyValue> {
  return Object.fromEntries(fields.map((name) => [name, propertyValue(properties, name)]));
}

export function meaningful(value: LegacyValue): boolean {
  return value !== null && value !== '' && (!Array.isArray(value) || value.length > 0);
}

export function legacyBlockCount(pages: PreparedPage[]): number {
  return pages.filter((page) => Object.values(page.legacy).some(meaningful)).length;
}

function dateRequest(value: string | null): { date: { start: string } | null } {
  return value === null ? { date: null } : { date: { start: value } };
}

export function prepareProblem(page: {
  id: string;
  properties: Record<string, UnknownRecord>;
}): PreparedPage {
  const mastery = propertyValue(page.properties, 'Mastery');
  const greenCount = propertyValue(page.properties, 'Green Count');
  const nextReview = toCalendarDate(propertyValue(page.properties, 'Next Review') as string | null);
  const lastAttempt = propertyValue(page.properties, 'Last Attempt') as string | null;
  if (typeof mastery !== 'string') {
    throw new Error(`Problem ${page.id} has no migratable Mastery value.`);
  }
  if (greenCount !== null && typeof greenCount !== 'number') {
    throw new Error(`Problem ${page.id} has an invalid Green Count.`);
  }
  const state = toV2State(mastery);
  const streak = toSolvedStreak(mastery, greenCount);
  return {
    id: page.id,
    legacy: legacyValues(page.properties, PROBLEM_LEGACY_FIELDS),
    backfill: {
      Topics: { multi_select: [] },
      'Practice State': { select: { name: state } },
      'Solved Streak': { number: streak },
      'Next Review': dateRequest(nextReview),
      'Last Attempt': dateRequest(lastAttempt),
    },
    expected: {
      Topics: [],
      'Practice State': state,
      'Solved Streak': streak,
      'Next Review': nextReview,
      'Last Attempt': lastAttempt,
    },
  };
}

export function prepareAttempt(page: {
  id: string;
  properties: Record<string, UnknownRecord>;
}): PreparedPage {
  const outcome = propertyValue(page.properties, 'Outcome');
  const resultingMastery = propertyValue(page.properties, 'Resulting Mastery');
  const resultingGreenCount = propertyValue(page.properties, 'Resulting Green Count');
  const nextReview = toCalendarDate(
    propertyValue(page.properties, 'Resulting Next Review') as string | null,
  );
  if (typeof outcome !== 'string' || typeof resultingMastery !== 'string') {
    throw new Error(`Attempt ${page.id} has no migratable Outcome or Resulting Mastery.`);
  }
  if (resultingGreenCount !== null && typeof resultingGreenCount !== 'number') {
    throw new Error(`Attempt ${page.id} has an invalid Resulting Green Count.`);
  }
  const result = toV2Result(outcome);
  const state = toV2State(resultingMastery);
  const streak = toSolvedStreak(resultingMastery, resultingGreenCount);
  return {
    id: page.id,
    legacy: legacyValues(page.properties, ATTEMPT_LEGACY_FIELDS),
    backfill: {
      Result: { select: { name: result } },
      'Resulting State': { select: { name: state } },
      'Resulting Solved Streak': { number: streak },
      'Resulting Next Review': dateRequest(nextReview),
    },
    expected: {
      Result: result,
      'Resulting State': state,
      'Resulting Solved Streak': streak,
      'Resulting Next Review': nextReview,
    },
  };
}

function text(content: string) {
  return unicodeSafeTextChunks(content, 1_900).map((chunk) => ({
    type: 'text' as const,
    text: { content: chunk },
  }));
}

function serializeLegacyValue(value: LegacyValue): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

export function legacyChildren(
  legacy: Record<string, LegacyValue>,
  includeHeading = true,
  onlyLabels?: ReadonlySet<string>,
): Array<Record<string, unknown>> {
  return [
    ...(includeHeading
      ? [
          {
            object: 'block',
            type: 'heading_2',
            heading_2: { rich_text: text(LEGACY_MARKER) },
          },
        ]
      : []),
    ...Object.entries(legacy)
      .filter(([, value]) => meaningful(value))
      .filter(([label]) => !onlyLabels || onlyLabels.has(label))
      .map(([label, value]) => ({
        object: 'block',
        type: 'bulleted_list_item',
        bulleted_list_item: { rich_text: text(`${label}: ${serializeLegacyValue(value)}`) },
      })),
  ];
}

export function expectedLegacyLabels(legacy: Record<string, LegacyValue>): Map<string, string> {
  return new Map(
    Object.entries(legacy)
      .filter(([, value]) => meaningful(value))
      .map(([label, value]) => [label, `${label}: ${serializeLegacyValue(value)}`]),
  );
}

export function blockText(block: unknown): string {
  const candidate = block as UnknownRecord;
  const content = candidate?.[candidate.type]?.rich_text;
  if (!Array.isArray(content)) return '';
  return content.map((item) => item.plain_text ?? item.text?.content ?? '').join('');
}
