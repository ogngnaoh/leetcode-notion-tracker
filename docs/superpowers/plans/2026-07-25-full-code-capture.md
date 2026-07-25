# Full Code Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the complete LeetCode solution by reading Monaco's editor model from a MAIN-world content script, so a solution longer than the editor viewport is never truncated.

**Architecture:** A new MAIN-world content script owns all Monaco model reads and answers the existing ISOLATED content script over `window.postMessage` with a nonce. The ISOLATED script keeps ownership of title, difficulty, and topics. All DOM-based code reconstruction and language scraping are deleted; when the model cannot be read, code is reported unavailable and capture blocks.

**Tech Stack:** TypeScript, Chrome MV3 (`world: "MAIN"` content scripts), esbuild, Vitest (node environment, no jsdom), Playwright.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-25-full-code-capture-design.md`.
- Vitest runs with `environment: 'node'`. There is **no jsdom**. All unit tests use hand-built fake objects, never real DOM.
- No new `manifest.json` permissions. `minimum_chrome_version` stays `116`.
- Content script bundles must not contain `export` statements — esbuild `format: 'esm'` only produces clean output for entry points that export nothing.
- Model read timeout is exactly `500`ms. Bridge discovery poll interval is exactly `250`ms.
- The unavailable reason string is exactly `NO_READABLE_EDITOR_MODEL`.
- The channel name string is exactly `lctrack-model`.
- Version bump is a deliberate **minor** increment `0.1.8` → `0.2.0` (capture mechanism change), applied to `package.json`, `package-lock.json`, and `extension/manifest.json`. Edit the `version` fields in `package-lock.json` by hand; do **not** run `npm install` to bump it.
- Commit only the exact paths each task lists. Never `git add` a bare directory.
- Run `npm run typecheck && npm run test` before every commit. Every commit must be green.

---

### Task 1: Pure Monaco model reader

**Files:**
- Create: `extension/src/leetcode-model-reader.ts`
- Test: `test/leetcode-model-reader.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `readEditorModel(monaco: MonacoLike | null | undefined): EditorModelReading | null`, and types `EditorModelReading { code: string; languageId: string }`, `MonacoLike`, `EditorLike`, `EditorModelLike`, `EditorNodeLike`.

The reader must not touch `document`. Connectivity is tested via `node.isConnected`, which a fake object can supply. This is what keeps it testable under the node environment.

- [ ] **Step 1: Write the failing test**

Create `test/leetcode-model-reader.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/leetcode-model-reader.test.ts`
Expected: FAIL — cannot resolve `../extension/src/leetcode-model-reader.js`.

- [ ] **Step 3: Write the implementation**

Create `extension/src/leetcode-model-reader.ts`:

```ts
export interface EditorModelLike {
  getValue(): string;
  getLineCount(): number;
  getLanguageId(): string;
}

export interface EditorNodeLike {
  isConnected: boolean;
  getBoundingClientRect(): { width: number; height: number };
}

export interface EditorLike {
  getModel(): EditorModelLike | null | undefined;
  getDomNode(): EditorNodeLike | null | undefined;
}

export interface MonacoLike {
  editor?: {
    getEditors?: () => EditorLike[] | undefined;
  };
}

export interface EditorModelReading {
  code: string;
  languageId: string;
}

/**
 * Reads the complete buffer from Monaco's model, which is independent of what the
 * virtualized view has rendered. The plaintext editor LeetCode keeps alongside the
 * code editor is skipped; among the rest the largest laid-out editor wins, which
 * survives the brief post-load window where the code editor measures near zero.
 */
export function readEditorModel(monaco: MonacoLike | null | undefined): EditorModelReading | null {
  const editors = monaco?.editor?.getEditors?.();
  if (!Array.isArray(editors)) return null;

  let best: { reading: EditorModelReading; area: number } | null = null;
  for (const editor of editors) {
    const model = editor?.getModel?.();
    const node = editor?.getDomNode?.();
    if (!model || !node || !node.isConnected) continue;
    const languageId = model.getLanguageId();
    if (languageId === 'plaintext') continue;
    const rectangle = node.getBoundingClientRect();
    const area = rectangle.width * rectangle.height;
    if (best && area <= best.area) continue;
    best = { reading: { code: model.getValue(), languageId }, area };
  }
  return best?.reading ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/leetcode-model-reader.test.ts && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add extension/src/leetcode-model-reader.ts test/leetcode-model-reader.test.ts
git commit -m "feat: add pure Monaco model reader"
```

---

### Task 2: Pure cross-world message channel

**Files:**
- Create: `extension/src/leetcode-model-channel.ts`
- Test: `test/leetcode-model-channel.test.ts`

**Interfaces:**
- Consumes: `EditorModelReading` from Task 1.
- Produces:
  - `MODEL_CHANNEL = 'lctrack-model'`
  - `createModelRequester(window: ChannelWindow, origin: string, newId: () => string, timeoutMs?: number): () => Promise<EditorModelReading | null>`
  - `createModelResponder(window: ChannelWindow, origin: string, read: () => EditorModelReading | null): () => void`
  - `publishModelChanged(window: ChannelWindow, origin: string): void`
  - `listenForModelChanges(window: ChannelWindow, onChange: () => void): () => void`
  - types `ChannelWindow`, `MessageEventLike`

Both worlds share this module. The requester validates every reply because the MAIN world is the page's world and the page can forge messages.

