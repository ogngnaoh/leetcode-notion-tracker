import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { Client } from '@notionhq/client';
import { z } from 'zod';
import { readManifest } from './io.js';
import {
  DIFFICULTY_OPTION_NAMES,
  NOTION_API_VERSION,
  REQUIRED_ATTEMPTS_TYPES,
  REQUIRED_PROBLEMS_TYPES,
  RESULT_OPTIONS,
  STATE_OPTIONS,
} from './schema.js';
import { verifyV2DataSource } from './verify-data-source.js';
export { verifyV2DataSource } from './verify-data-source.js';

const VerifyEnvSchema = z.object({
  NOTION_TOKEN: z.string().min(1),
  NOTION_MANIFEST_PATH: z.string().default('build/notion-manifest.json'),
});

async function main(): Promise<void> {
  const env = VerifyEnvSchema.parse(process.env);
  const manifest = await readManifest(env.NOTION_MANIFEST_PATH);
  if (manifest.version !== 2) {
    throw new Error('Notion manifest is version 1. Run npm run notion:migrate:v2 first.');
  }
  const notion = new Client({ auth: env.NOTION_TOKEN, notionVersion: NOTION_API_VERSION });

  const [problems, attempts] = await Promise.all([
    notion.dataSources.retrieve({ data_source_id: manifest.problems.dataSourceId }),
    notion.dataSources.retrieve({ data_source_id: manifest.attempts.dataSourceId }),
  ]);
  verifyV2DataSource(problems, 'LeetCode Problems', REQUIRED_PROBLEMS_TYPES, {
    relation: { name: 'Attempts', dataSourceId: manifest.attempts.dataSourceId },
    selects: { 'Practice State': STATE_OPTIONS },
    selectNames: { Difficulty: DIFFICULTY_OPTION_NAMES },
  });
  verifyV2DataSource(attempts, 'LeetCode Attempts', REQUIRED_ATTEMPTS_TYPES, {
    relation: { name: 'Problem', dataSourceId: manifest.problems.dataSourceId },
    selects: { Result: RESULT_OPTIONS, 'Resulting State': STATE_OPTIONS },
  });
  console.log(`✓ LeetCode Problems: ${Object.keys(REQUIRED_PROBLEMS_TYPES).length} properties`);
  console.log(`✓ LeetCode Attempts: ${Object.keys(REQUIRED_ATTEMPTS_TYPES).length} properties`);
  console.log('Notion tracker schema is compatible with this extension.');
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
