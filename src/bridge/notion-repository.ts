import { readFile } from 'node:fs/promises';
import { Client, isFullPage } from '@notionhq/client';
import { z } from 'zod';
import type { CaptureEvent, NotionManifest, ReviewState } from '../shared/contract.js';
import {
  DifficultySchema,
  NotionManifestSchema,
  PracticeStateSchema,
  ReviewStateSchema,
} from '../shared/contract.js';
import { attemptTitle } from '../shared/keys.js';
import { unicodeSafeTextChunks } from '../shared/text-chunks.js';
import { NOTION_API_VERSION } from '../notion/schema.js';
import type { CaptureRepository, ProblemRecord, StoredAttempt } from './repository.js';
import type { DashboardRow } from './dashboard.js';

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
  const review = ReviewStateSchema.parse({
    practiceState: PracticeStateSchema.parse(requiredSelect(properties, 'Practice State')),
    solvedStreak: requiredNumber(properties, 'Solved Streak'),
    nextReview: nullableDate(properties, 'Next Review'),
  });
  const lastAttempt = nullableDate(properties, 'Last Attempt');
  const firstSolved = nullableDate(properties, 'First Solved');
  if (lastAttempt !== null) IsoTimestampSchema.parse(lastAttempt);
  if (firstSolved !== null) IsoTimestampSchema.parse(firstSolved);
  return {
    pageId: candidate.id,
    externalKey: requiredRichText(properties, 'External Key'),
    slug: requiredRichText(properties, 'Slug'),
    title: requiredTitle(properties, 'Problem'),
    number: nullableNumber(properties, 'Number'),
    url: requiredUrl(properties, 'URL'),
    difficulty: DifficultySchema.parse(requiredSelect(properties, 'Difficulty')),
    topics: requiredMultiSelect(properties, 'Topics'),
    ...review,
    lastAttempt,
    firstSolved,
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

function pageChildren(event: CaptureEvent): Array<Record<string, unknown>> {
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
  ];
}

export async function loadNotionManifest(path: string): Promise<NotionManifest> {
  const raw = await readFile(path, 'utf8');
  return NotionManifestSchema.parse(JSON.parse(raw));
}

export class NotionCaptureRepository implements CaptureRepository {
  constructor(
    private readonly notion: Client,
    private readonly manifest: NotionManifest,
  ) {}

  static async create(token: string, manifestPath: string): Promise<NotionCaptureRepository> {
    const manifest = await loadNotionManifest(manifestPath);
    const notion = new Client({ auth: token, notionVersion: NOTION_API_VERSION });
    return new NotionCaptureRepository(notion, manifest);
  }

  async loadDashboard(date: string): Promise<{ newSolveCount: number; due: DashboardRow[] }> {
    const queryAll = async (request: Record<string, unknown>): Promise<any[]> => {
      const results: any[] = [];
      let startCursor: string | undefined;
      do {
        const response = await this.notion.dataSources.query({
          data_source_id: this.manifest.problems.dataSourceId,
          page_size: 100,
          ...request,
          ...(startCursor ? { start_cursor: startCursor } : {}),
        } as never);
        results.push(...response.results);
        startCursor = response.next_cursor ?? undefined;
      } while (startCursor);
      return results;
    };
    const [solves, duePages] = await Promise.all([
      queryAll({ filter: { property: 'First Solved', date: { equals: date } } }),
      queryAll({
        filter: { property: 'Next Review', date: { on_or_before: date } },
        sorts: [
          { property: 'Next Review', direction: 'ascending' },
          { property: 'Problem', direction: 'ascending' },
        ],
      }),
    ]);
    const due = duePages.filter(isFullPage).map((page): DashboardRow => {
      const properties = propertyMap(page);
      const nextReview = requiredDate(properties, 'Next Review');
      return {
        title: requiredTitle(properties, 'Problem'),
        url: requiredUrl(properties, 'URL'),
        difficulty: DifficultySchema.parse(requiredSelect(properties, 'Difficulty')),
        practiceState: PracticeStateSchema.parse(requiredSelect(properties, 'Practice State')),
        solvedStreak: requiredNumber(properties, 'Solved Streak'),
        nextReview: nextReview.slice(0, 10),
      };
    });
    return { newSolveCount: solves.length, due };
  }

  async findAttemptByEventId(clientEventId: string): Promise<StoredAttempt | null> {
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

    try {
      const properties = propertyMap(page);
      const attemptedAt = requiredDate(properties, 'Attempted At');
      IsoTimestampSchema.parse(attemptedAt);
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
        result: z
          .enum(['Couldn’t solve', 'Needed help', 'Solved'])
          .parse(requiredSelect(properties, 'Result')),
        review,
      };
    } catch {
      throw new Error(
        `Attempt ${page.id} is missing or invalid extension-managed idempotency fields.`,
      );
    }
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
    const page = await this.notion.pages.retrieve({ page_id: pageId });
    return isFullPage(page) ? parseProblem(page) : null;
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
        'First Solved': { date: null },
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
      firstSolved: null,
    };
  }

  async updateProblemMetadata(problemPageId: string, event: CaptureEvent): Promise<void> {
    await this.notion.pages.update({
      page_id: problemPageId,
      properties: {
        Problem: { title: richText(event.problem.title) },
        Slug: { rich_text: richText(event.problem.slug) },
        Number: { number: event.problem.number ?? null },
        URL: { url: event.problem.url },
        Difficulty: { select: { name: event.problem.difficulty } },
        Topics: { multi_select: event.problem.topics.map((name) => ({ name })) },
      },
    });
  }

  async createAttempt(
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
      properties: {
        Attempt: { title: richText(attemptTitle(event.problem.title, event.attempt.attemptedAt)) },
        'Client Event ID': { rich_text: richText(event.clientEventId) },
        Problem: { relation: [{ id: problem.pageId }] },
        'Problem Key': { rich_text: richText(externalKey) },
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
      },
      children: pageChildren(event) as never,
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
    await this.notion.pages.update({
      page_id: problemPageId,
      properties: {
        'Practice State': { select: { name: review.practiceState } },
        'Solved Streak': { number: review.solvedStreak },
        'Next Review': review.nextReview ? { date: { start: review.nextReview } } : { date: null },
        'Last Attempt': { date: { start: attemptedAt } },
      },
    });
  }

  async applyFirstSolved(problemPageId: string, attemptedAt: string): Promise<void> {
    await this.notion.pages.update({
      page_id: problemPageId,
      properties: { 'First Solved': { date: { start: attemptedAt } } },
    });
  }
}
