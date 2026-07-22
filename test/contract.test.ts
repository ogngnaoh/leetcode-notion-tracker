import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  AttemptResultSchema,
  CaptureEventSchema,
  NotionManifestSchema,
  PracticeStateSchema,
} from '../src/shared/contract.js';

function validCapture(): unknown {
  return {
    clientEventId: 'eb9fdc89-8098-4f76-9a68-26e94dc75fc6',
    problem: {
      slug: 'two-sum',
      title: 'Two Sum',
      number: 1,
      url: 'https://leetcode.com/problems/two-sum/',
      difficulty: 'Easy',
      topics: ['Array', 'Hash Table'],
    },
    attempt: {
      attemptedAt: '2026-07-20T08:30:00-04:00',
      attemptedOn: '2026-07-20',
      language: 'Python',
      code: 'def twoSum(nums, target):\n    return []',
      result: 'Solved',
    },
  };
}

describe('CaptureEventSchema v2', () => {
  it('keeps the public capture example on the exact v2 contract', async () => {
    const raw = await readFile(new URL('../examples/capture.json', import.meta.url), 'utf8');
    expect(CaptureEventSchema.parse(JSON.parse(raw))).toEqual(JSON.parse(raw));
  });

  it('accepts the exact v2 capture contract', () => {
    expect(CaptureEventSchema.parse(validCapture())).toEqual(validCapture());
  });

  it.each(['Needed help', 'Solved'])('accepts canonical result %s', (result) => {
    const capture = validCapture() as any;
    capture.attempt.result = result;
    expect(CaptureEventSchema.safeParse(capture).success).toBe(true);
  });

  it('rejects the removed Couldn’t solve result and practice state', () => {
    const capture = validCapture() as any;
    capture.attempt.result = 'Couldn’t solve';
    expect(CaptureEventSchema.safeParse(capture).success).toBe(false);
    expect(AttemptResultSchema.safeParse('Couldn’t solve').success).toBe(false);
    expect(PracticeStateSchema.safeParse('Couldn’t solve').success).toBe(false);
  });

  it('rejects a title that still includes the LeetCode problem number', () => {
    const capture = validCapture() as any;
    capture.problem.title = '1. Two Sum';
    expect(CaptureEventSchema.safeParse(capture).success).toBe(false);
  });

  it.each(['2026-02-29', '2026-2-01', '2026-04-31', '2026-07-20T00:00:00Z'])(
    'rejects invalid browser-local attemptedOn value %s',
    (attemptedOn) => {
      const capture = validCapture() as any;
      capture.attempt.attemptedOn = attemptedOn;
      expect(CaptureEventSchema.safeParse(capture).success).toBe(false);
    },
  );

  it('requires an attemptedAt timestamp with an offset', () => {
    const capture = validCapture() as any;
    capture.attempt.attemptedAt = '2026-07-20T08:30:00';
    expect(CaptureEventSchema.safeParse(capture).success).toBe(false);
  });

  it.each(['', '   ', 'x'.repeat(20_001)])('rejects invalid code', (code) => {
    const capture = validCapture() as any;
    capture.attempt.code = code;
    expect(CaptureEventSchema.safeParse(capture).success).toBe(false);
  });

  it('preserves the captured code exactly while validating it', () => {
    const capture = validCapture() as any;
    capture.attempt.code = '  def solve():\n    pass\n';
    expect(CaptureEventSchema.parse(capture).attempt.code).toBe(capture.attempt.code);
  });

  it('allows Unknown as a nonempty language', () => {
    const capture = validCapture() as any;
    capture.attempt.language = 'Unknown';
    expect(CaptureEventSchema.safeParse(capture).success).toBe(true);
  });

  it('rejects empty topic labels', () => {
    const capture = validCapture() as any;
    capture.problem.topics = ['Array', '  '];
    expect(CaptureEventSchema.safeParse(capture).success).toBe(false);
  });

  it.each([
    ['submissionResult', 'Accepted'],
    ['outcome', 'Green'],
    ['coldAttempt', true],
    ['helpUsed', 'None'],
    ['failureCode', null],
    ['totalMinutes', 12],
    ['primaryPattern', 'Hash map'],
    ['notes', 'One pass'],
  ])('rejects removed attempt field %s', (name, value) => {
    const capture = validCapture() as any;
    capture.attempt[name] = value;
    expect(CaptureEventSchema.safeParse(capture).success).toBe(false);
  });
});

describe('NotionManifestSchema', () => {
  const manifest = {
    notionApiVersion: '2026-03-11',
    createdAt: '2026-07-20T12:00:00.000Z',
    parentPageId: 'parent',
    problems: { databaseId: 'problems-db', dataSourceId: 'problems-source' },
    attempts: { databaseId: 'attempts-db', dataSourceId: 'attempts-source' },
  };

  it.each([1, 2, 3, 4])('accepts manifest version %s without weakening ID fields', (version) => {
    expect(NotionManifestSchema.parse({ ...manifest, version })).toEqual({ ...manifest, version });
  });

  it('rejects unknown versions and missing IDs', () => {
    expect(NotionManifestSchema.safeParse({ ...manifest, version: 5 }).success).toBe(false);
    expect(
      NotionManifestSchema.safeParse({
        ...manifest,
        version: 2,
        problems: { ...manifest.problems, databaseId: '' },
      }).success,
    ).toBe(false);
  });
});
