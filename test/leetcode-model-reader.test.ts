import { describe, expect, it } from 'vitest';
import { readEditorModel, type EditorLike } from '../extension/src/leetcode-model-reader.js';

function editor(options: {
  code?: string;
  languageId?: string;
  isConnected?: boolean;
  width?: number;
  height?: number;
  model?: null;
  node?: null;
}): EditorLike {
  const model =
    options.model === null
      ? null
      : {
          getValue: () => options.code ?? 'code',
          getLineCount: () => (options.code ?? 'code').split('\n').length,
          getLanguageId: () => options.languageId ?? 'python3',
        };
  const node =
    options.node === null
      ? null
      : {
          isConnected: options.isConnected ?? true,
          getBoundingClientRect: () => ({
            width: options.width ?? 700,
            height: options.height ?? 720,
          }),
        };
  return { getModel: () => model, getDomNode: () => node };
}

function monaco(editors: EditorLike[]) {
  return { editor: { getEditors: () => editors } };
}

describe('readEditorModel', () => {
  it.each([
    ['null namespace', null],
    ['undefined namespace', undefined],
    ['namespace without editor', {}],
    ['editor without getEditors', { editor: {} }],
  ])('returns null for %s', (_label, value) => {
    expect(readEditorModel(value as never)).toBeNull();
  });

  it('returns null when getEditors does not return an array', () => {
    expect(readEditorModel({ editor: { getEditors: () => undefined } } as never)).toBeNull();
  });

  it('returns null when there are no editors', () => {
    expect(readEditorModel(monaco([]))).toBeNull();
  });

  it('reads the code and language id of the sole editor', () => {
    expect(readEditorModel(monaco([editor({ code: 'a\nb', languageId: 'python3' })]))).toEqual({
      code: 'a\nb',
      languageId: 'python3',
    });
  });

  it('ignores plaintext editors', () => {
    expect(readEditorModel(monaco([editor({ languageId: 'plaintext' })]))).toBeNull();
  });

  it('ignores editors whose node is detached', () => {
    expect(readEditorModel(monaco([editor({ isConnected: false })]))).toBeNull();
  });

  it.each([
    ['a missing model', { model: null as null }],
    ['a missing dom node', { node: null as null }],
  ])('ignores an editor with %s', (_label, override) => {
    expect(readEditorModel(monaco([editor(override)]))).toBeNull();
  });

  it('prefers the largest editor when several qualify', () => {
    const reading = readEditorModel(
      monaco([
        editor({ code: 'small', width: 10, height: 10 }),
        editor({ code: 'large', width: 700, height: 720 }),
        editor({ code: 'medium', width: 100, height: 100 }),
      ]),
    );
    expect(reading?.code).toBe('large');
  });

  it('selects a zero-area editor when it is the only candidate', () => {
    const reading = readEditorModel(monaco([editor({ code: 'hydrating', width: 0, height: 0 })]));
    expect(reading?.code).toBe('hydrating');
  });

  it('skips the plaintext editor and reads the code editor beside it', () => {
    const reading = readEditorModel(
      monaco([
        editor({ code: '', languageId: 'plaintext', width: 0, height: 0 }),
        editor({ code: 'class Solution:', languageId: 'python3' }),
      ]),
    );
    expect(reading).toEqual({ code: 'class Solution:', languageId: 'python3' });
  });
});
