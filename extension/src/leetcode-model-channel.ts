import type { EditorModelReading } from './leetcode-model-reader.js';

export const MODEL_CHANNEL = 'lctrack-model';

export interface MessageEventLike {
  data: unknown;
  source: unknown;
}

export interface ChannelWindow {
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
}

function isChannelMessage(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).channel === MODEL_CHANNEL
  );
}

function isReading(value: unknown): value is EditorModelReading | null {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  const reading = value as Record<string, unknown>;
  return typeof reading.code === 'string' && typeof reading.languageId === 'string';
}

/**
 * Requests the model reading from the MAIN-world bridge. The bridge runs in the page's
 * world, so every reply is validated for shape and matched against a fresh nonce; an
 * unanswered request resolves null rather than hanging.
 */
export function createModelRequester(
  window: ChannelWindow,
  origin: string,
  newId: () => string,
  timeoutMs = 500,
): () => Promise<EditorModelReading | null> {
  return () =>
    new Promise<EditorModelReading | null>((resolve) => {
      const id = newId();
      let settled = false;

      const finish = (reading: EditorModelReading | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', listener);
        resolve(reading);
      };

      const listener = (event: MessageEventLike): void => {
        if (event.source !== window || !isChannelMessage(event.data)) return;
        const message = event.data;
        if (message.kind !== 'response' || message.id !== id || !isReading(message.reading)) return;
        finish(message.reading);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);
      window.addEventListener('message', listener);
      window.postMessage({ channel: MODEL_CHANNEL, kind: 'request', id }, origin);
    });
}

export function createModelResponder(
  window: ChannelWindow,
  origin: string,
  read: () => EditorModelReading | null,
): () => void {
  const listener = (event: MessageEventLike): void => {
    if (event.source !== window || !isChannelMessage(event.data)) return;
    const message = event.data;
    if (message.kind !== 'request' || typeof message.id !== 'string') return;
    window.postMessage(
      { channel: MODEL_CHANNEL, kind: 'response', id: message.id, reading: read() },
      origin,
    );
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export function publishModelChanged(window: ChannelWindow, origin: string): void {
  window.postMessage({ channel: MODEL_CHANNEL, kind: 'changed' }, origin);
}

export function listenForModelChanges(window: ChannelWindow, onChange: () => void): () => void {
  const listener = (event: MessageEventLike): void => {
    if (event.source !== window || !isChannelMessage(event.data)) return;
    if (event.data.kind !== 'changed') return;
    onChange();
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
