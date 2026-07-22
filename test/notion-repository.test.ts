import type { Client } from '@notionhq/client';
import { describe, expect, it, vi } from 'vitest';
import type { CaptureEvent, NotionManifest, ReviewState } from '../src/shared/contract.js';
import { NotionCaptureRepository } from '../src/bridge/notion-repository.js';

const manifest: NotionManifest = {
  version: 1,
  notionApiVersion: '2026-03-11',
  createdAt: '2026-07-20T12:00:00.000Z',
  parentPageId: 'parent',
  problems: { databaseId: 'problems-db', dataSourceId: 'problems-source' },
  attempts: { databaseId: 'attempts-db', dataSourceId: 'attempts-source' },
};

const event: CaptureEvent = {
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
    code: 'x'.repeat(2_100),
    result: 'Solved',
  },
};

const review: ReviewState = {
  practiceState: 'Solved',
  solvedStreak: 1,
  nextReview: '2026-07-21',
};

function fullPage(id: string, properties: Record<string, unknown>) {
  return { object: 'page', id, url: `https://notion.so/${id}`, properties };
}

function fakeNotion() {
  return {
    dataSources: { query: vi.fn() },
    pages: { create: vi.fn(), update: vi.fn(), retrieve: vi.fn() },
  };
}

function repository(fake: ReturnType<typeof fakeNotion>) {
  return new NotionCaptureRepository(fake as unknown as Client, manifest);
}

function problemRecord() {
  return {
    pageId: 'problem-1',
    externalKey: 'leetcode:two-sum',
    ...event.problem,
    number: event.problem.number ?? null,
    practiceState: 'New' as const,
    solvedStreak: 0,
    nextReview: null,
    lastAttempt: null,
    firstSolved: null,
  };
}

