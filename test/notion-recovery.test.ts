import { describe, expect, it, vi } from 'vitest';
import {
  NotionMutationGateway,
  type MutationCheckpoint,
} from '../extension/src/notion-recovery.js';
import { captureEvent, manifest as oldManifest } from '../scripts/benchmark/fixture.js';
import { RECEIPTS_LABEL, receiptBlock } from '../src/tracker/latest-attempt.js';

const pageId = '00000000-0000-4000-8000-000000000100';
const blockId = '00000000-0000-4000-8000-000000000101';
const manifest = {
  ...oldManifest,
  problems: {
    databaseId: '00000000-0000-4000-8000-000000000200',
    dataSourceId: '00000000-0000-4000-8000-000000000201',
  },
  attempts: {
    databaseId: '00000000-0000-4000-8000-000000000300',
    dataSourceId: '00000000-0000-4000-8000-000000000301',
  },
};
const request = {
  path: '/v1/pages',
  method: 'POST',
  body: JSON.stringify({
    parent: { data_source_id: manifest.problems.dataSourceId },
    properties: {
      'External Key': { rich_text: [{ text: { content: 'leetcode:two-sum' } }] },
      'Practice State': { select: { name: 'New' } },
    },
  }),
};
const page = {
  object: 'page',
  id: pageId,
  parent: { data_source_id: manifest.problems.dataSourceId },
  properties: {
    'External Key': { type: 'rich_text', rich_text: [{ plain_text: 'leetcode:two-sum' }] },
    'Practice State': { type: 'select', select: { name: 'New' } },
  },
};

function setup(
  read: (request: { path: string; method: string; body?: string }) => Promise<Response>,
) {
  let checkpoints: MutationCheckpoint[] = [];
  const store = {
    load: async () => structuredClone(checkpoints),
    save: vi.fn(async (value: MutationCheckpoint[]) => {
      checkpoints = structuredClone(value);
    }),
  };
  const gateway = new NotionMutationGateway({ event: captureEvent(1), manifest, read, store });
  return { gateway, store, checkpoints: () => checkpoints };
}

