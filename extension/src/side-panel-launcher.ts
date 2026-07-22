export interface ClickedTab {
  id?: number | undefined;
  url?: string | undefined;
}

export interface SidePanelApi {
  setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
  setOptions(options: { tabId?: number; path?: string; enabled: boolean }): Promise<void>;
  open(options: { tabId: number }): Promise<void>;
}

export async function configureTabScopedSidePanel(api: SidePanelApi): Promise<void> {
  await api.setPanelBehavior({ openPanelOnActionClick: false });
  await api.setOptions({ enabled: false });
}

export async function openSidePanelForTab(tab: ClickedTab, api: SidePanelApi): Promise<boolean> {
  if (tab.id === undefined) return false;
  const configuration = api.setOptions({
    tabId: tab.id,
    path: 'sidepanel.html',
    enabled: true,
  });
  const opening = api.open({ tabId: tab.id });
  await Promise.all([configuration, opening]);
  return true;
}
