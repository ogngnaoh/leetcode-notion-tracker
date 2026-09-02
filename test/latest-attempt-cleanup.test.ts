import { describe, expect, it, vi } from 'vitest';
import { applyLatestAttemptCleanup } from '../src/notion/latest-attempt-cleanup.js';
import { planLatestAttempts } from '../src/notion/latest-attempt-maintenance.js';
import { blockText, RECEIPTS_LABEL } from '../src/bridge/latest-attempt.js';

function fixture() {
  const rich = (value: string) => [{ type: 'text', plain_text: value, text: { content: value } }];
  const problem: any = {
    object: 'page',
    id: 'problem',
    url: 'https://notion.so/problem',
    parent: { data_source_id: 'problems' },
    in_trash: false,
    properties: {
      Problem: { type: 'title', title: rich('Two Sum') },
      'External Key': { type: 'rich_text', rich_text: rich('leetcode:two-sum') },
      'First Attempt': { type: 'date', date: { start: '2026-09-01T00:00:00Z' } },
      'Last Attempt': { type: 'date', date: { start: '2026-09-02T00:00:00Z' } },
      'Grind Done': { type: 'checkbox', checkbox: true },
      Attempts: { type: 'relation', relation: [{ id: 'old' }, { id: 'keep' }] },
    },
  };
  const attempt = (id: string, day: string, eventId: string) => ({
    object: 'page',
    id,
    url: `https://notion.so/${id}`,
    parent: { data_source_id: 'attempts' },
    in_trash: false,
    properties: {
      'Problem Key': { type: 'rich_text', rich_text: rich('leetcode:two-sum') },
      'Client Event ID': { type: 'rich_text', rich_text: rich(eventId) },
      Problem: { type: 'relation', relation: [{ id: 'problem' }] },
      'Attempted At': { type: 'date', date: { start: `${day}T00:00:00Z` } },
      'Extension Managed': { type: 'checkbox', checkbox: true },
      Result: { type: 'select', select: { name: 'Solved' } },
      'Resulting State': { type: 'select', select: { name: 'Solved' } },
      'Resulting Solved Streak': { type: 'number', number: 1 },
      'Resulting Next Review': { type: 'date', date: { start: '2026-09-03' } },
    },
  });
  const old = attempt('old', '2026-09-01', 'eb9fdc89-8098-4f76-9a68-26e94dc75fc6');
  const keep = attempt('keep', '2026-09-02', 'd83d5722-13dd-4b2f-8d60-115613364ed4');
  const pages = new Map<string, any>([problem, old, keep].map((p) => [p.id, p]));
  const children = new Map<string, any[]>(
    ['old', 'keep'].map((id) => [
      id,
      [
        { id: `${id}-heading`, type: 'heading_2', heading_2: { rich_text: rich('Captured code') } },
        { id: `${id}-code`, type: 'code', code: { rich_text: rich(`${id} code`) } },
      ],
    ]),
  );
  const snapshot: any = {
    manifest: {
      version: 4,
      problems: { dataSourceId: 'problems' },
      attempts: { dataSourceId: 'attempts' },
    },
    problems: structuredClone([problem]),
    attempts: structuredClone([old, keep]),
    bodies: Object.fromEntries([...children].map(([id, body]) => [id, structuredClone(body)])),
  };
  snapshot.plan = planLatestAttempts(snapshot.problems, snapshot.attempts, snapshot.bodies);
  const writes: string[] = [];
  let seq = 0;
  const notion: any = {
    dataSources: {
      query: vi.fn(async ({ data_source_id }: any) => ({
        results: structuredClone(
          [...pages.values()].filter(
            (p) => p.parent.data_source_id === data_source_id && !p.in_trash,
          ),
        ),
        has_more: false,
        next_cursor: null,
      })),
    },
    pages: {
      retrieve: vi.fn(async ({ page_id }: any) => structuredClone(pages.get(page_id))),
      update: vi.fn(async ({ page_id, in_trash }: any) => {
        writes.push(`trash:${page_id}`);
        pages.get(page_id).in_trash = in_trash;
        problem.properties.Attempts.relation = problem.properties.Attempts.relation.filter(
          (r: any) => r.id !== page_id,
        );
        return structuredClone(pages.get(page_id));
      }),
    },
    blocks: {
      children: {
        list: vi.fn(async ({ block_id }: any) => ({
          results: structuredClone(children.get(block_id) ?? []),
          has_more: false,
          next_cursor: null,
        })),
        append: vi.fn(async ({ block_id, children: added }: any) => {
          writes.push(`append:${block_id}`);
          for (const child of structuredClone(added)) {
            child.id = `new-${++seq}`;
            const nested = child[child.type].children;
            if (nested) {
              child.has_children = true;
              children.set(
                child.id,
                nested.map((b: any) => ({ ...b, id: `new-${++seq}` })),
              );
              delete child[child.type].children;
            }
            children.set(block_id, [...(children.get(block_id) ?? []), child]);
          }
          return {};
        }),
      },
    },
  };
  return { snapshot, notion, pages, children, writes };
}