- [ ] **Step 1: Write the failing test**

Create `test/leetcode-model-channel.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_CHANNEL,
  createModelRequester,
  createModelResponder,
  listenForModelChanges,
  publishModelChanged,
  type ChannelWindow,
  type MessageEventLike,
} from '../extension/src/leetcode-model-channel.js';

afterEach(() => {
  vi.useRealTimers();
});

class FakeWindow implements ChannelWindow {
  readonly sent: unknown[] = [];
  private listeners = new Set<(event: MessageEventLike) => void>();

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  addEventListener(_type: 'message', listener: (event: MessageEventLike) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEventLike) => void): void {
    this.listeners.delete(listener);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  deliver(data: unknown, source: unknown = this): void {
    for (const listener of [...this.listeners]) listener({ data, source });
  }
}

const reading = { code: 'class Solution:', languageId: 'python3' };

describe('model requester', () => {
  it('posts a request carrying the channel and a fresh id', async () => {
    const win = new FakeWindow();
    const request = createModelRequester(win, 'https://leetcode.com', () => 'id-1');
    const pending = request();
    expect(win.sent).toEqual([{ channel: MODEL_CHANNEL, kind: 'request', id: 'id-1' }]);
    win.deliver({ channel: MODEL_CHANNEL, kind: 'response', id: 'id-1', reading });
    await expect(pending).resolves.toEqual(reading);
  });

  it('resolves null when the responder reports no model', async () => {
    const win = new FakeWindow();
    const request = createModelRequester(win, 'https://leetcode.com', () => 'id-1');
    const pending = request();
    win.deliver({ channel: MODEL_CHANNEL, kind: 'response', id: 'id-1', reading: null });
    await expect(pending).resolves.toBeNull();
  });

  it('removes its listener once settled', async () => {
    const win = new FakeWindow();
    const request = createModelRequester(win, 'https://leetcode.com', () => 'id-1');
    const pending = request();
    expect(win.listenerCount).toBe(1);
    win.deliver({ channel: MODEL_CHANNEL, kind: 'response', id: 'id-1', reading });
    await pending;
    expect(win.listenerCount).toBe(0);
  });

  it('resolves null after the timeout when nothing replies', async () => {
    vi.useFakeTimers();
    const win = new FakeWindow();
    const request = createModelRequester(win, 'https://leetcode.com', () => 'id-1', 500);
    const pending = request();
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBeNull();
    expect(win.listenerCount).toBe(0);
  });

  it.each([
    ['a foreign source', { channel: MODEL_CHANNEL, kind: 'response', id: 'id-1', reading }, {}],
    ['a mismatched id', { channel: MODEL_CHANNEL, kind: 'response', id: 'other', reading }, null],
    ['a foreign channel', { channel: 'evil', kind: 'response', id: 'id-1', reading }, null],
    ['a non-object payload', 'nonsense', null],
    [
      'a malformed reading',
      { channel: MODEL_CHANNEL, kind: 'response', id: 'id-1', reading: { code: 5 } },
      null,
    ],
  ])('ignores %s', async (_label, data, source) => {
    vi.useFakeTimers();
    const win = new FakeWindow();
    const request = createModelRequester(win, 'https://leetcode.com', () => 'id-1', 500);
    const pending = request();
    win.deliver(data, source === null ? win : source);
    await vi.advanceTimersByTimeAsync(500);
    await expect(pending).resolves.toBeNull();
  });
});

describe('model responder', () => {
  it('replies to a request with the current reading', () => {
    const win = new FakeWindow();
    createModelResponder(win, 'https://leetcode.com', () => reading);
    win.deliver({ channel: MODEL_CHANNEL, kind: 'request', id: 'id-9' });
    expect(win.sent).toEqual([
      { channel: MODEL_CHANNEL, kind: 'response', id: 'id-9', reading },
    ]);
  });

  it('replies with a null reading when no model is readable', () => {
    const win = new FakeWindow();
    createModelResponder(win, 'https://leetcode.com', () => null);
    win.deliver({ channel: MODEL_CHANNEL, kind: 'request', id: 'id-9' });
    expect(win.sent).toEqual([
      { channel: MODEL_CHANNEL, kind: 'response', id: 'id-9', reading: null },
    ]);
  });

  it.each([
    ['a response message', { channel: MODEL_CHANNEL, kind: 'response', id: 'x', reading: null }],
    ['a foreign channel', { channel: 'evil', kind: 'request', id: 'x' }],
    ['a request without an id', { channel: MODEL_CHANNEL, kind: 'request' }],
  ])('does not reply to %s', (_label, data) => {
    const win = new FakeWindow();
    createModelResponder(win, 'https://leetcode.com', () => reading);
    win.deliver(data);
    expect(win.sent).toEqual([]);
  });

  it('stops replying once disposed', () => {
    const win = new FakeWindow();
    const dispose = createModelResponder(win, 'https://leetcode.com', () => reading);
    dispose();
    win.deliver({ channel: MODEL_CHANNEL, kind: 'request', id: 'id-9' });
    expect(win.sent).toEqual([]);
  });
});

describe('change notifications', () => {
  it('publishes a changed message', () => {
    const win = new FakeWindow();
    publishModelChanged(win, 'https://leetcode.com');
    expect(win.sent).toEqual([{ channel: MODEL_CHANNEL, kind: 'changed' }]);
  });

  it('invokes the callback for a changed message from this window', () => {
    const win = new FakeWindow();
    const onChange = vi.fn();
    listenForModelChanges(win, onChange);
    win.deliver({ channel: MODEL_CHANNEL, kind: 'changed' });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a foreign source', { channel: MODEL_CHANNEL, kind: 'changed' }, {}],
    ['a foreign channel', { channel: 'evil', kind: 'changed' }, null],
    ['another kind', { channel: MODEL_CHANNEL, kind: 'request', id: 'x' }, null],
  ])('ignores %s', (_label, data, source) => {
    const win = new FakeWindow();
    const onChange = vi.fn();
    listenForModelChanges(win, onChange);
    win.deliver(data, source === null ? win : source);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stops listening once disposed', () => {
    const win = new FakeWindow();
    const onChange = vi.fn();
    listenForModelChanges(win, onChange)();
    win.deliver({ channel: MODEL_CHANNEL, kind: 'changed' });
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/leetcode-model-channel.test.ts`
Expected: FAIL — cannot resolve `../extension/src/leetcode-model-channel.js`.

