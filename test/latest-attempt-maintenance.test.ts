import { describe, expect, it, vi } from 'vitest';
import {
  planLatestAttempts,
  GRIND_OPEN_FORMULA,
  updateGrindLink,
  updateGrindAliasLinks,
} from '../src/notion/latest-attempt-maintenance.js';

function attempt(id: string, at: string, problemId = 'problem-1', key = 'leetcode:two-sum'): any {
  return {
    object: 'page',
    id,
    url: `https://www.notion.so/${id}`,
    properties: {
      'Problem Key': { type: 'rich_text', rich_text: [{ plain_text: key }] },
      'Client Event ID': {
        type: 'rich_text',
        rich_text: [
          {
            plain_text:
              id === 'older'
                ? 'eb9fdc89-8098-4f76-9a68-26e94dc75fc6'
                : 'd83d5722-13dd-4b2f-8d60-115613364ed4',
          },
        ],
      },
      Problem: { type: 'relation', relation: [{ id: problemId }] },
      'Attempted At': { type: 'date', date: { start: at } },
      'Extension Managed': { type: 'checkbox', checkbox: true },
      Result: { type: 'select', select: { name: 'Solved' } },
      'Resulting State': { type: 'select', select: { name: 'Solved' } },
      'Resulting Solved Streak': { type: 'number', number: 1 },
      'Resulting Next Review': { type: 'date', date: { start: '2026-09-03' } },
    },
  };
}
const problem: any = {
  id: 'problem-1',
  properties: {
    'External Key': { type: 'rich_text', rich_text: [{ plain_text: 'leetcode:two-sum' }] },
    Problem: { type: 'title', title: [{ plain_text: 'Two Sum' }] },
    'First Attempt': { type: 'date', date: { start: '2026-09-01T00:00:00Z' } },
    'Last Attempt': { type: 'date', date: { start: '2026-09-02T00:00:00Z' } },
  },
};
const bodies = {
  older: [
    { type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Captured code' }] } },
    { type: 'code', code: { rich_text: [{ plain_text: 'old code' }] } },
  ],
  latest: [
    { type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Captured code' }] } },
    { type: 'code', code: { rich_text: [{ plain_text: 'new code' }] } },
  ],
};

describe('latest-attempt maintenance', () => {
  it('links only the alias field and preserves checkboxes and the canonical relation', async () => {
    const original = {
      id: 'alias',
      properties: {
        'Grind Done': { type: 'checkbox', checkbox: true },
        Attempts: { type: 'relation', relation: [] },
      },
    };
    const before = {
      ...original,
      properties: {
        ...original.properties,
        'Grind Open': { type: 'formula', formula: { string: 'Problem' } },
        'Grind Attempt': { type: 'relation', relation: [] },
      },
    };
    const after = structuredClone(before) as any;
    after.properties['Grind Attempt'].relation = [{ id: 'attempt' }];
    const notion: any = {
      pages: {
        retrieve: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after),
        update: vi.fn(),
      },
    };
    await updateGrindAliasLinks(notion, {
      problems: [original],
      plan: { aliasLinks: [{ problemPageId: 'alias', attemptPageId: 'attempt' }] },
    } as any);
    expect(notion.pages.update).toHaveBeenCalledExactlyOnceWith({
      page_id: 'alias',
      properties: { 'Grind Attempt': { relation: [{ id: 'attempt' }] } },
    });
  });

  it('plans alias links for Grind-only duplicate rows without moving canonical relations', () => {
    const alias = structuredClone(problem);
    alias.id = 'grind-alias';
    alias.properties.Attempts = { type: 'relation', relation: [] };
    alias.properties['Grind Day'] = { type: 'select', select: { name: 'Day 6' } };
    alias.properties['Extension Managed'] = { type: 'checkbox', checkbox: false };
    const plan = planLatestAttempts(
      [problem, alias],
      [attempt('latest', '2026-09-02T00:00:00Z')],
      bodies,
    );
    expect(plan.blockers).toEqual([]);
    expect(plan.aliasLinks).toEqual([{ problemPageId: 'grind-alias', attemptPageId: 'latest' }]);
  });

  it('keeps the latest instant, not lexicographically greatest timestamp, and prepares old receipts', () => {
    const plan = planLatestAttempts(
      [problem],
      [attempt('older', '2026-09-01T23:00:00+03:00'), attempt('latest', '2026-09-01T22:00:00Z')],
      bodies,
    );
    expect(plan.groups[0]).toMatchObject({ keepPageId: 'latest', trashPageIds: ['older'] });
    expect(plan.trashCount).toBe(1);
    expect(plan.blockers).toEqual([]);
    expect(plan.groups[0]!.receipts).toHaveLength(2);
    expect(JSON.stringify(plan.groups[0]!.receipts)).not.toContain('old code');
  });
  it('blocks ambiguous timestamps, unmanaged rows, wrong relations and incomplete backups', () => {
    const older = attempt('older', '2026-09-02T00:00:00Z');
    const latest = attempt('latest', '2026-09-02T00:00:00Z');
    expect(planLatestAttempts([problem], [older, latest], bodies).blockers.join(' ')).toMatch(
      /same timestamp/i,
    );
    older.properties['Extension Managed'].checkbox = false;
    expect(planLatestAttempts([problem], [older], bodies).blockers.join(' ')).toMatch(/unmanaged/i);
    expect(
      planLatestAttempts(
        [problem],
        [attempt('older', '2026-09-01T00:00:00Z', 'wrong')],
        bodies,
      ).blockers.join(' '),
    ).toMatch(/relation/i);
    expect(planLatestAttempts([problem], [latest], {}).blockers.join(' ')).toMatch(/body/i);
  });
  it('updates only the existing Grind formula by property ID and verifies read-back', async () => {
    const before = {
      properties: {
        'Grind Open': { id: 'formula-id', type: 'formula', formula: { expression: 'old' } },
        Attempts: { type: 'relation', relation: { data_source_id: 'attempts' } },
        'Grind Attempt': {
          type: 'relation',
          relation: { data_source_id: 'attempts', type: 'single_property' },
        },
        URL: { type: 'url' },
      },
    };
    const after = structuredClone(before);
    after.properties['Grind Open'].formula.expression = GRIND_OPEN_FORMULA;
    const notion: any = {
      dataSources: {
        retrieve: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after),
        update: vi.fn(),
      },
    };
    await updateGrindLink(notion, 'problems', before);
    expect(notion.dataSources.update).toHaveBeenCalledExactlyOnceWith({
      data_source_id: 'problems',
      properties: { 'formula-id': { formula: { expression: GRIND_OPEN_FORMULA } } },
    });
    expect(GRIND_OPEN_FORMULA).toContain('Attempted At');
    expect(GRIND_OPEN_FORMULA).not.toContain('link(');
    expect(GRIND_OPEN_FORMULA).toContain(
      'attempts.filter(current.id() == latestId).unique().slice(0, 1)',
    );
    // concat's argument is evaluated in the related-page context in Notion.
    expect(GRIND_OPEN_FORMULA).toContain('lets(grind, prop("Grind Attempt"),');
    expect(GRIND_OPEN_FORMULA).toContain('.concat(grind)');
  });
  it('refuses a changed formula between backup and mutation', async () => {
    const before = {
      properties: { 'Grind Open': { id: 'id', type: 'formula', formula: { expression: 'old' } } },
    };
    const notion: any = {
      dataSources: { retrieve: vi.fn().mockResolvedValue({ properties: {} }), update: vi.fn() },
    };
    await expect(updateGrindLink(notion, 'problems', before)).rejects.toThrow(/changed/i);
    expect(notion.dataSources.update).not.toHaveBeenCalled();
  });

  it('accepts the formula already saved by the Notion editor without rewriting it', async () => {
    const source = {
      properties: {
        'Grind Open': {
          id: 'formula-id',
          type: 'formula',
          formula: { expression: GRIND_OPEN_FORMULA },
        },
        Attempts: { type: 'relation', relation: { data_source_id: 'attempts' } },
        'Grind Attempt': {
          type: 'relation',
          relation: { data_source_id: 'attempts', type: 'single_property' },
        },
        URL: { type: 'url' },
      },
    };
    const notion: any = {
      dataSources: { retrieve: vi.fn().mockResolvedValue(source), update: vi.fn() },
    };
    await updateGrindLink(notion, 'problems', source);
    expect(notion.dataSources.update).not.toHaveBeenCalled();
  });

  it('supports the renamed Solution formula without adding a second property', async () => {
    const before = {
      properties: {
        Solution: { id: 'formula-id', type: 'formula', formula: { expression: 'old' } },
        Attempts: { type: 'relation', relation: { data_source_id: 'attempts' } },
        'Grind Attempt': {
          type: 'relation',
          relation: { data_source_id: 'attempts', type: 'single_property' },
        },
        URL: { type: 'url' },
      },
    };
    const after = structuredClone(before);
    after.properties.Solution.formula.expression = GRIND_OPEN_FORMULA;
    const notion: any = {
      dataSources: {
        retrieve: vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after),
        update: vi.fn(),
      },
    };
    await updateGrindLink(notion, 'problems', before);
    expect(notion.dataSources.update).toHaveBeenCalledExactlyOnceWith({
      data_source_id: 'problems',
      properties: { 'formula-id': { formula: { expression: GRIND_OPEN_FORMULA } } },
    });
  });
});
