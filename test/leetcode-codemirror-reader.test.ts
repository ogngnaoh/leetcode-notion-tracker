import { describe, expect, it } from 'vitest';
import {
  readCodeMirrorModel,
  type CodeMirrorContentLike,
} from '../extension/src/leetcode-codemirror-reader.js';

function content(
  options: {
    code?: string;
    languageId?: string;
    isConnected?: boolean;
    width?: number;
    height?: number;
    view?: null;
  } = {},
): CodeMirrorContentLike {
  const document = {
    toString: () => options.code ?? 'model code',
  };
  const candidate: CodeMirrorContentLike = {
    isConnected: options.isConnected ?? true,
    dataset: { language: options.languageId ?? 'python' },
    getBoundingClientRect: () => ({
      width: options.width ?? 700,
      height: options.height ?? 720,
    }),
  };
  if (options.view !== null) candidate.cmView = { view: { state: { doc: document } } };
  return candidate;
}

describe('readCodeMirrorModel', () => {
  it('returns null when no complete CodeMirror model is reachable', () => {
    expect(readCodeMirrorModel([])).toBeNull();
    expect(readCodeMirrorModel([content({ view: null })])).toBeNull();
  });

  it('reads the complete state document and language instead of rendered DOM text', () => {
    const complete = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join('\n');
    const candidate = content({ code: complete, languageId: 'python' });
    candidate.textContent = 'line 40\nline 41';

    expect(readCodeMirrorModel([candidate])).toEqual({
      code: complete,
      languageId: 'python',
    });
  });

  it('ignores detached or language-less candidates and chooses the largest problem editor', () => {
    expect(
      readCodeMirrorModel([
        content({ code: 'detached', isConnected: false, width: 1_000, height: 1_000 }),
        content({ code: 'testcase', languageId: '', width: 900, height: 900 }),
        content({ code: 'small', width: 100, height: 100 }),
        content({ code: 'solution', languageId: 'typescript', width: 700, height: 500 }),
      ]),
    ).toEqual({ code: 'solution', languageId: 'typescript' });
  });

  it('selects a zero-area editor while CodeMirror is hydrating', () => {
    expect(readCodeMirrorModel([content({ code: 'hydrating', width: 0, height: 0 })])).toEqual({
      code: 'hydrating',
      languageId: 'python',
    });
  });
});
