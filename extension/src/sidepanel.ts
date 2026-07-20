import type {
  CaptureEvent,
  FailureCode,
  HelpUsed,
  Outcome,
  SubmissionResult,
} from '../../src/shared/contract.js';
import { sendCapture } from './api.js';
import { CaptureSubmissionCoordinator } from './capture-submission.js';
import { getSettings } from './storage.js';
import type { LeetCodeContext } from './types.js';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value as T;
}

const form = element<HTMLFormElement>('capture-form');
const problemTitle = element<HTMLParagraphElement>('problem-title');
const problemMeta = element<HTMLParagraphElement>('problem-meta');
const reloadButton = element<HTMLButtonElement>('reload');
const submitButton = element<HTMLButtonElement>('submit');
const status = element<HTMLParagraphElement>('status');
const language = element<HTMLInputElement>('language');
const outcome = element<HTMLSelectElement>('outcome');
const submissionResult = element<HTMLSelectElement>('submission-result');
const totalMinutes = element<HTMLInputElement>('total-minutes');
const helpUsed = element<HTMLSelectElement>('help-used');
const primaryPattern = element<HTMLInputElement>('primary-pattern');
const failureCode = element<HTMLSelectElement>('failure-code');
const coldAttempt = element<HTMLInputElement>('cold-attempt');
const notes = element<HTMLTextAreaElement>('notes');
const code = element<HTMLTextAreaElement>('code');
const openOptions = element<HTMLButtonElement>('open-options');

let context: LeetCodeContext | null = null;
const submissionCoordinator = new CaptureSubmissionCoordinator();

function setPendingUi(pending: boolean): void {
  for (const field of form.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >('input, select, textarea')) {
    field.disabled = pending;
  }
  reloadButton.disabled = pending;
  submitButton.textContent = pending ? 'Retry same attempt' : 'Log attempt';
}

function setStatus(message: string, kind: 'neutral' | 'success' | 'error' = 'neutral'): void {
  status.textContent = message;
  status.className = kind === 'neutral' ? 'status' : `status ${kind}`;
}

async function activeTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found.');
  return tab;
}

async function loadContext(): Promise<void> {
  setStatus('Reading the current LeetCode problem…');
  const tab = await activeTab();
  if (!tab.url?.startsWith('https://leetcode.com/problems/')) {
    context = null;
    problemTitle.textContent = 'Open a LeetCode problem.';
    problemMeta.textContent = '';
    setStatus('The active tab is not a LeetCode problem.', 'error');
    return;
  }

  context = (await chrome.tabs.sendMessage(tab.id!, {
    type: 'GET_LEETCODE_CONTEXT',
  })) as LeetCodeContext | null;
  if (!context) throw new Error('Could not read the current problem. Refresh the LeetCode tab.');
  problemTitle.textContent = context.title;
  problemMeta.textContent = `${context.difficulty} · ${context.slug}`;
  setStatus('Ready.');
}

function optionalNumber(input: HTMLInputElement): number | null {
  if (input.value.trim() === '') return null;
  return Number(input.value);
}

function optionalText(input: HTMLInputElement | HTMLTextAreaElement): string | null {
  const value = input.value.trim();
  return value === '' ? null : value;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    if (!context) await loadContext();
    if (!context) throw new Error('No LeetCode problem is available to log.');

    const settings = await getSettings();
    if (!settings.bridgeToken) {
      throw new Error('Open Bridge settings and save your bridge token first.');
    }

    submitButton.disabled = true;
    setStatus('Writing to Notion…');
    const submission = submissionCoordinator.submit(
      (): CaptureEvent => ({
        clientEventId: crypto.randomUUID(),
        problem: context!,
        attempt: {
          attemptedAt: new Date().toISOString(),
          language: language.value.trim(),
          submissionResult: submissionResult.value as SubmissionResult,
          outcome: outcome.value as Outcome,
          coldAttempt: coldAttempt.checked,
          helpUsed: helpUsed.value as HelpUsed,
          failureCode: (failureCode.value || null) as FailureCode | null,
          totalMinutes: optionalNumber(totalMinutes),
          primaryPattern: optionalText(primaryPattern),
          notes: optionalText(notes),
          code: optionalText(code),
        },
      }),
      (capture) => sendCapture(settings, capture),
    );
    setPendingUi(submissionCoordinator.hasPending);
    const result = await submission;
    setPendingUi(false);
    const next = result.review.nextReview
      ? ` Next review: ${new Date(result.review.nextReview).toLocaleDateString()}.`
      : '';
    setStatus(
      `${result.duplicate ? 'Already logged.' : 'Logged.'} ${result.review.mastery}.${next}`,
      'success',
    );
    notes.value = '';
    code.value = '';
  })()
    .catch((error: unknown) => {
      setPendingUi(submissionCoordinator.hasPending);
      setStatus(error instanceof Error ? error.message : 'Unable to log the attempt.', 'error');
    })
    .finally(() => {
      submitButton.disabled = false;
    });
});

reloadButton.addEventListener('click', () => {
  void loadContext().catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : 'Unable to read the problem.', 'error');
  });
});

openOptions.addEventListener('click', () => {
  void chrome.runtime.openOptionsPage();
});

void (async () => {
  const settings = await getSettings();
  language.value = settings.defaultLanguage;
  await loadContext();
})().catch((error: unknown) => {
  setStatus(error instanceof Error ? error.message : 'Unable to initialize.', 'error');
});
