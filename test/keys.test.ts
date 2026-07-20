import { describe, expect, it } from 'vitest';
import { attemptTitle, problemExternalKey } from '../src/shared/keys.js';

describe('problemExternalKey', () => {
  it('normalizes a LeetCode slug into a stable key', () => {
    expect(problemExternalKey(' Two-Sum ')).toBe('leetcode:two-sum');
  });

  it('rejects a value that is not a slug', () => {
    expect(() => problemExternalKey('Two Sum')).toThrow('Invalid LeetCode slug');
  });
});

describe('attemptTitle', () => {
  it('builds a readable deterministic title', () => {
    expect(attemptTitle('Two Sum', '2026-07-20T18:30:00.000Z')).toBe('Two Sum — 2026-07-20 18:30');
  });
});