- [ ] **Step 3: Write the implementation**

Create `extension/src/leetcode-model-channel.ts`:

```ts
import type { EditorModelReading } from './leetcode-model-reader.js';

export const MODEL_CHANNEL = 'lctrack-model';

export interface MessageEventLike {
  data: unknown;
  source: unknown;
}

export interface ChannelWindow {
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
}

function isChannelMessage(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).channel === MODEL_CHANNEL
  );
}

function isReading(value: unknown): value is EditorModelReading | null {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  const reading = value as Record<string, unknown>;
  return typeof reading.code === 'string' && typeof reading.languageId === 'string';
}

/**
 * Requests the model reading from the MAIN-world bridge. The bridge runs in the page's
 * world, so every reply is validated for shape and matched against a fresh nonce; an
 * unanswered request resolves null rather than hanging.
 */
export function createModelRequester(
  window: ChannelWindow,
  origin: string,
  newId: () => string,
  timeoutMs = 500,
): () => Promise<EditorModelReading | null> {
  return () =>
    new Promise<EditorModelReading | null>((resolve) => {
      const id = newId();
      let settled = false;

      const finish = (reading: EditorModelReading | null): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener('message', listener);
        resolve(reading);
      };

      const listener = (event: MessageEventLike): void => {
        if (event.source !== window || !isChannelMessage(event.data)) return;
        const message = event.data;
        if (message.kind !== 'response' || message.id !== id || !isReading(message.reading)) return;
        finish(message.reading);
      };

      const timer = setTimeout(() => finish(null), timeoutMs);
      window.addEventListener('message', listener);
      window.postMessage({ channel: MODEL_CHANNEL, kind: 'request', id }, origin);
    });
}

export function createModelResponder(
  window: ChannelWindow,
  origin: string,
  read: () => EditorModelReading | null,
): () => void {
  const listener = (event: MessageEventLike): void => {
    if (event.source !== window || !isChannelMessage(event.data)) return;
    const message = event.data;
    if (message.kind !== 'request' || typeof message.id !== 'string') return;
    window.postMessage(
      { channel: MODEL_CHANNEL, kind: 'response', id: message.id, reading: read() },
      origin,
    );
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export function publishModelChanged(window: ChannelWindow, origin: string): void {
  window.postMessage({ channel: MODEL_CHANNEL, kind: 'changed' }, origin);
}

export function listenForModelChanges(window: ChannelWindow, onChange: () => void): () => void {
  const listener = (event: MessageEventLike): void => {
    if (event.source !== window || !isChannelMessage(event.data)) return;
    if (event.data.kind !== 'changed') return;
    onChange();
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/leetcode-model-channel.test.ts && npm run typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add extension/src/leetcode-model-channel.ts test/leetcode-model-channel.test.ts
git commit -m "feat: add cross-world model message channel"
```

---

### Task 3: MAIN-world bridge, manifest entry, and dual-world reinjection

**Files:**
- Create: `extension/src/leetcode-model-bridge.ts`
- Modify: `extension/manifest.json:36-43`
- Modify: `scripts/build-extension.mjs:13-18`
- Modify: `extension/src/sidepanel-snapshot-reader.ts:4-7,24-25`
- Modify: `extension/src/sidepanel.ts:117-119`
- Test: `test/sidepanel-snapshot-reader.test.ts`

**Interfaces:**
- Consumes: `readEditorModel` (Task 1); `createModelResponder`, `publishModelChanged` (Task 2).
- Produces: the built artifact `leetcode-model-bridge.js`; `SnapshotReaderDependencies.injectContentScripts(tabId: number): Promise<void>` replacing `injectContentScript(tabId, files)`.

Nothing consumes the bridge yet — this task is additive and leaves the existing DOM path working, so the suite stays green.

- [ ] **Step 1: Write the failing test**

Replace the injection expectations in `test/sidepanel-snapshot-reader.test.ts`. Change every `injectContentScript` dependency to `injectContentScripts` taking only `tabId`. The test asserting a reinjection now reads:

```ts
it('injects both world scripts once when no receiver exists, then retries', async () => {
  const injected: number[] = [];
  let calls = 0;
  const read = createSnapshotReader({
    sendMessage: async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
      return { context: null };
    },
    injectContentScripts: async (tabId) => {
      injected.push(tabId);
    },
  });

  await expect(read(7)).resolves.toBeNull();
  expect(injected).toEqual([7]);
  expect(calls).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/sidepanel-snapshot-reader.test.ts`
