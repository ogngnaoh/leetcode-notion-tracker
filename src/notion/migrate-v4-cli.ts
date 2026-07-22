import 'dotenv/config';
import { join } from 'node:path';
import { Client } from '@notionhq/client';
import { z } from 'zod';
import { readManifest } from './io.js';
import { migrateNotionV4, type NotionV4MigrationClient } from './migrate-v4.js';
import { NOTION_API_VERSION } from './schema.js';

const EnvSchema = z.object({
  NOTION_TOKEN: z.string().min(1),
  NOTION_MANIFEST_PATH: z.string().default('build/notion-manifest.json'),
});

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--apply') || args.filter((arg) => arg === '--apply').length > 1) {
    throw new Error('Usage: npm run notion:migrate:v4 -- [--apply]');
  }
  const env = EnvSchema.parse(process.env);
  const manifest = await readManifest(env.NOTION_MANIFEST_PATH);
  const notion = new Client({ auth: env.NOTION_TOKEN, notionVersion: NOTION_API_VERSION });
  const result = await migrateNotionV4({
    notion: notion as unknown as NotionV4MigrationClient,
    manifest,
    manifestPath: env.NOTION_MANIFEST_PATH,
    backupDirectory: join(process.cwd(), 'build'),
    apply: args.includes('--apply'),
  });
  if (result.mode === 'no-op') {
    console.log('no-op: manifest and schema are already exact v4.');
    return;
  }
  console.log(`Backup: ${result.backupPath}`);
  console.log(
    `Rows: ${result.counts.problems} Problems, ${result.counts.attempts} Attempts; ` +
      `${result.counts.reclassifiedProblems} Problems and ${result.counts.reclassifiedAttempts} Attempts to reclassify`,
  );
  console.log(
    `${result.mode}: ${result.plannedOperations.renameFirstAttempt} property rename, ` +
      `${result.plannedOperations.backfillProblems} first-Attempt backfills, ` +
      `${result.plannedOperations.removeObsoleteOptions} obsolete option sets, manifest v4`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
