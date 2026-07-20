import type { ContentScriptResponse } from './leetcode-context-runtime.js';
import type { LeetCodeSnapshot } from './leetcode-extraction.js';

export interface SnapshotReaderDependencies {
  sendMessage(tabId: number): Promise<ContentScriptResponse | undefined>;
  injectContentScript(tabId: number, files: string[]): Promise<void>;
}

function hasNoReceiver(error: unknown): boolean {
  return (
    error instanceof Error &&
    /could not establish connection|receiving end does not exist/i.test(error.message)
  );
}

export function createSnapshotReader(dependencies: SnapshotReaderDependencies) {
  const injectedTabs = new Set<number>();

  return async (tabId: number): Promise<LeetCodeSnapshot | null> => {
    try {
      return (await dependencies.sendMessage(tabId))?.context ?? null;
    } catch (error) {
      if (!hasNoReceiver(error) || injectedTabs.has(tabId)) throw error;
      injectedTabs.add(tabId);
      await dependencies.injectContentScript(tabId, ['content.js']);
      return (await dependencies.sendMessage(tabId))?.context ?? null;
    }
  };
}
