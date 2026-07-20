import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('scanRepository', () => {
  it('excludes ignored env files while scanning tracked files and dist/extension', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'leetcode-secret-scan-'));
    const trackedSecret = `ntn_${'A'.repeat(24)}`;
    const ignoredSecret = `ntn_${'B'.repeat(24)}`;
    const builtSecret = `secret_${'C'.repeat(24)}`;
    const trackedTextSecret = `secret_${'D'.repeat(24)}`;
    const builtMapSecret = `ntn_${'E'.repeat(24)}`;

    try {
      await mkdir(join(fixtureRoot, 'dist', 'extension'), { recursive: true });
      await writeFile(join(fixtureRoot, '.gitignore'), '.env\ndist/\n', 'utf8');
      await writeFile(join(fixtureRoot, '.env'), `NOTION_TOKEN=${ignoredSecret}\n`, 'utf8');
      await writeFile(
        join(fixtureRoot, 'tracked.ts'),
        `export const value = '${trackedSecret}';\n`,
      );
      await writeFile(join(fixtureRoot, 'tracked.txt'), trackedTextSecret, 'utf8');
      await writeFile(join(fixtureRoot, 'deleted.ts'), trackedSecret, 'utf8');
      await writeFile(join(fixtureRoot, 'dist', 'extension', 'bundle.js'), builtSecret, 'utf8');
      await writeFile(
        join(fixtureRoot, 'dist', 'extension', 'bundle.js.map'),
        builtMapSecret,
        'utf8',
      );
      await execFileAsync('git', ['init', fixtureRoot]);
      await execFileAsync('git', [
        '-C',
        fixtureRoot,
        'add',
        '.gitignore',
        'tracked.ts',
        'tracked.txt',
        'deleted.ts',
      ]);
      await rm(join(fixtureRoot, 'deleted.ts'));

      // @ts-expect-error The scanner is a JavaScript CLI module under test.
      const { scanRepository } = await import('../scripts/scan-secrets.mjs');
      const findings = await scanRepository(fixtureRoot);

      expect(findings).toHaveLength(4);
      expect(findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'Notion token', file: 'tracked.ts' }),
          expect.objectContaining({ type: 'legacy Notion secret', file: 'tracked.txt' }),
          expect.objectContaining({
            type: 'legacy Notion secret',
            file: 'dist/extension/bundle.js',
          }),
          expect.objectContaining({
            type: 'Notion token',
            file: 'dist/extension/bundle.js.map',
          }),
        ]),
      );
      expect(JSON.stringify(findings)).not.toContain(trackedSecret);
      expect(JSON.stringify(findings)).not.toContain(ignoredSecret);
      expect(JSON.stringify(findings)).not.toContain(builtSecret);
      expect(JSON.stringify(findings)).not.toContain(trackedTextSecret);
      expect(JSON.stringify(findings)).not.toContain(builtMapSecret);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
