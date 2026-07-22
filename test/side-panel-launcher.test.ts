import { describe, expect, it, vi } from 'vitest';
import {
  configureTabScopedSidePanel,
  openSidePanelForTab,
} from '../extension/src/side-panel-launcher.js';

function sidePanelApi() {
  return {
    setPanelBehavior: vi.fn(async () => undefined),
    setOptions: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
  };
}

describe('tab-scoped side panel launcher', () => {
  it('disables global action-click behavior and the global side panel', async () => {
    const api = sidePanelApi();

    await configureTabScopedSidePanel(api);

    expect(api.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: false });
    expect(api.setOptions).toHaveBeenCalledWith({ enabled: false });
  });

  it('opens a tab-specific panel for the clicked tab', async () => {
    const api = sidePanelApi();

    await expect(
      openSidePanelForTab({ id: 42, url: 'https://leetcode.com/problems/two-sum/' }, api),
    ).resolves.toBe(true);

    expect(api.setOptions).toHaveBeenCalledWith({
      tabId: 42,
      path: 'sidepanel.html',
      enabled: true,
    });
    expect(api.open).toHaveBeenCalledWith({ tabId: 42 });
  });

  it('calls open before awaiting tab configuration so Chrome retains the user gesture', async () => {
    let finishConfiguration!: () => void;
    const configuration = new Promise<undefined>((resolve) => {
      finishConfiguration = () => resolve(undefined);
    });
    const api = sidePanelApi();
    api.setOptions.mockReturnValueOnce(configuration);

    const opening = openSidePanelForTab({ id: 42, url: 'https://example.com/' }, api);

    expect(api.setOptions).toHaveBeenCalledOnce();
    expect(api.open).toHaveBeenCalledWith({ tabId: 42 });
    finishConfiguration();
    await expect(opening).resolves.toBe(true);
  });

  it.each([
    'https://leetcode.com/problems/two-sum/',
    'https://example.com/articles/side-panels',
    'http://localhost:3000/dashboard',
  ])('opens independently from arbitrary clicked tab %s', async (url) => {
    const api = sidePanelApi();

    await expect(openSidePanelForTab({ id: 42, url }, api)).resolves.toBe(true);

    expect(api.setOptions).toHaveBeenCalledWith({
      tabId: 42,
      path: 'sidepanel.html',
      enabled: true,
    });
    expect(api.open).toHaveBeenCalledWith({ tabId: 42 });
  });

  it('does not open when Chrome does not supply a tab ID', async () => {
    const api = sidePanelApi();

    await expect(
      openSidePanelForTab({ id: undefined, url: 'https://example.com/' }, api),
    ).resolves.toBe(false);

    expect(api.setOptions).not.toHaveBeenCalled();
    expect(api.open).not.toHaveBeenCalled();
  });
});
