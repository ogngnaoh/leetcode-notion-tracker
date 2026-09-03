import type { CaptureEvent, NotionManifest } from '../../src/shared/contract.js';

export const manifest: NotionManifest = {
  version: 4,
  notionApiVersion: '2026-03-11',
  createdAt: '2026-09-03T00:00:00Z',
  parentPageId: 'synthetic-parent',
  problems: { databaseId: 'problems', dataSourceId: 'problems' },
  attempts: { databaseId: 'attempts', dataSourceId: 'attempts' },
};

export function captureEvent(index: number): CaptureEvent {
  return {
    clientEventId: `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, '0')}`,
    problem: {
      slug: 'two-sum',
      title: 'Two Sum',
      number: 1,
      url: 'https://leetcode.com/problems/two-sum/',
      difficulty: 'Easy',
      topics: ['Array'],
    },
    attempt: {
      attemptedAt: new Date(Date.UTC(2026, 8, 3, 0, index)).toISOString(),
      attemptedOn: '2026-09-03',
      language: 'Python',
      result: 'Solved',
      code: `# Synthetic benchmark capture ${index}\ndef twoSum(nums, target):\n    return []\n${'# synthetic code padding\n'.repeat(30)}`,
    },
  };
}

// Stateful REST double. Only the parent benchmark owns it, so helper restarts do not erase Notion state.
// No user data, real token, or forwarding network client is accepted here.
export class SyntheticNotion {
  private sequence = 0;
  private pages = new Map<string, any>();
  private blocks = new Map<string, any>();
  private children = new Map<string, string[]>();
  counts = { capture: 0, dashboard: 0 };
  active = 0;
  latencyMs = 0;
  resetCounts(): void {
    this.counts = { capture: 0, dashboard: 0 };
  }
  reset(): void {
    if (this.active) throw new Error('Cannot reset active fixture');
    this.pages.clear();
    this.blocks.clear();
    this.children.clear();
    this.sequence = 0;
    this.resetCounts();
  }
  private addBlocks(parent: string, values: any[]): any[] {
    return values.map((value) => {
      const block = structuredClone(value);
      block.id = `block-${++this.sequence}`;
      const nested = block[block.type]?.children;
      if (nested) delete block[block.type].children;
      block.has_children = Boolean(nested?.length);
      this.blocks.set(block.id, block);
      this.children.set(parent, [...(this.children.get(parent) ?? []), block.id]);
      if (nested) this.addBlocks(block.id, nested);
      return block;
    });
  }
  private properties(props: any): any {
    return Object.fromEntries(
      Object.entries(props).map(([name, raw]) => {
        const value = structuredClone(raw) as any;
        const type = Object.keys(value)[0]!;
        if (type === 'title' || type === 'rich_text') {
          for (const text of value[type]) text.plain_text = text.text.content;
        }
        return [name, { ...value, type }];
      }),
    );
  }
  async respond(input: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input);
    const path = url.pathname;
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
    const dashboard = Boolean(body.filter?.date);
    this.counts[dashboard ? 'dashboard' : 'capture']++;
    this.active++;
    try {
      if (this.latencyMs) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
      let result: any;
      const query = /^\/v1\/data_sources\/([^/]+)\/query$/.exec(path);
      const page = /^\/v1\/pages\/([^/]+)$/.exec(path);
      const children = /^\/v1\/blocks\/([^/]+)\/children$/.exec(path);
      const block = /^\/v1\/blocks\/([^/]+)$/.exec(path);
      if (method === 'POST' && query) {
        let rows = [...this.pages.values()].filter((p) => p.parent.data_source_id === query[1]);
        const filter = body.filter;
        if (filter?.rich_text)
          rows = rows.filter(
            (p) =>
              p.properties[filter.property]?.rich_text.map((r: any) => r.plain_text).join('') ===
              filter.rich_text.equals,
          );
        if (filter?.date)
          rows = rows.filter((p) => {
            const date = p.properties[filter.property]?.date?.start;
            return (
              date &&
              (filter.date.equals
                ? date.slice(0, 10) === filter.date.equals
                : filter.date.after
                  ? Date.parse(date) > Date.parse(filter.date.after)
                  : date.slice(0, 10) <= filter.date.on_or_before)
            );
          });
        if (body.sorts?.[0]?.property === 'Attempted At')
          rows.sort(
            (a, b) =>
              Date.parse(b.properties['Attempted At'].date.start) -
              Date.parse(a.properties['Attempted At'].date.start),
          );
        result = this.list(rows, body.start_cursor, body.page_size);
      } else if (method === 'POST' && path === '/v1/pages') {
        result = {
          object: 'page',
          id: `page-${++this.sequence}`,
          parent: body.parent,
          url: 'https://www.notion.so/synthetic',
          created_time: '2026-09-03T00:00:00Z',
          properties: this.properties(body.properties),
          in_trash: false,
        };
        this.pages.set(result.id, result);
        this.addBlocks(result.id, body.children ?? []);
      } else if (page && (method === 'GET' || method === 'PATCH')) {
        result = this.pages.get(page[1]!);
        if (!result) throw new Error('Unknown synthetic page');
        if (method === 'PATCH')
          Object.assign(result.properties, this.properties(body.properties ?? {}));
      } else if (children && method === 'GET') {
        result = this.list(
          (this.children.get(children[1]!) ?? []).map((id) => this.blocks.get(id)),
          url.searchParams.get('start_cursor'),
          Number(url.searchParams.get('page_size') ?? 100),
        );
      } else if (children && method === 'PATCH') {
        result = {
          object: 'list',
          results: this.addBlocks(children[1]!, body.children),
          has_more: false,
          next_cursor: null,
        };
      } else if (block && method === 'PATCH') {
        result = this.blocks.get(block[1]!);
        if (!result) throw new Error('Unknown synthetic block');
        Object.assign(result, structuredClone(body));
      } else throw new Error(`Unsupported synthetic route: ${method} ${path}`);
      return Response.json(result);
    } finally {
      this.active--;
    }
  }
  private list(rows: any[], cursor: unknown, size = 100) {
    const start = Number(cursor ?? 0);
    return {
      object: 'list',
      results: rows.slice(start, start + size),
      has_more: start + size < rows.length,
      next_cursor: start + size < rows.length ? String(start + size) : null,
    };
  }
}
