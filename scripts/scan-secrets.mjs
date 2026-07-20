import { execFile } from 'node:child_process';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const patterns = [
  { name: 'Notion token', regex: /\bntn_[A-Za-z0-9_-]{20,}\b/g },
  { name: 'legacy Notion secret', regex: /\bsecret_[A-Za-z0-9_-]{20,}\b/g },
];

async function filesUnder(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function gitFileNames(repositoryRoot) {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', repositoryRoot, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { encoding: 'utf8' },
  );
  return stdout.split('\0').filter(Boolean);
}

function sourceLocation(content, offset) {
  const before = content.slice(0, offset);
  const lastNewline = before.lastIndexOf('\n');
  return {
    line: before.split('\n').length,
    column: offset - lastNewline,
  };
}

export async function scanRepository(repositoryRoot) {
  const resolvedRoot = resolve(repositoryRoot);
  const gitFiles = await gitFileNames(resolvedRoot);
  const builtFiles = (await filesUnder(join(resolvedRoot, 'dist', 'extension'))).map((file) =>
    relative(resolvedRoot, file),
  );
  const files = [...new Set([...gitFiles, ...builtFiles])];
  const findings = [];

  for (const file of files) {
    let fileInfo;
    try {
      fileInfo = await lstat(join(resolvedRoot, file));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (!fileInfo.isFile()) continue;

    let content;
    try {
      content = await readFile(join(resolvedRoot, file), 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    for (const pattern of patterns) {
      for (const match of content.matchAll(pattern.regex)) {
        findings.push({
          type: pattern.name,
          file,
          ...sourceLocation(content, match.index ?? 0),
        });
      }
    }
  }

  return findings;
}

async function runCli() {
  const findings = await scanRepository(root);
  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`${finding.type} in ${finding.file} at ${finding.line}:${finding.column}`);
    }
    process.exitCode = 1;
  } else {
    console.log('No Notion-token-shaped values found in Git files or dist/extension.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runCli();
}
