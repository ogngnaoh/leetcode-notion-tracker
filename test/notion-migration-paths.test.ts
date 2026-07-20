import { describe, expect, it } from 'vitest';
import { migrationArtifactPaths } from '../src/notion/migration-paths.js';

describe('migrationArtifactPaths', () => {
  it('keeps backups and the journal in project build regardless of manifest location', () => {
    expect(migrationArtifactPaths('/project')).toEqual({
      backupDirectory: '/project/build/notion-v2-backups',
      journalPath: '/project/build/notion-v2-journal.json',
    });
  });
});
