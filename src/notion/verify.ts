import 'dotenv/config';
import { Client, isFullDataSource } from '@notionhq/client';
import { z } from 'zod';
import { readManifest } from './io.js';
import { NOTION_API_VERSION, REQUIRED_ATTEMPTS_TYPES, REQUIRED_PROBLEMS_TYPES } from './schema.js';

const VerifyEnvSchema = z.object({
  NOTION_TOKEN: z.string().min(1),
  NOTION_MANIFEST_PATH: z.string().default('build/notion-manifest.json'),
});

async function verifyDataSource(
  notion: Client,
  dataSourceId: string,
  label: string,
  expected: Record<string, string>,
): Promise<void> {
  const response = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  if (!isFullDataSource(response)) {
    throw new Error(`Notion returned only a partial ${label} data source.`);
  }

  const failures: string[] = [];
  for (const [name, type] of Object.entries(expected)) {
    const property = response.properties[name];
    if (!property) {
      failures.push(`${name}: missing`);
    } else if (property.type !== type) {
      failures.push(`${name}: expected ${type}, received ${property.type}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${label} schema mismatch:\n- ${failures.join('\n- ')}`);
  }
  console.log(`✓ ${label}: ${Object.keys(expected).length} required properties verified`);
}

async function main(): Promise<void> {
  const env = VerifyEnvSchema.parse(process.env);
  const manifest = await readManifest(env.NOTION_MANIFEST_PATH);
  const notion = new Client({ auth: env.NOTION_TOKEN, notionVersion: NOTION_API_VERSION });

  await verifyDataSource(
    notion,
    manifest.problems.dataSourceId,
    'LeetCode Problems',
    REQUIRED_PROBLEMS_TYPES,
  );
  await verifyDataSource(
    notion,
    manifest.attempts.dataSourceId,
    'LeetCode Attempts',
    REQUIRED_ATTEMPTS_TYPES,
  );
  console.log('Notion tracker schema is compatible with this extension.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