describe('approved latest-attempt cleanup', () => {
  it('preserves and verifies both receipts before trashing only the old page; rerun is safe', async () => {
    const w = fixture();
    await applyLatestAttemptCleanup(w.notion, w.snapshot);
    expect(w.writes).toEqual(['append:keep', 'trash:old']);
    expect(w.pages.get('keep').in_trash).toBe(false);
    expect(w.pages.get('keep').properties).toEqual(w.snapshot.attempts[1].properties);
    expect(w.children.get('keep')!.slice(0, 2)).toEqual(w.snapshot.bodies.keep);
    const toggle = w.children.get('keep')!.find((b) => blockText(b) === RECEIPTS_LABEL);
    const receipts = w.children.get(toggle.id)!.map((b) => JSON.parse(blockText(b)));
    expect(receipts).toHaveLength(2);
    expect(JSON.stringify(receipts)).not.toContain('old code');
    await applyLatestAttemptCleanup(w.notion, w.snapshot);
    expect(w.writes).toEqual(['append:keep', 'trash:old']);
  });

  it('does not trash if receipt persistence fails', async () => {
    const w = fixture();
    w.notion.blocks.children.append.mockResolvedValue({});
    await expect(applyLatestAttemptCleanup(w.notion, w.snapshot)).rejects.toThrow(/receipt/i);
    expect(w.notion.pages.update).not.toHaveBeenCalled();
  });

  it('resumes an uncertain append without duplicate receipts', async () => {
    const w = fixture();
    const original = w.notion.blocks.children.append.getMockImplementation();
    w.notion.blocks.children.append.mockImplementationOnce(async (request: any) => {
      await original(request);
      throw new Error('lost response');
    });
    await expect(applyLatestAttemptCleanup(w.notion, w.snapshot)).rejects.toThrow('lost response');
    expect(w.notion.pages.update).not.toHaveBeenCalled();
    await applyLatestAttemptCleanup(w.notion, w.snapshot);
    expect(w.writes).toEqual(['append:keep', 'trash:old']);
  });

  it.each(['property', 'body', 'note', 'plan', 'new-page', 'review'])(
    'refuses %s drift before any write',
    async (kind) => {
      const w = fixture();
      if (kind === 'property') w.pages.get('old').properties.Result.select.name = 'Needed help';
      if (kind === 'body') w.children.get('old')![1].code.rich_text[0].text.content = 'edited';
      if (kind === 'note') {
        const note = {
          id: 'note',
          type: 'paragraph',
          paragraph: { rich_text: [{ text: { content: 'my note' } }] },
        };
        w.children.get('old')!.push(note);
        w.snapshot.bodies.old.push(note);
        w.snapshot.plan = planLatestAttempts(
          w.snapshot.problems,
          w.snapshot.attempts,
          w.snapshot.bodies,
        );
      }
      if (kind === 'plan') w.snapshot.plan.groups[0].keepPageId = 'old';
      if (kind === 'new-page')
        w.pages.set('new', { ...structuredClone(w.pages.get('old')), id: 'new' });
      if (kind === 'review')
        w.pages.get('problem').properties['Last Attempt'].date.start = '2026-09-03T00:00:00Z';
      await expect(applyLatestAttemptCleanup(w.notion, w.snapshot)).rejects.toThrow();
      expect(w.writes).toEqual([]);
    },
  );
});
