import { readFile } from 'node:fs/promises';
import { Client } from '@notionhq/client';
import { NotionManifestSchema, type NotionManifest } from '../shared/contract.js';
import { NOTION_API_VERSION } from '../notion/schema.js';
import { NotionCaptureRepository as PortableRepository } from '../tracker/notion-repository.js';
export { attemptProperties, parseStoredAttempt } from '../tracker/notion-repository.js';

export async function loadNotionManifest(path: string): Promise<NotionManifest> {
  return NotionManifestSchema.parse(JSON.parse(await readFile(path, 'utf8')));
}

export class NotionCaptureRepository extends PortableRepository {
  static async create(token: string, manifestPath: string): Promise<NotionCaptureRepository> {
    const manifest = await loadNotionManifest(manifestPath);
    if (manifest.version !== 4)
      throw new Error('Run npm run notion:migrate:v4 before starting the bridge.');
    return new NotionCaptureRepository(
      new Client({ auth: token, notionVersion: NOTION_API_VERSION }),
      manifest,
    );
  }
}
