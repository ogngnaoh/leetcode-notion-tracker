import type { CaptureEvent, CaptureResult } from '../../src/shared/contract.js';
import type { ExtensionSettings } from './types.js';

export async function sendCapture(
  settings: ExtensionSettings,
  event: CaptureEvent,
): Promise<CaptureResult> {
  const response = await fetch(`${settings.bridgeUrl.replace(/\/$/, '')}/api/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.bridgeToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(event),
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body
        ? String((body as { error: unknown }).error)
        : `Bridge returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return body as CaptureResult;
}
