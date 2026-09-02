import type { ContentScriptResponse } from './leetcode-context-runtime.js';
import type { LeetCodeSnapshot } from './leetcode-extraction.js';

export interface SnapshotReaderDependencies {
  sendMessage(tabId: number): Promise<ContentScriptResponse | undefined>;
  injectContentScripts(tabId: number): Promise<void>;
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
      const response = await dependencies.sendMessage(tabId);
      if (response !== undefined) return response.context;
      if (injectedTabs.has(tabId)) return null;
    } catch (error) {
      if (!hasNoReceiver(error) || injectedTabs.has(tabId)) throw error;
    }

    injectedTabs.add(tabId);
    await dependencies.injectContentScripts(tabId);
    return (await dependencies.sendMessage(tabId))?.context ?? null;
  };
}
