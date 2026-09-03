import { configureTabScopedSidePanel, openSidePanelForTab } from './side-panel-launcher.js';
import { NotionRuntime } from './notion-runtime.js';
import {
  createOpenPanels,
  forgetOpenPanel,
  hydrateOpenPanels,
  rememberOpenPanel,
  toggleSidePanelForTab,
} from './side-panel-toggle.js';
import {
  DailyRepsStore,
  dailyRepsErrorResponse,
  dispatchDailyRepsRequest,
  isDailyRepsRequest,
  type DailyRepsResponse,
} from './daily-reps.js';

export const TOGGLE_COMMAND = 'toggle-side-panel';

const notionRuntime = new NotionRuntime(
  { local: chrome.storage.local, session: chrome.storage.session },
  {
    changed: async (message) => {
      await chrome.runtime.sendMessage(message).catch(() => undefined);
    },
  },
);

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (
    !message ||
    typeof message !== 'object' ||
    !('type' in message) ||
    message.type !== 'lctrack.notion'
  )
    return false;
  void notionRuntime.handle(message, sender, chrome.runtime.id).then(sendResponse);
  return true;
});

const openPanels = createOpenPanels();
const dailyRepsStore = new DailyRepsStore(
  {
    get: async (key) => chrome.storage.local.get(key),
    set: async (items) => chrome.storage.local.set(items),
  },
  {
    randomUUID: () => crypto.randomUUID(),
    now: () => new Date(),
  },
);

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

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isDailyRepsRequest(message)) return false;
  const extensionRoot = chrome.runtime.getURL('');
  if (!sender.url?.startsWith(extensionRoot)) {
    const response: DailyRepsResponse = {
      ok: false,
      code: 'FORBIDDEN',
      message: 'Daily Reps commands are accepted only from LCTrack pages.',
    };
    sendResponse(response);
    return false;
  }
  void dispatchDailyRepsRequest(dailyRepsStore, message)
    .then((state) => sendResponse({ ok: true, state } satisfies DailyRepsResponse))
    .catch((error: unknown) => sendResponse(dailyRepsErrorResponse(error)));
  return true;
});
