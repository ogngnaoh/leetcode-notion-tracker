import 'dotenv/config';
import { Client, LogLevel } from '@notionhq/client';
import { chmod, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readManifest, writeJsonAtomic } from './io.js';
import {
  inventoryLatestAttempts,
  updateGrindLink,
  updateGrindAliasLinks,
} from './latest-attempt-maintenance.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((arg) => arg !== '--apply-grind-link')) {
    throw new Error(
      'Usage: npm run notion:latest -- [--apply-grind-link]. This command never trashes pages.',
    );
  }
  if (!process.env.NOTION_TOKEN) throw new Error('NOTION_TOKEN is required.');
  const manifest = await readManifest(
    process.env.NOTION_MANIFEST_PATH ?? 'build/notion-manifest.json',
  );
  const notion = new Client({
    auth: process.env.NOTION_TOKEN,
    notionVersion: manifest.notionApiVersion,
    logLevel: LogLevel.ERROR,
    logger: () => {},
  });
  console.log(
    'Reading all Problems, Attempts and nested Attempt page contents; no pages will be removed.',
  );
  const snapshot = await inventoryLatestAttempts(notion, manifest);
  const backupPath = resolve('build', `notion-latest-preview-${Date.now()}.json`);
  await writeJsonAtomic(backupPath, snapshot);
  await chmod(backupPath, 0o600);
  const digest = createHash('sha256')
    .update(await readFile(backupPath))
    .digest('hex');
  console.log(`Backup: ${backupPath}\nSHA-256: ${digest}`);
  console.log(
    `Attempts: ${snapshot.plan.attemptCount}; retain: ${snapshot.plan.problemCount}; older candidates: ${snapshot.plan.trashCount}`,
  );
  for (const group of snapshot.plan.groups.filter((g) => g.trashPageIds.length)) {
    console.log(
      `${group.problemKey}: keep ${group.keepPageId}; older pages: ${group.trashPageIds.length}`,
    );
  }
  for (const blocker of snapshot.plan.blockers) console.log(`BLOCKER: ${blocker}`);
  for (const warning of snapshot.plan.warnings) console.log(`NOTE: ${warning}`);
  console.log(`Grind-only rows needing a solution link: ${snapshot.plan.aliasLinks.length}`);
  if (args.includes('--apply-grind-link')) {
    if (snapshot.plan.blockers.length)
      throw new Error('Resolve inventory blockers before changing Grind.');
    await updateGrindLink(notion, manifest.problems.dataSourceId, snapshot.problemsSource);
    await updateGrindAliasLinks(notion, snapshot);
    console.log(
      'Updated and verified Grind solution links. Historical Attempts, canonical relations, checkboxes and buttons are untouched.',
    );
  }
}

main().catch((error: unknown) => {
  // Never log SDK request bodies, headers, credentials or captured code.
  console.error(error instanceof Error ? error.message : 'Latest-attempt maintenance failed.');
  process.exitCode = 1;
});
