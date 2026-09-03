import { describe, expect, it } from 'vitest';
import {
  parseConnectionManifest,
  parseReviewPreferences,
  verifyNotionConnection,
} from '../extension/src/notion-connection.js';
import {
  REQUIRED_PROBLEMS_TYPES,
  REQUIRED_ATTEMPTS_TYPES,
  STATE_OPTIONS,
  RESULT_OPTIONS,
} from '../src/notion/schema.js';
import { DIFFICULTY_OPTIONS } from '../src/notion/presentation.js';

export const manifest = {
  version: 4,
  notionApiVersion: '2026-03-11',
  createdAt: '2026-09-03T00:00:00.000Z',
  parentPageId: '00000000-0000-4000-8000-000000000001',
  problems: {
    databaseId: '00000000-0000-4000-8000-000000000002',
    dataSourceId: '00000000-0000-4000-8000-000000000003',
  },
  attempts: {
    databaseId: '00000000-0000-4000-8000-000000000004',
    dataSourceId: '00000000-0000-4000-8000-000000000005',
  },
};

function dataSource(
  types: Record<string, string>,
  relation: string,
  target: string,
  options: Record<string, unknown>,
) {
  const properties = Object.fromEntries(
    Object.entries(types).map(([name, type]) => [name, { type }]),
  );
  properties[relation] = {
    type: 'relation',
    relation: { type: 'dual_property', data_source_id: target, dual_property: {} },
  } as never;
  for (const [name, values] of Object.entries(options))
    properties[name] = { type: 'select', select: { options: values } } as never;
  return { properties };
}

describe('read-only connection/import', () => {
  it('requires exact v4 UUID bindings and explicit validated preferences', () => {
    expect(parseConnectionManifest(manifest)).toEqual(manifest);
    for (const invalid of [
      { ...manifest, token: 'synthetic' },
      { ...manifest, version: 3 },
      { ...manifest, problems: manifest.attempts },
      { ...manifest, parentPageId: 'some-id' },
    ]) {
      expect(() => parseConnectionManifest(invalid)).toThrow();
    }
    const preferences = {
      dailyNewProblemGoal: 17,
      newProblemSessionStartedAt: '2026-09-01T02:03:04.567Z',
    };
    expect(parseReviewPreferences(preferences)).toEqual(preferences);
    expect(() => parseReviewPreferences(undefined)).toThrow();
    expect(() => parseReviewPreferences({ ...preferences, token: 'synthetic' })).toThrow();
    expect(() => parseReviewPreferences({ ...preferences, dailyNewProblemGoal: 101 })).toThrow();
  });
  it('validates only two databases and data sources without page writes or presentation APIs', async () => {
    const checked = parseConnectionManifest(manifest);
    const seen: string[] = [];
    const client = {
      databases: {
        retrieve: async ({ database_id }: { database_id: string }) => {
          seen.push(database_id);
          const tracker =
            database_id === manifest.problems.databaseId ? manifest.problems : manifest.attempts;
          return {
            object: 'database',
            id: database_id,
            data_sources: [{ id: tracker.dataSourceId }],
          };
        },
      },
      dataSources: {
        retrieve: async ({ data_source_id }: { data_source_id: string }) => {
          seen.push(data_source_id);
          const problems = data_source_id === manifest.problems.dataSourceId;
          return {
            object: 'data_source',
            id: data_source_id,
            parent: {
              type: 'database_id',
              database_id: problems ? manifest.problems.databaseId : manifest.attempts.databaseId,
            },
            ...dataSource(
              problems ? REQUIRED_PROBLEMS_TYPES : REQUIRED_ATTEMPTS_TYPES,
              problems ? 'Attempts' : 'Problem',
              problems ? manifest.attempts.dataSourceId : manifest.problems.dataSourceId,
              problems
                ? { 'Practice State': STATE_OPTIONS, Difficulty: DIFFICULTY_OPTIONS }
                : { Result: RESULT_OPTIONS, 'Resulting State': STATE_OPTIONS },
            ),
          };
        },
      },
    };
    await expect(verifyNotionConnection(client as never, checked)).resolves.toBeUndefined();
    expect(seen).toHaveLength(4);
    client.databases.retrieve = async () =>
      ({ object: 'database', id: 'wrong', data_sources: [] }) as never;
    await expect(verifyNotionConnection(client as never, checked)).rejects.toThrow('schema');
  });
});