Expected: FAIL — `injectContentScripts` is not a known property.

- [ ] **Step 3: Write the implementation**

Edit `extension/src/sidepanel-snapshot-reader.ts` — replace the dependency and its call site:

```ts
export interface SnapshotReaderDependencies {
  sendMessage(tabId: number): Promise<ContentScriptResponse | undefined>;
  injectContentScripts(tabId: number): Promise<void>;
}
```

```ts
      injectedTabs.add(tabId);
      await dependencies.injectContentScripts(tabId);
```

Edit `extension/src/sidepanel.ts:117-119` — inject the MAIN-world bridge before the ISOLATED script:

```ts
  injectContentScripts: async (tabId) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['leetcode-model-bridge.js'],
      world: 'MAIN',
    });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  },
```

Create `extension/src/leetcode-model-bridge.ts`. This is an entry point: it must export nothing.

```ts
import {
  createModelResponder,
  publishModelChanged,
  type ChannelWindow,
} from './leetcode-model-channel.js';
import { readEditorModel, type MonacoLike } from './leetcode-model-reader.js';

interface ObservableModel {
  onDidChangeContent?: (listener: () => void) => unknown;
}

interface ObservableEditor {
  getModel?: () => ObservableModel | null | undefined;
  onDidChangeModelLanguage?: (listener: () => void) => unknown;
}

const channelWindow = window as unknown as ChannelWindow;
const origin = window.location.origin;
const namespace = (): MonacoLike | undefined =>
  (window as unknown as { monaco?: MonacoLike }).monaco;

createModelResponder(channelWindow, origin, () => readEditorModel(namespace()));

const observedModels = new WeakSet<object>();
const observedEditors = new WeakSet<object>();

/**
 * Monaco replaces the model when the user switches language, so discovery repeats on an
 * interval and the WeakSets keep re-attachment idempotent.
 */
function observeEditors(): void {
  const editors = namespace()?.editor?.getEditors?.();
  if (!Array.isArray(editors)) return;
  for (const editor of editors as unknown as ObservableEditor[]) {
    if (!editor) continue;
    if (!observedEditors.has(editor)) {
      observedEditors.add(editor);
      editor.onDidChangeModelLanguage?.(() => publishModelChanged(channelWindow, origin));
    }
    const model = editor.getModel?.();
    if (!model || observedModels.has(model)) continue;
    observedModels.add(model);
    model.onDidChangeContent?.(() => publishModelChanged(channelWindow, origin));
  }
}

observeEditors();
setInterval(observeEditors, 250);
```

Edit `scripts/build-extension.mjs:13-18` — add the entry point:

```js
  entryPoints: {
    background: resolve(source, 'src/background.ts'),
    content: resolve(source, 'src/content.ts'),
    'leetcode-model-bridge': resolve(source, 'src/leetcode-model-bridge.ts'),
    sidepanel: resolve(source, 'src/sidepanel.ts'),
    options: resolve(source, 'src/options.ts'),
  },
```

Edit `extension/manifest.json:36-43` — declare the MAIN-world script first so the responder is listening before the ISOLATED script asks:

```json
  "content_scripts": [
    {
      "matches": ["https://leetcode.com/problems/*"],
      "js": ["leetcode-model-bridge.js"],
      "run_at": "document_idle",
      "world": "MAIN"
    },
    {
      "matches": ["https://leetcode.com/problems/*"],
      "js": ["content.js"],
      "run_at": "document_idle"
    }
  ]
```

- [ ] **Step 4: Run tests and confirm the bundle exports nothing**

Run: `npm run typecheck && npm run test && npm run build:extension`
Expected: all PASS; build succeeds.

Run: `grep -c "^export" dist/extension/leetcode-model-bridge.js`
Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add extension/src/leetcode-model-bridge.ts extension/manifest.json scripts/build-extension.mjs extension/src/sidepanel-snapshot-reader.ts extension/src/sidepanel.ts test/sidepanel-snapshot-reader.test.ts
git commit -m "feat: add MAIN-world Monaco bridge and dual-world injection"
```

---

### Task 4: Source code and language from the model

**Files:**
- Modify: `extension/src/leetcode-extraction.ts:1-70,199-318`
- Modify: `extension/src/leetcode-dom-adapter.ts:1-6,71-153,155-217,219-271`
- Modify: `extension/src/content.ts`
- Test: `test/leetcode-extraction.test.ts`, `test/leetcode-dom-adapter.test.ts`, `test/leetcode-context-runtime.test.ts`

**Interfaces:**
- Consumes: `EditorModelReading` (Task 1); `createModelRequester`, `listenForModelChanges` (Task 2).
- Produces: `collectExtractionCandidates(document: Document, locationUrl: string, model: EditorModelReading | null): ExtractionCandidates`, where `ExtractionCandidates` now carries `model: EditorModelReading | null` and no longer carries `renderedCodeCandidates`, `codeCandidates`, `nearbyLanguageCandidates`, or `languageCandidates`. `UnavailableLeetCodeSnapshot.codeUnavailable.reason` becomes `'NO_READABLE_EDITOR_MODEL'`.

`codeRange` is deliberately **kept** in this task, always emitted as complete, so `sidepanel.ts` continues to typecheck. Task 5 removes it.

- [ ] **Step 1: Update the failing tests**

In `test/leetcode-extraction.test.ts`: delete every `describe`/`it` covering `reconstructMonacoCode`, and delete the import of `reconstructMonacoCode`. Replace candidate builders so they pass a `model` instead of code/language candidates. Add:

```ts
it('reads code and language from the model regardless of what is rendered', async () => {
  const snapshot = await extractLeetCodeSnapshot({
    locationUrl: 'https://leetcode.com/problems/two-sum/',
    documentTitle: '1. Two Sum - LeetCode',
    titleCandidates: [{ text: '1. Two Sum', visible: true }],
    difficultyCandidates: [{ text: 'Easy', visible: true }],
    topicCandidates: [],
    model: { code: 'line1\nline2\nline3', languageId: 'python3' },
  });

  expect(snapshot).toMatchObject({
    codeAvailable: true,
    language: 'Python',
    code: 'line1\nline2\nline3',
  });
});

