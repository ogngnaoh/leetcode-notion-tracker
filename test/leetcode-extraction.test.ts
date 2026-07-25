import { describe, expect, it } from 'vitest';
import {
  extractLeetCodeSnapshot,
  normalizeProblemTitle,
  type ExtractionCandidates,
} from '../extension/src/leetcode-extraction.js';

function candidates(overrides: Partial<ExtractionCandidates> = {}): ExtractionCandidates {
  return {
    locationUrl: 'https://leetcode.com/problems/two-sum/',
    documentTitle: '1. Two Sum - LeetCode',
    titleCandidates: [],
    difficultyCandidates: [],
    topicCandidates: [],
    model: null,
    ...overrides,
  };
}

describe('LeetCode public-DOM extraction', () => {
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

  it('reads code and language from the model regardless of what is rendered', async () => {
    const code = '  const x = 1;\n';
    const result = await extractLeetCodeSnapshot(
      candidates({ model: { code, languageId: 'typescript' } }),
    );

    expect(result).toEqual(
      expect.objectContaining({
        codeAvailable: true,
        language: 'TypeScript',
        code,
        fingerprint: 'c1a308e8a7b6951721cea9544a9ab8efaa9c223813257228512bb67010fff9d9',
      }),
    );
  });

  it('captures a solution far longer than any editor viewport in full', async () => {
    const code = Array.from({ length: 400 }, (_, index) => `line_${index + 1} = ${index}`).join(
      '\n',
    );
    const result = await extractLeetCodeSnapshot(
      candidates({ model: { code, languageId: 'python3' } }),
    );

    expect(result).toMatchObject({ codeAvailable: true, code });
    expect(result?.codeAvailable === true && result.code.split('\n')).toHaveLength(400);
  });

  it('does not carry a code range', async () => {
    const result = await extractLeetCodeSnapshot(
      candidates({ model: { code: 'a\nb', languageId: 'python3' } }),
    );

    expect(result).not.toHaveProperty('codeRange');
  });

  it('reports the model unavailable when there is no reading', async () => {
    const result = await extractLeetCodeSnapshot(candidates({ model: null }));

    expect(result).toEqual(
      expect.objectContaining({
        codeAvailable: false,
        language: 'Unknown',
        codeUnavailable: { reason: 'NO_READABLE_EDITOR_MODEL' },
        fingerprint: null,
      }),
    );
  });

  it.each([
    ['python3', 'Python'],
    ['typescript', 'TypeScript'],
    ['cpp', 'C++'],
    ['golang', 'Go'],
    ['brand-new-language', 'Unknown'],
  ])('maps the model language id %s to %s', async (languageId, expected) => {
    const result = await extractLeetCodeSnapshot(candidates({ model: { code: 'x', languageId } }));

    expect(result?.language).toBe(expected);
  });

  it('never infers the language from the code itself', async () => {
    const result = await extractLeetCodeSnapshot(
      candidates({
        model: { code: 'public static void main(String[] args) {}', languageId: 'unregistered' },
      }),
    );

    expect(result?.language).toBe('Unknown');
  });
});
