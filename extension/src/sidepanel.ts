import type { AttemptResult } from '../../src/shared/contract.js';
import { getProblemStatus, sendCaptureBody } from './api.js';
import { CaptureSessionStore } from './capture-session.js';
import {
  DAILY_REPS_STORAGE_KEY,
  currentDailySessionStartedAt,
  isDailyRepsState,
  isDailySessionStale,
  type ArchivedRepSession,
  type DailyRep,
  type DailyRepsRequest,
  type DailyRepsResponse,
  type DailyRepsStateV1,
} from './daily-reps.js';
import type {
  ContentScriptResponse,
  LeetCodeContextChangedMessage,
} from './leetcode-context-runtime.js';
import {
  GET_LEETCODE_CONTEXT_MESSAGE,
  LEETCODE_CONTEXT_CHANGED_MESSAGE,
} from './leetcode-context-runtime.js';
import type { LeetCodeSnapshot } from './leetcode-extraction.js';
import { SidePanelController, type SidePanelView } from './sidepanel-controller.js';
import { SidePanelTabCoordinator, type VisibleTab } from './sidepanel-tab-coordinator.js';
import { createSnapshotReader } from './sidepanel-snapshot-reader.js';
import { difficultyBadgeClass } from './difficulty-badge.js';
import { openDashboardShortcut } from './dashboard-shortcut.js';
import { getSettings } from './storage.js';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value as T;
}

const dailyRepsTab = element<HTMLButtonElement>('daily-reps-tab');
const notionLogTab = element<HTMLButtonElement>('notion-log-tab');
const dailyRepsPanel = element<HTMLElement>('daily-reps-panel');
const notionLogPanel = element<HTMLElement>('notion-log-panel');
const dailyProgressElement = document.querySelector<HTMLElement>('.daily-progress');
if (!dailyProgressElement) throw new Error('Missing Daily Reps progress panel.');
const dailyProgress: HTMLElement = dailyProgressElement;
const dailyRepCount = element<HTMLSpanElement>('daily-rep-count');
const dailyGoalDisplay = element<HTMLSpanElement>('daily-goal-display');
const dailyProgressBar = element<HTMLDivElement>('daily-progress-bar');
const dailyProgressFill = element<HTMLSpanElement>('daily-progress-fill');
const dailyGoalMessage = element<HTMLParagraphElement>('daily-goal-message');
const editDailyGoal = element<HTMLButtonElement>('edit-daily-goal');
const dailyGoalEditor = element<HTMLDivElement>('daily-goal-editor');
const dailyGoalInput = element<HTMLInputElement>('daily-goal-input');
const saveDailyGoal = element<HTMLButtonElement>('save-daily-goal');
const cancelDailyGoal = element<HTMLButtonElement>('cancel-daily-goal');
const staleSessionWarning = element<HTMLParagraphElement>('stale-session-warning');
const dailyProblemNumber = element<HTMLSpanElement>('daily-problem-number');
const dailyProblemTitle = element<HTMLHeadingElement>('daily-problem-title');
const dailyProblemDifficulty = element<HTMLSpanElement>('daily-problem-difficulty');
const dailyProblemTopics = element<HTMLUListElement>('daily-problem-topics');
const logDailyRep = element<HTMLButtonElement>('log-daily-rep');
const dailyStatus = element<HTMLParagraphElement>('daily-status');
const currentRepsSection = element<HTMLElement>('current-reps-section');
const currentRepsTotal = element<HTMLSpanElement>('current-reps-total');
const currentRepsList = element<HTMLOListElement>('current-reps-list');
const finishDailySession = element<HTMLButtonElement>('finish-daily-session');
const dailyHistorySection = element<HTMLElement>('daily-history-section');
const dailyHistoryTotal = element<HTMLSpanElement>('daily-history-total');
const dailyHistory = element<HTMLDivElement>('daily-history');
const showOlderHistory = element<HTMLButtonElement>('show-older-history');
const finishSessionDialog = element<HTMLDialogElement>('finish-session-dialog');
const finishSessionMessage = element<HTMLParagraphElement>('finish-session-message');
const cancelFinishSession = element<HTMLButtonElement>('cancel-finish-session');
const confirmFinishSession = element<HTMLButtonElement>('confirm-finish-session');
const deleteSessionDialog = element<HTMLDialogElement>('delete-session-dialog');
const cancelDeleteSession = element<HTMLButtonElement>('cancel-delete-session');
const confirmDeleteSession = element<HTMLButtonElement>('confirm-delete-session');

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
const openDashboard = element<HTMLButtonElement>('open-dashboard');
const outcomeButtons = Array.from(
  outcomeActions.querySelectorAll<HTMLButtonElement>('button[data-result]'),
);

