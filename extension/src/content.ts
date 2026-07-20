import type { Difficulty } from '../../src/shared/contract.js';
import type { LeetCodeContext } from './types.js';

function currentSlug(): string | null {
  return window.location.pathname.match(/^\/problems\/([^/]+)/)?.[1] ?? null;
}

function firstText(selectors: string[]): string | null {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.textContent?.trim();
    if (value) return value;
  }
  return null;
}

function problemTitle(slug: string): string {
  const selected = firstText([
    '[data-cy="question-title"]',
    '[data-testid="question-title"]',
    'div.text-title-large',
    'a[href="/problems/' + slug + '/"]',
  ]);
  if (selected) return selected;

  return document.title
    .replace(/\s*[-|]\s*LeetCode.*$/i, '')
    .replace(/^LeetCode\s*[-|]\s*/i, '')
    .trim();
}

function difficulty(): Difficulty {
  const explicit = firstText([
    '[data-degree]',
    '[diff]',
    '[data-testid="difficulty"]',
    'div.text-difficulty-easy',
    'div.text-difficulty-medium',
    'div.text-difficulty-hard',
  ]);
  if (explicit === 'Easy' || explicit === 'Medium' || explicit === 'Hard') return explicit;

  const candidates = Array.from(document.querySelectorAll('span, div'));
  for (const element of candidates.slice(0, 800)) {
    const text = element.textContent?.trim();
    if (text === 'Easy' || text === 'Medium' || text === 'Hard') return text;
  }
  return 'Unknown';
}

function extractContext(): LeetCodeContext | null {
  const slug = currentSlug();
  if (!slug) return null;
  const title = problemTitle(slug);
  const numberMatch = title.match(/^\s*(\d+)\s*\./);
  return {
    slug,
    title: title || slug,
    number: numberMatch ? Number(numberMatch[1]) : null,
    url: `https://leetcode.com/problems/${slug}/`,
    difficulty: difficulty(),
  };
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (typeof message === 'object' && message !== null && 'type' in message) {
    if ((message as { type: string }).type === 'GET_LEETCODE_CONTEXT') {
      sendResponse(extractContext());
    }
  }
});
