import 'dotenv/config';
import { Client } from '@notionhq/client';
import { createHash } from 'node:crypto';
import { chmod, readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { resolve } from 'node:path';
import { readManifest, writeJsonAtomic } from './io.js';
import { applyLatestAttemptCleanup } from './latest-attempt-cleanup.js';

async function main() {
  const args = process.argv.slice(2);
  if (
    args.length !== 4 ||
    args[0] !== '--backup' ||
    args[2] !== '--sha256' ||
    !/^[a-f0-9]{64}$/.test(args[3]!)
  )
    throw new Error(
      'Requires an approved backup: npm run notion:latest:cleanup -- --backup <path> --sha256 <digest>',
    );
  const backupPath = resolve(args[1]!);
  const bytes = await readFile(backupPath);
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== args[3]) throw new Error('Backup SHA-256 mismatch; no Notion writes made.');
  const snapshot = JSON.parse(bytes.toString('utf8'));
  const manifest = await readManifest(
    process.env.NOTION_MANIFEST_PATH ?? 'build/notion-manifest.json',
  );
  if (!isDeepStrictEqual(manifest, snapshot.manifest))
    throw new Error('Backup does not match the current manifest.');
  if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN is required.');
  const auditPath = resolve('build', `notion-latest-cleanup-${Date.now()}.json`);
  const audit = {
    version: 1,
    startedAt: new Date().toISOString(),
    backupPath,
    sha256: digest,
    status: 'started',
  };
  await writeJsonAtomic(auditPath, audit);
  await chmod(auditPath, 0o600);
  console.log(`Using approved backup: ${backupPath}\nAudit: ${auditPath}`);
  console.log(
    'Checking exact backed-up targets and preserving receipts before moving older pages to Trash. Keep the bridge stopped.',
  );
  const notion = new Client({
    auth: process.env.NOTION_TOKEN,
    notionVersion: manifest.notionApiVersion,
    logger: () => {},
  });
  const result = await applyLatestAttemptCleanup(notion, snapshot);
  await writeJsonAtomic(auditPath, {
    ...audit,
    status: 'complete',
    completedAt: new Date().toISOString(),
    result,
  });
  await chmod(auditPath, 0o600);
  console.log(
    `Verified: ${result.retained} retained Attempts, ${result.totalTrashed} approved older pages in Trash (${result.newlyTrashed} moved this run).`,
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Cleanup failed; retain the backup and audit.',
  );
  process.exitCode = 1;
});
