import {
  ContextChangePublisher,
  createContentMessageHandler,
  type LeetCodeContextChangedMessage,
} from './leetcode-context-runtime.js';
import { collectExtractionCandidates, observeLeetCodePageChanges } from './leetcode-dom-adapter.js';
import { extractLeetCodeSnapshot } from './leetcode-extraction.js';
import {
  createModelRequester,
  listenForModelChanges,
  type ChannelWindow,
} from './leetcode-model-channel.js';

const channelWindow = window as unknown as ChannelWindow;
const requestModel = createModelRequester(channelWindow, window.location.origin, () =>
  crypto.randomUUID(),
);

const extractCurrentContext = async () =>
  extractLeetCodeSnapshot(
    collectExtractionCandidates(document, window.location.href, await requestModel()),
  );

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
listenForModelChanges(channelWindow, () => publisher.notifyChange());
publisher.notifyChange();
