import type { Client } from '@notionhq/client';
import { isFullPage } from '@notionhq/client';
import { z } from 'zod';
import {
  CaptureEventSchema,
  AttemptResultSchema,
  ReviewStateSchema,
  type CaptureEvent,
  type NotionManifest,
  type ReviewState,
} from '../shared/contract.js';
import { unicodeSafeTextChunks } from '../shared/text-chunks.js';
import type { StoredAttempt } from './repository.js';

export const RECEIPTS_LABEL = 'LCTrack retry receipts — managed';
export const ReceiptSchema = z
  .object({
    version: z.literal(1),
    clientEventId: z.string().uuid(),
    attemptedAt: z.string().datetime({ offset: true }),
    result: AttemptResultSchema,
    review: ReviewStateSchema,
    pending: CaptureEventSchema.optional(),
  })
  .strict();
export type Receipt = z.infer<typeof ReceiptSchema>;

export function compareAttemptPages(a: any, b: any): number {
  return (
    Date.parse(b.properties['Attempted At'].date.start) -
      Date.parse(a.properties['Attempted At'].date.start) ||
    Date.parse(b.created_time ?? '1970-01-01T00:00:00Z') -
      Date.parse(a.created_time ?? '1970-01-01T00:00:00Z') ||
    a.id.localeCompare(b.id)
  );
}

export function richTextChunks(text: string) {
  const chunks = unicodeSafeTextChunks(text, 1900);
  if (chunks.length > 100) throw new Error('Managed Notion block exceeds the safe text limit.');
  return chunks.map((content) => ({ type: 'text' as const, text: { content } }));
}
export function blockText(block: any): string {
  return (block?.[block.type]?.rich_text ?? [])
    .map((r: any) => r.plain_text ?? r.text?.content ?? '')
    .join('');
}
export async function listBlocks(notion: Client, blockId: string): Promise<any[]> {
  const blocks: any[] = [];
  let cursor: string | undefined;
  do {
    const result = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    blocks.push(...result.results);
    if (result.has_more && !result.next_cursor)
      throw new Error('Incomplete Notion block pagination.');
    cursor = result.next_cursor ?? undefined;
  } while (cursor);
  return blocks;
}
export function receiptBlock(receipt: Receipt) {
  return {
    object: 'block' as const,
    type: 'code' as const,
    code: {
      language: 'json' as const,
      rich_text: richTextChunks(JSON.stringify(ReceiptSchema.parse(receipt))),
    },
  };
}

// Receipts contain no historical code. Only an unfinished write temporarily contains its payload.
export class LatestAttemptStore {
  private readonly pages = new Map<string, any>();
  private readonly states = new Map<
    string,
    {
      blocks: any[];
      container: any;
      receipts: Array<{ id: string; value: Receipt }>;
    }
  >();
  private readonly completions = new Map<string, Receipt>();
  constructor(
    private notion: Client,
    private manifest: NotionManifest,
    private parse: (page: any) => StoredAttempt,
    private properties: (
      problemId: string,
      event: CaptureEvent,
      review: ReviewState,
    ) => Record<string, any>,
    private readonly deferCompletion = false,
  ) {}

  async page(problemKey: string): Promise<any | null> {
    if (this.pages.has(problemKey)) return this.pages.get(problemKey);
    const response = await this.notion.dataSources.query({
      data_source_id: this.manifest.attempts.dataSourceId,
      page_size: 100,
      filter: { property: 'Problem Key', rich_text: { equals: problemKey } },
      sorts: [
        { property: 'Attempted At', direction: 'descending' },
        { timestamp: 'created_time', direction: 'descending' },
      ],
    });
    if (!response.results.length) {
      this.pages.set(problemKey, null);
      return null;
    }
    if (response.results.some((page) => !isFullPage(page)))
      throw new Error('Partial Attempt in latest-page lookup.');
    const pages = [...response.results].sort(compareAttemptPages);
    if (
      response.has_more &&
      compareAttemptPages({ ...pages[0], id: 'same' }, { ...pages.at(-1), id: 'same' }) === 0
    ) {
      throw new Error('Too many tied Attempts to select safely.');
    }
    const page = pages[0]!;
    if (!isFullPage(page)) throw new Error('Latest Attempt is not a full Notion page.');
    if (
      (page.properties['Extension Managed'] as any)?.checkbox !== true ||
      this.parse(page).problemKey !== problemKey
    ) {
      throw new Error('Latest Attempt is not a valid extension-managed page.');
    }
    this.pages.set(problemKey, page);
    return page;
  }

