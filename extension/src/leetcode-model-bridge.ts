import {
  createModelResponder,
  publishModelChanged,
  type ChannelWindow,
} from './leetcode-model-channel.js';
import { readEditorModel, type MonacoLike } from './leetcode-model-reader.js';

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

createModelResponder(channelWindow, origin, () => readEditorModel(namespace()));

const observedModels = new WeakSet<object>();
const observedEditors = new WeakSet<object>();

/**
 * Monaco replaces the model when the user switches language, so discovery repeats on an
 * interval and the WeakSets keep re-attachment idempotent. The same loop covers a
 * `window.monaco` that only appears after this script runs.
 */
function observeEditors(): void {
  const editors = namespace()?.editor?.getEditors?.();
  if (!Array.isArray(editors)) return;
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

observeEditors();
setInterval(observeEditors, 250);
