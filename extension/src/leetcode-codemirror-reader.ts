import type { EditorModelReading } from './leetcode-model-reader.js';

export const LEETCODE_CODEMIRROR_CONTENT_SELECTOR =
  '[data-track-load="code_editor"] .cm-content[role="textbox"]';

interface CodeMirrorDocumentLike {
  toString(): string;
}

interface CodeMirrorStateLike {
  doc?: CodeMirrorDocumentLike;
}

interface CodeMirrorEditorViewLike {
  state?: CodeMirrorStateLike;
}

interface CodeMirrorInternalViewLike extends CodeMirrorEditorViewLike {
  view?: CodeMirrorEditorViewLike;
}

export interface CodeMirrorContentLike {
  isConnected: boolean;
  dataset?: { language?: string };
  getBoundingClientRect(): { width: number; height: number };
  cmView?: CodeMirrorInternalViewLike;
  textContent?: string | null;
}

function editorView(content: CodeMirrorContentLike): CodeMirrorEditorViewLike | undefined {
  const internal = content.cmView;
  return internal?.view ?? internal;
}

/**
 * Reads CodeMirror's immutable state document rather than `.cm-content` text.
 * CodeMirror virtualizes that DOM for long solutions, so rendered text is never
 * accepted as a capture fallback.
 */
export function readCodeMirrorModel(
  contents: Iterable<CodeMirrorContentLike>,
): EditorModelReading | null {
  let best: { reading: EditorModelReading; area: number } | null = null;
  for (const content of contents) {
    if (!content.isConnected) continue;
    const languageId = content.dataset?.language?.trim() ?? '';
    const document = editorView(content)?.state?.doc;
    if (!languageId || !document || typeof document.toString !== 'function') continue;
    const rectangle = content.getBoundingClientRect();
    const area = rectangle.width * rectangle.height;
    if (best && area <= best.area) continue;
    best = {
      reading: { code: document.toString(), languageId },
      area,
    };
  }
  return best?.reading ?? null;
}
