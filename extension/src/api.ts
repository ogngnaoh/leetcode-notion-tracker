import type {
  CaptureEvent,
  CaptureResult,
  PracticeState,
  ProblemStatus,
} from '../../src/shared/contract.js';
import { CaptureRequestError } from './capture-submission.js';
import type { ExtensionSettings } from './types.js';

const PRACTICE_STATES = new Set<PracticeState>([
  'New',
  'Couldn’t solve',
  'Needed help',
  'Solved',
  'Mastered',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
  );
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

const ISO_DATE_SOURCE =
  '(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))';
const ISO_TIME_SOURCE = '(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?';
const ISO_TIMESTAMP_WITH_OFFSET = new RegExp(
  `^${ISO_DATE_SOURCE}T${ISO_TIME_SOURCE}(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$`,
);

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && ISO_TIMESTAMP_WITH_OFFSET.test(value);
}

function isReviewState(value: unknown): boolean {
  if (!isRecord(value) || !hasExactKeys(value, ['practiceState', 'solvedStreak', 'nextReview'])) {
    return false;
  }
  return (
    typeof value.practiceState === 'string' &&
    PRACTICE_STATES.has(value.practiceState as PracticeState) &&
    typeof value.solvedStreak === 'number' &&
    Number.isInteger(value.solvedStreak) &&
    value.solvedStreak >= 0 &&
    value.solvedStreak <= 5 &&
    (value.nextReview === null || isCalendarDate(value.nextReview))
  );
}

function isCaptureResult(value: unknown): value is CaptureResult {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['duplicate', 'problemPageId', 'attemptPageId', 'review'])
  ) {
    return false;
  }
  return (
    typeof value.duplicate === 'boolean' &&
    typeof value.problemPageId === 'string' &&
    value.problemPageId.length > 0 &&
    typeof value.attemptPageId === 'string' &&
    value.attemptPageId.length > 0 &&
    isReviewState(value.review)
  );
}

function isProblemStatus(value: unknown): value is ProblemStatus {
  if (!isRecord(value) || typeof value.found !== 'boolean') return false;
  if (!value.found) return hasExactKeys(value, ['found']);
  return (
    hasExactKeys(value, ['found', 'practiceState', 'solvedStreak', 'nextReview', 'lastAttempt']) &&
    isReviewState({
      practiceState: value.practiceState,
      solvedStreak: value.solvedStreak,
      nextReview: value.nextReview,
    }) &&
    (value.lastAttempt === null || isIsoTimestamp(value.lastAttempt))
  );
}

function responseMessage(body: unknown, status: number): string {
  return isRecord(body) && typeof body.error === 'string'
    ? body.error
    : `Bridge returned HTTP ${status}`;
}

export async function sendCapture(
  settings: ExtensionSettings,
  event: CaptureEvent,
): Promise<CaptureResult> {
  return sendCaptureBody(settings, JSON.stringify(event));
}

export async function sendCaptureBody(
  settings: ExtensionSettings,
  serializedBody: string,
): Promise<CaptureResult> {
  let response: Response;
  try {
    response = await fetch(`${settings.bridgeUrl.replace(/\/$/, '')}/api/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.bridgeToken}`,
        'Content-Type': 'application/json',
      },
      body: serializedBody,
    });
  } catch {
    throw new CaptureRequestError(
      'Could not reach the local bridge. Retry the same attempt.',
      null,
      'uncertain',
    );
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new CaptureRequestError(
      responseMessage(body, response.status),
      response.status,
      response.status >= 400 && response.status < 500 ? 'definitive' : 'uncertain',
    );
  }

  if (!isCaptureResult(body)) {
    throw new CaptureRequestError(
      'The local bridge returned an invalid success response. Retry the same attempt.',
      response.status,
      'uncertain',
    );
  }
  return body;
}

export async function getProblemStatus(
  settings: ExtensionSettings,
  slug: string,
): Promise<ProblemStatus> {
  let response: Response;
  try {
    response = await fetch(
      `${settings.bridgeUrl.replace(/\/$/, '')}/api/problems/${encodeURIComponent(slug)}/status`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${settings.bridgeToken}` },
      },
    );
  } catch {
    throw new CaptureRequestError('Could not reach the local bridge.', null, 'uncertain');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new CaptureRequestError(
      responseMessage(body, response.status),
      response.status,
      response.status >= 400 && response.status < 500 ? 'definitive' : 'uncertain',
    );
  }
  if (!isProblemStatus(body)) {
    throw new CaptureRequestError(
      'The local bridge returned an invalid problem status.',
      response.status,
      'uncertain',
    );
  }
  return body;
}