it('reports the model unavailable when there is no reading', async () => {
  const snapshot = await extractLeetCodeSnapshot({
    locationUrl: 'https://leetcode.com/problems/two-sum/',
    documentTitle: '1. Two Sum - LeetCode',
    titleCandidates: [{ text: '1. Two Sum', visible: true }],
    difficultyCandidates: [],
    topicCandidates: [],
    model: null,
  });

  expect(snapshot).toMatchObject({
    codeAvailable: false,
    language: 'Unknown',
    codeUnavailable: { reason: 'NO_READABLE_EDITOR_MODEL' },
    fingerprint: null,
  });
});

it.each([
  ['python3', 'Python'],
  ['typescript', 'TypeScript'],
  ['cpp', 'C++'],
  ['golang', 'Go'],
  ['brand-new-language', 'Unknown'],
])('maps the model language id %s to %s', async (languageId, expected) => {
  const snapshot = await extractLeetCodeSnapshot({
    locationUrl: 'https://leetcode.com/problems/two-sum/',
    documentTitle: '1. Two Sum - LeetCode',
    titleCandidates: [],
    difficultyCandidates: [],
    topicCandidates: [],
    model: { code: 'x', languageId },
  });
  expect(snapshot?.language).toBe(expected);
});
```

In `test/leetcode-dom-adapter.test.ts`: delete assertions covering `renderedCodeCandidates`, `codeCandidates`, `nearbyLanguageCandidates`, and `languageCandidates`; pass `null` as the third argument to `collectExtractionCandidates`. In `test/leetcode-context-runtime.test.ts`: change the two `codeRange: { startLine: 12, endLine: 12, complete: false }` fixtures to `{ startLine: 1, endLine: 1, complete: true }`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/leetcode-extraction.test.ts test/leetcode-dom-adapter.test.ts`
Expected: FAIL — `model` is not a known property; `reconstructMonacoCode` still exported but unused.

- [ ] **Step 3: Write the implementation**

In `extension/src/leetcode-extraction.ts`:

Delete `CodeCandidate`, `MonacoGutterCandidate`, `MonacoRenderedLineCandidate`, `RenderedCodeCandidate`, `reconstructMonacoCode`, and `extractLanguage`. Import the reading type and reshape the candidates:

```ts
import type { Difficulty, ProblemSnapshot } from '../../src/shared/contract.js';
import type { EditorModelReading } from './leetcode-model-reader.js';
```

```ts
export interface ExtractionCandidates {
  locationUrl: string;
  documentTitle: string;
  titleCandidates: VisibleTextCandidate[];
  difficultyCandidates: VisibleTextCandidate[];
  topicCandidates: TopicCandidate[];
  model: EditorModelReading | null;
}
```

```ts
export interface UnavailableLeetCodeSnapshot {
  codeAvailable: false;
  problem: ProblemSnapshot;
  language: string;
  codeUnavailable: {
    reason: 'NO_READABLE_EDITOR_MODEL';
  };
  fingerprint: null;
}
```

Simplify `normalizeLanguage` — model ids need no prefix stripping:

```ts
function normalizeLanguage(languageId: string): string {
  return LANGUAGES.get(languageId.trim().toLowerCase()) ?? 'Unknown';
}
```

Replace the tail of `extractLeetCodeSnapshot` (from `const language = ...` onward):

```ts
  const reading = candidates.model;
  const language = reading ? normalizeLanguage(reading.languageId) : 'Unknown';

  if (reading) {
    const lineCount = reading.code.length === 0 ? 1 : reading.code.split('\n').length;
    return {
      codeAvailable: true,
      problem,
      language,
      code: reading.code,
      codeRange: { startLine: 1, endLine: lineCount, complete: true },
      fingerprint: await fingerprintCode(location.slug, language, reading.code),
    };
  }

  return {
    codeAvailable: false,
    problem,
    language,
    codeUnavailable: { reason: 'NO_READABLE_EDITOR_MODEL' },
    fingerprint: null,
  };
```

In `extension/src/leetcode-dom-adapter.ts`: delete `positionedTop`, `entireFileRendered`, `renderedCodeCandidates`, `languageValues`, `nearbyLanguageCandidates`, the `ordinaryCodeEditors`/`editorContainers`/`stableLanguage` blocks, and the `reconstructMonacoCode` import. Change the signature and return:

```ts
import type { ExtractionCandidates, VisibleTextCandidate } from './leetcode-extraction.js';
import type { EditorModelReading } from './leetcode-model-reader.js';
```

```ts
export function collectExtractionCandidates(
  document: Document,
  locationUrl: string,
  model: EditorModelReading | null,
): ExtractionCandidates {
```

