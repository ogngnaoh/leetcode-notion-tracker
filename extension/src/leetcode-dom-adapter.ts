import {
  reconstructMonacoCode,
  type ExtractionCandidates,
  type RenderedCodeCandidate,
  type VisibleTextCandidate,
} from './leetcode-extraction.js';

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

function textCandidate(element: Element, text = element.textContent ?? ''): VisibleTextCandidate {
  return { text, visible: isPubliclyVisible(element) };
}

function languageValues(element: Element): VisibleTextCandidate[] {
  const visible = isPubliclyVisible(element);
  const rawValues = [
    element.textContent ?? '',
    element.getAttribute('data-language') ?? '',
    element.getAttribute('data-lang') ?? '',
    element.getAttribute('aria-label') ?? '',
    element.getAttribute('title') ?? '',
  ];
  return [...new Set(rawValues)].map((text) => ({ text, visible }));
}

function nearbyLanguageCandidates(codeEditors: Element[]): VisibleTextCandidate[] {
  const candidates: VisibleTextCandidate[] = [];
  const seen = new Set<Element>();
  for (const editor of codeEditors.filter(isPubliclyVisible)) {
    let container: Element | null = editor.parentElement;
    for (let depth = 0; container && depth < 6; depth += 1, container = container.parentElement) {
      for (const element of container.querySelectorAll(
        'button, [role="button"], [data-language], [data-lang], [aria-label*="language" i]',
      )) {
        if (seen.has(element)) continue;
        seen.add(element);
        candidates.push(...languageValues(element));
      }
    }
  }
  return candidates;
}

function positionedTop(element: Element, boundary: Element): number | null {
  for (
    let current: Element | null = element;
    current && current !== boundary;
    current = current.parentElement
  ) {
    const value = Number.parseFloat((current as HTMLElement).style?.top ?? '');
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function entireFileRendered(editor: Element): boolean {
  const scrollbar = editor.querySelector<HTMLElement>('.scrollbar.vertical');
  if (!scrollbar) return false;
  const maximum = Number.parseFloat(scrollbar.getAttribute('aria-valuemax') ?? '');
  if (Number.isFinite(maximum)) return maximum <= 0;
  const slider = scrollbar.querySelector<HTMLElement>('.slider');
  if (!slider) return false;
  const trackHeight = scrollbar.getBoundingClientRect().height;
  const sliderHeight = slider.getBoundingClientRect().height;
  return trackHeight > 0 && sliderHeight >= trackHeight - 1;
}

function renderedCodeCandidates(document: Document): RenderedCodeCandidate[] {
  const candidates: RenderedCodeCandidate[] = [];
  for (const editor of document.querySelectorAll('.monaco-editor')) {
    if (!isPubliclyVisible(editor)) continue;
    const gutters = Array.from(editor.querySelectorAll('.margin-view-overlays .line-numbers')).map(
      (element) => ({
        lineNumber: Number.parseInt(element.textContent?.trim() ?? '', 10),
        top: positionedTop(element, editor),
      }),
    );
    const rendered = Array.from(editor.querySelectorAll('.view-lines > .view-line')).map(
      (element) => ({ text: element.textContent ?? '', top: positionedTop(element, editor) }),
    );
    if (gutters.some((line) => line.top === null) || rendered.some((line) => line.top === null)) {
      continue;
    }
    const candidate = reconstructMonacoCode(
      gutters.map((line) => ({ lineNumber: line.lineNumber, top: line.top! })),
      rendered.map((line) => ({ text: line.text, top: line.top! })),
      entireFileRendered(editor),
    );
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

export function collectExtractionCandidates(
  document: Document,
  locationUrl: string,
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
  const stableDifficulty = elements(document, [
    '[data-degree]',
    '[diff]',
    '[data-testid="difficulty"]',
    '.text-difficulty-easy',
    '.text-difficulty-medium',
    '.text-difficulty-hard',
  ]);
  const topicElements = Array.from(document.querySelectorAll('a[href]'));
  const ordinaryCodeEditors = Array.from(
    document.querySelectorAll<HTMLTextAreaElement>(
      'textarea[data-testid*="code" i], textarea[aria-label*="code" i]',
    ),
  ).filter((editor) => !editor.closest('.monaco-editor'));
  const editorContainers = [
    ...Array.from(document.querySelectorAll('.monaco-editor')),
    ...ordinaryCodeEditors,
  ];
  const stableLanguage = elements(document, [
    '[data-cy="lang-select"]',
    '[data-testid="language-select"]',
    '[data-testid*="language" i]',
    '[data-language]',
    '[data-lang]',
    'button[aria-label*="language" i]',
    '[role="button"][aria-label*="language" i]',
    'button[id^="headlessui-listbox-button"]',
  ]);

  return {
    locationUrl,
    documentTitle: document.title,
    titleCandidates: titleElements.map((element) => textCandidate(element)),
    difficultyCandidates: stableDifficulty.map((element) => textCandidate(element)),
    topicCandidates: topicElements.map((element) => ({
      ...textCandidate(element),
      href: element.getAttribute('href') ?? '',
    })),
    renderedCodeCandidates: renderedCodeCandidates(document),
    codeCandidates: ordinaryCodeEditors.map((editor) => {
      try {
        return { visible: isPubliclyVisible(editor), readable: true, value: editor.value };
      } catch {
        return { visible: isPubliclyVisible(editor), readable: false, value: '' };
      }
    }),
    nearbyLanguageCandidates: nearbyLanguageCandidates(editorContainers),
    languageCandidates: stableLanguage.flatMap(languageValues),
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
      'value',
    ],
  });
  const onEditorInput = (event: Event) => {
    if (
      event.target instanceof Element &&
      event.target.matches('textarea[aria-label="Code editor"]')
    ) {
      onChange();
    }
  };
  document.addEventListener('input', onEditorInput, true);
  document.addEventListener('change', onEditorInput, true);
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
    document.removeEventListener('input', onEditorInput, true);
    document.removeEventListener('change', onEditorInput, true);
    window.removeEventListener('popstate', onChange);
    window.removeEventListener('hashchange', onChange);
    clearInterval(locationInterval);
  };
}