  async state(page: any) {
    if (this.states.has(page.id)) return this.states.get(page.id)!;
    const blocks = await listBlocks(this.notion, page.id);
    const containers = blocks.filter((b) => b.type === 'toggle' && blockText(b) === RECEIPTS_LABEL);
    if (containers.length > 1)
      throw new Error('Multiple managed receipt containers; refusing to overwrite.');
    const container = containers[0];
    const receipts: Array<{ id: string; value: Receipt }> = [];
    if (container) {
      for (const block of await listBlocks(this.notion, container.id)) {
        if (block.type !== 'code') throw new Error('Invalid block in managed receipt container.');
        let value: Receipt;
        try {
          value = ReceiptSchema.parse(JSON.parse(blockText(block)));
        } catch {
          throw new Error('Invalid managed capture receipt; refusing to overwrite.');
        }
        if (
          value.pending &&
          (value.pending.clientEventId !== value.clientEventId ||
            value.pending.attempt.attemptedAt !== value.attemptedAt ||
            value.pending.attempt.result !== value.result ||
            `leetcode:${value.pending.problem.slug}` !== this.parse(page).problemKey)
        ) {
          throw new Error('Pending capture does not match its receipt or Problem.');
        }
        if (receipts.some((r) => r.value.clientEventId === value.clientEventId))
          throw new Error('Duplicate managed capture receipts.');
        receipts.push({ id: block.id, value });
      }
      if (receipts.filter((r) => r.value.pending).length > 1)
        throw new Error('Multiple unfinished captures.');
    }
    const state = { blocks, container, receipts };
    this.states.set(page.id, state);
    return state;
  }

  private currentId(page: any): string {
    const id = page.properties['Client Event ID']?.rich_text
      ?.map((r: any) => r.plain_text ?? r.text?.content ?? '')
      .join('');
    return z.string().uuid().parse(id);
  }

  private codeBlock(blocks: any[]) {
    const candidates = blocks.flatMap((b, i) =>
      b.type === 'heading_2' && blockText(b) === 'Captured code' && blocks[i + 1]?.type === 'code'
        ? [blocks[i + 1]]
        : [],
    );
    if (candidates.length !== 1)
      throw new Error(
        'Expected exactly one managed Captured code block; notes were left untouched.',
      );
    return candidates[0]!;
  }

  async latest(problemKey: string): Promise<StoredAttempt | null> {
    let page = await this.page(problemKey);
    if (!page) return null;
    const state = await this.state(page);
    const pending = state.receipts.find((r) => r.value.pending);
    const pendingEvent = pending?.value.pending;
    if (pending) {
      page = await this.finish(page, state.blocks, pending.id, pending.value);
    }
    const record = this.parse(page);
    const firstAttempt = [
      record.attemptedAt,
      ...state.receipts.map((r) => r.value.attemptedAt),
    ].sort((a, b) => Date.parse(a) - Date.parse(b))[0]!;
    return { ...record, firstAttempt, ...(pendingEvent ? { pendingEvent } : {}) };
  }

  async find(clientEventId: string, problemKey: string): Promise<StoredAttempt | null> {
    const page = await this.page(problemKey);
    if (!page) return null;
    const record = this.parse(page);
    const state = await this.state(page);
    const receipt = state.receipts.find((r) => r.value.clientEventId === clientEventId)?.value;
    if (receipt?.pending)
      throw new Error('Unfinished capture must be recovered under the Problem lock.');
    if (receipt)
      return {
        ...record,
        attemptedAt: receipt.attemptedAt,
        result: receipt.result,
        review: receipt.review,
        superseded: this.currentId(page) !== clientEventId,
      };
    if (this.currentId(page) === clientEventId) return record;
    return null;
  }

