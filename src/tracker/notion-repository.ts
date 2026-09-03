import type { Client } from '@notionhq/client';
import { isFullPage } from '@notionhq/client/build/src/helpers.js';
import { z } from 'zod';
import { matchesNotionTimestamp } from './notion-timestamps.js';
import type { CaptureEvent, NotionManifest, ReviewState } from '../shared/contract.js';
import {
  AttemptResultSchema,
  DifficultySchema,
  PracticeStateSchema,
  ReviewStateSchema,
} from '../shared/contract.js';
import { attemptTitle } from '../shared/keys.js';
import { unicodeSafeTextChunks } from '../shared/text-chunks.js';
import type {
  CaptureRepository,
  ProblemRecord,
  ProblemUpdate,
  StoredAttempt,
} from './repository.js';
import type { DashboardRow } from './review.js';
import { LatestAttemptStore, RECEIPTS_LABEL, receiptBlock } from './latest-attempt.js';

function richText(content: string) {
  return [{ type: 'text' as const, text: { content } }];
}

function propertyMap(page: unknown): Record<string, any> {
  const candidate = page as Parameters<typeof isFullPage>[0];
  if (!isFullPage(candidate)) {
    throw new Error('Notion returned a partial page where a full page was required.');
  }
  return candidate.properties as Record<string, any>;
}

function requiredProperty(properties: Record<string, any>, name: string, type: string): any {
  const value = properties[name];
  if (value?.type !== type) throw new Error(`Notion property ${name} must be ${type}.`);
  return value;
}

function requiredTitle(properties: Record<string, any>, name: string): string {
  const value = requiredProperty(properties, name, 'title').title?.[0]?.plain_text;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Notion property ${name} must contain a title.`);
  }
  return value;
}

function requiredRichText(properties: Record<string, any>, name: string): string {
  const value = requiredProperty(properties, name, 'rich_text').rich_text?.[0]?.plain_text;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Notion property ${name} must contain text.`);
  }
  return value;
}

function nullableNumber(properties: Record<string, any>, name: string): number | null {
  const value = requiredProperty(properties, name, 'number').number;
  if (value !== null && typeof value !== 'number') {
    throw new Error(`Notion property ${name} must contain a number or null.`);
  }
  return value;
}

function requiredNumber(properties: Record<string, any>, name: string): number {
  const value = nullableNumber(properties, name);
  if (value === null) throw new Error(`Notion property ${name} must contain a number.`);
  return value;
}

function requiredSelect(properties: Record<string, any>, name: string): string {
  const value = requiredProperty(properties, name, 'select').select?.name;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Notion property ${name} must contain a selection.`);
  }
  return value;
}

function nullableDate(properties: Record<string, any>, name: string): string | null {
  const value = requiredProperty(properties, name, 'date').date;
  if (value === null) return null;
  if (typeof value?.start !== 'string') {
    throw new Error(`Notion property ${name} must contain a date or null.`);
  }
  return value.start;
}

function requiredDate(properties: Record<string, any>, name: string): string {
  const value = nullableDate(properties, name);
  if (value === null) throw new Error(`Notion property ${name} must contain a date.`);
  return value;
}

function requiredRelationId(properties: Record<string, any>, name: string): string {
  const value = requiredProperty(properties, name, 'relation').relation?.[0]?.id;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Notion property ${name} must contain a relation.`);
  }
  return value;
}