```ts
  return {
    locationUrl,
    documentTitle: document.title,
    titleCandidates: titleElements.map((element) => textCandidate(element)),
    difficultyCandidates: stableDifficulty.map((element) => textCandidate(element)),
    topicCandidates: topicElements.map((element) => ({
      ...textCandidate(element),
      href: element.getAttribute('href') ?? '',
    })),
    model,
  };
}
```

In `observeLeetCodePageChanges`, delete the `onEditorInput` handler, both `document.addEventListener`/`removeEventListener` calls for it, and `'value'` from `attributeFilter` — code changes now arrive through the channel.

Rewrite `extension/src/content.ts`:

```ts
import {
  ContextChangePublisher,
  createContentMessageHandler,
  type LeetCodeContextChangedMessage,
} from './leetcode-context-runtime.js';
import { collectExtractionCandidates, observeLeetCodePageChanges } from './leetcode-dom-adapter.js';
import { extractLeetCodeSnapshot } from './leetcode-extraction.js';
import {
  createModelRequester,
  listenForModelChanges,
  type ChannelWindow,
} from './leetcode-model-channel.js';

const channelWindow = window as unknown as ChannelWindow;
const requestModel = createModelRequester(channelWindow, window.location.origin, () =>
  crypto.randomUUID(),
);

const extractCurrentContext = async () =>
  extractLeetCodeSnapshot(
    collectExtractionCandidates(document, window.location.href, await requestModel()),
  );

const handleMessage = createContentMessageHandler(extractCurrentContext);
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) =>
  handleMessage(message, sendResponse),
);

const publisher = new ContextChangePublisher(
  extractCurrentContext,
  async (context) => {
    const message: LeetCodeContextChangedMessage = {
      type: 'LEETCODE_CONTEXT_CHANGED',
      context,
    };
    await chrome.runtime.sendMessage(message).catch(() => undefined);
  },
  100,
);

observeLeetCodePageChanges(document, window, () => publisher.notifyChange());
listenForModelChanges(channelWindow, () => publisher.notifyChange());
publisher.notifyChange();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run typecheck && npm run test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/leetcode-extraction.ts extension/src/leetcode-dom-adapter.ts extension/src/content.ts test/leetcode-extraction.test.ts test/leetcode-dom-adapter.test.ts test/leetcode-context-runtime.test.ts
git commit -m "feat: read captured code and language from the Monaco model"
```

---

### Task 5: Delete codeRange and the partial-range display

**Files:**
- Modify: `extension/src/leetcode-extraction.ts` (`AvailableLeetCodeSnapshot`, `extractLeetCodeSnapshot`)
- Modify: `extension/src/sidepanel.ts:74-80`
- Modify: `extension/src/sidepanel-controller.ts:171`
- Test: `test/leetcode-extraction.test.ts`, `test/leetcode-context-runtime.test.ts`, `test/sidepanel-controller.test.ts`, `test/sidepanel-tab-coordinator.test.ts`

**Interfaces:**
- Consumes: everything from Task 4.
- Produces: `AvailableLeetCodeSnapshot` without `codeRange`.

- [ ] **Step 1: Update the failing tests**

Remove every `codeRange` key from fixtures and expectations across the four test files listed above. In `test/leetcode-extraction.test.ts` add:

```ts
it('does not carry a code range', async () => {
  const snapshot = await extractLeetCodeSnapshot({
    locationUrl: 'https://leetcode.com/problems/two-sum/',
    documentTitle: '1. Two Sum - LeetCode',
    titleCandidates: [],
    difficultyCandidates: [],
    topicCandidates: [],
    model: { code: 'a\nb', languageId: 'python3' },
  });
  expect(snapshot).not.toHaveProperty('codeRange');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/leetcode-extraction.test.ts`
Expected: FAIL — snapshot still has `codeRange`.

- [ ] **Step 3: Write the implementation**

In `extension/src/leetcode-extraction.ts`, delete the `codeRange` field from `AvailableLeetCodeSnapshot` and the `codeRange` and `lineCount` lines from the available branch of `extractLeetCodeSnapshot`:

```ts
export interface AvailableLeetCodeSnapshot {
  codeAvailable: true;
  problem: ProblemSnapshot;
  language: string;
  code: string;
  fingerprint: string;
}
```

```ts
  if (reading) {
    return {
      codeAvailable: true,
      problem,
      language,
      code: reading.code,
      fingerprint: await fingerprintCode(location.slug, language, reading.code),
    };
  }
```

In `extension/src/sidepanel.ts:74-80`, the line count is now always exact:

```ts
  const code = snapshot.codeAvailable ? snapshot.code : '';
  const lines = exactLineCount(code);
  codeLineCount.textContent = `${lines} ${lines === 1 ? 'line' : 'lines'}`;
  capturedCode.textContent = code;
```

In `extension/src/sidepanel-controller.ts:171`, update the blocked message:

```ts
        message:
          'Open the LeetCode code editor with non-blank code, then try again. Reload the page if it stays unavailable.',
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run typecheck && npm run test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/leetcode-extraction.ts extension/src/sidepanel.ts extension/src/sidepanel-controller.ts test/leetcode-extraction.test.ts test/leetcode-context-runtime.test.ts test/sidepanel-controller.test.ts test/sidepanel-tab-coordinator.test.ts
git commit -m "refactor: drop the partial code range from the snapshot"
```

