import type { CodeMirrorContentLike } from './leetcode-codemirror-reader.js';

interface ObservableEditorMetadata {
  getModel?: () =>
    | {
        getLanguageId?: () => string;
        getVersionId?: () => number;
      }
    | null
    | undefined;
  getDomNode?: () =>
    | {
        isConnected: boolean;
        getBoundingClientRect(): { width: number; height: number };
      }
    | null
    | undefined;
}

/** Editor discovery must never materialize code just to report a change. */
export class ModelDiscovery {
  private readonly identities = new WeakMap<object, number>();
  private sequence = 0;
  private previous: string | null = null;

  private identity(value: object): number {
    let id = this.identities.get(value);
    if (id === undefined) {
      id = ++this.sequence;
      this.identities.set(value, id);
    }
    return id;
  }

  changed(
    editors: readonly ObservableEditorMetadata[],
    contents: readonly CodeMirrorContentLike[],
  ): boolean {
    const metadata: unknown[] = [];
    for (const editor of editors) {
      try {
        const model = editor?.getModel?.();
        const node = editor?.getDomNode?.();
        if (!model || !node?.isConnected) continue;
        const { width, height } = node.getBoundingClientRect();
        metadata.push([
          'monaco',
          this.identity(model),
          model.getLanguageId?.(),
          model.getVersionId?.(),
          width,
          height,
        ]);
      } catch {
        /* A partially mounted page model will be rediscovered next time. */
      }
    }
    for (const content of contents) {
      try {
        if (!content.isConnected) continue;
        const view = content.cmView?.view ?? content.cmView;
        const doc = view?.state?.doc;
        const { width, height } = content.getBoundingClientRect();
        metadata.push([
          'codemirror',
          this.identity(content),
          doc ? this.identity(doc) : null,
          content.dataset?.language,
          width,
          height,
        ]);
      } catch {
        /* Keep discovery independent from transient editor hydration failures. */
      }
    }
    const key = JSON.stringify(metadata);
    if (key === this.previous) return false;
    this.previous = key;
    return true;
  }
}
