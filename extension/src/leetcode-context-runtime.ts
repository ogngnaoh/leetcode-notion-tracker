import type { LeetCodeSnapshot } from './leetcode-extraction.js';

export const GET_LEETCODE_CONTEXT_MESSAGE = 'GET_LEETCODE_CONTEXT_V4';
export const GET_LEETCODE_MODEL_MESSAGE = 'GET_LEETCODE_MODEL_V4';
export const LEETCODE_CONTEXT_CHANGED_MESSAGE = 'LEETCODE_CONTEXT_CHANGED_V4';

export interface GetLeetCodeContextMessage {
  type: typeof GET_LEETCODE_CONTEXT_MESSAGE;
}

export interface ContentScriptResponse {
  context: LeetCodeSnapshot | null;
}

export interface LeetCodeContextChangedMessage {
  type: typeof LEETCODE_CONTEXT_CHANGED_MESSAGE;
  context: LeetCodeSnapshot | null;
}

export type ExtractLeetCodeContext = () => Promise<LeetCodeSnapshot | null>;
export type PublishLeetCodeContext = (context: LeetCodeSnapshot | null) => void | Promise<void>;

export function metadataOnlyContext(context: LeetCodeSnapshot | null): LeetCodeSnapshot | null {
  return context
    ? {
        problem: context.problem,
        codeAvailable: false,
        language: 'Unknown',
        codeUnavailable: { reason: 'NO_READABLE_EDITOR_MODEL' },
        fingerprint: null,
      }
    : null;
}

export function createContentMessageHandler(
  extract: ExtractLeetCodeContext,
  extractModel: ExtractLeetCodeContext = extract,
) {
  return (message: unknown, sendResponse: (response: ContentScriptResponse) => void): boolean => {
    if (
      typeof message !== 'object' ||
      message === null ||
      !('type' in message) ||
      (message.type !== GET_LEETCODE_CONTEXT_MESSAGE && message.type !== GET_LEETCODE_MODEL_MESSAGE)
    ) {
      return false;
    }

    const full = message.type === GET_LEETCODE_MODEL_MESSAGE;
    void (full ? extractModel() : extract()).then(
      (context) => sendResponse({ context: full ? context : metadataOnlyContext(context) }),
      () => sendResponse({ context: null }),
    );
    return true;
  };
}

function publicationKey(context: LeetCodeSnapshot | null): string {
  if (!context) return 'outside-problem';
  return JSON.stringify(context);
}

export class ContextChangePublisher {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  private revision = 0;
  private publishedKey: string | undefined;
  private running = false;
  private queuedRevision: number | undefined;
  private modelRevision = 0;

  constructor(
    private readonly extract: ExtractLeetCodeContext,
    private readonly publish: PublishLeetCodeContext,
    private readonly debounceMs = 100,
  ) {}

  notifyChange(modelChanged = false): void {
    if (modelChanged) this.modelRevision += 1;
    this.revision += 1;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
    // Charts and other animations can mutate continuously while the editor is
    // unfocused. Bound the debounce so they cannot postpone discovery forever.
    this.maxWaitTimer ??= setTimeout(() => this.flush(), Math.max(500, this.debounceMs));
  }

  dispose(): void {
    this.revision += 1;
    if (this.timer !== undefined) clearTimeout(this.timer);
    if (this.maxWaitTimer !== undefined) clearTimeout(this.maxWaitTimer);
    this.timer = undefined;
    this.maxWaitTimer = undefined;
    this.queuedRevision = undefined;
  }

  private flush(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    if (this.maxWaitTimer !== undefined) clearTimeout(this.maxWaitTimer);
    this.timer = undefined;
    this.maxWaitTimer = undefined;
    this.runOrQueue(this.revision);
  }

  private runOrQueue(revision: number): void {
    if (this.running) {
      this.queuedRevision = revision;
      return;
    }
    void this.extractAndPublish(revision);
  }

  private async extractAndPublish(revision: number): Promise<void> {
    this.running = true;
    try {
      const context = metadataOnlyContext(await this.extract());
      if (revision !== this.revision) return;

      const key = `${this.modelRevision}:${publicationKey(context)}`;
      if (key === this.publishedKey) return;

      await this.publish(context);
      this.publishedKey = key;
    } catch {
      // A later DOM or navigation event retries extraction without leaking page details.
    } finally {
      this.running = false;
      const queuedRevision = this.queuedRevision;
      this.queuedRevision = undefined;
      if (queuedRevision !== undefined && queuedRevision === this.revision) {
        this.runOrQueue(queuedRevision);
      }
    }
  }
}