describe('Notion mutation recovery', () => {
  it.each([401, 403, 429, 529])(
    'keeps checkpoints and sanitized HTTP status when a read-only check returns %s',
    async (status) => {
      const privateMessage = 'response body containing private provider details';
      const read = vi.fn(async (_request: { method: string; path: string }) =>
        Response.json({ message: privateMessage }, { status }),
      );
      const { gateway, checkpoints } = setup(read);
      const send = vi.fn(async () => {
        throw new Error('lost create response');
      });
      await expect(gateway.dispatch(request, send)).rejects.toThrow('lost create response');
      const before = structuredClone(checkpoints());
      const error: unknown = await gateway.check().catch((value: unknown) => value);
      expect(error).toMatchObject({ status });
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain(privateMessage);
      expect(checkpoints()).toEqual(before);
      expect(send).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledTimes(1);
      expect(read.mock.calls[0]?.[0]).toMatchObject({
        method: 'POST',
        path: `/v1/data_sources/${manifest.problems.dataSourceId}/query`,
      });
    },
  );

  it('persists intent before dispatch and never recreates after an empty recovery query', async () => {
    let checkpoints: MutationCheckpoint[] = [];
    const read = vi.fn(async () => Response.json({ results: [], has_more: false }));
    const gateway = new NotionMutationGateway({
      event: captureEvent(1),
      manifest,
      read,
      store: {
        load: async () => checkpoints,
        save: async (value) => {
          checkpoints = structuredClone(value);
        },
      },
    });
    const send = vi.fn(async () => {
      expect(checkpoints).toHaveLength(1);
      throw new Error('response lost');
    });
    await expect(
      gateway.dispatch(
        {
          path: '/v1/pages',
          method: 'POST',
          body: JSON.stringify({
            parent: { data_source_id: manifest.problems.dataSourceId },
            properties: {
              'External Key': { rich_text: [{ text: { content: 'leetcode:two-sum' } }] },
            },
          }),
        },
        send,
      ),
    ).rejects.toThrow();
    await expect(gateway.check()).rejects.toThrow();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('positively discovers a lost create then reuses its known identity after legitimate property updates', async () => {
    let changed = false;
    const read = vi.fn(async ({ method }: { method: string }) => {
      const found = structuredClone(page);
      if (changed) found.properties['Practice State'].select.name = 'Solved';
      return Response.json(method === 'POST' ? { results: [found], has_more: false } : found);
    });
    const { gateway, checkpoints } = setup(read);
    const send = vi.fn(async () => {
      throw new Error('lost response');
    });
    await expect(gateway.dispatch(request, send)).rejects.toThrow('lost response');
    await expect(gateway.check()).resolves.toEqual({ resolved: 1 });
    changed = true;
    const recovered = await gateway.dispatch(request, send);
    expect(await recovered.json()).toMatchObject({
      id: pageId,
      properties: { 'Practice State': { select: { name: 'Solved' } } },
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(checkpoints()[0]).toMatchObject({ status: 'resolved', targetIds: [pageId] });
    expect(
      read.mock.calls.every(([value]) => value.method === 'GET' || value.method === 'POST'),
    ).toBe(true);
  });

  it('does not dispatch when the preflight intent cannot be saved', async () => {
    const { gateway, store } = setup(async () => Response.json({}));
    store.save.mockRejectedValueOnce(new Error('quota'));
    const send = vi.fn(async () => Response.json(page));
    await expect(gateway.dispatch(request, send)).rejects.toThrow('quota');
    expect(send).not.toHaveBeenCalled();
  });

  it('retains ambiguity on malformed success, duplicate lookup, and another attempted write', async () => {
    const { gateway, checkpoints } = setup(async () =>
      Response.json({ results: [page, page], has_more: false }),
    );
    await expect(
      gateway.dispatch(request, async () => Response.json({ id: pageId })),
    ).rejects.toThrow();
    expect(checkpoints()[0]?.status).toBe('uncertain');
    await expect(gateway.check()).rejects.toThrow();
    const send = vi.fn(async () => Response.json(page));
    const other = { ...request, body: request.body.replace('"New"', '"Solved"') };
    await expect(gateway.dispatch(other, send)).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('recovers a lost receipt append using only the exact parent and receipt identity', async () => {
    const receipt = receiptBlock({
      version: 1,
      clientEventId: captureEvent(1).clientEventId,
      attemptedAt: captureEvent(1).attempt.attemptedAt,
      result: 'Solved',
      review: { practiceState: 'Solved', solvedStreak: 1, nextReview: '2026-09-04' },
      pending: captureEvent(1),
    });
    const block = { ...receipt, id: blockId };
    const read = vi.fn(async () => Response.json({ results: [block], has_more: false }));
    const { gateway } = setup(read);
    const append = {
      path: `/v1/blocks/${pageId}/children`,
      method: 'PATCH',
      body: JSON.stringify({ children: [receipt] }),
    };
    const send = vi.fn(async () => {
      throw new Error('lost append');
    });
    await expect(gateway.dispatch(append, send)).rejects.toThrow();
    await gateway.check();
    const result = await gateway.dispatch(append, send);
    expect(await result.json()).toMatchObject({ results: [{ id: blockId }] });
    expect(send).toHaveBeenCalledTimes(1);
    expect(read.mock.calls).toHaveLength(2);
  });

  it('keeps the save blocked if the create succeeded but its acknowledgement could not be persisted', async () => {
    const { gateway, store, checkpoints } = setup(async ({ method }) =>
      Response.json(method === 'POST' ? { results: [page], has_more: false } : page),
    );
    const durableSave = store.save.getMockImplementation()!;
    store.save
      .mockImplementationOnce(durableSave)
      .mockRejectedValueOnce(new Error('storage failed'));
    const send = vi.fn(async () => Response.json(page));
    await expect(gateway.dispatch(request, send)).rejects.toThrow('storage failed');
    expect(checkpoints()[0]?.status).toBe('uncertain');
    await gateway.check();
    await gateway.dispatch(request, send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('releases only a definitively rejected request and validates checkpoint tampering', async () => {
    const { gateway, checkpoints } = setup(async () => Response.json({}));
    const response = await gateway.dispatch(request, async () =>
      Response.json({}, { status: 429 }),
    );
    expect(response.status).toBe(429);
    expect(checkpoints()).toHaveLength(0);
    await gateway.dispatch(request, async () => Response.json(page));
    checkpoints()[0]!.request.body = request.body.replace('two-sum', 'three-sum');
    await expect(gateway.check()).rejects.toThrow();
  });

  it('refuses to treat two matching receipt containers as one committed append', async () => {
    const child = {
      object: 'block',
      type: 'toggle',
      toggle: { rich_text: [{ type: 'text', text: { content: RECEIPTS_LABEL } }] },
    };
    const { gateway } = setup(async () =>
      Response.json({
        results: [
          { ...child, id: pageId },
          { ...child, id: blockId },
        ],
        has_more: false,
      }),
    );
    await expect(
      gateway.dispatch(
        {
          path: `/v1/blocks/${pageId}/children`,
          method: 'PATCH',
          body: JSON.stringify({ children: [child] }),
        },
        async () => {
          throw new Error('lost');
        },
      ),
    ).rejects.toThrow();
    await expect(gateway.check()).rejects.toThrow();
  });
});
