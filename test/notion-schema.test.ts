import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  ATTEMPTS_PROPERTIES,
  PROBLEMS_PROPERTIES,
  REQUIRED_ATTEMPTS_TYPES,
  REQUIRED_PROBLEMS_TYPES,
} from '../src/notion/schema.js';

function configuredType(value: object): string {
  return Object.keys(value)[0]!;
}

describe('Notion schema', () => {
  it('keeps every configured Problems property in the verifier contract', () => {
    for (const [name, config] of Object.entries(PROBLEMS_PROPERTIES)) {
      expect(REQUIRED_PROBLEMS_TYPES[name]).toBe(configuredType(config));
    }
    expect(REQUIRED_PROBLEMS_TYPES.Attempts).toBe('relation');
  });

  it('keeps every configured Attempts property in the verifier contract', () => {
    for (const [name, config] of Object.entries(ATTEMPTS_PROPERTIES)) {
      expect(REQUIRED_ATTEMPTS_TYPES[name]).toBe(configuredType(config));
    }
    expect(REQUIRED_ATTEMPTS_TYPES.Problem).toBe('relation');
  });

  it('defines the exact v4 property names and types', () => {
    expect(REQUIRED_PROBLEMS_TYPES).toEqual({
      Problem: 'title',
      'External Key': 'rich_text',
      Slug: 'rich_text',
      Number: 'number',
      URL: 'url',
      Difficulty: 'select',
      Topics: 'multi_select',
      'Practice State': 'select',
      'Solved Streak': 'number',
      'Next Review': 'date',
      'Last Attempt': 'date',
      'First Attempt': 'date',
      'Extension Managed': 'checkbox',
      Attempts: 'relation',
    });
    expect(REQUIRED_ATTEMPTS_TYPES).toEqual({
      Attempt: 'title',
      'Client Event ID': 'rich_text',
      Problem: 'relation',
      'Problem Key': 'rich_text',
      'Attempted At': 'date',
      'Source URL': 'url',
      Language: 'rich_text',
      Result: 'select',
      'Resulting State': 'select',
      'Resulting Solved Streak': 'number',
      'Resulting Next Review': 'date',
      'Extension Managed': 'checkbox',
      'Created Time': 'created_time',
    });
  });

  it('uses the required native colors for every v4 state and result option', () => {
    expect(PROBLEMS_PROPERTIES['Practice State'].select.options).toEqual([
      { name: 'New', color: 'gray' },
      { name: 'Needed help', color: 'yellow' },
      { name: 'Solved', color: 'green' },
      { name: 'Mastered', color: 'blue' },
    ]);
    expect(ATTEMPTS_PROPERTIES.Result.select.options).toEqual([
      { name: 'Needed help', color: 'yellow' },
      { name: 'Solved', color: 'green' },
    ]);
    expect(ATTEMPTS_PROPERTIES['Resulting State'].select.options).toEqual(
      PROBLEMS_PROPERTIES['Practice State'].select.options,
    );
  });

  it('exposes a dry-run-by-default v2 migration command', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(packageJson.scripts['notion:migrate:v2']).toBe('tsx src/notion/migrate-v2-cli.ts');
  });

  it('exposes v3, v4, and dry-run dashboard rollback commands', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    );
    expect(packageJson.scripts['notion:migrate:v3']).toBe('tsx src/notion/migrate-v3-cli.ts');
    expect(packageJson.scripts['notion:migrate:v4']).toBe('tsx src/notion/migrate-v4-cli.ts');
    expect(packageJson.scripts['notion:dashboard:rollback']).toBe(
      'tsx src/notion/dashboard-rollback-cli.ts',
    );
  });
});
