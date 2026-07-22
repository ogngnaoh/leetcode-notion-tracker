import 'dotenv/config';
import { Client } from '@notionhq/client';
import { z } from 'zod';
import { readManifest } from './io.js';
import { migrateNotionV3, type NotionV3MigrationClient } from './migrate-v3.js';
import { NOTION_API_VERSION } from './schema.js';

const EnvSchema = z.object({
  NOTION_TOKEN: z.string().min(1),
  NOTION_MANIFEST_PATH: z.string().default('build/notion-manifest.json'),
});

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply') || args.filter((arg) => arg === '--apply').length > 1) {
    throw new Error('Usage: npm run notion:migrate:v3 -- [--apply]');
  }
  const env = EnvSchema.parse(process.env);
  const manifest = await readManifest(env.NOTION_MANIFEST_PATH);
  const notion = new Client({ auth: env.NOTION_TOKEN, notionVersion: NOTION_API_VERSION });
  const result = await migrateNotionV3({
    notion: notion as unknown as NotionV3MigrationClient,
    manifest,
    manifestPath: env.NOTION_MANIFEST_PATH,
    backupDirectory: join(process.cwd(), 'build'),
    apply: args.includes('--apply'),
  });
  console.log(`Backup: ${result.backupPath}`);
  console.log(
    `Rows: ${result.counts.problems} Problems, ${result.counts.attempts} Attempts; ${result.counts.solvedProblems} solved Problems`,
  );
  console.log(
    `${result.mode}: ${result.plannedOperations.addProperties} properties to add, ${result.plannedOperations.backfillPages} pages to backfill, manifest v3`,
  );
}

import { join } from 'node:path';

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
