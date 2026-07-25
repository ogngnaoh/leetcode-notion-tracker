export interface EditorModelLike {
  getValue(): string;
  getLineCount(): number;
  getLanguageId(): string;
}

export interface EditorNodeLike {
  isConnected: boolean;
  getBoundingClientRect(): { width: number; height: number };
}

export interface EditorLike {
  getModel(): EditorModelLike | null | undefined;
  getDomNode(): EditorNodeLike | null | undefined;
}

export interface MonacoLike {
  editor?: {
    getEditors?: () => EditorLike[] | undefined;
  };
}

export interface EditorModelReading {
  code: string;
  languageId: string;
}

/**
 * Reads the complete buffer from Monaco's model, which is independent of what the
 * virtualized view has rendered. The plaintext editor LeetCode keeps alongside the
 * code editor is skipped; among the rest the largest laid-out editor wins, which
 * survives the brief post-load window where the code editor measures near zero.
 */
export function readEditorModel(monaco: MonacoLike | null | undefined): EditorModelReading | null {
  const editors = monaco?.editor?.getEditors?.();
  if (!Array.isArray(editors)) return null;

  let best: { reading: EditorModelReading; area: number } | null = null;
  for (const editor of editors) {
    const model = editor?.getModel?.();
    const node = editor?.getDomNode?.();
    if (!model || !node || !node.isConnected) continue;
    const languageId = model.getLanguageId();
    if (languageId === 'plaintext') continue;
    const rectangle = node.getBoundingClientRect();
    const area = rectangle.width * rectangle.height;
    if (best && area <= best.area) continue;
    best = { reading: { code: model.getValue(), languageId }, area };
  }
  return best?.reading ?? null;
}