function requiredUrl(properties: Record<string, any>, name: string): string {
  const value = requiredProperty(properties, name, 'url').url;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Notion property ${name} must contain a URL.`);
  }
  return value;
}

function requiredMultiSelect(properties: Record<string, any>, name: string): string[] {
  const values = requiredProperty(properties, name, 'multi_select').multi_select;
  if (!Array.isArray(values) || values.some((item) => typeof item?.name !== 'string')) {
    throw new Error(`Notion property ${name} must contain selections.`);
  }
  return values.map((item) => item.name as string);
}

const IsoTimestampSchema = z.string().datetime({ offset: true });

function parseProblem(page: unknown): ProblemRecord {
  const candidate = page as Parameters<typeof isFullPage>[0];
  const properties = propertyMap(candidate);
  const lastAttempt = nullableDate(properties, 'Last Attempt');
  const firstAttempt = nullableDate(properties, 'First Attempt');
  const nextReview = nullableDate(properties, 'Next Review');
  const state = requiredProperty(properties, 'Practice State', 'select').select;
  const streak = nullableNumber(properties, 'Solved Streak');
  // Pre-seeded Grind rows have no review values until their first capture.
  // Never infer New if any progress is present, and never repair the row on read.
  const blankReview =
    state === null &&
    streak === null &&
    lastAttempt === null &&
    firstAttempt === null &&
    nextReview === null;
  const review = ReviewStateSchema.parse({
    practiceState: blankReview
      ? 'New'
      : PracticeStateSchema.parse(requiredSelect(properties, 'Practice State')),
    solvedStreak: blankReview ? 0 : requiredNumber(properties, 'Solved Streak'),
    nextReview,
  });
  if (lastAttempt !== null) IsoTimestampSchema.parse(lastAttempt);
  if (firstAttempt !== null) IsoTimestampSchema.parse(firstAttempt);
  return {
    pageId: candidate.id,
    externalKey: requiredRichText(properties, 'External Key'),
    slug: requiredRichText(properties, 'Slug'),
    title: requiredTitle(properties, 'Problem'),
    number: nullableNumber(properties, 'Number'),
    url: requiredUrl(properties, 'URL'),
    difficulty:
      requiredProperty(properties, 'Difficulty', 'select').select === null
        ? 'Unknown'
        : DifficultySchema.parse(requiredSelect(properties, 'Difficulty')),
    topics: requiredMultiSelect(properties, 'Topics'),
    ...review,
    lastAttempt,
    firstAttempt,
  };
}

function textChunks(
  value: string,
  chunkSize = 1900,
): Array<{ type: 'text'; text: { content: string } }> {
  return unicodeSafeTextChunks(value, chunkSize).map((content) => ({
    type: 'text',
    text: { content },
  }));
}

function pageChildren(event: CaptureEvent, review: ReviewState): Array<Record<string, unknown>> {
  return [
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: richText('Captured code') },
    },
    {
      object: 'block',
      type: 'code',
      code: {
        language: 'plain text',
        rich_text: textChunks(event.attempt.code),
      },
    },
    // Preserve precision in the existing receipt format when a date property
    // cannot round-trip it. Whole-minute captures need no extra receipt yet.
    ...(Date.parse(event.attempt.attemptedAt) % 60_000 === 0
      ? []
      : [
          {
            object: 'block',
            type: 'toggle',
            toggle: {
              rich_text: richText(RECEIPTS_LABEL),
              children: [
                receiptBlock({
                  version: 1,
                  clientEventId: event.clientEventId,
                  attemptedAt: event.attempt.attemptedAt,
                  result: event.attempt.result,
                  review,
                }),
              ],
            },
          },
        ]),
  ];
}

export class NotionCaptureRepository implements CaptureRepository {
  private store: LatestAttemptStore | undefined;
  private readonly problems = new Map<string, ProblemRecord>();

  captureSession(existing: StoredAttempt | null): CaptureRepository {
    return new NotionCaptureRepository(this.notion, this.manifest, { existing });
  }

  async completeCapture(): Promise<void> {
    await this.store?.complete();
  }

  private latestStore(): LatestAttemptStore {
    if (this.store) return this.store;
    const store = new LatestAttemptStore(
      this.notion,
      this.manifest,
      parseStoredAttempt,
      attemptProperties,
      Boolean(this.session),
    );
    if (this.session) this.store = store;
    return store;
  }

  async findLatestAttemptByProblemKey(problemKey: string): Promise<StoredAttempt | null> {
    return this.latestStore().latest(problemKey);
  }
  constructor(
    private readonly notion: Client,
    private readonly manifest: NotionManifest,
    private readonly session?: { existing: StoredAttempt | null },
  ) {}

  async loadDashboard(
    date: string,
    newProblemSessionStartedAt?: string,
  ): Promise<{ newProblemCount: number; due: DashboardRow[] }> {
    const queryAll = async (request: Record<string, unknown>): Promise<any[]> => {
      const results: any[] = [];
      const cursors = new Set<string>();
      const pageIds = new Set<string>();
      let pages = 0;
      let startCursor: string | undefined;
      do {
        const response = await this.notion.dataSources.query({
          data_source_id: this.manifest.problems.dataSourceId,
          page_size: 100,
          ...request,
          ...(startCursor ? { start_cursor: startCursor } : {}),
        } as never);
        if (
          !Array.isArray(response.results) ||
          typeof response.has_more !== 'boolean' ||
          response.results.some((page) => !isFullPage(page))
        ) {
          throw new Error('Notion returned an incomplete dashboard page.');
        }
        for (const page of response.results) {
          if (pageIds.has(page.id))
            throw new Error('Notion repeated a dashboard row during pagination.');
          pageIds.add(page.id);
        }
        results.push(...response.results);
        if (++pages > 100 || results.length > 5000)
          throw new Error('The dashboard is too large to load in one operation.');
        if (!response.has_more) break;
        if (
          typeof response.next_cursor !== 'string' ||
          !response.next_cursor ||
          cursors.has(response.next_cursor)
        ) {
          throw new Error('Notion returned incomplete dashboard pagination.');
        }
        startCursor = response.next_cursor;
        cursors.add(startCursor);
      } while (true);
      return results;
    };
    const [newProblems, duePages] = await Promise.all([
      queryAll({
        filter: {
          property: 'First Attempt',
          date: newProblemSessionStartedAt
            ? { after: newProblemSessionStartedAt }
            : { equals: date },
        },
      }),
      queryAll({
        filter: { property: 'Next Review', date: { on_or_before: date } },
        sorts: [
          { property: 'Next Review', direction: 'ascending' },
          { property: 'Problem', direction: 'ascending' },
        ],
      }),
    ]);
    const newProblemCount = newProblems.filter((page) => {
      const first = IsoTimestampSchema.parse(requiredDate(propertyMap(page), 'First Attempt'));
      return newProblemSessionStartedAt
        ? Date.parse(first) > Date.parse(newProblemSessionStartedAt)
        : first.slice(0, 10) === date;
    }).length;
    const due = duePages
      .map((page): DashboardRow => {
        const properties = propertyMap(page);
        const nextReview = ReviewStateSchema.shape.nextReview
          .unwrap()
          .parse(requiredDate(properties, 'Next Review'));
        return {
          title: requiredTitle(properties, 'Problem'),
          url: requiredUrl(properties, 'URL'),
          difficulty: DifficultySchema.parse(requiredSelect(properties, 'Difficulty')),
          practiceState: PracticeStateSchema.parse(requiredSelect(properties, 'Practice State')),
          solvedStreak: ReviewStateSchema.shape.solvedStreak.parse(
            requiredNumber(properties, 'Solved Streak'),
          ),
          nextReview: nextReview.slice(0, 10),
        };
      })
      .filter((row) => row.nextReview <= date);
    return { newProblemCount, due };
  }

  async findAttemptByEventId(
    clientEventId: string,
    problemKey?: string,
  ): Promise<StoredAttempt | null> {
    if (problemKey) {
      const receipt = await this.latestStore().find(clientEventId, problemKey);
      if (receipt) return receipt;
      // The exact-ID query already ran before the lock. Reuse only that result;
      // newly written receipts are found in the fresh, locked snapshot above.
      if (this.session) {
        const existing = this.session.existing;
        if (!existing || existing.problemKey !== problemKey) return null;
        if (!(await this.latestStore().page(problemKey)))
          throw new Error('Recorded capture is missing from the latest lookup; retry to recover.');
        return { ...existing, superseded: true };
      }
    }
    const response = await this.notion.dataSources.query({
      data_source_id: this.manifest.attempts.dataSourceId,
      page_size: 1,
      filter: {
        property: 'Client Event ID',
        rich_text: { equals: clientEventId },
      },
    });
    const page = response.results.find((result) => isFullPage(result));
    if (!page || !isFullPage(page)) return null;

    const record = parseStoredAttempt(page);
    if (problemKey) {
      const latest = await this.latestStore().page(problemKey);
      // A legacy historical page is a receipt only, never the canonical review state.
      return { ...record, superseded: latest !== null && latest.id !== page.id };
    }
    return record;
  }

  async findProblemByExternalKey(externalKey: string): Promise<ProblemRecord | null> {
    const response = await this.notion.dataSources.query({
      data_source_id: this.manifest.problems.dataSourceId,
      page_size: 1,
      filter: {
        property: 'External Key',
        rich_text: { equals: externalKey },
      },
    });
    const page = response.results.find((result) => isFullPage(result));
    return page && isFullPage(page) ? parseProblem(page) : null;
  }

  async findProblemByPageId(pageId: string): Promise<ProblemRecord | null> {
    if (this.session && this.problems.has(pageId)) return this.problems.get(pageId)!;
    const page = await this.notion.pages.retrieve({ page_id: pageId });
    const problem = isFullPage(page) ? parseProblem(page) : null;
    if (this.session && problem) this.problems.set(pageId, problem);
    return problem;
  }

  async createProblem(event: CaptureEvent, externalKey: string): Promise<ProblemRecord> {
    const page = await this.notion.pages.create({
      parent: {
        type: 'data_source_id',
        data_source_id: this.manifest.problems.dataSourceId,
      },
      properties: {
        Problem: { title: richText(event.problem.title) },
        'External Key': { rich_text: richText(externalKey) },
        Slug: { rich_text: richText(event.problem.slug) },
        Number: { number: event.problem.number ?? null },
        URL: { url: event.problem.url },
        Difficulty: { select: { name: event.problem.difficulty } },
        Topics: { multi_select: event.problem.topics.map((name) => ({ name })) },
        'Practice State': { select: { name: 'New' } },
        'Solved Streak': { number: 0 },
        'Next Review': { date: null },
        'Last Attempt': { date: null },
        'First Attempt': { date: null },
        'Extension Managed': { checkbox: true },
      },
    });

    return {
      pageId: page.id,
      externalKey,
      ...event.problem,
      number: event.problem.number ?? null,
      topics: [...event.problem.topics],
      practiceState: 'New',
      solvedStreak: 0,
      nextReview: null,
      lastAttempt: null,
      firstAttempt: null,
    };
  }

  async updateProblemMetadata(problemPageId: string, event: CaptureEvent): Promise<void> {
    await this.updateProblem(problemPageId, { event });
  }

  async updateProblem(problemPageId: string, update: ProblemUpdate): Promise<void> {
    const properties: Record<string, any> = {};
    const event = update.event;
    if (event)
      Object.assign(properties, {
        Problem: { title: richText(event.problem.title) },
        Slug: { rich_text: richText(event.problem.slug) },
        Number: { number: event.problem.number ?? null },
        URL: { url: event.problem.url },
        Difficulty: { select: { name: event.problem.difficulty } },
        Topics: { multi_select: event.problem.topics.map((name) => ({ name })) },
      });
    if (update.firstAttempt) properties['First Attempt'] = { date: { start: update.firstAttempt } };
    if (update.review) {
      const { attemptedAt, state: review } = update.review;
      Object.assign(properties, {
        'Practice State': { select: { name: review.practiceState } },
        'Solved Streak': { number: review.solvedStreak },
        'Next Review': review.nextReview ? { date: { start: review.nextReview } } : { date: null },
        'Last Attempt': { date: { start: attemptedAt } },
      });
    }
    if (!Object.keys(properties).length) return;
    const page = await this.notion.pages.update({ page_id: problemPageId, properties });
    if (this.session) {
      const problem = parseProblem(page);
      const expected = update.event?.problem;
      const review = update.review;
      if (
        problem.pageId !== problemPageId ||
        (update.firstAttempt &&
          !matchesNotionTimestamp(problem.firstAttempt, update.firstAttempt)) ||
        (review &&
          (!matchesNotionTimestamp(problem.lastAttempt, review.attemptedAt) ||
            problem.practiceState !== review.state.practiceState ||
            problem.solvedStreak !== review.state.solvedStreak ||
            problem.nextReview !== review.state.nextReview)) ||
        (expected &&
          (problem.externalKey !== `leetcode:${expected.slug}` ||
            problem.title !== expected.title ||
            problem.slug !== expected.slug ||
            problem.number !== (expected.number ?? null) ||
            problem.url !== expected.url ||
            problem.difficulty !== expected.difficulty ||
            JSON.stringify([...problem.topics].sort()) !==
              JSON.stringify([...expected.topics].sort())))
      ) {
        throw new Error('Unexpected Problem update response; retry to recover.');
      }
      this.problems.set(problemPageId, problem);
    }
  }

  async createAttempt(
    problem: ProblemRecord,
    event: CaptureEvent,
    externalKey: string,
    review: ReviewState,
  ): Promise<StoredAttempt> {
    return this.latestStore().save(problem.pageId, event, review, () =>
      this.createNewAttempt(problem, event, externalKey, review),
    );
  }

  private async createNewAttempt(
    problem: ProblemRecord,
    event: CaptureEvent,
    externalKey: string,
    review: ReviewState,
  ): Promise<StoredAttempt> {
    const page = await this.notion.pages.create({
      parent: {
        type: 'data_source_id',
        data_source_id: this.manifest.attempts.dataSourceId,
      },
      properties: attemptProperties(problem.pageId, event, review),
      children: pageChildren(event, review) as never,
    });

    return {
      pageId: page.id,
      problemPageId: problem.pageId,
      problemKey: externalKey,
      attemptedAt: event.attempt.attemptedAt,
      result: event.attempt.result,
      review,
    };
  }

  async applyReview(
    problemPageId: string,
    attemptedAt: string,
    review: ReviewState,
  ): Promise<void> {
    await this.updateProblem(problemPageId, { review: { attemptedAt, state: review } });
  }

  async applyFirstAttempt(problemPageId: string, attemptedAt: string): Promise<void> {
    await this.updateProblem(problemPageId, { firstAttempt: attemptedAt });
  }
}

export function attemptProperties(problemId: string, event: CaptureEvent, review: ReviewState) {
  return {
    Attempt: { title: richText(attemptTitle(event.problem.title, event.attempt.attemptedAt)) },
    'Client Event ID': { rich_text: richText(event.clientEventId) },
    Problem: { relation: [{ id: problemId }] },
    'Problem Key': { rich_text: richText(`leetcode:${event.problem.slug}`) },
    'Attempted At': { date: { start: event.attempt.attemptedAt } },
    'Source URL': { url: event.problem.url },
    Language: { rich_text: richText(event.attempt.language) },
    Result: { select: { name: event.attempt.result } },
    'Resulting State': { select: { name: review.practiceState } },
    'Resulting Solved Streak': { number: review.solvedStreak },
    'Resulting Next Review': review.nextReview
      ? { date: { start: review.nextReview } }
      : { date: null },
    'Extension Managed': { checkbox: true },
  };
}

export function parseStoredAttempt(page: any): StoredAttempt {
  try {
    const properties = propertyMap(page);
    const attemptedAt = IsoTimestampSchema.parse(requiredDate(properties, 'Attempted At'));
    const review = ReviewStateSchema.parse({
      practiceState: requiredSelect(properties, 'Resulting State'),
      solvedStreak: requiredNumber(properties, 'Resulting Solved Streak'),
      nextReview: nullableDate(properties, 'Resulting Next Review'),
    });
    return {
      pageId: page.id,
      problemPageId: requiredRelationId(properties, 'Problem'),
      problemKey: requiredRichText(properties, 'Problem Key'),
      attemptedAt,
      result: AttemptResultSchema.parse(requiredSelect(properties, 'Result')),
      review,
    };
  } catch {
    throw new Error(
      `Attempt ${page.id} is missing or invalid extension-managed idempotency fields.`,
    );
  }
}
