import { describe, expect, it } from 'vitest';
import { dailyViewPatch, guardDrift } from '../src/notion/grind-guards.js';
const ids = {
  Problem: 'title',
  Number: 'n',
  'Grind Done': 'done',
  Solution: 'solution',
  'Grind Day': 'day',
  'Grind Block': 'block',
  'Grind Order': 'order',
};
describe('Grind protections', () => {
  it('exposes only the checklist, title and solution while preserving day/block navigation', () => {
    const patch = dailyViewPatch(ids, 4);
    expect(patch.filter).toEqual({ property: 'day', select: { equals: 'Day 4' } });
    expect(patch.configuration.properties.map((p) => p.property_id)).toEqual([
      'title',
      'done',
      'solution',
    ]);
    expect(patch.configuration.group_by.property_id).toBe('block');
    expect(patch.sorts).toEqual([{ property: 'order', direction: 'ascending' }]);
  });
  it('ignores extra API response metadata and hidden columns but detects visible drift', () => {
    const patch = dailyViewPatch(ids, 4);
    const view = structuredClone(patch) as any;
    view.configuration.properties.push({ property_id: 'n', visible: false });
    view.configuration.properties[0].property_name = 'Problem';
    expect(guardDrift(view, patch)).toBe(false);
    view.configuration.properties.at(-1).visible = true;
    expect(guardDrift(view, patch)).toBe(true);
  });
});
