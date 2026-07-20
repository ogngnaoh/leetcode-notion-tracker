import type { CaptureEvent, CaptureResult, Mastery } from '../../src/shared/contract.js';
import { CaptureRequestError } from './capture-submission.js';
import type { ExtensionSettings } from './types.js';

const MASTERY_VALUES = new Set<Mastery>(['Unseen', 'Red', 'Yellow', 'Green', 'Mastered']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCaptureResult(value: unknown): value is CaptureResult {
  if (!isRecord(value) || !isRecord(value.review)) return false;
  const { review } = value;
  return (
    typeof value.duplicate === 'boolean' &&
    typeof value.problemPageId === 'string' &&
    value.problemPageId.length > 0 &&
    typeof value.attemptPageId === 'string' &&
    value.attemptPageId.length > 0 &&
    typeof review.mastery === 'string' &&
    MASTERY_VALUES.has(review.mastery as Mastery) &&
    typeof review.greenCount === 'number' &&
    Number.isInteger(review.greenCount) &&
    review.greenCount >= 0 &&
    (review.nextReview === null ||
      (typeof review.nextReview === 'string' &&
        /(?:Z|[+-]\d{2}:\d{2})$/.test(review.nextReview) &&
        !Number.isNaN(Date.parse(review.nextReview))))
  );
}

export async function sendCapture(
  settings: ExtensionSettings,
  event: CaptureEvent,
): Promise<CaptureResult> {
  let response: Response;
  try {
    response = await fetch(`${settings.bridgeUrl.replace(/\/$/, '')}/api/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.bridgeToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
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
    const message =
      typeof body === 'object' &&
      body !== null &&
      'error' in body &&
      typeof (body as { error: unknown }).error === 'string'
        ? (body as { error: string }).error
        : `Bridge returned HTTP ${response.status}`;
    throw new CaptureRequestError(
      message,
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