describe('NotionCaptureRepository v3 mapping', () => {
  it('creates a Problem with only canonical metadata and v3 review properties', async () => {
    const fake = fakeNotion();
    fake.pages.create.mockResolvedValue({ id: 'problem-1' });

    await repository(fake).createProblem(event, 'leetcode:two-sum');

    const request = fake.pages.create.mock.calls[0]![0];
    expect(request.properties).toEqual({
      Problem: { title: [{ type: 'text', text: { content: 'Two Sum' } }] },
      'External Key': {
        rich_text: [{ type: 'text', text: { content: 'leetcode:two-sum' } }],
      },
      Slug: { rich_text: [{ type: 'text', text: { content: 'two-sum' } }] },
      Number: { number: 1 },
      URL: { url: 'https://leetcode.com/problems/two-sum/' },
      Difficulty: { select: { name: 'Easy' } },
      Topics: { multi_select: [{ name: 'Array' }, { name: 'Hash Table' }] },
      'Practice State': { select: { name: 'New' } },
      'Solved Streak': { number: 0 },
      'Next Review': { date: null },
      'Last Attempt': { date: null },
      'First Solved': { date: null },
      'Extension Managed': { checkbox: true },
    });
  });

  it('updates canonical Problem metadata only through the explicit new-event operation', async () => {
    const fake = fakeNotion();
    fake.pages.update.mockResolvedValue({});

    await repository(fake).updateProblemMetadata('problem-1', event);

    expect(fake.pages.update).toHaveBeenCalledWith({
      page_id: 'problem-1',
      properties: {
        Problem: { title: [{ type: 'text', text: { content: 'Two Sum' } }] },
        Slug: { rich_text: [{ type: 'text', text: { content: 'two-sum' } }] },
        Number: { number: 1 },
        URL: { url: 'https://leetcode.com/problems/two-sum/' },
        Difficulty: { select: { name: 'Easy' } },
        Topics: { multi_select: [{ name: 'Array' }, { name: 'Hash Table' }] },
      },
    });
  });

  it('creates an Attempt with v2 properties and code-only page content', async () => {
    const fake = fakeNotion();
    fake.pages.create.mockResolvedValue({ id: 'attempt-1' });

    await repository(fake).createAttempt(problemRecord(), event, 'leetcode:two-sum', review);

    const request = fake.pages.create.mock.calls[0]![0];
    expect(Object.keys(request.properties)).toEqual([
      'Attempt',
      'Client Event ID',
      'Problem',
      'Problem Key',
      'Attempted At',
      'Source URL',
      'Language',
      'Result',
      'Resulting State',
      'Resulting Solved Streak',
      'Resulting Next Review',
      'Extension Managed',
    ]);
    expect(request.properties).toMatchObject({
      Problem: { relation: [{ id: 'problem-1' }] },
      Language: { rich_text: [{ type: 'text', text: { content: 'Python' } }] },
      Result: { select: { name: 'Solved' } },
      'Resulting State': { select: { name: 'Solved' } },
      'Resulting Solved Streak': { number: 1 },
      'Resulting Next Review': { date: { start: '2026-07-21' } },
      'Extension Managed': { checkbox: true },
    });
    expect(request.children).toHaveLength(2);
    expect(request.children[0]).toMatchObject({
      type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: 'Captured code' } }] },
    });
    expect(request.children[1]).toMatchObject({ type: 'code' });
    expect(request.children[1].code.rich_text.map((item: any) => item.text.content).join('')).toBe(
      event.attempt.code,
    );
  });

  it('does not split a non-BMP code point across Notion rich-text objects', async () => {
    const fake = fakeNotion();
    fake.pages.create.mockResolvedValue({ id: 'attempt-1' });
    const code = `${'x'.repeat(1_899)}😀tail`;

    await repository(fake).createAttempt(
      problemRecord(),
      { ...event, attempt: { ...event.attempt, code } },
      'leetcode:two-sum',
      review,
    );

    const chunks = fake.pages.create.mock.calls[0]![0].children[1].code.rich_text.map(
      (item: any) => item.text.content as string,
    );
    expect(chunks.join('')).toBe(code);
    expect(chunks.every((chunk: string) => !/[\uD800-\uDBFF]$/.test(chunk))).toBe(true);
    expect(chunks.every((chunk: string) => !/^[\uDC00-\uDFFF]/.test(chunk))).toBe(true);
  });

  it('reads all state and metadata needed for status and stale protection', async () => {
    const fake = fakeNotion();
    fake.dataSources.query.mockResolvedValue({
      results: [
        fullPage('problem-1', {
          Problem: { type: 'title', title: [{ plain_text: 'Two Sum' }] },
          'External Key': { type: 'rich_text', rich_text: [{ plain_text: 'leetcode:two-sum' }] },
          Slug: { type: 'rich_text', rich_text: [{ plain_text: 'two-sum' }] },
          Number: { type: 'number', number: 1 },
          URL: { type: 'url', url: 'https://leetcode.com/problems/two-sum/' },
          Difficulty: { type: 'select', select: { name: 'Easy' } },
          Topics: {
            type: 'multi_select',
            multi_select: [{ name: 'Array' }, { name: 'Hash Table' }],
          },
          'Practice State': { type: 'select', select: { name: 'Solved' } },
          'Solved Streak': { type: 'number', number: 3 },
          'Next Review': { type: 'date', date: { start: '2026-07-27' } },
          'Last Attempt': { type: 'date', date: { start: '2026-07-20T08:30:00-04:00' } },
          'First Solved': { type: 'date', date: { start: '2026-07-18T08:30:00-04:00' } },
        }),
      ],
    });

    await expect(repository(fake).findProblemByExternalKey('leetcode:two-sum')).resolves.toEqual({
      pageId: 'problem-1',
      externalKey: 'leetcode:two-sum',
      slug: 'two-sum',
      title: 'Two Sum',
      number: 1,
      url: 'https://leetcode.com/problems/two-sum/',
      difficulty: 'Easy',
      topics: ['Array', 'Hash Table'],
      practiceState: 'Solved',
      solvedStreak: 3,
      nextReview: '2026-07-27',
      lastAttempt: '2026-07-20T08:30:00-04:00',
      firstSolved: '2026-07-18T08:30:00-04:00',
    });
  });

  it('reads and validates a stored Attempt resulting review', async () => {
    const fake = fakeNotion();
    fake.dataSources.query.mockResolvedValue({
      results: [
        fullPage('attempt-1', {
          Problem: { type: 'relation', relation: [{ id: 'problem-1' }] },
          'Problem Key': {
            type: 'rich_text',
            rich_text: [{ plain_text: 'leetcode:two-sum' }],
          },
          'Attempted At': { type: 'date', date: { start: event.attempt.attemptedAt } },
          Result: { type: 'select', select: { name: 'Solved' } },
          'Resulting State': { type: 'select', select: { name: 'Solved' } },
          'Resulting Solved Streak': { type: 'number', number: 1 },
          'Resulting Next Review': { type: 'date', date: { start: '2026-07-21' } },
        }),
      ],
    });

    await expect(repository(fake).findAttemptByEventId(event.clientEventId)).resolves.toEqual({
      pageId: 'attempt-1',
      problemPageId: 'problem-1',
      problemKey: 'leetcode:two-sum',
      attemptedAt: event.attempt.attemptedAt,
      result: 'Solved',
      review,
    });

    fake.dataSources.query.mockResolvedValue({
      results: [
        fullPage('attempt-bad', {
          Problem: { type: 'relation', relation: [] },
          'Attempted At': { type: 'rich_text', rich_text: [] },
          'Resulting State': { type: 'select', select: { name: 'Legacy' } },
          'Resulting Solved Streak': { type: 'number', number: 1 },
          'Resulting Next Review': { type: 'date', date: null },
        }),
      ],
    });
    await expect(repository(fake).findAttemptByEventId(event.clientEventId)).rejects.toThrow(
      'missing or invalid extension-managed idempotency fields',
    );
  });

  it('applies only v2 review and Last Attempt properties', async () => {
    const fake = fakeNotion();
    fake.pages.update.mockResolvedValue({});

    await repository(fake).applyReview('problem-1', event.attempt.attemptedAt, review);

    expect(fake.pages.update).toHaveBeenCalledWith({
      page_id: 'problem-1',
      properties: {
        'Practice State': { select: { name: 'Solved' } },
        'Solved Streak': { number: 1 },
        'Next Review': { date: { start: '2026-07-21' } },
        'Last Attempt': { date: { start: event.attempt.attemptedAt } },
      },
    });
  });

  it('fully paginates daily solves and due reviews with exact filters and ordering', async () => {
    const fake = fakeNotion();
    const duePage = (id: string, title: string, date: string) =>
      fullPage(id, {
        Problem: { type: 'title', title: [{ plain_text: title }] },
        URL: { type: 'url', url: `https://leetcode.com/problems/${id}/` },
        Difficulty: { type: 'select', select: { name: 'Medium' } },
        'Practice State': { type: 'select', select: { name: 'Needed help' } },
        'Solved Streak': { type: 'number', number: 0 },
        'Next Review': { type: 'date', date: { start: date } },
      });
    fake.dataSources.query.mockImplementation(async (request: any) => {
      if (request.start_cursor === 's2')
        return { results: [{ id: 'solve-2' }], has_more: false, next_cursor: null };
      if (request.start_cursor === 'd2')
        return {
          results: [duePage('alpha', 'Alpha', '2026-07-20')],
          has_more: false,
          next_cursor: null,
        };
      if (request.filter.property === 'First Solved')
        return { results: [{ id: 'solve-1' }], has_more: true, next_cursor: 's2' };
      return {
        results: [duePage('zeta', 'Zeta', '2026-07-20')],
        has_more: true,
        next_cursor: 'd2',
      };
    });

    await expect(repository(fake).loadDashboard('2026-07-21')).resolves.toMatchObject({
      newSolveCount: 2,
      due: [{ title: 'Zeta' }, { title: 'Alpha' }],
    });
    expect(fake.dataSources.query.mock.calls.map(([request]) => request)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          filter: { property: 'First Solved', date: { equals: '2026-07-21' } },
        }),
        expect.objectContaining({ start_cursor: 's2' }),
        expect.objectContaining({
          filter: { property: 'Next Review', date: { on_or_before: '2026-07-21' } },
          sorts: [
            { property: 'Next Review', direction: 'ascending' },
            { property: 'Problem', direction: 'ascending' },
          ],
        }),
        expect.objectContaining({ start_cursor: 'd2' }),
      ]),
    );
  });
});
