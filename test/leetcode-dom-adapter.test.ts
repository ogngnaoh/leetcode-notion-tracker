import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectExtractionCandidates,
  isVisibleFromFacts,
  observeLeetCodePageChanges,
} from '../extension/src/leetcode-dom-adapter.js';
import { extractLeetCodeSnapshot } from '../extension/src/leetcode-extraction.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LeetCode DOM adapter primitives', () => {
  it.each([
    ['hidden attribute', { hiddenInTree: true }],
    ['aria-hidden tree', { ariaHiddenInTree: true }],
    ['display none', { displayNoneInTree: true }],
    ['hidden visibility', { visibilityHiddenInTree: true }],
    ['zero layout', { hasLayout: false }],
  ])('rejects an element hidden by %s', (_label, override) => {
    expect(
      isVisibleFromFacts({
        hiddenInTree: false,
        ariaHiddenInTree: false,
        displayNoneInTree: false,
        visibilityHiddenInTree: false,
        hasLayout: true,
        ...override,
      }),
    ).toBe(false);
  });

  it('accepts an element that is visible and has layout', () => {
    expect(
      isVisibleFromFacts({
        hiddenInTree: false,
        ariaHiddenInTree: false,
        displayNoneInTree: false,
        visibilityHiddenInTree: false,
        hasLayout: true,
      }),
    ).toBe(true);
  });

  it('detects an href-only SPA change without observing page-world history', async () => {
    vi.useFakeTimers();
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      'MutationObserver',
      class {
        observe = observe;
        disconnect = disconnect;
      },
    );
    const document = {
      documentElement: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Document;
    const window = {
      location: { href: 'https://leetcode.com/problems/two-sum/' },
      history: { pushState: vi.fn(), replaceState: vi.fn() },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const onChange = vi.fn();

    const cleanup = observeLeetCodePageChanges(document, window, onChange);
    window.location.href = 'https://leetcode.com/problems/three-sum/';
    await vi.advanceTimersByTimeAsync(500);

    expect(onChange).toHaveBeenCalledOnce();
    expect(window.history.pushState).not.toHaveBeenCalled();
    expect(window.history.replaceState).not.toHaveBeenCalled();

    cleanup();
    window.location.href = 'https://leetcode.com/problems/four-sum/';
    await vi.advanceTimersByTimeAsync(500);
    expect(onChange).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('does not treat unrelated visible difficulty text as problem metadata', async () => {
    const visibleHard = {
      textContent: 'Hard',
      ownerDocument: {
        defaultView: {
          getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
        },
      },
      parentElement: null,
      hasAttribute: () => false,
      getAttribute: () => null,
      getClientRects: () => [{ width: 20, height: 20 }],
      getBoundingClientRect: () => ({ width: 20, height: 20 }),
    } as unknown as Element;
    const document = {
      title: '1. Two Sum - LeetCode',
      querySelectorAll: (selector: string) => (selector === 'span, div' ? [visibleHard] : []),
    } as unknown as Document;

    const candidates = collectExtractionCandidates(
      document,
      'https://leetcode.com/problems/two-sum/',
    );
    const result = await extractLeetCodeSnapshot(candidates);

    expect(result?.problem.difficulty).toBe('Unknown');
  });
});
