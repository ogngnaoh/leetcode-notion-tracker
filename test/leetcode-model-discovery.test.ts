import { describe, expect, it } from 'vitest';
import { ModelDiscovery } from '../extension/src/leetcode-model-discovery.js';

describe('metadata-only model discovery', () => {
  it('uses Monaco model/version identity without extracting its text', () => {
    let version = 1;
    const node = { isConnected: true, getBoundingClientRect: () => ({ width: 400, height: 240 }) };
    const model = {
      getVersionId: () => version,
      getLanguageId: () => 'python3',
      getValue: () => {
        throw new Error('No text reads during discovery');
      },
    };
    const editor = { getModel: () => model, getDomNode: () => node };
    const discovery = new ModelDiscovery();
    expect(discovery.changed([editor], [])).toBe(true);
    expect(discovery.changed([editor], [])).toBe(false);
    version++;
    expect(discovery.changed([editor], [])).toBe(true);
    expect(discovery.changed([], [])).toBe(true);
  });
  it('detects CodeMirror hydration and immutable document changes without toString', () => {
    const makeDoc = () => ({
      toString: () => {
        throw new Error('No text reads during discovery');
      },
    });
    const content = {
      isConnected: true,
      dataset: { language: 'python3' },
      getBoundingClientRect: () => ({ width: 400, height: 240 }),
      cmView: { view: { state: { doc: makeDoc() } } },
    };
    const discovery = new ModelDiscovery();
    expect(discovery.changed([], [])).toBe(true);
    expect(discovery.changed([], [content])).toBe(true);
    expect(discovery.changed([], [content])).toBe(false);
    content.cmView.view.state.doc = makeDoc();
    expect(discovery.changed([], [content])).toBe(true);
  });
});
