import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  parseCurriculum,
  propertiesFor,
  planGrind,
  repairGrind,
  type GrindEntry,
} from '../src/notion/grind-maintenance.js';
import {
  verifyDatabasePresentation,
  PROBLEMS_DATABASE_PRESENTATION,
} from '../src/notion/presentation.js';

const entry: GrindEntry = {
  slot: 'day-1-01',
  day: 1,
  block: 'A',
  order: 1,
  slug: 'two-sum',
  title: 'Two Sum',
  number: 1,
};
const sourceId = 'source';
const page = (extra: any = {}) => ({
  id: 'original',
  parent: { data_source_id: sourceId },
  in_trash: false,
  properties: {
    ...propertiesFor(entry),
    'Grind Done': { checkbox: true },
    Attempts: { relation: [{ id: 'attempt' }] },
    ...extra,
  },
});
const state = { dataSourceId: sourceId, pages: { [entry.slot]: 'original' } };

describe('Grind maintenance', () => {
  it('accepts a locked database without treating it as schema damage', () => {
    expect(() =>
      verifyDatabasePresentation(
        {
          icon: PROBLEMS_DATABASE_PRESENTATION.icon,
          description: [{ plain_text: PROBLEMS_DATABASE_PRESENTATION.description }],
          is_locked: true,
        },
        'Problems',
        PROBLEMS_DATABASE_PRESENTATION,
      ),
    ).not.toThrow();
  });
  it('validates the complete immutable 120-row curriculum', () => {
    const data = JSON.parse(readFileSync('config/grind-curriculum.json', 'utf8'));
    expect(parseCurriculum(data).entries).toHaveLength(120);
    data.entries[1] = data.entries[0];
    expect(() => parseCurriculum(data)).toThrow();
  });
  it('does not treat canonical non-Grind duplicates as missing checklist rows', () => {
    const canonical = {
      ...page(),
      id: 'canonical',
      properties: { ...page().properties, 'Grind Day': { select: null } },
    };
    expect(planGrind([entry], state, [page(), canonical], []).actions).toEqual([]);
  });
  it('repairs only curriculum values, preserving progress and relations', async () => {
    let current = page({
      'Grind Day': { select: { name: 'Day 6' } },
      Problem: { title: [{ text: { content: 'Oops' } }] },
    });
    const before = structuredClone(current.properties);
    const plan = planGrind([entry], state, [current], []);
    const api: any = {
      pages: {
        retrieve: vi.fn(async () => current),
        update: vi.fn(async (x) => {
          current = { ...current, properties: { ...current.properties, ...x.properties } };
          return current;
        }),
      },
    };
    await repairGrind(api, plan, async () => {});
    expect(current.properties['Grind Done']).toEqual(before['Grind Done']);
    expect(current.properties.Attempts).toEqual(before.Attempts);
    expect(Object.keys(api.pages.update.mock.calls[0][0].properties).sort()).toEqual([
      'Grind Day',
      'Problem',
    ]);
    expect(planGrind([entry], state, [current], []).actions).toEqual([]);
  });
  it('restores the exact original trashed page, not a new page', async () => {
    let current: any = { ...page(), in_trash: true };
    const plan = planGrind([entry], state, [], [current]);
    expect(plan.actions[0]?.restore).toBe(true);
    const api: any = {
      pages: {
        retrieve: async () => current,
        update: vi.fn(async (x) => {
          current = { ...current, in_trash: false };
          return current;
        }),
      },
    };
    await repairGrind(api, plan, async () => {});
    expect(api.pages.update).toHaveBeenCalledWith({ page_id: 'original', in_trash: false });
  });
  it('blocks unavailable, moved, and extra scheduled pages instead of guessing', () => {
    expect(planGrind([entry], state, [], []).blockers[0]).toContain('unavailable');
    expect(
      planGrind([entry], state, [], [{ ...page(), parent: { data_source_id: 'other' } }])
        .blockers[0],
    ).toContain('moved');
    expect(
      planGrind([entry], state, [page(), { ...page(), id: 'extra' }], []).blockers[0],
    ).toContain('Unexpected');
  });
  it('refuses a stale plan and writes nothing when backup fails', async () => {
    const current = page({ 'Grind Order': { number: 2 } });
    const plan = planGrind([entry], state, [current], []);
    const api: any = {
      pages: { retrieve: async () => page({ 'Grind Order': { number: 3 } }), update: vi.fn() },
    };
    await expect(repairGrind(api, plan, async () => {})).rejects.toThrow('changed');
    expect(api.pages.update).not.toHaveBeenCalled();
    await expect(
      repairGrind(api, plan, async () => {
        throw new Error('disk full');
      }),
    ).rejects.toThrow('disk full');
    expect(api.pages.update).not.toHaveBeenCalled();
  });
  it('stops after an ambiguous write and a fresh check safely resumes', async () => {
    let current = page({ 'Grind Order': { number: 2 } });
    const plan = planGrind([entry], state, [current], []);
    const api: any = {
      pages: {
        retrieve: async () => current,
        update: vi.fn(async (x) => {
          current.properties = { ...current.properties, ...x.properties };
          throw new Error('timeout');
        }),
      },
    };
    await expect(repairGrind(api, plan, async () => {})).rejects.toThrow('timeout');
    expect(api.pages.update).toHaveBeenCalledTimes(1);
    expect(planGrind([entry], state, [current], []).actions).toHaveLength(0);
  });
});