  async save(
    problemId: string,
    event: CaptureEvent,
    review: ReviewState,
    create: () => Promise<StoredAttempt>,
  ): Promise<StoredAttempt> {
    const page = await this.page(`leetcode:${event.problem.slug}`);
    if (!page) return create();
    const current = this.parse(page);
    if (current.problemPageId !== problemId)
      throw new Error('Attempt relation does not match canonical Problem.');
    const state = await this.state(page);
    this.codeBlock(state.blocks); // Validate before creating a pending write.
    if (!state.container) {
      const response = await this.notion.blocks.children.append({
        block_id: page.id,
        children: [
          {
            object: 'block',
            type: 'toggle',
            toggle: {
              rich_text: richTextChunks(RECEIPTS_LABEL),
            },
          },
        ],
      });
      const container = response.results[0] as any;
      if (
        response.results.length !== 1 ||
        !container?.id ||
        container.type !== 'toggle' ||
        blockText(container) !== RECEIPTS_LABEL
      ) {
        throw new Error('Invalid managed receipt container response; retry to recover.');
      }
      state.container = container;
      state.blocks.push(container);
    }
    if (!state.container) throw new Error('Managed receipt container was not persisted.');
    const existing = state.receipts.find((r) => r.value.clientEventId === event.clientEventId);
    if (existing) {
      if (existing.value.pending)
        await this.finish(page, state.blocks, existing.id, existing.value);
      return {
        ...current,
        attemptedAt: existing.value.attemptedAt,
        result: existing.value.result,
        review: existing.value.review,
      };
    }
    if (state.receipts.some((r) => r.value.pending))
      throw new Error('Recover the previous capture before saving another.');
    const receipt: Receipt = {
      version: 1,
      clientEventId: event.clientEventId,
      attemptedAt: event.attempt.attemptedAt,
      result: event.attempt.result,
      review,
      pending: event,
    };
    const additions: Receipt[] = [];
    // Also repairs an empty container left by an interrupted first replacement.
    if (!state.receipts.some((r) => r.value.clientEventId === this.currentId(page))) {
      additions.push({
        version: 1,
        clientEventId: this.currentId(page),
        attemptedAt: current.attemptedAt,
        result: current.result,
        review: current.review,
      });
    }
    additions.push(receipt);
    const children = additions.map(receiptBlock);
    const response = await this.notion.blocks.children.append({
      block_id: state.container.id,
      children,
    });
    if (response.results.length !== additions.length)
      throw new Error('Incomplete pending capture response; retry to recover.');
    response.results.forEach((block: any, index) => {
      if (!block.id || block.type !== 'code' || blockText(block) !== blockText(children[index]))
        throw new Error('Invalid pending capture response; retry to recover.');
      state.receipts.push({ id: block.id, value: additions[index]! });
    });
    const durable = state.receipts.find((r) => r.value.clientEventId === event.clientEventId)!;
    await this.finish(page, state.blocks, durable.id, durable.value);
    return {
      pageId: page.id,
      problemPageId: problemId,
      problemKey: current.problemKey,
      attemptedAt: receipt.attemptedAt,
      result: receipt.result,
      review: receipt.review,
    };
  }

  private async finish(page: any, blocks: any[], receiptId: string, receipt: Receipt) {
    const event = receipt.pending;
    if (!event) return page;
    const current = this.parse(page);
    if (Date.parse(event.attempt.attemptedAt) >= Date.parse(current.attemptedAt)) {
      const block = this.codeBlock(blocks);
      const updatedCode = await this.notion.blocks.update({
        block_id: block.id,
        code: { rich_text: richTextChunks(event.attempt.code), language: 'plain text' },
      });
      if (
        updatedCode.id !== block.id ||
        (updatedCode as any).type !== 'code' ||
        blockText(updatedCode) !== event.attempt.code
      )
        throw new Error('Invalid captured code response; retry to recover.');
      Object.assign(block, updatedCode);
      const updatedPage = await this.notion.pages.update({
        page_id: page.id,
        properties: this.properties(current.problemPageId, event, receipt.review),
      });
      const updated = this.parse(updatedPage);
      if (
        updated.pageId !== page.id ||
        updated.problemPageId !== current.problemPageId ||
        updated.problemKey !== current.problemKey ||
        this.currentId(updatedPage) !== event.clientEventId ||
        Date.parse(updated.attemptedAt) !== Date.parse(event.attempt.attemptedAt) ||
        updated.result !== receipt.result ||
        updated.review.practiceState !== receipt.review.practiceState ||
        updated.review.solvedStreak !== receipt.review.solvedStreak ||
        updated.review.nextReview !== receipt.review.nextReview
      )
        throw new Error('Invalid Attempt update response; retry to recover.');
      page = updatedPage;
      this.pages.set(current.problemKey, page);
    }
    this.completions.set(receiptId, receipt);
    if (!this.deferCompletion) await this.complete();
    return page;
  }

  async complete(): Promise<void> {
    for (const [receiptId, receipt] of this.completions) {
      const { pending: _pending, ...compact } = receipt;
      const expected = receiptBlock(compact);
      const block = await this.notion.blocks.update({
        block_id: receiptId,
        code: expected.code,
      });
      if (
        block.id !== receiptId ||
        (block as any).type !== 'code' ||
        blockText(block) !== blockText(expected)
      )
        throw new Error('Invalid completed receipt response; retry to recover.');
      delete receipt.pending;
      this.completions.delete(receiptId);
    }
  }
}
