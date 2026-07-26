import { openSidePanelForTab, type ClickedTab, type SidePanelApi } from './side-panel-launcher.js';

export interface TogglingSidePanelApi extends SidePanelApi {
  close(options: { tabId: number }): Promise<void>;
}

/** Shape shared by chrome.sidePanel.onOpened and onClosed. `tabId` is absent for a global panel. */
export interface PanelPresence {
  tabId?: number | undefined;
  windowId?: number | undefined;
}

export interface RuntimeContext {
  tabId?: number | undefined;
}

export type GetContexts = (filter: { contextTypes: ['SIDE_PANEL'] }) => Promise<RuntimeContext[]>;

/** Tab IDs whose side panel is currently open. */
export type OpenPanels = Set<number>;

export function createOpenPanels(): OpenPanels {
  return new Set<number>();
}

export function rememberOpenPanel(panels: OpenPanels, presence: PanelPresence): void {
  if (presence.tabId === undefined) return;
  panels.add(presence.tabId);
}

export function forgetOpenPanel(panels: OpenPanels, presence: PanelPresence): void {
  if (presence.tabId === undefined) return;
  panels.delete(presence.tabId);
}

/**
 * Rebuilds panel state from the panels Chrome currently has open.
 *
 * The service worker is torn down when idle, taking `panels` with it, while an open side panel
 * survives. Without this, a worker that restarted under an open panel would believe the panel is
 * closed, reopen it as a no-op, and never toggle it shut. Failure is not fatal: an empty set
 * degrades to open-only behavior rather than breaking the command.
 */
export async function hydrateOpenPanels(
  panels: OpenPanels,
  getContexts: GetContexts,
): Promise<void> {
  let contexts: RuntimeContext[];
  try {
    contexts = await getContexts({ contextTypes: ['SIDE_PANEL'] });
  } catch {
    return;
  }
  for (const context of contexts) {
    rememberOpenPanel(panels, { tabId: context.tabId });
  }
}

/**
 * Opens the side panel for `tab`, or closes it when this tab already has one open.
 *
 * The open decision reads `panels` synchronously on purpose. `sidePanel.open()` is rejected outright
 * unless it runs while the user gesture is still active, so nothing may be awaited ahead of it —
 * which is also why panel state is held in memory rather than read from storage.
 */
export async function toggleSidePanelForTab(
  tab: ClickedTab,
  api: TogglingSidePanelApi,
  panels: OpenPanels,
): Promise<'opened' | 'closed' | 'ignored'> {
  if (tab.id === undefined) return 'ignored';
  if (panels.has(tab.id)) {
    await api.close({ tabId: tab.id });
    return 'closed';
  }
  await openSidePanelForTab(tab, api);
  return 'opened';
}
