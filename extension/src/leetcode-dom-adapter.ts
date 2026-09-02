import type { ExtractionCandidates, VisibleTextCandidate } from './leetcode-extraction.js';
import type { EditorModelReading } from './leetcode-model-reader.js';

export interface VisibilityFacts {
  hiddenInTree: boolean;
  ariaHiddenInTree: boolean;
  displayNoneInTree: boolean;
  visibilityHiddenInTree: boolean;
  hasLayout: boolean;
}

export function isVisibleFromFacts(facts: VisibilityFacts): boolean {
  return (
    !facts.hiddenInTree &&
    !facts.ariaHiddenInTree &&
    !facts.displayNoneInTree &&
    !facts.visibilityHiddenInTree &&
    facts.hasLayout
  );
}

export function isPubliclyVisible(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  let hiddenInTree = false;
  let ariaHiddenInTree = false;
  let displayNoneInTree = false;
  let visibilityHiddenInTree = false;

  for (let current: Element | null = element; current; current = current.parentElement) {
    hiddenInTree ||= current.hasAttribute('hidden');
    ariaHiddenInTree ||= current.getAttribute('aria-hidden')?.toLowerCase() === 'true';
    if (view) {
      const style = view.getComputedStyle(current);
      displayNoneInTree ||= style.display === 'none';
      visibilityHiddenInTree ||= style.visibility === 'hidden' || style.visibility === 'collapse';
    }
  }

  const rectangles = Array.from(element.getClientRects());
  const bounding = element.getBoundingClientRect();
  const hasLayout =
    rectangles.some((rectangle) => rectangle.width > 0 && rectangle.height > 0) ||
    (bounding.width > 0 && bounding.height > 0);

  return isVisibleFromFacts({
    hiddenInTree,
    ariaHiddenInTree,
    displayNoneInTree,
    visibilityHiddenInTree,
    hasLayout,
  });
}

function elements(document: Document, selectors: string[]): Element[] {
  const values: Element[] = [];
  const seen = new Set<Element>();
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (seen.has(element)) continue;
      seen.add(element);
      values.push(element);
    }
  }
  return values;
}

function textCandidate(element: Element, currentDescription: Element | null): VisibleTextCandidate {
  return {
    text: element.textContent ?? '',
    visible: isPubliclyVisible(element),
    ...(currentDescription?.contains(element) ? { inCurrentDescription: true } : {}),
  };
}

export function collectExtractionCandidates(
  document: Document,
  locationUrl: string,
  model: EditorModelReading | null,
): ExtractionCandidates {
  const slug = new URL(locationUrl).pathname.match(/^\/problems\/([a-z0-9-]+)/)?.[1] ?? '';
  const titleElements = elements(document, [
    '[data-cy="question-title"]',
    '[data-testid="question-title"]',
    '[data-testid="problem-title"]',
    'div.text-title-large',
    `a[href="/problems/${slug}/"]`,
    `a[href="/problems/${slug}/description/"]`,
  ]);
  // LeetCode leaves Description mounted but display:none after submission. Only
  // trust that pane when its own title link identifies the current problem; a
  // previous problem or a recommendations pane must not supply this metadata.
  const titleLink = titleElements
    .flatMap((element) =>
      element.matches('a[href]') ? [element] : Array.from(element.querySelectorAll('a[href]')),
    )
    .find((element) => {
      const href = element.getAttribute('href');
      return href === `/problems/${slug}/` || href === `/problems/${slug}/description/`;
    });
  const currentDescription = titleLink?.closest('.flexlayout__tab') ?? null;
  const scoped = (values: Element[]) =>
    currentDescription ? values.filter((element) => currentDescription.contains(element)) : values;
  const stableDifficulty = elements(document, [
    '[data-degree]',
    '[diff]',
    '[data-testid="difficulty"]',
    '.text-difficulty-easy',
    '.text-difficulty-medium',
    '.text-difficulty-hard',
  ]);
  const topicElements = Array.from(document.querySelectorAll('a[href]'));

  return {
    locationUrl,
    documentTitle: document.title,
    titleCandidates: scoped(titleLink ? [titleLink, ...titleElements] : titleElements).map(
      (element) => textCandidate(element, currentDescription),
    ),
    difficultyCandidates: scoped(stableDifficulty).map((element) =>
      textCandidate(element, currentDescription),
    ),
    topicCandidates: scoped(topicElements).map((element) => ({
      ...textCandidate(element, currentDescription),
      href: element.getAttribute('href') ?? '',
    })),
    model,
  };
}

export function observeLeetCodePageChanges(
  document: Document,
  window: Window,
  onChange: () => void,
): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [
      'aria-hidden',
      'aria-label',
      'class',
      'data-degree',
      'data-lang',
      'data-language',
      'diff',
      'hidden',
      'href',
      'style',
    ],
  });
  window.addEventListener('popstate', onChange);
  window.addEventListener('hashchange', onChange);
  let observedHref = window.location.href;
  const locationInterval = setInterval(() => {
    if (window.location.href === observedHref) return;
    observedHref = window.location.href;
    onChange();
  }, 250);

  return () => {
    observer.disconnect();
    window.removeEventListener('popstate', onChange);
    window.removeEventListener('hashchange', onChange);
    clearInterval(locationInterval);
  };
}
