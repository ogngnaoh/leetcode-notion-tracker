import { describe, expect, it, vi } from 'vitest';
import type { Client } from '@notionhq/client';
import { CaptureService } from '../src/bridge/capture-service.js';
import { createApp } from '../src/bridge/app.js';
import { NotionCaptureRepository } from '../src/bridge/notion-repository.js';
import type { CaptureEvent, NotionManifest } from '../src/shared/contract.js';

const manifest: NotionManifest = {
  version: 4,
  notionApiVersion: '2026-03-11',
  createdAt: '2026-09-02T00:00:00Z',
  parentPageId: 'parent',
  problems: { databaseId: 'problems', dataSourceId: 'problems' },
  attempts: { databaseId: 'attempts', dataSourceId: 'attempts' },
};
const event: CaptureEvent = {
  clientEventId: 'eb9fdc89-8098-4f76-9a68-26e94dc75fc6',
  problem: {
    slug: 'two-sum',
    title: 'Two Sum',
    number: 1,
    url: 'https://leetcode.com/problems/two-sum/',
    difficulty: 'Easy',
    topics: ['Array'],
  },
  attempt: {
    attemptedAt: '2026-09-01T10:00:00Z',
    attemptedOn: '2026-09-01',
    language: 'Python',
    code: 'first solution',
    result: 'Solved',
  },
};
const newer: CaptureEvent = {
  ...event,
  clientEventId: 'd83d5722-13dd-4b2f-8d60-115613364ed4',
  attempt: {
    ...event.attempt,
    attemptedAt: '2026-09-02T10:00:00Z',
    attemptedOn: '2026-09-02',
    code: 'new solution',
    result: 'Needed help',
  },
};

// Stateful Notion double: persisted mutations survive repository/service recreation.
function workspace(pageSize = 2) {
  let sequence = 0;
  const pages = new Map<string, any>();
  const blocks = new Map<string, any>();
  const children = new Map<string, string[]>();
  function addBlocks(parent: string, values: any[]) {
    return values.map((value) => {
      const block = structuredClone(value);
      block.id = `block-${++sequence}`;
      const nested = block[block.type]?.children;
      if (nested) delete block[block.type].children;
      block.has_children = Boolean(nested?.length);
      blocks.set(block.id, block);
      children.set(parent, [...(children.get(parent) ?? []), block.id]);
      if (nested) addBlocks(block.id, nested);
      return block;
    });
  }
  const propertyValues = (props: any) =>
    Object.fromEntries(
      Object.entries(props).map(([key, val]) => {
        const value = structuredClone(val) as any;
        const type = Object.keys(value)[0]!;
        if (type === 'title' || type === 'rich_text')
          value[type].forEach((t: any) => {
            t.plain_text = t.text.content;
          });
        return [key, { ...value, type }];
      }),
    );
  const notion = {
    dataSources: {
      query: vi.fn(async (req: any) => {
        let results = [...pages.values()].filter(
          (p) => p.parent.data_source_id === req.data_source_id && !p.in_trash,
        );
        if (req.filter?.rich_text)
          results = results.filter(
            (p) =>
              p.properties[req.filter.property]?.rich_text
                .map((r: any) => r.plain_text)
                .join('') === req.filter.rich_text.equals,
          );
        if (req.sorts)
          results.sort(
            (a, b) =>
              Date.parse(b.properties['Attempted At'].date.start) -
              Date.parse(a.properties['Attempted At'].date.start),
          );
        const start = Number(req.start_cursor ?? 0);
        const size = Math.min(req.page_size ?? 100, pageSize);
        return {
          results: structuredClone(results.slice(start, start + size)),
          has_more: start + size < results.length,
          next_cursor: start + size < results.length ? String(start + size) : null,
        };
      }),
    },
    pages: {
      create: vi.fn(async (req: any) => {
        const page = {
          object: 'page',
          id: `page-${++sequence}`,
          parent: req.parent,
          url: `https://www.notion.so/page-${sequence}`,
          properties: propertyValues(req.properties),
          in_trash: false,
        };
        pages.set(page.id, page);
        addBlocks(page.id, req.children ?? []);
        return structuredClone(page);
      }),
      update: vi.fn(async (req: any) => {
        const page = pages.get(req.page_id);
        Object.assign(page.properties, propertyValues(req.properties ?? {}));
        if ('in_trash' in req) page.in_trash = req.in_trash;
        return structuredClone(page);
      }),
      retrieve: vi.fn(async (req: any) => structuredClone(pages.get(req.page_id))),
    },
    blocks: {
      children: {
        list: vi.fn(async (req: any) => {
          const ids = children.get(req.block_id) ?? [];
          const start = Number(req.start_cursor ?? 0);
          return {
            results: ids
              .slice(start, start + pageSize)
              .map((id) => structuredClone(blocks.get(id))),
            has_more: start + pageSize < ids.length,
            next_cursor: start + pageSize < ids.length ? String(start + pageSize) : null,
          };
        }),
        append: vi.fn(async (req: any) => ({ results: addBlocks(req.block_id, req.children) })),
      },
      update: vi.fn(async (req: any) => {
        const block = blocks.get(req.block_id);
        Object.assign(block, structuredClone(req));
        return structuredClone(block);
      }),
    },
  };
  const repository = () => new NotionCaptureRepository(notion as unknown as Client, manifest);
  return {
    notion,
    pages,
    blocks,
    children,
    repository,
    service: () => new CaptureService(repository()),
    addBlocks,
  };
}
const content = (block: any) =>
  block?.code?.rich_text.map((r: any) => r.text?.content ?? r.plain_text).join('');

