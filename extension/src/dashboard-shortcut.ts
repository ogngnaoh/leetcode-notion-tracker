export interface DashboardTab {
  id?: number | undefined;
  windowId?: number | undefined;
  active?: boolean | undefined;
  url?: string | undefined;
}

export interface DashboardShortcutChrome {
  queryTabs(): Promise<DashboardTab[]>;
  focusWindow(windowId: number): Promise<void>;
  activateTab(tabId: number): Promise<void>;
  createTab(url: string): Promise<void>;
}

export function dashboardUrlFromBridgeUrl(bridgeUrl: string): string {
  try {
    if (bridgeUrl.trim() !== bridgeUrl || bridgeUrl.length === 0) throw new Error('invalid');
    const parsed = new URL(bridgeUrl);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username !== '' ||
      parsed.password !== ''
    ) {
      throw new Error('invalid');
    }
    return new URL('/dashboard', parsed.origin).href;
  } catch {
    throw new Error(
      'Dashboard shortcut needs a valid HTTP or HTTPS Bridge URL. Open Bridge settings to fix it.',
    );
  }
}

function isExactDashboardTab(tab: DashboardTab, dashboardUrl: string): boolean {
  if (tab.id === undefined || tab.windowId === undefined || !tab.url) return false;
  try {
    const candidate = new URL(tab.url);
    const expected = new URL(dashboardUrl);
    return candidate.origin === expected.origin && candidate.pathname === '/dashboard';
  } catch {
    return false;
  }
}

export async function openDashboardShortcut(
  bridgeUrl: string,
  chromeApi: DashboardShortcutChrome,
): Promise<void> {
  const dashboardUrl = dashboardUrlFromBridgeUrl(bridgeUrl);
  const matches = (await chromeApi.queryTabs()).filter((tab) =>
    isExactDashboardTab(tab, dashboardUrl),
  );
  const match = matches.find((tab) => tab.active) ?? matches[0];
  if (match?.id !== undefined && match.windowId !== undefined) {
    await chromeApi.focusWindow(match.windowId);
    await chromeApi.activateTab(match.id);
    return;
  }
  await chromeApi.createTab(dashboardUrl);
}
