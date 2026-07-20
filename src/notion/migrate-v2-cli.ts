import 'dotenv/config';
import { Client } from '@notionhq/client';
import { z } from 'zod';
import { readManifest } from './io.js';
import { migrateNotionV2, type NotionMigrationClient } from './migrate-v2.js';
import { migrationArtifactPaths } from './migration-paths.js';
import { NOTION_API_VERSION } from './schema.js';

const MigrationEnvSchema = z.object({
  NOTION_TOKEN: z.string().min(1),
  NOTION_MANIFEST_PATH: z.string().default('build/notion-manifest.json'),
});

async function main(): Promise<void> {
  const unexpected = process.argv.slice(2).filter((argument) => argument !== '--apply');
  const applyCount = process.argv.slice(2).filter((argument) => argument === '--apply').length;
  if (unexpected.length > 0 || applyCount > 1) {
    throw new Error('Usage: npm run notion:migrate:v2 -- [--apply]');
  }

  const env = MigrationEnvSchema.parse(process.env);
  const manifest = await readManifest(env.NOTION_MANIFEST_PATH);
  const notion = new Client({ auth: env.NOTION_TOKEN, notionVersion: NOTION_API_VERSION });
  const artifacts = migrationArtifactPaths(process.cwd());
  const result = await migrateNotionV2({
    notion: notion as unknown as NotionMigrationClient,
    manifest,
    manifestPath: env.NOTION_MANIFEST_PATH,
    backupDirectory: artifacts.backupDirectory,
    journalPath: artifacts.journalPath,
    apply: applyCount === 1,
  });

  console.log(`Backup: ${result.backupPath}`);
  console.log(
    `Rows: ${result.counts.problems} Problems, ${result.counts.attempts} Attempts; ` +
      `${result.counts.legacyBlocks} legacy sections`,
  );
  console.log(
    `${result.mode}: ${result.plannedOperations.addProperties} properties to add, ` +
      `${result.plannedOperations.backfillPages} pages to backfill, ` +
      `${result.plannedOperations.removeProperties} properties to remove, manifest v2`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