const HISTORY_PAGE_SIZE = 10;
let dailyState: DailyRepsStateV1 | null = null;
let latestSnapshot: LeetCodeSnapshot | null = null;
let dailyBusy = false;
let dailyReadFailed = false;
let visibleHistoryCount = HISTORY_PAGE_SIZE;
let pendingDeleteSessionId: string | null = null;

function exactLineCount(code: string): number {
  return code.length === 0 ? 0 : code.split('\n').length;
}

function countLabel(count: number, singular: string, plural = `${singular}S`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

function formatDate(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

function formatSessionDate(session: ArchivedRepSession): string {
  const started = formatDate(session.startedAt);
  const ended = formatDate(session.endedAt);
  return started === ended ? started : `${started} – ${ended}`;
}

function renderTopics(target: HTMLUListElement, labels: string[]): void {
  target.replaceChildren();
  for (const label of labels) {
    const item = document.createElement('li');
    item.className = target === dailyProblemTopics ? 'daily-topic' : 'chip';
    item.textContent = label;
    target.append(item);
  }
}

function setDailyStatus(message: string, kind: 'normal' | 'success' | 'error' = 'normal'): void {
  dailyStatus.textContent = message;
  dailyStatus.className = `status daily-status${kind === 'normal' ? '' : ` ${kind}`}`;
}

function renderDailySnapshot(snapshot: LeetCodeSnapshot | null): void {
  latestSnapshot = snapshot;
  if (!snapshot) {
    dailyProblemNumber.textContent = '—';
    dailyProblemTitle.textContent = 'Open a LeetCode problem';
    dailyProblemDifficulty.className = 'badge badge--muted';
    dailyProblemDifficulty.textContent = 'Unknown';
    renderTopics(dailyProblemTopics, []);
    if (!dailyReadFailed) setDailyStatus('Open a LeetCode problem to log a repetition.');
    updateDailyControls();
    return;
  }

  dailyProblemNumber.textContent = snapshot.problem.number
    ? `#${snapshot.problem.number}`
    : 'UNNUMBERED';
  dailyProblemTitle.textContent = snapshot.problem.title;
  dailyProblemDifficulty.className = `badge ${difficultyBadgeClass(snapshot.problem.difficulty)}`;
  dailyProblemDifficulty.textContent = snapshot.problem.difficulty;
  renderTopics(dailyProblemTopics, snapshot.problem.topics);
  if (!dailyReadFailed) {
    setDailyStatus(
      dailyState?.goal === null
        ? 'Set a goal before logging this problem.'
        : `Ready to log ${snapshot.problem.title}.`,
    );
  }
  updateDailyControls();
}

function renderNotionSnapshot(snapshot: LeetCodeSnapshot | null): void {
  if (!snapshot) {
    problemNumber.textContent = '—';
    problemTitle.textContent = 'Open a LeetCode problem';
    problemDifficulty.className = 'badge badge--muted';
    problemDifficulty.textContent = 'Unknown';
    renderTopics(topics, []);
    codeLanguage.textContent = 'Unknown';
    codeLineCount.textContent = '0 lines';
    capturedCode.textContent = '';
    return;
  }

  problemNumber.textContent = snapshot.problem.number
    ? `#${snapshot.problem.number}`
    : 'UNNUMBERED';
  problemTitle.textContent = snapshot.problem.title;
  problemDifficulty.className = `badge ${difficultyBadgeClass(snapshot.problem.difficulty)}`;
  problemDifficulty.textContent = snapshot.problem.difficulty;
  renderTopics(topics, snapshot.problem.topics);
  codeLanguage.textContent = snapshot.language;
  const code = snapshot.codeAvailable ? snapshot.code : '';
  const lines = exactLineCount(code);
  codeLineCount.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  capturedCode.textContent = code;
}

function createRepRow(rep: DailyRep, removable: boolean): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'rep-row';
  const copy = document.createElement('div');
  copy.className = 'rep-copy';
  const primary = document.createElement('div');
  primary.className = 'rep-primary';
  const link = document.createElement('a');
  link.className = 'rep-title';
  link.href = rep.problem.url;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = `${rep.problem.number === null ? '' : `#${rep.problem.number} `}${rep.problem.title}`;
  primary.append(link);
  const meta = document.createElement('p');
  meta.className = 'rep-meta';
  const topicMeta = rep.problem.topics.length > 0 ? ` · ${rep.problem.topics.join(' · ')}` : '';
  meta.textContent = `${rep.problem.difficulty}${topicMeta} · ${formatTime(rep.loggedAt)}`;
  copy.append(primary, meta);
  item.append(copy);
  if (removable) {
    const remove = document.createElement('button');
    remove.className = 'btn btn--quiet remove-rep';
    remove.type = 'button';
    remove.dataset.repId = rep.id;
    remove.textContent = 'Remove';
    remove.setAttribute(
      'aria-label',
      `Remove ${rep.problem.title} logged at ${formatTime(rep.loggedAt)}`,
    );
    remove.disabled = dailyBusy;
    item.append(remove);
  }
  return item;
}

function renderCurrentReps(state: DailyRepsStateV1): void {
  const count = state.currentReps.length;
  currentRepsSection.hidden = count === 0;
  currentRepsTotal.textContent = countLabel(count, 'REP');
  currentRepsList.replaceChildren(
    ...[...state.currentReps].reverse().map((rep) => createRepRow(rep, true)),
  );
}

function createHistorySession(session: ArchivedRepSession): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'history-session';
  details.dataset.sessionId = session.id;
  const summary = document.createElement('summary');
  const heading = document.createElement('span');
  heading.className = 'history-session-heading';
  const headingCopy = document.createElement('span');
  headingCopy.textContent = formatSessionDate(session);
  const result = document.createElement('span');
  result.className = `badge ${session.reps.length >= session.goal ? '' : 'badge--muted'}`.trim();
  result.textContent = `${session.reps.length}/${session.goal}`;
  const meta = document.createElement('span');
  meta.className = 'history-session-meta';
  meta.textContent = session.reps.length >= session.goal ? 'Complete' : 'Below goal';
  const resultGroup = document.createElement('span');
  resultGroup.className = 'history-session-result';
  resultGroup.append(meta, result);
  heading.append(headingCopy, resultGroup);
  summary.append(heading);
  const body = document.createElement('div');
  body.className = 'history-session-body';
  const reps = document.createElement('ol');
  reps.className = 'rep-list';
  reps.append(...[...session.reps].reverse().map((rep) => createRepRow(rep, false)));
  const deleteButton = document.createElement('button');
  deleteButton.className = 'btn btn--quiet delete-history-session';
  deleteButton.type = 'button';
  deleteButton.dataset.sessionId = session.id;
  deleteButton.textContent = 'Delete session';
  deleteButton.disabled = dailyBusy;
  body.append(reps, deleteButton);
  details.append(summary, body);
  return details;
}

