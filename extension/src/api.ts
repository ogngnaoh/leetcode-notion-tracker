import type { NotionOperation, NotionResponse, NotionState } from './notion-protocol.js';

export class NotionMessageError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export async function requestNotion(
  operation: NotionOperation,
  attempts = 0,
): Promise<NotionState> {
  const id = crypto.randomUUID();
  let response: NotionResponse;
  try {
    response = (await chrome.runtime.sendMessage({
      type: 'lctrack.notion',
      version: 1,
      id,
      ...operation,
    })) as NotionResponse;
  } catch {
    throw new NotionMessageError(
      'UNAVAILABLE',
      'The extension worker disconnected. Check the pending save before trying another attempt.',
    );
  }
  if (
    !response ||
    response.version !== 1 ||
    response.id !== id ||
    typeof response.ok !== 'boolean'
  ) {
    throw new NotionMessageError(
      'INVALID_RESPONSE',
      'The extension returned an unreadable response. Check pending recovery before another attempt.',
    );
  }
  if (!response.ok) {
    if (
      response.code === 'STALE_STATE' &&
      attempts < 2 &&
      (operation.op === 'connection.state' || operation.op === 'capture.pending')
    ) {
      return requestNotion(operation, attempts + 1);
    }
    throw new NotionMessageError(response.code, response.message);
  }
  if (
    response.data.connection.vaultId !== response.vaultId ||
    response.data.connection.generation !== response.generation
  ) {
    throw new NotionMessageError(
      'INVALID_RESPONSE',
      'The connection changed while this response was being delivered. Reopen the current view.',
    );
  }
  return response.data;
}