describe('latest Attempt persistence', () => {
  it('validates write responses independently of input object property order', async () => {
    const w = workspace(100);
    await w.service().capture(event);
    const reordered: CaptureEvent = {
      attempt: {
        result: newer.attempt.result,
        code: newer.attempt.code,
        language: newer.attempt.language,
        attemptedOn: newer.attempt.attemptedOn,
        attemptedAt: newer.attempt.attemptedAt,
      },
      problem: {
        topics: newer.problem.topics,
        difficulty: newer.problem.difficulty,
        url: newer.problem.url,
        number: newer.problem.number,
        title: newer.problem.title,
        slug: newer.problem.slug,
      },
      clientEventId: newer.clientEventId,
    };
    expect((await w.service().capture(reordered)).duplicate).toBe(false);
    expect((await w.service().capture(reordered)).duplicate).toBe(true);
  });

  it('does not report success when the exact UUID exists but the locked latest lookup is missing', async () => {
    const w = workspace(100);
    const first = await w.service().capture(event);
    w.pages.get(first.problemPageId).properties['Solved Streak'].number = 0;
    const query = w.notion.dataSources.query.getMockImplementation()!;
    w.notion.dataSources.query.mockImplementation(async (req) =>
      req.filter?.property === 'Problem Key'
        ? { results: [], has_more: false, next_cursor: null }
        : query(req),
    );
    await expect(w.service().capture(event)).rejects.toThrow('latest lookup');
    w.notion.dataSources.query.mockImplementation(query);
    expect((await w.service().capture(event)).duplicate).toBe(true);
    expect(w.pages.get(first.problemPageId).properties['Solved Streak'].number).toBe(1);
  });

  it.runIf(process.env.LCTRACK_CAPTURE_BENCHMARK === '1')(
    'reports controlled-latency capture timing',
    async () => {
      for (const result of ['Needed help', 'Solved'] as const) {
        const w = workspace(100);
        await w.service().capture(event);
        await w.service().capture(newer);
        const methods = [
          w.notion.dataSources.query,
          ...Object.values(w.notion.pages),
          ...Object.values(w.notion.blocks.children),
          w.notion.blocks.update,
        ];
        for (const method of methods) {
          const implementation = method.getMockImplementation()!;
          method.mockImplementation(async (req) => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return implementation(req);
          });
        }
        const measurements = [];
        const app = createApp({
          bridgeToken: 'synthetic-benchmark-token',
          captureService: w.service(),
        });
        for (let i = 0; i < 3; i++) {
          methods.forEach((method) => method.mockClear());
          const start = performance.now();
          const response = await app.request('/api/capture', {
            method: 'POST',
            headers: {
              Authorization: 'Bearer synthetic-benchmark-token',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...newer,
              clientEventId: `b1a5d388-78a2-4cfb-b2a2-d038664aa3f${i}`,
              attempt: { ...newer.attempt, result },
            }),
          });
          expect(response.status).toBe(201);
          expect((await response.json()).duplicate).toBe(false);
          measurements.push({
            ms: Math.round(performance.now() - start),
            calls: methods.reduce((sum, method) => sum + method.mock.calls.length, 0),
          });
        }
        process.stdout.write(
          `${JSON.stringify({ result, latencyPerRequestMs: 20, measurements })}\n`,
        );
      }
    },
  );

  it('uses six calls for a first capture, ten for a first replacement and five for a retry', async () => {
    const w = workspace(100);
    const methods = [
      w.notion.dataSources.query,
      ...Object.values(w.notion.pages),
      ...Object.values(w.notion.blocks.children),
      w.notion.blocks.update,
    ];
    const count = () => methods.reduce((sum, method) => sum + method.mock.calls.length, 0);
    const service = w.service();
    await service.capture(event);
    expect(count()).toBe(6);
    methods.forEach((method) => method.mockClear());
    await service.capture(newer);
    expect(count()).toBe(10);
    methods.forEach((method) => method.mockClear());
    expect((await service.capture(newer)).duplicate).toBe(true);
    expect(count()).toBe(5);
    expect(w.notion.pages.update).not.toHaveBeenCalled();
    expect(w.notion.blocks.update).not.toHaveBeenCalled();
    expect(w.notion.blocks.children.append).not.toHaveBeenCalled();
  });

  it('reads each body/receipt pagination page only once and finds an older paginated receipt', async () => {
    const w = workspace(2);
    const service = w.service();
    const first = await service.capture(event);
    for (let i = 0; i < 7; i++)
      await service.capture({ ...newer, clientEventId: `b1a5d388-78a2-4cfb-b2a2-d038664aa3f${i}` });
    w.notion.blocks.children.list.mockClear();
    expect(
      (await service.capture({ ...newer, clientEventId: 'b1a5d388-78a2-4cfb-b2a2-d038664aa3f4' }))
        .duplicate,
    ).toBe(true);
    const requests = w.notion.blocks.children.list.mock.calls.map(
      ([req]) => `${req.block_id}:${req.start_cursor ?? ''}`,
    );
    expect(requests).toHaveLength(6); // Two body pages and four receipt pages.
    expect(new Set(requests).size).toBe(requests.length);
    expect(content(w.blocks.get(w.children.get(first.attemptPageId)![1]!))).toBe(
      newer.attempt.code,
    );
  });

  it.each(['container', 'pending', 'code', 'attempt', 'problem', 'receipt'] as const)(
    'rejects an incomplete %s response and recovers from fresh state',
    async (boundary) => {
      const w = workspace(100);
      const first = await w.service().capture(event);
      const codeId = w.children.get(first.attemptPageId)![1]!;
      let corrupted = false;
      const corrupt = (matches: boolean, result: any) => {
        if (!matches || corrupted) return result;
        corrupted = true;
        return { id: result.id, results: [] };
      };
      const append = w.notion.blocks.children.append.getMockImplementation()!;
      const blockUpdate = w.notion.blocks.update.getMockImplementation()!;
      const pageUpdate = w.notion.pages.update.getMockImplementation()!;
      w.notion.blocks.children.append.mockImplementation(async (req) =>
        corrupt(
          boundary === (req.block_id === first.attemptPageId ? 'container' : 'pending'),
          await append(req),
        ),
      );
      w.notion.blocks.update.mockImplementation(async (req) =>
        corrupt(
          boundary === (req.block_id === codeId ? 'code' : 'receipt'),
          await blockUpdate(req),
        ),
      );
      w.notion.pages.update.mockImplementation(async (req) =>
        corrupt(
          boundary === (req.page_id === first.attemptPageId ? 'attempt' : 'problem'),
          await pageUpdate(req),
        ),
      );
      await expect(w.service().capture(newer)).rejects.toThrow();
      const retry = await w.service().capture(newer);
      expect(retry.review.practiceState).toBe('Needed help');
      expect(retry.attemptPageId).toBe(first.attemptPageId);
      expect((await w.service().capture(event)).duplicate).toBe(true);
    },
  );

  it.each(['Needed help', 'Solved'] as const)(
    'saves %s with at most ten Notion calls and one Problem update',
    async (result) => {
      const w = workspace(100);
      const first = await w.service().capture(event);
      await w.service().capture(newer);
      const methods = [
        w.notion.dataSources.query,
        ...Object.values(w.notion.pages),
        ...Object.values(w.notion.blocks.children),
        w.notion.blocks.update,
      ];
      methods.forEach((method) => method.mockClear());
      await w.service().capture({
        ...newer,
        clientEventId: 'b1a5d388-78a2-4cfb-b2a2-d038664aa3f4',
        attempt: { ...newer.attempt, result },
      });
      const calls = methods.reduce((sum, method) => sum + method.mock.calls.length, 0);
      expect(calls).toBeLessThanOrEqual(10);
      expect(
        w.notion.pages.update.mock.calls.filter(([req]) => req.page_id === first.problemPageId),
      ).toHaveLength(1);
    },
  );

  it('keeps the pending payload until the Problem update succeeds', async () => {
    const w = workspace(100);
    const first = await w.service().capture(event);
    const update = w.notion.pages.update.getMockImplementation()!;
    w.notion.pages.update.mockImplementation(async (req) => {
      if (req.page_id === first.problemPageId && req.properties['Last Attempt']) {
        throw new Error('Problem write failed');
      }
      return update(req);
    });
    await expect(w.service().capture(newer)).rejects.toThrow('Problem write failed');
    expect([...w.blocks.values()].some((block) => content(block)?.includes('"pending":'))).toBe(
      true,
    );
    w.notion.pages.update.mockImplementation(update);
    const retry = await w.service().capture(newer);
    expect(retry.duplicate).toBe(true);
    expect([...w.blocks.values()].some((block) => content(block)?.includes('"pending":'))).toBe(
      false,
    );
  });

  it('does not accept a stale Problem update response as durable success', async () => {
    const w = workspace(100);
    const first = await w.service().capture(event);
    const update = w.notion.pages.update.getMockImplementation()!;
    w.notion.pages.update.mockImplementation(async (req) => {
      const stale = structuredClone(w.pages.get(req.page_id));
      const response = await update(req);
      return req.page_id === first.problemPageId ? stale : response;
    });
    await expect(w.service().capture(newer)).rejects.toThrow('Problem update response');
    expect([...w.blocks.values()].some((block) => content(block)?.includes('"pending":'))).toBe(
      true,
    );
    w.notion.pages.update.mockImplementation(update);
    expect((await w.service().capture(newer)).duplicate).toBe(true);
  });

  it.each(['container', 'pending', 'code', 'attempt', 'problem', 'receipt'] as const)(
    'recovers a lost %s response after its write already committed',
    async (boundary) => {
      const w = workspace(100);
      const first = await w.service().capture(event);
      const codeId = w.children.get(first.attemptPageId)![1]!;
      const append = w.notion.blocks.children.append.getMockImplementation()!;
      const blockUpdate = w.notion.blocks.update.getMockImplementation()!;
      const pageUpdate = w.notion.pages.update.getMockImplementation()!;
      let failed = false;
      const lose = (matches: boolean) => {
        if (matches && !failed) {
          failed = true;
          throw new Error('response lost');
        }
      };
      w.notion.blocks.children.append.mockImplementation(async (req) => {
        const response = await append(req);
        lose(boundary === (req.block_id === first.attemptPageId ? 'container' : 'pending'));
        return response;
      });
      w.notion.blocks.update.mockImplementation(async (req) => {
        const response = await blockUpdate(req);
        lose(boundary === (req.block_id === codeId ? 'code' : 'receipt'));
        return response;
      });
      w.notion.pages.update.mockImplementation(async (req) => {
        const response = await pageUpdate(req);
        lose(boundary === (req.page_id === first.attemptPageId ? 'attempt' : 'problem'));
        return response;
      });
      const solve = {
        ...newer,
        problem: { ...newer.problem, title: 'Updated Two Sum' },
        attempt: { ...newer.attempt, result: 'Solved' as const },
      };
      await expect(w.service().capture(solve)).rejects.toThrow('response lost');
      const retry = await w.service().capture(solve);
      expect(retry.review.solvedStreak).toBe(2);
      expect(retry.duplicate).toBe(boundary !== 'container');
      expect(w.pages.get(first.problemPageId).properties.Problem.title[0].plain_text).toBe(
        'Updated Two Sum',
      );
      expect(w.pages.get(first.problemPageId).properties['Solved Streak'].number).toBe(2);
      expect(content(w.blocks.get(codeId))).toBe(solve.attempt.code);
      expect([...w.blocks.values()].some((block) => content(block)?.includes('"pending":'))).toBe(
        false,
      );
      expect((await w.service().capture(event)).duplicate).toBe(true);
    },
  );

  it('recovers an unfinished solve before another solve without using retry metadata', async () => {
    const w = workspace(100);
    const first = await w.service().capture(event);
    const update = w.notion.pages.update.getMockImplementation()!;
    let failed = false;
    w.notion.pages.update.mockImplementation(async (req) => {
      if (!failed && req.page_id === first.problemPageId) {
        failed = true;
        throw new Error('offline');
      }
      return update(req);
    });
    const second = { ...newer, attempt: { ...newer.attempt, result: 'Solved' as const } };
    await expect(w.service().capture(second)).rejects.toThrow('offline');
    const third = { ...second, clientEventId: 'b1a5d388-78a2-4cfb-b2a2-d038664aa3f4' };
    expect((await w.service().capture(third)).review.solvedStreak).toBe(3);
    expect(
      (
        await w
          .service()
          .capture({ ...second, problem: { ...second.problem, title: 'Must not be applied' } })
      ).duplicate,
    ).toBe(true);
    expect(w.pages.get(first.problemPageId).properties['Solved Streak'].number).toBe(3);
    expect(w.pages.get(first.problemPageId).properties.Problem.title[0].plain_text).toBe('Two Sum');
  });

  it('does not reuse a previous capture snapshot and serializes concurrent solves', async () => {
    const w = workspace(100);
    const service = w.service();
    const first = await service.capture(event);
    const solve = { ...newer, attempt: { ...newer.attempt, result: 'Solved' as const } };
    const results = await Promise.all([
      service.capture(solve),
      service.capture({ ...solve, clientEventId: 'b1a5d388-78a2-4cfb-b2a2-d038664aa3f4' }),
    ]);
    expect(results.map((result) => result.review.solvedStreak)).toEqual([2, 3]);
    expect(w.pages.get(first.problemPageId).properties['Solved Streak'].number).toBe(3);
    w.pages.get(first.problemPageId).properties['First Attempt'].date = {
      start: '2020-01-01T00:00:00Z',
    };
    await service.capture({ ...solve, clientEventId: 'b1a5d388-78a2-4cfb-b2a2-d038664aa3f5' });
    expect(w.pages.get(first.problemPageId).properties['First Attempt'].date.start).toBe(
      '2020-01-01T00:00:00Z',
    );
  });

  it('uses the retained Attempt relation when duplicate Problem keys already exist', async () => {
    const w = workspace();
    const first = await w.service().capture(event);
    const canonical = w.pages.get(first.problemPageId);
    const duplicate = structuredClone(canonical);
    duplicate.id = 'duplicate-problem';
    duplicate.properties['Solved Streak'].number = 5;
    w.pages.delete(canonical.id);
    w.pages.set(duplicate.id, duplicate);
    w.pages.set(canonical.id, canonical);
    const result = await w.service().capture(newer);
    expect(result.problemPageId).toBe(first.problemPageId);
    expect(duplicate.properties['Solved Streak'].number).toBe(5);
  });

  it('updates the same page and code block, preserving unrelated notes and old retry receipts', async () => {
    const w = workspace();
    const first = await w.service().capture(event);
    const codeId = w.children.get(first.attemptPageId)![1]!;
    const [note] = w.addBlocks(first.attemptPageId, [
      {
        type: 'paragraph',
        paragraph: { rich_text: [{ text: { content: 'My handwritten note' } }] },
      },
    ]);
    const second = await w.service().capture(newer);
    expect(second.attemptPageId).toBe(first.attemptPageId);
    expect(
      [...w.pages.values()].filter((p) => p.parent.data_source_id === 'attempts'),
    ).toHaveLength(1);
    expect(content(w.blocks.get(codeId))).toBe('new solution');
    expect(w.blocks.get(note.id)).toEqual(note);
    const retry = await w.service().capture(event);
    expect(retry).toMatchObject({ duplicate: true, attemptPageId: first.attemptPageId });
    expect(content(w.blocks.get(codeId))).toBe('new solution');
    expect(w.pages.get(first.problemPageId).properties['Practice State'].select.name).toBe(
      'Needed help',
    );
    expect(
      [...w.blocks.values()].filter((b) => content(b)?.includes('first solution')),
    ).toHaveLength(0);
  });

  it.each(['code', 'page', 'receipt'])(
    'recovers an interrupted %s update after restart without incrementing twice',
    async (failure) => {
      const w = workspace();
      const first = await w.service().capture(event);
      const codeId = w.children.get(first.attemptPageId)![1]!;
      const updateBlock = w.notion.blocks.update.getMockImplementation()!;
      const updatePage = w.notion.pages.update.getMockImplementation()!;
      let failed = false;
      w.notion.blocks.update.mockImplementation(async (req: any) => {
        if (
          !failed &&
          ((failure === 'code' && req.block_id === codeId) ||
            (failure === 'receipt' && req.block_id !== codeId))
        ) {
          failed = true;
          throw new Error('offline');
        }
        return updateBlock(req);
      });
      w.notion.pages.update.mockImplementation(async (req: any) => {
        if (!failed && failure === 'page' && req.page_id === first.attemptPageId) {
          failed = true;
          throw new Error('offline');
        }
        return updatePage(req);
      });
      const solve = { ...newer, attempt: { ...newer.attempt, result: 'Solved' as const } };
      await expect(w.service().capture(solve)).rejects.toThrow('offline');
      await expect(w.service().capture(solve)).resolves.toMatchObject({
        duplicate: true,
        review: { solvedStreak: 2 },
      });
      expect(content(w.blocks.get(codeId))).toBe('new solution');
      expect(w.pages.get(first.problemPageId).properties['Solved Streak'].number).toBe(2);
      expect(
        [...w.pages.values()].filter((p) => p.parent.data_source_id === 'attempts'),
      ).toHaveLength(1);
    },
  );

  it('retains a late event receipt without replacing the newer code, result or timestamp', async () => {
    const w = workspace();
    const first = await w.service().capture(newer);
    const before = structuredClone(w.pages.get(first.attemptPageId).properties);
    await w.service().capture(event);
    expect(w.pages.get(first.attemptPageId).properties).toEqual(before);
    expect((await w.service().capture(event)).duplicate).toBe(true);
    expect(w.pages.get(first.problemPageId).properties['First Attempt'].date.start).toBe(
      event.attempt.attemptedAt,
    );
  });
});
