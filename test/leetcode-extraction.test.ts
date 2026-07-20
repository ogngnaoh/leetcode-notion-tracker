import { describe, expect, it } from 'vitest';
import {
  extractLeetCodeSnapshot,
  normalizeProblemTitle,
  reconstructMonacoCode,
  type ExtractionCandidates,
} from '../extension/src/leetcode-extraction.js';

function candidates(overrides: Partial<ExtractionCandidates> = {}): ExtractionCandidates {
  return {
    locationUrl: 'https://leetcode.com/problems/two-sum/',
    documentTitle: '1. Two Sum - LeetCode',
    titleCandidates: [],
    difficultyCandidates: [],
    topicCandidates: [],
    renderedCodeCandidates: [],
    codeCandidates: [],
    nearbyLanguageCandidates: [],
    languageCandidates: [],
    ...overrides,
  };
}

describe('LeetCode public-DOM extraction', () => {
  it('reconstructs numbered Monaco lines, soft wraps, indentation, blank lines, and nonbreaking spaces', () => {
    expect(
      reconstructMonacoCode(
        [
          { lineNumber: 1, top: 0 },
          { lineNumber: 2, top: 20 },
          { lineNumber: 3, top: 60 },
          { lineNumber: 4, top: 80 },
        ],
        [
          { text: 'function solve() {', top: 0 },
          { text: '\u00a0\u00a0const values = input.', top: 20 },
          { text: '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0map(transform);', top: 40 },
          { text: '', top: 60 },
          { text: '\u00a0\u00a0return values;', top: 80 },
        ],
        true,
      ),
    ).toEqual({
      code: 'function solve() {\n  const values = input.map(transform);\n\n  return values;',
      startLine: 1,
      endLine: 4,
      complete: true,
    });
  });

  it('returns a partial rendered range when Monaco does not expose the whole file', () => {
    expect(
      reconstructMonacoCode(
        [
          { lineNumber: 12, top: 120 },
          { lineNumber: 13, top: 140 },
        ],
        [
          { text: 'const middle = true;', top: 120 },
          { text: 'return middle;', top: 140 },
        ],
        false,
      ),
    ).toEqual({
      code: 'const middle = true;\nreturn middle;',
      startLine: 12,
      endLine: 13,
      complete: false,
    });
  });

  it('rejects ambiguous Monaco line mappings instead of using misleading rendered code', () => {
    expect(
      reconstructMonacoCode(
        [
          { lineNumber: 4, top: 60 },
          { lineNumber: 6, top: 80 },
        ],
        [
          { text: 'line four', top: 60 },
          { text: 'line six', top: 80 },
        ],
        false,
      ),
    ).toBeNull();
  });

  it('separates a leading LeetCode number from the normalized title', () => {
    expect(normalizeProblemTitle('  123.   Best Time to Buy and Sell Stock  ')).toEqual({
      title: 'Best Time to Buy and Sell Stock',
      number: 123,
    });
  });

  it('uses the first visible title candidate and canonicalizes the problem URL', async () => {
    const result = await extractLeetCodeSnapshot(
      candidates({
        locationUrl: 'https://leetcode.com/problems/two-sum/?envType=study-plan',
        titleCandidates: [
          { text: 'Hidden title', visible: false },
          { text: '1. Two Sum', visible: true },
        ],
      }),
    );

    expect(result?.problem).toMatchObject({
      slug: 'two-sum',
      title: 'Two Sum',
      number: 1,
      url: 'https://leetcode.com/problems/two-sum/',
    });
  });

  it('recognizes the public description route and stores the canonical problem URL', async () => {
    await expect(
      extractLeetCodeSnapshot(
        candidates({ locationUrl: 'https://leetcode.com/problems/two-sum/description/' }),
      ),
    ).resolves.toMatchObject({
      codeAvailable: false,
      problem: {
        slug: 'two-sum',
        url: 'https://leetcode.com/problems/two-sum/',
      },
    });
  });

  it('falls back to the document title and then the slug', async () => {
    const fromDocument = await extractLeetCodeSnapshot(
      candidates({ documentTitle: 'LeetCode | 42. Trapping Rain Water' }),
    );
    const fromSlug = await extractLeetCodeSnapshot(candidates({ documentTitle: 'LeetCode' }));

    expect(fromDocument?.problem.title).toBe('Trapping Rain Water');
    expect(fromDocument?.problem.number).toBe(42);
    expect(fromSlug?.problem.title).toBe('two-sum');
    expect(fromSlug?.problem.number).toBeNull();
  });

  it('rejects pages outside the English desktop problem route', async () => {
    await expect(
      extractLeetCodeSnapshot(candidates({ locationUrl: 'https://leetcode.com/explore/' })),
    ).resolves.toBeNull();
    await expect(
      extractLeetCodeSnapshot(candidates({ locationUrl: 'https://leetcode.cn/problems/two-sum/' })),
    ).resolves.toBeNull();
  });

  it('extracts a recognized visible difficulty and otherwise uses Unknown', async () => {
    const known = await extractLeetCodeSnapshot(
      candidates({
        difficultyCandidates: [
          { text: 'Hard', visible: false },
          { text: ' Medium ', visible: true },
        ],
      }),
    );
    const unknown = await extractLeetCodeSnapshot(
      candidates({ difficultyCandidates: [{ text: 'Advanced', visible: true }] }),
    );

    expect(known?.problem.difficulty).toBe('Medium');
    expect(unknown?.problem.difficulty).toBe('Unknown');
  });

  it('keeps unique visible LeetCode topic-link labels in visible order', async () => {
    const result = await extractLeetCodeSnapshot(
      candidates({
        topicCandidates: [
          { text: ' Array ', href: '/tag/array/', visible: true },
          { text: 'Hidden', href: '/tag/hidden/', visible: false },
          { text: '', href: '/tag/blank/', visible: true },
          { text: 'Array', href: 'https://leetcode.com/tag/array/', visible: true },
          { text: 'Hash Table', href: 'https://leetcode.com/tag/hash-table/', visible: true },
          { text: 'Discussion', href: '/discuss/', visible: true },
          { text: 'Foreign', href: 'https://example.com/tag/foreign/', visible: true },
        ],
      }),
    );

    expect(result?.problem.topics).toEqual(['Array', 'Hash Table']);
  });

  it('prefers reconstructed Monaco rendering and includes its complete range', async () => {
    const code = '  const x = 1;\n';
    const result = await extractLeetCodeSnapshot(
      candidates({
        renderedCodeCandidates: [{ code, startLine: 1, endLine: 2, complete: true }],
        codeCandidates: [
          { visible: false, readable: true, value: 'hidden' },
          { visible: true, readable: true, value: 'textarea fallback' },
        ],
        nearbyLanguageCandidates: [{ text: 'TypeScript', visible: true }],
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        codeAvailable: true,
        language: 'TypeScript',
        code,
        codeRange: { startLine: 1, endLine: 2, complete: true },
        fingerprint: 'c1a308e8a7b6951721cea9544a9ab8efaa9c223813257228512bb67010fff9d9',
      }),
    );
  });

  it('uses an ordinary visible textarea only when rendered Monaco code is unavailable', async () => {
    const result = await extractLeetCodeSnapshot(
      candidates({
        codeCandidates: [{ visible: true, readable: true, value: 'ordinary textarea' }],
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        codeAvailable: true,
        code: 'ordinary textarea',
        codeRange: { startLine: 1, endLine: 1, complete: true },
      }),
    );
  });

  it('returns structured unavailable code when no visible readable textarea exists', async () => {
    const result = await extractLeetCodeSnapshot(
      candidates({
        codeCandidates: [
          { visible: false, readable: true, value: 'hidden' },
          { visible: true, readable: false, value: '' },
        ],
      }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        codeAvailable: false,
        language: 'Unknown',
        codeUnavailable: { reason: 'NO_VISIBLE_CODE_EDITOR' },
        fingerprint: null,
      }),
    );
  });

  it('prefers a known visible language label near the editor', async () => {
    const result = await extractLeetCodeSnapshot(
      candidates({
        codeCandidates: [{ visible: true, readable: true, value: 'pass' }],
        nearbyLanguageCandidates: [
          { text: 'not a language', visible: true },
          { text: 'Python3', visible: true },
        ],
        languageCandidates: [{ text: 'Java', visible: true }],
      }),
    );

    expect(result?.language).toBe('Python');
  });

  it('uses a bounded stable language fallback and never infers from code', async () => {
    const fromStableSelector = await extractLeetCodeSnapshot(
      candidates({
        codeCandidates: [{ visible: true, readable: true, value: 'class Solution {}' }],
        languageCandidates: [{ text: 'Language: C++', visible: true }],
      }),
    );
    const unknown = await extractLeetCodeSnapshot(
      candidates({
        codeCandidates: [
          { visible: true, readable: true, value: 'public static void main(String[] args) {}' },
        ],
        languageCandidates: [{ text: 'Choose syntax', visible: true }],
      }),
    );

    expect(fromStableSelector?.language).toBe('C++');
    expect(unknown?.language).toBe('Unknown');
  });
});
