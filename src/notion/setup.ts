import 'dotenv/config';
import { access } from 'node:fs/promises';
import { Client, isFullDatabase } from '@notionhq/client';
import { z } from 'zod';
import type { NotionManifest } from '../shared/contract.js';
import { writeManifest } from './io.js';
import { ATTEMPTS_PROPERTIES, NOTION_API_VERSION, PROBLEMS_PROPERTIES } from './schema.js';

const SetupEnvSchema = z.object({
  NOTION_TOKEN: z.string().min(1),
  NOTION_PARENT_PAGE_ID: z.string().min(1),
  NOTION_MANIFEST_PATH: z.string().default('build/notion-manifest.json'),
});

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createDatabase(
  notion: Client,
  parentPageId: string,
  title: string,
  properties: Record<string, unknown>,
): Promise<{ databaseId: string; dataSourceId: string }> {
  const created = await notion.databases.create({
    parent: { type: 'page_id', page_id: parentPageId },
    title: [{ type: 'text', text: { content: title } }],
    description: [
      {
        type: 'text',
        text: { content: 'Managed by the personal LeetCode tracker.' },
      },
    ],
    is_inline: false,
    initial_data_source: {
      properties: properties as never,
    },
  });

  const database = isFullDatabase(created)
    ? created
    : await notion.databases.retrieve({ database_id: created.id });
  if (!isFullDatabase(database) || database.data_sources.length === 0) {
    throw new Error(`Notion did not return a data source for ${title}.`);
  }

  return {
    databaseId: database.id,
    dataSourceId: database.data_sources[0]!.id,
  };
}

async function main(): Promise<void> {
  const env = SetupEnvSchema.parse(process.env);
  if (await fileExists(env.NOTION_MANIFEST_PATH)) {
    throw new Error(
      `Refusing to create duplicate databases because ${env.NOTION_MANIFEST_PATH} already exists. ` +
        'Run npm run notion:verify, or delete the manifest only after manually removing the old databases.',
    );
  }

  const notion = new Client({
    auth: env.NOTION_TOKEN,
    notionVersion: NOTION_API_VERSION,
  });

  console.log('Creating LeetCode Problems…');
  const problems = await createDatabase(
    notion,
    env.NOTION_PARENT_PAGE_ID,
    'LeetCode Problems',
    PROBLEMS_PROPERTIES,
  );

  console.log('Creating LeetCode Attempts…');
  const attempts = await createDatabase(
    notion,
    env.NOTION_PARENT_PAGE_ID,
    'LeetCode Attempts',
    ATTEMPTS_PROPERTIES,
  );

  console.log('Adding the Attempts → Problem relation…');
  await notion.dataSources.update({
    data_source_id: attempts.dataSourceId,
    properties: {
      Problem: {
        relation: {
          data_source_id: problems.dataSourceId,
          dual_property: {
            synced_property_name: 'Attempts',
          },
        },
      },
    },
  });

  const manifest: NotionManifest = {
    version: 2,
    notionApiVersion: NOTION_API_VERSION,
    createdAt: new Date().toISOString(),
    parentPageId: env.NOTION_PARENT_PAGE_ID,
    problems,
    attempts,
  };
  await writeManifest(env.NOTION_MANIFEST_PATH, manifest);

  console.log(`Created both databases and wrote ${env.NOTION_MANIFEST_PATH}.`);
  console.log('Next: npm run notion:verify');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
