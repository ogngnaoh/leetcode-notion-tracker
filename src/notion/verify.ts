import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { Client } from '@notionhq/client';
import { z } from 'zod';
import { readManifest } from './io.js';
import {
  NOTION_API_VERSION,
  REQUIRED_ATTEMPTS_TYPES,
  REQUIRED_PROBLEMS_TYPES,
  RESULT_OPTIONS,
  STATE_OPTIONS,
} from './schema.js';
import { verifyV2DataSource } from './verify-data-source.js';
import {
  ATTEMPTS_DATABASE_PRESENTATION,
  ATTEMPTS_VIEW,
  DIFFICULTY_OPTIONS,
  PROBLEMS_ALL_VIEW,
  PROBLEMS_DATABASE_PRESENTATION,
  PROBLEMS_REVIEW_VIEW,
  propertyIds,
  verifyDatabasePresentation,
  verifyManagedView,
} from './presentation.js';
import { listAllViews, requireUniqueView, retrieveManagedView } from './views.js';
export { verifyV2DataSource } from './verify-data-source.js';

const VerifyEnvSchema = z.object({
  NOTION_TOKEN: z.string().min(1),
  NOTION_MANIFEST_PATH: z.string().default('build/notion-manifest.json'),
});

async function main(): Promise<void> {
  const env = VerifyEnvSchema.parse(process.env);
  const manifest = await readManifest(env.NOTION_MANIFEST_PATH);
  if (manifest.version !== 4) {
    throw new Error(
      manifest.version === 1
        ? 'Notion manifest is version 1. Run migrations v2, v3, then v4.'
        : manifest.version === 2
          ? 'Notion manifest is version 2. Run npm run notion:migrate:v3, then npm run notion:migrate:v4.'
          : 'Notion manifest is version 3. Run npm run notion:migrate:v4 first.',
    );
  }
  const notion = new Client({ auth: env.NOTION_TOKEN, notionVersion: NOTION_API_VERSION });

  const [problems, attempts, problemsDatabase, attemptsDatabase] = await Promise.all([
    notion.dataSources.retrieve({ data_source_id: manifest.problems.dataSourceId }),
    notion.dataSources.retrieve({ data_source_id: manifest.attempts.dataSourceId }),
    notion.databases.retrieve({ database_id: manifest.problems.databaseId }),
    notion.databases.retrieve({ database_id: manifest.attempts.databaseId }),
  ]);
  verifyV2DataSource(problems, 'LeetCode Problems', REQUIRED_PROBLEMS_TYPES, {
    relation: { name: 'Attempts', dataSourceId: manifest.attempts.dataSourceId },
    selects: { 'Practice State': STATE_OPTIONS, Difficulty: DIFFICULTY_OPTIONS },
  });
  verifyDatabasePresentation(problemsDatabase, 'LeetCode Problems', PROBLEMS_DATABASE_PRESENTATION);
  verifyDatabasePresentation(attemptsDatabase, 'LeetCode Attempts', ATTEMPTS_DATABASE_PRESENTATION);
  const [problemViewRefs, attemptViewRefs] = await Promise.all([
    listAllViews(notion, manifest.problems.dataSourceId),
    listAllViews(notion, manifest.attempts.dataSourceId),
  ]);
  const reviewRef = requireUniqueView(problemViewRefs, 'Review queue');
  const allRef = requireUniqueView(problemViewRefs, 'All problems');
  const recentRef = requireUniqueView(attemptViewRefs, 'Recent attempts');
  if (!reviewRef || !allRef || !recentRef)
    throw new Error('One or more managed views are missing.');
  const [review, all, recent] = await Promise.all([
    retrieveManagedView(notion, reviewRef.id),
    retrieveManagedView(notion, allRef.id),
    retrieveManagedView(notion, recentRef.id),
  ]);
  verifyManagedView(review, PROBLEMS_REVIEW_VIEW(propertyIds(problems)));
  verifyManagedView(all, PROBLEMS_ALL_VIEW(propertyIds(problems)));
  verifyManagedView(recent, ATTEMPTS_VIEW(propertyIds(attempts)));
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