function renderHistory(state: DailyRepsStateV1): void {
  const count = state.archivedSessions.length;
  dailyHistorySection.hidden = count === 0;
  dailyHistoryTotal.textContent = countLabel(count, 'SESSION');
  dailyHistory.replaceChildren(
    ...state.archivedSessions.slice(0, visibleHistoryCount).map(createHistorySession),
  );
  showOlderHistory.hidden = visibleHistoryCount >= count;
  showOlderHistory.disabled = dailyBusy;
}

function renderStaleWarning(state: DailyRepsStateV1): void {
  const earliest = currentDailySessionStartedAt(state);
  if (earliest === null || !isDailySessionStale(state, new Date())) {
    staleSessionWarning.hidden = true;
    staleSessionWarning.textContent = '';
    return;
  }
  staleSessionWarning.textContent = `This session began on ${formatDate(earliest)}. It will remain active until you finish and reset it.`;
  staleSessionWarning.hidden = false;
}

function renderDailyState(state: DailyRepsStateV1): void {
  dailyState = state;
  const count = state.currentReps.length;
  const goal = state.goal;
  dailyRepCount.textContent = String(count);
  dailyGoalDisplay.textContent = goal === null ? '—' : String(goal);
  editDailyGoal.textContent = goal === null ? 'Set goal' : 'Edit goal';
  if (goal === null) {
    dailyProgress.dataset.state = 'unset';
    dailyProgressFill.style.width = '0%';
    dailyProgressBar.removeAttribute('aria-valuemax');
    dailyProgressBar.setAttribute('aria-valuenow', '0');
    dailyProgressBar.setAttribute('aria-valuetext', 'Set a goal to begin');
    dailyGoalMessage.textContent = 'Set a goal from 1 to 100 to begin.';
  } else {
    const percentage = Math.min(100, (count / goal) * 100);
    dailyProgress.dataset.state = count > goal ? 'over' : count === goal ? 'complete' : 'active';
    dailyProgressFill.style.width = `${percentage}%`;
    dailyProgressBar.setAttribute('aria-valuemax', String(goal));
    dailyProgressBar.setAttribute('aria-valuenow', String(Math.min(count, goal)));
    dailyProgressBar.setAttribute('aria-valuetext', `${count} of ${goal} repetitions logged`);
    dailyGoalMessage.textContent =
      count > goal
        ? `Goal complete — ${count - goal} ${count - goal === 1 ? 'rep' : 'reps'} over target.`
        : count === goal
          ? 'Goal complete. Keep going or finish this session.'
          : `${goal - count} ${goal - count === 1 ? 'rep' : 'reps'} to go.`;
  }
  renderStaleWarning(state);
  renderCurrentReps(state);
  renderHistory(state);
  updateDailyControls();
}

