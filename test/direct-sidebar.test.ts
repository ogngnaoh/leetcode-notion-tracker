import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('direct Notion sidebar boundary', () => {
  it('keeps connection forms in the sidebar and makes Chrome options a credential-free launcher', async () => {
    const panel = await readFile('extension/sidepanel.html', 'utf8');
    const options = await readFile('extension/options.html', 'utf8');
    expect(panel).not.toContain('id="review-panel"');
    expect(panel).not.toContain('id="review-tab"');
    expect(panel).toContain('id="connection-form"');
    expect(panel).toContain('id="unlock-form"');
    expect(panel).toContain('id="pending-recovery"');
    expect(panel).not.toContain('id="open-dashboard"');
    expect(options).not.toMatch(/<input|<form/);
    expect(options).toContain('Open LCTrack Settings');
  });
});
