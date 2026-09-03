export interface ProblemFixture {
  slug: string;
  title: string;
  number: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  topics: string[];
  /** LeetCode editor language id. */
  language: string;
  code: string | null;
  /** How many logical lines the fake view renders. Omit to render all of them. */
  renderedLines?: number;
  /** Installs `window.monaco` well after the model request timeout, mimicking slow hydration. */
  lateModel?: boolean;
  /** Editor runtime used by the page. Focus mode currently uses CodeMirror. */
  editor?: 'monaco' | 'codemirror';
  /** Accepted submissions keep the description mounted in an inactive layout tab. */
  inactiveDescription?: boolean;
  route?: string;
  animate?: boolean;
}

export const twoSum: ProblemFixture = {
  slug: 'two-sum',
  title: 'Two Sum',
  number: 1,
  difficulty: 'Easy',
  topics: ['Array', 'Hash Table', 'Array'],
  language: 'python3',
  code: 'def twoSum(nums, target):\n    seen = {}\n    return []',
};

export const secondProblem: ProblemFixture = {
  slug: 'longest-substring-without-repeating-characters',
  title: 'Longest Substring Without Repeating Characters',
  number: 3,
  difficulty: 'Medium',
  topics: ['Hash Table', 'String', 'Sliding Window'],
  language: 'typescript',
  code: 'function lengthOfLongestSubstring(s: string): number {\n  return s.length;\n}',
};

export function fixtureHtml(fixture: ProblemFixture): string {
  const topics = fixture.topics
    .map((topic) => {
      const slug = topic.toLowerCase().replaceAll(' ', '-');
      return `<a class="topic" href="/tag/${slug}/">${topic}</a>`;
    })
    .join('');
  const editor =
    fixture.code === null
      ? ''
      : fixture.editor === 'codemirror'
        ? `<div class="editor" data-track-load="code_editor"><div class="cm-editor"><div class="cm-scroller"><div class="cm-content" role="textbox" data-language=${JSON.stringify(fixture.language)}></div></div></div></div>
    <script>
      (() => {
        const state = {
          code: ${JSON.stringify(fixture.code)},
          languageId: ${JSON.stringify(fixture.language)},
          rendered: ${fixture.renderedLines ?? -1},
        };
        const content = document.querySelector('[data-track-load="code_editor"] .cm-content');
        const view = { state: { doc: { toString: () => state.code } } };
        content.cmView = { view };
        const render = () => {
          const lines = state.code.split('\\n');
          const shown = state.rendered < 0 ? lines : lines.slice(0, state.rendered);
          content.replaceChildren(...shown.map((text) => {
            const line = document.createElement('div');
            line.className = 'cm-line';
            line.textContent = text;
            return line;
          }));
        };
        window.__setModel = (code, languageId, rendered) => {
          state.code = code;
          if (languageId !== undefined) {
            state.languageId = languageId;
            content.dataset.language = languageId;
          }
          if (rendered !== undefined) state.rendered = rendered;
          view.state = { doc: { toString: () => state.code } };
          render();
        };
        render();
      })();
    </script>`
        : `<div class="editor"><div class="monaco-editor"><div class="view-lines"></div></div></div>
    <script>
      (() => {
        const contentListeners = new Set();
        const languageListeners = new Set();
        const state = {
          code: ${JSON.stringify(fixture.code)},
          languageId: ${JSON.stringify(fixture.language)},
          rendered: ${fixture.renderedLines ?? -1},
        };
        const node = document.querySelector('.monaco-editor');
        const view = node.querySelector('.view-lines');
        const render = () => {
          const lines = state.code.split('\\n');
          const shown = state.rendered < 0 ? lines : lines.slice(0, state.rendered);
          view.replaceChildren(...shown.map((text) => {
            const line = document.createElement('div');
            line.className = 'view-line';
            line.textContent = text;
            return line;
          }));
        };
        const model = {
          getValue: () => state.code,
          getLineCount: () => state.code.split('\\n').length,
          getLanguageId: () => state.languageId,
          onDidChangeContent: (listener) => {
            contentListeners.add(listener);
            return { dispose: () => contentListeners.delete(listener) };
          },
        };
        const editorInstance = {
          getModel: () => model,
          getDomNode: () => node,
          onDidChangeModelLanguage: (listener) => {
            languageListeners.add(listener);
            return { dispose: () => languageListeners.delete(listener) };
          },
        };
        const install = () => {
          window.monaco = { editor: { getEditors: () => [editorInstance] } };
        };
        if (${fixture.lateModel === true}) setTimeout(install, 900); else install();
        window.__setModel = (code, languageId, rendered) => {
          state.code = code;
          if (languageId !== undefined) state.languageId = languageId;
          if (rendered !== undefined) state.rendered = rendered;
          render();
          for (const listener of contentListeners) listener();
          for (const listener of languageListeners) listener();
        };
        render();
      })();
    </script>`;
  return `<!doctype html>
    <html lang="en"><head><meta charset="utf-8"><title>${fixture.inactiveDescription ? '' : `${fixture.number}. `}${fixture.title} - LeetCode</title>
    <style>
      body { font-family: sans-serif; }
      [data-testid="question-title"], [data-testid="difficulty"], .topic, .editor { display: block; width: 480px; min-height: 24px; }
      .monaco-editor, .cm-editor { position: relative; width: 480px; height: 240px; }
      .view-line { min-height: 20px; white-space: pre; }
      #topics { margin-top: 1600px; }
    </style></head><body>
      ${fixture.inactiveDescription ? '<div class="flexlayout__tab"><div class="text-difficulty-hard">Hard</div><a href="/tag/unrelated/">Unrelated</a></div>' : ''}
      <div class="flexlayout__tab" ${fixture.inactiveDescription ? 'style="display:none"' : ''}>
      <h1 data-testid="question-title"><a href="/problems/${fixture.slug}/">${fixture.number}. ${fixture.title}</a></h1>
      <div data-testid="difficulty">${fixture.difficulty}</div>
      <section id="topics">${topics}</section></div>
      ${editor}
      ${fixture.animate ? '<script>let tick = 0; setInterval(() => document.body.className = `tick-${++tick}`, 16);</script>' : ''}
    </body></html>`;
}