function updateDailyControls(): void {
  const goalReady = dailyState !== null && dailyState.goal !== null;
  logDailyRep.disabled = dailyBusy || dailyReadFailed || !goalReady || latestSnapshot === null;
  finishDailySession.disabled =
    dailyBusy || dailyReadFailed || !dailyState || dailyState.currentReps.length === 0;
  editDailyGoal.disabled = dailyBusy || dailyReadFailed;
  saveDailyGoal.disabled = dailyBusy || dailyReadFailed;
  cancelDailyGoal.disabled = dailyBusy;
  for (const button of currentRepsList.querySelectorAll<HTMLButtonElement>('.remove-rep')) {
    button.disabled = dailyBusy;
  }
  for (const button of dailyHistory.querySelectorAll<HTMLButtonElement>(
    '.delete-history-session',
  )) {
    button.disabled = dailyBusy;
  }
}

function openGoalEditor(): void {
  dailyGoalEditor.hidden = false;
  editDailyGoal.setAttribute('aria-expanded', 'true');
  dailyGoalInput.value = dailyState?.goal === null || !dailyState ? '' : String(dailyState.goal);
  dailyGoalInput.setCustomValidity('');
  dailyGoalInput.focus();
  dailyGoalInput.select();
}

function closeGoalEditor(returnFocus = true): void {
  dailyGoalEditor.hidden = true;
  editDailyGoal.setAttribute('aria-expanded', 'false');
  dailyGoalInput.setCustomValidity('');
  if (returnFocus) editDailyGoal.focus();
}

async function requestDailyReps(request: DailyRepsRequest): Promise<DailyRepsStateV1> {
  const response = (await chrome.runtime.sendMessage(request)) as DailyRepsResponse | undefined;
  if (!response) throw new Error('Daily Reps did not receive a response from the extension.');
  if (!response.ok) throw new Error(response.message);
  if (!isDailyRepsState(response.state)) {
    throw new Error(
      'Daily Reps received an invalid state response. Stored history was not changed.',
    );
  }
  return response.state;
}

async function runDailyMutation(
  request: DailyRepsRequest,
  successMessage: string,
): Promise<DailyRepsStateV1 | null> {
  if (dailyBusy || dailyReadFailed) return null;
  dailyBusy = true;
  updateDailyControls();
  try {
    const state = await requestDailyReps(request);
    renderDailyState(state);
    setDailyStatus(successMessage, 'success');
    return state;
  } catch (error) {
    setDailyStatus(
      error instanceof Error ? error.message : 'Daily Reps could not be updated.',
      'error',
    );
    return null;
  } finally {
    dailyBusy = false;
    updateDailyControls();
  }
}

