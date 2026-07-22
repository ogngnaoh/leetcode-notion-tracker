import { describe, expect, it, vi } from 'vitest';
import {
  dashboardUrlFromBridgeUrl,
  openDashboardShortcut,
} from '../extension/src/dashboard-shortcut.js';

describe('extension dashboard shortcut', () => {
  it.each([
    ['http://127.0.0.1:8787', 'http://127.0.0.1:8787/dashboard'],
    ['http://localhost:8787/', 'http://localhost:8787/dashboard'],
    ['https://bridge.example.test/base?ignored=1#ignored', 'https://bridge.example.test/dashboard'],
  ])('derives the dashboard URL from %s', (bridgeUrl, expected) => {
    expect(dashboardUrlFromBridgeUrl(bridgeUrl)).toBe(expected);
  });

  it.each(['', 'not a url', 'chrome://settings', 'file:///tmp/bridge', 'http://user:pass@host'])(
    'rejects invalid Bridge URL %j',
    (bridgeUrl) => {
      expect(() => dashboardUrlFromBridgeUrl(bridgeUrl)).toThrow('valid HTTP or HTTPS Bridge URL');
    },
  );

  it('focuses an active exact dashboard match before other matching tabs', async () => {
    const focusWindow = vi.fn(async () => undefined);
    const activateTab = vi.fn(async () => undefined);
    const createTab = vi.fn(async () => undefined);

    await openDashboardShortcut('http://127.0.0.1:8787', {
      queryTabs: vi.fn(async () => [
        { id: 2, windowId: 20, active: false, url: 'http://127.0.0.1:8787/dashboard' },
        { id: 3, windowId: 30, active: true, url: 'http://127.0.0.1:8787/dashboard?refresh=1' },
        { id: 4, windowId: 40, active: true, url: 'http://127.0.0.1:8787/dashboard/other' },
      ]),
      focusWindow,
      activateTab,
      createTab,
    });

    expect(focusWindow).toHaveBeenCalledWith(30);
    expect(activateTab).toHaveBeenCalledWith(3);
    expect(createTab).not.toHaveBeenCalled();
  });

  it('requires the same origin and exact /dashboard pathname', async () => {
    const createTab = vi.fn(async () => undefined);
    await openDashboardShortcut('http://127.0.0.1:8787', {
      queryTabs: vi.fn(async () => [
        { id: 2, windowId: 20, active: true, url: 'http://localhost:8787/dashboard' },
        { id: 3, windowId: 30, active: false, url: 'http://127.0.0.1:8787/dashboard/' },
        { id: 4, windowId: 40, active: false, url: 'http://127.0.0.1:8787/other' },
      ]),
      focusWindow: vi.fn(async () => undefined),
      activateTab: vi.fn(async () => undefined),
      createTab,
    });

    expect(createTab).toHaveBeenCalledWith('http://127.0.0.1:8787/dashboard');
  });

  it('creates one dashboard tab when there is no match', async () => {
    const createTab = vi.fn(async () => undefined);
    await openDashboardShortcut('http://127.0.0.1:8787', {
      queryTabs: vi.fn(async () => []),
      focusWindow: vi.fn(async () => undefined),
      activateTab: vi.fn(async () => undefined),
      createTab,
    });
    expect(createTab).toHaveBeenCalledOnce();
    expect(createTab).toHaveBeenCalledWith('http://127.0.0.1:8787/dashboard');
  });
});