---

### Task 6: Playwright fixture on a Monaco stub

**Files:**
- Modify: `test/browser/mv3-capture.spec.ts`

**Interfaces:**
- Consumes: the built extension from Task 3.
- Produces: no source interfaces; this task proves the regression is fixed end to end.

The fixture currently builds Monaco-shaped DOM. It must instead expose a `window.monaco` stub, and separately render however many lines it likes, so a test can assert that a partially rendered editor still captures in full.

- [ ] **Step 1: Write the failing test**

In `test/browser/mv3-capture.spec.ts`:

Replace the `startLine`/`complete` fields on `ProblemFixture` with `renderedLines?: number` (how many lines the fake view renders; defaults to all).

Replace the `editor` string in `fixtureHtml` with markup plus an inline stub. The stub is the page's own script, so the MAIN-world bridge sees it:

```ts
  const editor =
    fixture.code === null
      ? ''
      : `<div class="editor"><div class="monaco-editor"><div class="view-lines"></div></div></div>
    <script>
      (() => {
        const listeners = new Set();
        const languageListeners = new Set();
        const state = { code: ${JSON.stringify(fixture.code)}, languageId: ${JSON.stringify(fixture.language)}, rendered: ${fixture.renderedLines ?? -1} };
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
          onDidChangeContent: (listener) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
        };
        const editorInstance = {
          getModel: () => model,
          getDomNode: () => node,
          onDidChangeModelLanguage: (listener) => { languageListeners.add(listener); return { dispose: () => languageListeners.delete(listener) }; },
        };
        window.monaco = { editor: { getEditors: () => [editorInstance] } };
        window.__setModel = (code, languageId, rendered) => {
          state.code = code;
          if (languageId !== undefined) state.languageId = languageId;
          if (rendered !== undefined) state.rendered = rendered;
          render();
          for (const listener of listeners) listener();
          for (const listener of languageListeners) listener();
        };
        render();
      })();
    </script>`;
```

Fixture `language` values become model ids: change `twoSum.language` to `'python3'` and `secondProblem.language` to `'typescript'`. The panel still asserts the display names `Python` and `TypeScript`.

Simplify the fixture `<style>` block to keep the editor laid out with non-zero area:

```ts
      .monaco-editor { position: relative; width: 480px; height: 240px; }
      .view-line { min-height: 20px; white-space: pre; }
```

Delete the `.line-numbers`, `.margin-view-overlays`, `.scrollbar`, and textarea rules.

Rewrite `openProblem`'s post-navigation assertions:

```ts
  await page.goto(`https://leetcode.com/problems/${fixture.slug}/`);
  if (fixture.code === null) {
    await expect(page.locator('.monaco-editor')).toHaveCount(0);
  } else {
    await expect(page.locator('.view-lines > .view-line').first()).toBeAttached();
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('TEXTAREA');
  }
```

Rewrite `setCode` to drive the stub:

```ts
async function setCode(page: Page, code: string, publish: boolean): Promise<void> {
  await page.evaluate(
    (value) => {
      (window as unknown as { __setModel: (code: string) => void }).__setModel(value.code);
    },
    { code, publish },
  );
}
```

The `publish` argument is now unused by the stub because `onDidChangeContent` always fires; keep the parameter so call sites are unchanged, and delete the `data-revision` mechanism.

Rewrite `replaceProblem` so its code half drives the stub instead of rebuilding gutters and lines:

```ts
async function replaceProblem(page: Page, fixture: ProblemFixture, publish = true): Promise<void> {
  await page.evaluate(
    ({ next }) => {
      history.pushState({}, '', `/problems/${next.slug}/`);
      document.title = `${next.number}. ${next.title} - LeetCode`;
      const title = document.querySelector('[data-testid="question-title"]');
      const difficulty = document.querySelector('[data-testid="difficulty"]');
      const topics = document.querySelector('#topics');
      if (title) title.textContent = `${next.number}. ${next.title}`;
      if (difficulty) difficulty.textContent = next.difficulty;
      if (topics) {
        topics.replaceChildren(
          ...next.topics.map((topic) => {
            const anchor = document.createElement('a');
            anchor.className = 'topic';
            anchor.href = `/tag/${topic.toLowerCase().replaceAll(' ', '-')}/`;
            anchor.textContent = topic;
            return anchor;
          }),
        );
      }
      if (next.code !== null) {
        (
          window as unknown as {
            __setModel: (code: string, languageId?: string, rendered?: number) => void;
          }
        ).__setModel(next.code, next.language);
      }
    },
    { next: fixture, shouldPublish: publish },
  );
}
```

Delete the test `'labels a partial Monaco rendering with its visible logical range'` and replace it with:

```ts
test('captures the whole model when the view renders only part of it', async () => {
  const longSolution = Array.from({ length: 40 }, (_, index) => `line_${index + 1} = ${index}`).join('\n');
  const { panel } = await setupCase({ ...twoSum, code: longSolution, renderedLines: 5 });

  await expect(renderedLineCount(panel)).resolves.toBe(5);
  await expect(panel.locator('#code-line-count')).toHaveText('40 lines');
  await expect(panel.locator('#captured-code')).toHaveText(longSolution);

  await choose(panel, 'Solved');
  await expect(panel.locator('#success-confirmation')).toBeVisible();
  const event = JSON.parse(bridge.posts()[0]!.body!) as { attempt: { code: string } };
  expect(event.attempt.code).toBe(longSolution);
  expect(event.attempt.code.split('\n')).toHaveLength(40);
});
```

Add this helper above the test, which proves the DOM really was partial:

```ts
async function renderedLineCount(panel: Page): Promise<number> {
  const problem = context.pages().find((page) => page.url().includes('/problems/'));
  if (!problem) throw new Error('The problem page is unavailable.');
  return problem.locator('.view-lines > .view-line').count();
}
```

Update the blocked-copy expectations in `'missing or blank visible code blocks capture'`:

```ts
test('missing or blank model code blocks capture', async () => {
  let current = await setupCase({ ...twoSum, code: null });
  await expect(current.panel.locator('#status')).toContainText('Open the LeetCode code editor');
  await expect(current.panel.locator('#outcome-actions')).toBeHidden();
  expect(bridge.posts()).toHaveLength(0);

  current = await setupCase({ ...twoSum, code: '   ' });
  await expect(current.panel.locator('#status')).toContainText('non-blank code');
  await expect(current.panel.locator('#outcome-actions')).toBeHidden();
  expect(bridge.posts()).toHaveLength(0);
});
```

- [ ] **Step 2: Run the browser suite to verify the new test fails on the old build**

Run: `git stash && npm run test:browser -- --grep "renders only part"; git stash pop`
Expected: FAIL — proves the test detects truncation. (If the stash conflicts, skip this step and rely on Step 4.)

- [ ] **Step 3: Build and run**

Run: `npm run build:extension`

- [ ] **Step 4: Run the browser suite to verify it passes**

Run: `npm run test:browser`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add test/browser/mv3-capture.spec.ts
git commit -m "test: drive browser fixtures from a Monaco model stub"
```