function render(view: SidePanelView): void {
  renderDailySnapshot(view.snapshot);
  renderNotionSnapshot(view.snapshot);
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
  successConfirmation.textContent = view.loggedResult ? 'Attempt logged.' : '';
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
      type: GET_LEETCODE_CONTEXT_MESSAGE,
    }) as Promise<ContentScriptResponse | undefined>,
  injectContentScripts: async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['leetcode-model-bridge.js'],
      world: 'MAIN',
    });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
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
      initialCaptureEnabled: false,
    }),
  render,
});

async function selectTrackerTab(tab: 'daily' | 'notion', focus: boolean): Promise<void> {
  const dailySelected = tab === 'daily';
  dailyRepsTab.setAttribute('aria-selected', String(dailySelected));
  dailyRepsTab.tabIndex = dailySelected ? 0 : -1;
  notionLogTab.setAttribute('aria-selected', String(!dailySelected));
  notionLogTab.tabIndex = dailySelected ? -1 : 0;
  dailyRepsPanel.hidden = !dailySelected;
  notionLogPanel.hidden = dailySelected;
  if (focus) (dailySelected ? dailyRepsTab : notionLogTab).focus();
  await tabCoordinator.setCaptureEnabled(!dailySelected);
}

function handleTabKeydown(event: KeyboardEvent): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const selectDaily = event.key === 'ArrowLeft' || event.key === 'Home';
  void selectTrackerTab(selectDaily ? 'daily' : 'notion', true);
}

for (const button of outcomeButtons) {
  button.addEventListener('click', () => {
    void tabCoordinator.selectResult(button.dataset.result as AttemptResult);
  });
}
retryAttempt.addEventListener('click', () => void tabCoordinator.retryPending());
dailyRepsTab.addEventListener('click', () => void selectTrackerTab('daily', false));
notionLogTab.addEventListener('click', () => void selectTrackerTab('notion', false));
dailyRepsTab.addEventListener('keydown', handleTabKeydown);
notionLogTab.addEventListener('keydown', handleTabKeydown);

editDailyGoal.setAttribute('aria-expanded', 'false');
editDailyGoal.addEventListener('click', openGoalEditor);
cancelDailyGoal.addEventListener('click', () => closeGoalEditor());
saveDailyGoal.addEventListener('click', () => {
  const goal = Number(dailyGoalInput.value);
  if (!Number.isInteger(goal) || goal < 1 || goal > 100) {
    dailyGoalInput.setCustomValidity('Choose a whole number from 1 through 100.');
    dailyGoalInput.reportValidity();
    return;
  }
  void runDailyMutation({ type: 'DAILY_REPS', action: 'set-goal', goal }, 'Daily goal saved.').then(
    (state) => {
      if (state) closeGoalEditor(false);
    },
  );
});
dailyGoalInput.addEventListener('input', () => dailyGoalInput.setCustomValidity(''));
dailyGoalInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    saveDailyGoal.click();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeGoalEditor();
  }
});

logDailyRep.addEventListener('click', () => {
  if (!latestSnapshot) return;
  const title = latestSnapshot.problem.title;
  const problem = {
    ...latestSnapshot.problem,
    number: latestSnapshot.problem.number ?? null,
  };
  void runDailyMutation({ type: 'DAILY_REPS', action: 'log-rep', problem }, `Logged ${title}.`);
});

currentRepsList.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.dataset.repId) return;
  void runDailyMutation(
    { type: 'DAILY_REPS', action: 'remove-current-rep', repId: target.dataset.repId },
    'Repetition removed.',
  );
});

finishDailySession.addEventListener('click', () => {
  const state = dailyState;
  if (!state || state.goal === null || state.currentReps.length === 0) return;
  const count = state.currentReps.length;
  const shortfall = Math.max(0, state.goal - count);
  finishSessionMessage.textContent =
    shortfall > 0
      ? `You logged ${count} of ${state.goal} reps, ${shortfall} short of your goal. This will archive the session and start an empty one.`
      : `You logged ${count} of ${state.goal} reps. This will archive the session and start an empty one.`;
  finishSessionDialog.showModal();
});
cancelFinishSession.addEventListener('click', () => finishSessionDialog.close());
confirmFinishSession.addEventListener('click', () => {
  void runDailyMutation(
    { type: 'DAILY_REPS', action: 'finish-session' },
    'Session archived. Your goal is ready for the next session.',
  ).then((state) => {
    if (!state) return;
    visibleHistoryCount = HISTORY_PAGE_SIZE;
    finishSessionDialog.close();
    renderDailyState(state);
    logDailyRep.focus();
  });
});

