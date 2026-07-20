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
});
