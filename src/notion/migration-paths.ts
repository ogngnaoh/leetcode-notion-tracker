import { join } from 'node:path';

export function migrationArtifactPaths(projectRoot: string): {
  backupDirectory: string;
  journalPath: string;
} {
  return {
    backupDirectory: join(projectRoot, 'build', 'notion-v2-backups'),
    journalPath: join(projectRoot, 'build', 'notion-v2-journal.json'),
  };
}
