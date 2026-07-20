import type { AttemptResult } from '../../src/shared/contract.js';
import { getProblemStatus, sendCaptureBody } from './api.js';
import { CaptureSessionStore } from './capture-session.js';
import type {
  ContentScriptResponse,
  LeetCodeContextChangedMessage,
} from './leetcode-context-runtime.js';
import type { LeetCodeSnapshot } from './leetcode-extraction.js';
import { SidePanelController, type SidePanelView } from './sidepanel-controller.js';
import { SidePanelTabCoordinator, type VisibleTab } from './sidepanel-tab-coordinator.js';
import { createSnapshotReader } from './sidepanel-snapshot-reader.js';
import { getSettings } from './storage.js';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value as T;
}

const problemNumber = element<HTMLSpanElement>('problem-number');
const problemTitle = element<HTMLHeadingElement>('problem-title');
const problemDifficulty = element<HTMLSpanElement>('problem-difficulty');
const reviewState = element<HTMLSpanElement>('review-state');
const topics = element<HTMLUListElement>('problem-topics');
const codeLanguage = element<HTMLSpanElement>('code-language');
const codeLineCount = element<HTMLSpanElement>('code-line-count');
const capturedCode = element<HTMLPreElement>('captured-code');
const outcomeActions = element<HTMLDivElement>('outcome-actions');
const retryAttempt = element<HTMLButtonElement>('retry-attempt');
const successConfirmation = element<HTMLParagraphElement>('success-confirmation');
const status = element<HTMLParagraphElement>('status');
const openOptions = element<HTMLButtonElement>('open-options');
const outcomeButtons = Array.from(
  outcomeActions.querySelectorAll<HTMLButtonElement>('button[data-result]'),
);

function exactLineCount(code: string): number {
  return code.length === 0 ? 0 : code.split('\n').length;
}

function renderTopics(labels: string[]): void {
  topics.replaceChildren();
  for (const label of labels) {
    const item = document.createElement('li');
    item.className = 'chip';
    item.textContent = label;
    topics.append(item);
  }
}

function renderSnapshot(snapshot: LeetCodeSnapshot | null): void {
  if (!snapshot) {
    problemNumber.textContent = '—';
    problemTitle.textContent = 'Open a LeetCode problem';
    problemDifficulty.textContent = 'Unknown';
    renderTopics([]);
    codeLanguage.textContent = 'Unknown';
    codeLineCount.textContent = '0 lines';
    capturedCode.textContent = '';
    return;
  }

  problemNumber.textContent = snapshot.problem.number
    ? `#${snapshot.problem.number}`
    : 'UNNUMBERED';
  problemTitle.textContent = snapshot.problem.title;
  problemDifficulty.textContent = snapshot.problem.difficulty;
  renderTopics(snapshot.problem.topics);
  codeLanguage.textContent = snapshot.language;
  const code = snapshot.codeAvailable ? snapshot.code : '';
  const lines = exactLineCount(code);
  codeLineCount.textContent =
    snapshot.codeAvailable && !snapshot.codeRange.complete
      ? `visible lines ${snapshot.codeRange.startLine}–${snapshot.codeRange.endLine}`
      : `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  capturedCode.textContent = code;
}

function render(view: SidePanelView): void {
  renderSnapshot(view.snapshot);
  reviewState.textContent = view.reviewLabel;
  outcomeActions.hidden = view.mode !== 'ready';
  retryAttempt.hidden = view.mode !== 'retry';
  successConfirmation.hidden = view.mode === 'retry' || view.loggedResult === null;
  for (const button of outcomeButtons) button.disabled = view.busy;
  for (const button of outcomeButtons) {
    button.setAttribute('aria-pressed', String(button.dataset.result === view.loggedResult));
  }
  retryAttempt.disabled = view.busy;
  retryAttempt.setAttribute('aria-busy', String(view.busy));
  successConfirmation.textContent = view.loggedResult
    ? `${view.loggedResult} logged for this exact code.`
    : '';
  status.textContent = view.message;
  status.className =
    view.mode === 'ready' && view.loggedResult !== null
      ? 'status success'
      : view.mode === 'blocked' || view.mode === 'retry'
        ? 'status error'
        : 'status';
  openOptions.dataset.attention = String(view.showSettings);
}

async function activeTab(): Promise<VisibleTab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error('No active tab found.');
  return { id: tab.id, ...(tab.url === undefined ? {} : { url: tab.url }) };
}

const readSnapshot = createSnapshotReader({
  sendMessage: (tabId) =>
    chrome.tabs.sendMessage(tabId, {
      type: 'GET_LEETCODE_CONTEXT',
    }) as Promise<ContentScriptResponse | undefined>,
  injectContentScript: async (tabId, files) => {
    await chrome.scripting.executeScript({ target: { tabId }, files });
  },
});

const sessionStorage = {
  get: async (key: string) => chrome.storage.session.get(key),
  set: async (items: Record<string, unknown>) => chrome.storage.session.set(items),
  remove: async (key: string) => chrome.storage.session.remove(key),
};

const tabCoordinator = new SidePanelTabCoordinator({
  getActiveTab: activeTab,
  readSnapshot,
  createController: (tabId) =>
    new SidePanelController({
      store: new CaptureSessionStore(sessionStorage, tabId),
      getSettings,
      getFreshSnapshot: () => readSnapshot(tabId),
      getProblemStatus,
      sendCaptureBody,
      randomUUID: () => crypto.randomUUID(),
      now: () => new Date(),
    }),
  render,
});

for (const button of outcomeButtons) {
  button.addEventListener('click', () => {
    void tabCoordinator.selectResult(button.dataset.result as AttemptResult);
  });
}
retryAttempt.addEventListener('click', () => {
  void tabCoordinator.retryPending();
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (
    sender.tab?.id === undefined ||
    typeof message !== 'object' ||
    message === null ||
    !('type' in message) ||
    message.type !== 'LEETCODE_CONTEXT_CHANGED'
  ) {
    return;
  }
  const changed = message as LeetCodeContextChangedMessage;
  void tabCoordinator.acceptContext(sender.tab.id, changed.context);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void tabCoordinator.rebindActiveTab(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active || (changeInfo.url === undefined && changeInfo.status !== 'complete')) return;
  void tabCoordinator.refreshActiveTab(tabId, tab.url);
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void tabCoordinator.rebindActiveTab();
});

openOptions.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

void tabCoordinator.rebindActiveTab().catch((error: unknown) => {
  status.textContent =
    error instanceof Error
      ? error.message
      : 'Could not read the current problem. Refresh the LeetCode tab.';
  status.className = 'status error';
});
