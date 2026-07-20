import { readFile } from 'node:fs/promises';
import { Client, isFullPage } from '@notionhq/client';
import type { CaptureEvent, NotionManifest, ReviewState } from '../shared/contract.js';
import { NotionManifestSchema } from '../shared/contract.js';
import { attemptTitle } from '../shared/keys.js';
import { NOTION_API_VERSION } from '../notion/schema.js';
import type { CaptureRepository, ProblemRecord, StoredAttempt } from './repository.js';

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

function getRichText(properties: Record<string, any>, name: string): string | null {
  const value = properties[name];
  return value?.type === 'rich_text' ? (value.rich_text?.[0]?.plain_text ?? null) : null;
}

function getNumber(properties: Record<string, any>, name: string): number | null {
  const value = properties[name];
  return value?.type === 'number' ? (value.number ?? null) : null;
}

function getSelect(properties: Record<string, any>, name: string): string | null {
  const value = properties[name];
  return value?.type === 'select' ? (value.select?.name ?? null) : null;
}

function getDate(properties: Record<string, any>, name: string): string | null {
  const value = properties[name];
  return value?.type === 'date' ? (value.date?.start ?? null) : null;
}

function getRelationId(properties: Record<string, any>, name: string): string | null {
  const value = properties[name];
  return value?.type === 'relation' ? (value.relation?.[0]?.id ?? null) : null;
}

function textChunks(
  value: string,
  chunkSize = 1900,
): Array<{ type: 'text'; text: { content: string } }> {
  const chunks: Array<{ type: 'text'; text: { content: string } }> = [];
  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push({ type: 'text', text: { content: value.slice(index, index + chunkSize) } });
  }
  return chunks.length > 0 ? chunks : [{ type: 'text', text: { content: '' } }];
}

function pageChildren(event: CaptureEvent): Array<Record<string, unknown>> {
  const children: Array<Record<string, unknown>> = [
    {
      object: 'block',
      type: 'heading_2',
      heading_2: { rich_text: richText('Reflection') },
    },
    {
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: richText(event.attempt.notes || 'No reflection recorded.') },
    },
  ];

  if (event.attempt.code) {
    children.push(
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
    );
  }
  return children;
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

    const properties = propertyMap(page);
    const problemPageId = getRelationId(properties, 'Problem');
    const mastery = getSelect(properties, 'Resulting Mastery');
    const attemptedAt = getDate(properties, 'Attempted At');
    if (!problemPageId || !mastery || !attemptedAt) {
      throw new Error(`Attempt ${page.id} is missing extension-managed idempotency fields.`);
    }

    return {
      pageId: page.id,
      problemPageId,
      attemptedAt,
      review: {
        mastery: mastery as ReviewState['mastery'],
        greenCount: getNumber(properties, 'Resulting Green Count') ?? 0,
        nextReview: getDate(properties, 'Resulting Next Review'),
      },
    };
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
    if (!page || !isFullPage(page)) return null;
    const properties = propertyMap(page);
    return {
      pageId: page.id,
      externalKey: getRichText(properties, 'External Key') ?? externalKey,
      greenCount: getNumber(properties, 'Green Count') ?? 0,
    };
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
        'Primary Pattern': {
          rich_text: richText(event.attempt.primaryPattern ?? ''),
        },
        Mastery: { select: { name: 'Unseen' } },
        'Green Count': { number: 0 },
        'Next Review': { date: null },
        'Last Attempt': { date: null },
        'Extension Managed': { checkbox: true },
      },
    });

    return {
      pageId: page.id,
      externalKey,
      greenCount: 0,
    };
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
        'Submission Result': { select: { name: event.attempt.submissionResult } },
        Outcome: { select: { name: event.attempt.outcome } },
        'Cold Attempt': { checkbox: event.attempt.coldAttempt },
        'Help Used': { select: { name: event.attempt.helpUsed } },
        'Failure Code': event.attempt.failureCode
          ? { select: { name: event.attempt.failureCode } }
          : { select: null },
        'Total Minutes': { number: event.attempt.totalMinutes ?? null },
        'Primary Pattern': {
          rich_text: richText(event.attempt.primaryPattern ?? ''),
        },
        Notes: { rich_text: richText(event.attempt.notes ?? '') },
        'Resulting Mastery': { select: { name: review.mastery } },
        'Resulting Green Count': { number: review.greenCount },
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
      attemptedAt: event.attempt.attemptedAt,
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
        Mastery: { select: { name: review.mastery } },
        'Green Count': { number: review.greenCount },
        'Next Review': review.nextReview ? { date: { start: review.nextReview } } : { date: null },
        'Last Attempt': { date: { start: attemptedAt } },
      },
    });
  }
}
