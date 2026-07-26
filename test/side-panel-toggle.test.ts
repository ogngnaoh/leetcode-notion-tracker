import { describe, expect, it, vi } from 'vitest';
import {
  createOpenPanels,
  forgetOpenPanel,
  hydrateOpenPanels,
  rememberOpenPanel,
  toggleSidePanelForTab,
} from '../extension/src/side-panel-toggle.js';

function togglingApi() {
  return {
    setPanelBehavior: vi.fn(async () => undefined),
    setOptions: vi.fn(async () => undefined),
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  };
}

describe('side panel toggle', () => {
  it('opens the panel for a tab with none recorded', async () => {
    const api = togglingApi();
    const panels = createOpenPanels();

    await expect(toggleSidePanelForTab({ id: 42 }, api, panels)).resolves.toBe('opened');

    expect(api.setOptions).toHaveBeenCalledWith({
      tabId: 42,
      path: 'sidepanel.html',
      enabled: true,
    });
    expect(api.open).toHaveBeenCalledWith({ tabId: 42 });
    expect(api.close).not.toHaveBeenCalled();
  });

  it('closes the panel for a tab already recorded as open', async () => {
    const api = togglingApi();
    const panels = createOpenPanels();
    rememberOpenPanel(panels, { tabId: 42, windowId: 7 });

    await expect(toggleSidePanelForTab({ id: 42 }, api, panels)).resolves.toBe('closed');

    expect(api.close).toHaveBeenCalledWith({ tabId: 42 });
    expect(api.open).not.toHaveBeenCalled();
  });

  it('calls open before awaiting configuration so Chrome retains the user gesture', async () => {
    const api = togglingApi();
    const panels = createOpenPanels();
    let finishConfiguration!: () => void;
    api.setOptions.mockReturnValueOnce(
      new Promise<undefined>((resolve) => {
        finishConfiguration = () => resolve(undefined);
      }),
    );

    const toggling = toggleSidePanelForTab({ id: 42 }, api, panels);

    expect(api.open).toHaveBeenCalledWith({ tabId: 42 });
    finishConfiguration();
    await expect(toggling).resolves.toBe('opened');
  });

  it('reads panel state synchronously so no await precedes the open call', () => {
    const api = togglingApi();
    const panels = createOpenPanels();

    void toggleSidePanelForTab({ id: 42 }, api, panels);

    // No await has run yet: if the decision required async state, open would still be pending.
    expect(api.open).toHaveBeenCalledWith({ tabId: 42 });
  });

  it('toggles back to open after the panel is recorded closed', async () => {
    const api = togglingApi();
    const panels = createOpenPanels();
    rememberOpenPanel(panels, { tabId: 42, windowId: 7 });
    forgetOpenPanel(panels, { tabId: 42, windowId: 7 });

    await expect(toggleSidePanelForTab({ id: 42 }, api, panels)).resolves.toBe('opened');

    expect(api.open).toHaveBeenCalledWith({ tabId: 42 });
  });

  it('keeps per-tab state so one tab closing leaves another tab open', async () => {
    const api = togglingApi();
    const panels = createOpenPanels();
    rememberOpenPanel(panels, { tabId: 1, windowId: 7 });
    rememberOpenPanel(panels, { tabId: 2, windowId: 7 });
    forgetOpenPanel(panels, { tabId: 1, windowId: 7 });

    await expect(toggleSidePanelForTab({ id: 1 }, api, panels)).resolves.toBe('opened');
    await expect(toggleSidePanelForTab({ id: 2 }, api, panels)).resolves.toBe('closed');
  });

  it('ignores a command that arrives without a tab ID', async () => {
    const api = togglingApi();
    const panels = createOpenPanels();

    await expect(toggleSidePanelForTab({ id: undefined }, api, panels)).resolves.toBe('ignored');

    expect(api.open).not.toHaveBeenCalled();
    expect(api.close).not.toHaveBeenCalled();
  });

  it('ignores presence events for a global panel that names no tab', async () => {
    const api = togglingApi();
    const panels = createOpenPanels();

    rememberOpenPanel(panels, { windowId: 7 });

    await expect(toggleSidePanelForTab({ id: 42 }, api, panels)).resolves.toBe('opened');
  });

  it('hydrates open tabs from the live side panel contexts after a worker restart', async () => {
    const panels = createOpenPanels();
    const getContexts = vi.fn(async () => [
      { contextType: 'SIDE_PANEL', tabId: 42, windowId: 7 },
      { contextType: 'SIDE_PANEL', tabId: 43, windowId: 7 },
    ]);

    await hydrateOpenPanels(panels, getContexts);

    expect(getContexts).toHaveBeenCalledWith({ contextTypes: ['SIDE_PANEL'] });
    expect([...panels].sort()).toEqual([42, 43]);
  });

  it('closes a panel Chrome reports open even though this worker never saw it open', async () => {
    const api = togglingApi();
    const panels = createOpenPanels();
    const getContexts = vi.fn(async () => [{ contextType: 'SIDE_PANEL', tabId: 42, windowId: 7 }]);

    await hydrateOpenPanels(panels, getContexts);

    await expect(toggleSidePanelForTab({ id: 42 }, api, panels)).resolves.toBe('closed');
    expect(api.close).toHaveBeenCalledWith({ tabId: 42 });
  });

  it('leaves state empty when the runtime cannot report contexts', async () => {
    const panels = createOpenPanels();
    const getContexts = vi.fn(async () => {
      throw new Error('getContexts is unavailable');
    });

    await expect(hydrateOpenPanels(panels, getContexts)).resolves.toBeUndefined();
    expect([...panels]).toEqual([]);
  });

  it('skips contexts that report no tab ID', async () => {
    const panels = createOpenPanels();
    const getContexts = vi.fn(async () => [
      { contextType: 'SIDE_PANEL', windowId: 7 },
      { contextType: 'SIDE_PANEL', tabId: 42, windowId: 7 },
    ]);

    await hydrateOpenPanels(panels, getContexts);

    expect([...panels]).toEqual([42]);
  });
});
