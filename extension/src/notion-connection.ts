import { z } from 'zod';
import type { Client } from '@notionhq/client';
import type { NotionManifest } from '../../src/shared/contract.js';
import {
  REQUIRED_ATTEMPTS_TYPES,
  REQUIRED_PROBLEMS_TYPES,
  RESULT_OPTIONS,
  STATE_OPTIONS,
} from '../../src/notion/schema.js';
import { DIFFICULTY_OPTIONS } from '../../src/notion/presentation.js';
import { verifyV2DataSource } from '../../src/notion/verify-data-source.js';
import type { ReviewPreferences } from './notion-protocol.js';

const uuid = z
  .string()
  .regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)
  .transform((value) => {
    const compact = value.replaceAll('-', '').toLowerCase();
    return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
  });
const ids = z.object({ databaseId: uuid, dataSourceId: uuid }).strict();
const manifestSchema = z
  .object({
    version: z.literal(4),
    notionApiVersion: z.literal('2026-03-11'),
    createdAt: z.string().datetime({ offset: true }),
    parentPageId: uuid,
    problems: ids,
    attempts: ids,
  })
  .strict()
  .refine((value) => {
    const values = [
      value.parentPageId,
      value.problems.databaseId,
      value.problems.dataSourceId,
      value.attempts.databaseId,
      value.attempts.dataSourceId,
    ].map((id) => id.toLowerCase());
    return new Set(values).size === values.length;
  });

const preferencesSchema = z
  .object({
    dailyNewProblemGoal: z.number().int().min(1).max(100),
    newProblemSessionStartedAt: z
      .string()
      .refine((v) => Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v)
      .optional(),
  })
  .strict();

export class ConnectionError extends Error {
  readonly code = 'SCHEMA_MISMATCH';
}

export function parseConnectionManifest(value: unknown): NotionManifest {
  const result = manifestSchema.safeParse(value);
  if (!result.success)
    throw new ConnectionError(
      'Import an exact version 4 tracker manifest with distinct database and data-source IDs.',
    );
  return result.data;
}

export function parseReviewPreferences(value: unknown): ReviewPreferences {
  const result = preferencesSchema.safeParse(value);
  if (!result.success)
    throw new ConnectionError(
      'Import valid review preferences or explicitly confirm the default goal and counting period.',
    );
  return {
    dailyNewProblemGoal: result.data.dailyNewProblemGoal,
    ...(result.data.newProblemSessionStartedAt
      ? { newProblemSessionStartedAt: result.data.newProblemSessionStartedAt }
      : {}),
  };
}

function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ConnectionError('Notion tracker schema could not be verified.');
  return value as Record<string, any>;
}

/** Verification deliberately has no mutation, presentation, provisioning or receipt-repair path. */
export async function verifyNotionConnection(
  notion: Client,
  manifest: NotionManifest,
): Promise<void> {
  const fetched = [];
  for (const tracker of [manifest.problems, manifest.attempts]) {
    const database = record(await notion.databases.retrieve({ database_id: tracker.databaseId }));
    const dataSource = record(
      await notion.dataSources.retrieve({ data_source_id: tracker.dataSourceId }),
    );
    if (
      database.object !== 'database' ||
      database.id !== tracker.databaseId ||
      database.archived ||
      database.in_trash ||
      !Array.isArray(database.data_sources) ||
      !database.data_sources.some((entry: any) => entry?.id === tracker.dataSourceId) ||
      dataSource.object !== 'data_source' ||
      dataSource.id !== tracker.dataSourceId ||
      dataSource.archived ||
      dataSource.in_trash ||
      dataSource.parent?.type !== 'database_id' ||
      dataSource.parent.database_id !== tracker.databaseId
    ) {
      throw new ConnectionError(
        'Notion tracker schema or database binding does not match this manifest.',
      );
    }
    fetched.push(dataSource);
  }
  try {
    verifyV2DataSource(fetched[0], 'Problems', REQUIRED_PROBLEMS_TYPES, {
      relation: { name: 'Attempts', dataSourceId: manifest.attempts.dataSourceId },
      selects: { 'Practice State': STATE_OPTIONS, Difficulty: DIFFICULTY_OPTIONS },
      optionalTypes: {
        'Grind Block': 'select',
        'Grind Day': 'select',
        'Grind Order': 'number',
        'Grind Done': 'checkbox',
        'Grind Open': 'formula',
        Solution: 'formula',
        'Grind Attempt': 'relation',
      },
    });
    verifyV2DataSource(fetched[1], 'Attempts', REQUIRED_ATTEMPTS_TYPES, {
      relation: { name: 'Problem', dataSourceId: manifest.problems.dataSourceId },
      selects: { Result: RESULT_OPTIONS, 'Resulting State': STATE_OPTIONS },
    });
  } catch {
    throw new ConnectionError(
      'Notion tracker schema is incompatible. Verify the version 4 properties and reciprocal relations.',
    );
  }
}
