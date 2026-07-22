import { configureTabScopedSidePanel, openSidePanelForTab } from './side-panel-launcher.js';

void configureTabScopedSidePanel(chrome.sidePanel).catch(() => {
  console.error('Could not configure the tab-scoped side panel.');
});

chrome.action.onClicked.addListener((tab) => {
  void openSidePanelForTab(tab, chrome.sidePanel).catch(() => {
    console.error('Could not open the side panel for this tab.');
  });
});
