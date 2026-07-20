import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { NotionManifestSchema, type NotionManifest } from '../shared/contract.js';

export async function readManifest(path: string): Promise<NotionManifest> {
  const raw = await readFile(path, 'utf8');
  return NotionManifestSchema.parse(JSON.parse(raw));
}

export async function writeManifest(path: string, manifest: NotionManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
