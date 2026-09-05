import { describe, expect, it } from 'vitest';
import { PrivateResponseGate, PanelStateRevision } from '../extension/src/panel-private-state.js';

describe('panel private response gate', () => {
  it('rejects a reply already in transit when Lock or navigation clears the panel', () => {
    const gate = new PrivateResponseGate();
    const started = gate.ticket();
    gate.invalidate();
    expect(gate.accepts(started)).toBe(false);
    expect(gate.accepts(gate.ticket())).toBe(true);
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
