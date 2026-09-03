import { describe, expect, it } from 'vitest';
import {
  PrivateResponseGate,
  PanelStateRevision,
  selectReviewRows,
} from '../extension/src/panel-private-state.js';

describe('panel private response gate', () => {
  it('rejects a reply already in transit when Lock or navigation clears the panel', () => {
    const gate = new PrivateResponseGate();
    const started = gate.ticket();
    gate.invalidate();
    expect(gate.accepts(started)).toBe(false);
    expect(gate.accepts(gate.ticket())).toBe(true);
  });
  it('combines review date/outcome and normalized search without truncating the source', () => {
    const rows = [
      { title: 'Two Sum', nextReview: '2026-09-03', practiceState: 'Solved' },
      { title: 'Three Sum', nextReview: '2026-09-02', practiceState: 'Needed help' },
      { title: 'Other', nextReview: '2026-09-02', practiceState: 'Solved' },
    ];
    expect(selectReviewRows(rows, '2026-09-03', 'needed-help', ' SUM ')).toEqual([rows[1]]);
    expect(selectReviewRows(rows, '2026-09-03', 'today', '')).toEqual([rows[0]]);
    expect(rows).toHaveLength(3);
  });
});

describe('panel state revision', () => {
  it('rejects replies already in transit before another operation in the same grant', () => {
    const revision = new PanelStateRevision();
    expect(revision.observe('vault', 'grant', 4)).toBe(true);
    expect(revision.observe('vault', 'grant', 6)).toBe(true);
    expect(revision.observe('vault', 'grant', 5)).toBe(false);
    expect(revision.observe('vault', 'grant', 6)).toBe(true);
    expect(revision.observe('vault', 'new-grant', 0)).toBe(true);
  });
});
