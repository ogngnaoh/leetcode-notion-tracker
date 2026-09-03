import {
  createModelResponder,
  publishModelChanged,
  type ChannelWindow,
} from './leetcode-model-channel.js';
import {
  LEETCODE_CODEMIRROR_CONTENT_SELECTOR,
  readCodeMirrorModel,
  type CodeMirrorContentLike,
} from './leetcode-codemirror-reader.js';
import { readEditorModel, type MonacoLike } from './leetcode-model-reader.js';
import { ModelDiscovery } from './leetcode-model-discovery.js';

interface ObservableModel {
  onDidChangeContent?: (listener: () => void) => unknown;
}

interface ObservableEditor {
  getModel?: () => ObservableModel | null | undefined;
  onDidChangeModelLanguage?: (listener: () => void) => unknown;
}

const channelWindow = window as unknown as ChannelWindow;
const origin = window.location.origin;
const namespace = (): MonacoLike | undefined =>
  (window as unknown as { monaco?: MonacoLike }).monaco;
const codeMirrorContents = (): CodeMirrorContentLike[] =>
  Array.from(
    document.querySelectorAll(LEETCODE_CODEMIRROR_CONTENT_SELECTOR),
  ) as unknown as CodeMirrorContentLike[];
const readActiveEditorModel = () =>
  readEditorModel(namespace()) ?? readCodeMirrorModel(codeMirrorContents());

createModelResponder(channelWindow, origin, readActiveEditorModel);

const observedModels = new WeakSet<object>();
const observedEditors = new WeakSet<object>();
const observedCodeMirrorContents = new WeakSet<object>();
const discovery = new ModelDiscovery();

/**
 * Monaco replaces the model when the user switches language, and LeetCode replaces its
 * CodeMirror view during focus-mode hydration. Discovery repeats on an interval and the
 * WeakSets keep listener attachment idempotent. CodeMirror input events publish immediately;
 * the interval also catches programmatic model changes that do not mutate rendered lines.
 *
 * Announcing readability transitions is what makes a timed-out first request recoverable.
 * LeetCode hydrates the editor after the content scripts run, so the first read can find
 * no reachable model; without this signal nothing would ever ask again, and the panel
 * would stay blocked until the user happened to edit the code.
 */
function observeEditors(): void {
  const editors = namespace()?.editor?.getEditors?.();
  const contents = codeMirrorContents();
  if (Array.isArray(editors)) {
    for (const editor of editors as unknown as ObservableEditor[]) {
      if (!editor) continue;
      if (!observedEditors.has(editor)) {
        observedEditors.add(editor);
        editor.onDidChangeModelLanguage?.(() => publishModelChanged(channelWindow, origin));
      }
      const model = editor.getModel?.();
      if (!model || observedModels.has(model)) continue;
      observedModels.add(model);
      model.onDidChangeContent?.(() => publishModelChanged(channelWindow, origin));
    }
  }

  for (const content of contents) {
    if (observedCodeMirrorContents.has(content)) continue;
    observedCodeMirrorContents.add(content);
    (content as unknown as EventTarget).addEventListener('input', () =>
      publishModelChanged(channelWindow, origin),
    );
  }

  if (!discovery.changed(Array.isArray(editors) ? editors : [], contents)) return;
  publishModelChanged(channelWindow, origin);
}

observeEditors();
setInterval(observeEditors, 250);
