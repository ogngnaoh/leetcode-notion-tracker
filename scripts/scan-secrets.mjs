import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const ignoredDirectories = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);
const ignoredFiles = new Set(['package-lock.json']);
const textExtensions = new Set([
  '',
  '.css',
  '.env',
  '.example',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.sh',
  '.ts',
  '.yaml',
  '.yml',
]);
const patterns = [
  { name: 'Notion token', regex: /\bntn_[A-Za-z0-9_-]{20,}\b/g },
  { name: 'legacy Notion secret', regex: /\bsecret_[A-Za-z0-9_-]{20,}\b/g },
];

async function filesUnder(directory) {
  const entries = await readdir(directory);
  const files = [];
  for (const name of entries) {
    if (ignoredDirectories.has(name) || ignoredFiles.has(name)) continue;
    const path = join(directory, name);
    const info = await stat(path);
    if (info.isDirectory()) files.push(...(await filesUnder(path)));
    else if (textExtensions.has(extname(name)) || name.startsWith('.env')) files.push(path);
  }
  return files;
}

const findings = [];
for (const file of await filesUnder(root)) {
  const content = await readFile(file, 'utf8');
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern.regex)) {
      findings.push(`${pattern.name} in ${relative(root, file)} at offset ${match.index ?? 0}`);
    }
  }
}

if (findings.length > 0) {
  console.error(findings.join('\n'));
  process.exitCode = 1;
} else {
  console.log('No committed Notion-token-shaped values found.');
}