dailyHistory.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement) || !target.dataset.sessionId) return;
  pendingDeleteSessionId = target.dataset.sessionId;
  deleteSessionDialog.showModal();
});
cancelDeleteSession.addEventListener('click', () => {
  pendingDeleteSessionId = null;
  deleteSessionDialog.close();
});
confirmDeleteSession.addEventListener('click', () => {
  if (!pendingDeleteSessionId) return;
  const sessionId = pendingDeleteSessionId;
  void runDailyMutation(
    { type: 'DAILY_REPS', action: 'delete-archived-session', sessionId },
    'Archived session deleted.',
  ).then((state) => {
    if (!state) return;
    pendingDeleteSessionId = null;
    deleteSessionDialog.close();
  });
});

showOlderHistory.addEventListener('click', () => {
  visibleHistoryCount += HISTORY_PAGE_SIZE;
  if (dailyState) renderHistory(dailyState);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  const changed = changes[DAILY_REPS_STORAGE_KEY]?.newValue;
  if (changed === undefined) return;
  if (!isDailyRepsState(changed)) {
    dailyReadFailed = true;
    setDailyStatus('Stored Daily Reps history could not be read. It was left unchanged.', 'error');
    updateDailyControls();
    return;
  }
  dailyReadFailed = false;
  renderDailyState(changed);
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  if (
    sender.tab?.id === undefined ||
    typeof message !== 'object' ||
    message === null ||
    !('type' in message) ||
    message.type !== LEETCODE_CONTEXT_CHANGED_MESSAGE
  ) {
    return;
  }
  const changed = message as LeetCodeContextChangedMessage;
  void tabCoordinator.acceptContext(sender.tab.id, changed.context);
});

chrome.tabs.onActivated.addListener(
  (activeInfo) => void tabCoordinator.rebindActiveTab(activeInfo.tabId),
);
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.active || (changeInfo.url === undefined && changeInfo.status !== 'complete')) return;
  void tabCoordinator.refreshActiveTab(tabId, tab.url);
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void tabCoordinator.rebindActiveTab();
});

openOptions.addEventListener('click', () => void chrome.runtime.openOptionsPage());
openDashboard.addEventListener('click', () => {
  openDashboard.disabled = true;
  void getSettings()
    .then((settings) =>
      openDashboardShortcut(settings.bridgeUrl, {
        queryTabs: () => chrome.tabs.query({}),
        focusWindow: async (windowId) => {
          await chrome.windows.update(windowId, { focused: true });
        },
        activateTab: async (tabId) => {
          await chrome.tabs.update(tabId, { active: true });
        },
        createTab: async (url) => {
          await chrome.tabs.create({ url });
        },
      }),
    )
    .catch((error: unknown) => {
      status.textContent =
        error instanceof Error && error.message.includes('Bridge URL')
          ? error.message
          : 'Could not open the dashboard. Check Bridge settings and make sure Chrome can open the local bridge.';
      status.className = 'status error';
      openOptions.dataset.attention = 'true';
    })
    .finally(() => {
      openDashboard.disabled = false;
    });
});

void requestDailyReps({ type: 'DAILY_REPS', action: 'read' })
  .then((state) => {
    dailyReadFailed = false;
    renderDailyState(state);
    if (state.goal === null) openGoalEditor();
  })
  .catch((error: unknown) => {
    dailyReadFailed = true;
    setDailyStatus(
      error instanceof Error ? error.message : 'Daily Reps could not be read.',
      'error',
    );
    updateDailyControls();
  });

void tabCoordinator.rebindActiveTab().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : 'Could not read the current problem. Refresh the LeetCode tab.';
  setDailyStatus(message, 'error');
  status.textContent = message;
  status.className = 'status error';
});
