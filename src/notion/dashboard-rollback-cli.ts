import 'dotenv/config';
import { Client } from '@notionhq/client';
import { z } from 'zod';
import { readManifest } from './io.js';
import { NOTION_API_VERSION } from './schema.js';
import { rollbackDailyDashboard } from './dashboard-rollback.js';

const Env = z.object({
  NOTION_TOKEN: z.string().min(1),
  NOTION_MANIFEST_PATH: z.string().default('build/notion-manifest.json'),
});
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--apply') || args.filter((arg) => arg === '--apply').length > 1)
  throw new Error('Usage: npm run notion:dashboard:rollback -- [--apply]');
const env = Env.parse(process.env);
const manifest = await readManifest(env.NOTION_MANIFEST_PATH);
const notion = new Client({ auth: env.NOTION_TOKEN, notionVersion: NOTION_API_VERSION });
const result = await rollbackDailyDashboard({
  notion: notion as never,
  dataSourceId: manifest.problems.dataSourceId,
  apply: args.includes('--apply'),
});
console.log(`Backup: ${result.backupPath}`);
console.log(`${result.mode}: ${result.targets.length} managed dashboard views found.`);
