import {
  ContextChangePublisher,
  createContentMessageHandler,
  type LeetCodeContextChangedMessage,
} from './leetcode-context-runtime.js';
import { collectExtractionCandidates, observeLeetCodePageChanges } from './leetcode-dom-adapter.js';
import { extractLeetCodeSnapshot } from './leetcode-extraction.js';

const extractCurrentContext = () =>
  extractLeetCodeSnapshot(collectExtractionCandidates(document, window.location.href));

const handleMessage = createContentMessageHandler(extractCurrentContext);
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) =>
  handleMessage(message, sendResponse),
);

const publisher = new ContextChangePublisher(
  extractCurrentContext,
  async (context) => {
    const message: LeetCodeContextChangedMessage = {
      type: 'LEETCODE_CONTEXT_CHANGED',
      context,
    };
    await chrome.runtime.sendMessage(message).catch(() => undefined);
  },
  100,
);

observeLeetCodePageChanges(document, window, () => publisher.notifyChange());
publisher.notifyChange();
