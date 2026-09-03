import { describe, expect, it } from 'vitest';
import { parseNotionRequest, isNotionSender } from '../extension/src/notion-protocol.js';

describe('direct Notion command boundary', () => {
  it('accepts only exact packaged sidebar URLs and own normal-profile messages', () => {
    const sender = { id: 'abc', url: 'chrome-extension://abc/sidepanel.html?tabId=12' };
    expect(isNotionSender(sender, 'abc')).toBe(true);
    expect(
      isNotionSender({ ...sender, url: 'https://leetcode.com/problems/two-sum/' }, 'abc'),
    ).toBe(false);
    expect(isNotionSender({ ...sender, id: 'other' }, 'abc')).toBe(false);
    expect(
      isNotionSender({ ...sender, url: 'chrome-extension://abc/sidepanel.html/evil' }, 'abc'),
    ).toBe(false);
    expect(isNotionSender({ ...sender, tab: { incognito: true } }, 'abc')).toBe(false);
  });
  it('refuses generic URLs, extra fields and oversized secrets before dispatch', () => {
    const request = { type: 'lctrack.notion', version: 1, id: 'request-1', op: 'connection.state' };
    expect(parseNotionRequest(request)).toEqual(request);
    expect(() => parseNotionRequest({ ...request, url: 'https://evil.test' })).toThrow();
    expect(() => parseNotionRequest({ ...request, version: 2 })).toThrow();
    expect(() =>
      parseNotionRequest({ ...request, op: 'connection.unlock', passphrase: '🧩'.repeat(1024) }),
    ).toThrow();
    expect(() =>
      parseNotionRequest({ ...request, op: 'capture.retry', eventId: 'not-a-uuid' }),
    ).toThrow();
  });
});
