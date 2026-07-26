import { configureTabScopedSidePanel, openSidePanelForTab } from './side-panel-launcher.js';
import {
  createOpenPanels,
  forgetOpenPanel,
  hydrateOpenPanels,
  rememberOpenPanel,
  toggleSidePanelForTab,
} from './side-panel-toggle.js';

export const TOGGLE_COMMAND = 'toggle-side-panel';

const openPanels = createOpenPanels();

void configureTabScopedSidePanel(chrome.sidePanel).catch(() => {
  console.error('Could not configure the tab-scoped side panel.');
});

// The worker may have restarted while a panel stayed open; recover that state before any command.
void hydrateOpenPanels(openPanels, (filter) => chrome.runtime.getContexts(filter)).catch(() => {
  console.error('Could not read the open side panels.');
});

chrome.sidePanel.onOpened.addListener((info) => {
  rememberOpenPanel(openPanels, info);
});

chrome.sidePanel.onClosed.addListener((info) => {
  forgetOpenPanel(openPanels, info);
});

chrome.action.onClicked.addListener((tab) => {
  void openSidePanelForTab(tab, chrome.sidePanel).catch(() => {
    console.error('Could not open the side panel for this tab.');
  });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== TOGGLE_COMMAND || tab === undefined) return;
  void toggleSidePanelForTab(tab, chrome.sidePanel, openPanels).catch(() => {
    console.error('Could not toggle the side panel for this tab.');
  });
});