---

### Task 7: Documentation and release

**Files:**
- Modify: `docs/SECURITY.md:47-58`
- Modify: `docs/ARCHITECTURE.md:89-96`
- Modify: `docs/MANUAL_TEST.md`
- Modify: `package.json:3`, `package-lock.json` (both `version` fields), `extension/manifest.json:4`

**Interfaces:**
- Consumes: the shipped behavior from Tasks 1-6.
- Produces: no code interfaces.

- [ ] **Step 1: Rewrite the LeetCode access section of `docs/SECURITY.md`**

Replace the paragraph and list at `docs/SECURITY.md:47-58`:

```markdown
## LeetCode access

The extension reads only the active `leetcode.com/problems/*` page. Problem title, difficulty, and
topics come from the public DOM through the declared read-only content script. Captured code and
language come from Monaco's editor model, read by a second declared content script running in the
page's own JavaScript world, which answers nonce-matched requests over `window.postMessage`. Neither
script focuses, scrolls, or otherwise mutates the page.

Because the model reader runs in the page's world, a hostile page could forge a reply and supply
code the user did not write. This is not a new exposure: the page already controls every element the
extension reads. Replies are validated for shape and matched against a per-request nonce, and a
missing reply blocks capture rather than substituting partial data.

It does not:

- Read cookies
- Intercept network traffic
- Call undocumented LeetCode APIs
- Crawl other problems
- Send data without a user-confirmed outcome click
```

- [ ] **Step 2: Update the data-flow step in `docs/ARCHITECTURE.md`**

Replace steps 1-2 at `docs/ARCHITECTURE.md:91-96`:

```markdown
1. On startup, the side panel requests the current snapshot. If an extension reload left no receiver,
   it injects the MAIN-world model bridge and the read-only content script once through `scripting`
   and retries.
2. The content script reads title, difficulty, and topics from the public DOM, and requests code and
   language from the MAIN-world bridge, which returns Monaco's complete model buffer and its language
   id. Because the model is independent of the virtualized view, a solution longer than the editor
   viewport is captured in full. An unreadable model blocks capture rather than reporting a fragment.
```

- [ ] **Step 3: Add the manual verification step to `docs/MANUAL_TEST.md`**

Insert after the existing extraction step (currently step 7):

```markdown
8. Open a problem whose solution is longer than the code editor viewport, and scroll the editor so
   neither the first nor the last line is on screen. Confirm the side panel reports the solution's
   true total line count (not a `visible lines` range) and that the captured code block contains both
   the first and the last line. This is the check that decides whether full code capture works; the
   automated suites were rewritten alongside the feature and cannot decide it.
```

- [ ] **Step 4: Bump the three version fields to 0.2.0**

Set `"version": "0.2.0"` in `package.json:3` and `extension/manifest.json:4`. In `package-lock.json`, set both the top-level `"version"` and the `""` package entry's `"version"` to `0.2.0`. Do not run `npm install`.

Run: `grep -c '"version": "0.2.0"' package.json extension/manifest.json package-lock.json`
Expected: `1`, `1`, `2`.

- [ ] **Step 5: Run the full check and commit**

Run: `npm run check`
Expected: format, typecheck, unit tests, browser tests, and secret scan all PASS.

```bash
git add docs/SECURITY.md docs/ARCHITECTURE.md docs/MANUAL_TEST.md package.json package-lock.json extension/manifest.json
git commit -m "docs: describe MAIN-world model reads and release 0.2.0"
```

---

## Verification note

Tasks 1-6 rewrite the very tests that would judge this work. Per the project's verification rule, the
implementing session must not declare this verified. The deciding check is the manual step added in
Task 7 Step 3, which the user runs against a real LeetCode problem with an overflowing solution.
