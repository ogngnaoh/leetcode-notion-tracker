import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { NotionManifestSchema, type NotionManifest } from '../shared/contract.js';

export async function readManifest(path: string): Promise<NotionManifest> {
  const raw = await readFile(path, 'utf8');
  return NotionManifestSchema.parse(JSON.parse(raw));
}

export async function writeManifest(path: string, manifest: NotionManifest): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export async function writeManifestAtomic(path: string, manifest: NotionManifest): Promise<void> {
  await writeJsonAtomic(path, manifest);
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  const temporaryPath = join(directory, `.${basename(path)}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
