import { describe, expect, it, vi } from 'vitest';
import type { AttemptResult } from '../src/shared/contract.js';
import {
  SidePanelTabCoordinator,
  type CoordinatedSidePanelController,
  type VisibleTab,
} from '../extension/src/sidepanel-tab-coordinator.js';
import type { LeetCodeSnapshot } from '../extension/src/leetcode-extraction.js';
import type { SidePanelView } from '../extension/src/sidepanel-controller.js';

function snapshot(slug: string): LeetCodeSnapshot {
  return {
    codeAvailable: true,
    problem: {
      slug,
      title: slug,
      number: null,
      url: `https://leetcode.com/problems/${slug}/`,
      difficulty: 'Unknown',
      topics: [],
    },
    language: 'Python',
    code: `code:${slug}`,
    codeRange: { startLine: 1, endLine: 1, complete: true },
    fingerprint: `fingerprint:${slug}`,
  };
}

function view(slug: string): SidePanelView {
  return {
    mode: 'ready',
    snapshot: snapshot(slug),
    reviewLabel: 'New',
    message: slug,
    showSettings: false,
    busy: false,
    loggedResult: null,
  };
}

class FakeController implements CoordinatedSidePanelController {
  readonly initialize = vi.fn(async (_snapshot: LeetCodeSnapshot | null) => undefined);
  readonly acceptSnapshot = vi.fn(async (_snapshot: LeetCodeSnapshot | null) => undefined);
  readonly selectResult = vi.fn(async (_result: AttemptResult) => undefined);
  readonly retryPending = vi.fn(async () => undefined);
  readonly deactivate = vi.fn();
  private listener: ((next: SidePanelView) => void) | null = null;

  constructor(readonly tabId: number) {}

  subscribe(listener: (next: SidePanelView) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  emit(next: SidePanelView): void {
    this.listener?.(next);
  }
}

function tab(id: number): VisibleTab {
  return { id, url: `https://leetcode.com/problems/tab-${id}/` };
}

describe('SidePanelTabCoordinator', () => {
  it('rebinds actions, extraction, and rendering to the newly active tab', async () => {
    let active = tab(1);
    const controllers = new Map<number, FakeController>();
    const render = vi.fn();
    const readSnapshot = vi.fn(async (tabId: number) => snapshot(`tab-${tabId}`));
    const coordinator = new SidePanelTabCoordinator({
      getActiveTab: async () => active,
      readSnapshot,
      createController: (tabId) => {
        const controller = new FakeController(tabId);
        controllers.set(tabId, controller);
        return controller;
      },
      render,
    });

    await coordinator.rebindActiveTab();
    controllers.get(1)!.emit(view('tab-1'));
    active = tab(2);
    await coordinator.rebindActiveTab();
    controllers.get(2)!.emit(view('tab-2'));
    await coordinator.selectResult('Solved');

    expect(readSnapshot.mock.calls.map(([tabId]) => tabId)).toEqual([1, 2]);
    expect(controllers.get(1)!.deactivate).toHaveBeenCalledOnce();
    expect(controllers.get(1)!.selectResult).not.toHaveBeenCalled();
    expect(controllers.get(2)!.selectResult).toHaveBeenCalledWith('Solved');
    expect(render.mock.calls.at(-1)?.[0]).toMatchObject({ message: 'tab-2' });
  });

  it('drops stale startup extraction and listener results after a faster rebind', async () => {
    let active = tab(1);
    let resolveFirst!: (value: LeetCodeSnapshot) => void;
    const firstSnapshot = new Promise<LeetCodeSnapshot>((resolve) => {
      resolveFirst = resolve;
    });
    const controllers = new Map<number, FakeController>();
    const render = vi.fn();
    const coordinator = new SidePanelTabCoordinator({
      getActiveTab: async () => active,
      readSnapshot: (tabId) => (tabId === 1 ? firstSnapshot : Promise.resolve(snapshot('tab-2'))),
      createController: (tabId) => {
        const controller = new FakeController(tabId);
        controllers.set(tabId, controller);
        return controller;
      },
      render,
    });

    const firstBind = coordinator.rebindActiveTab();
    await vi.waitFor(() => expect(controllers.has(1)).toBe(true));
    active = tab(2);
    await coordinator.rebindActiveTab();
    resolveFirst(snapshot('tab-1'));
    await firstBind;
    controllers.get(1)!.emit(view('stale-tab-1'));
    await coordinator.selectResult('Needed help');

    expect(controllers.get(1)!.initialize).not.toHaveBeenCalled();
    expect(controllers.get(1)!.selectResult).not.toHaveBeenCalled();
    expect(controllers.get(2)!.initialize).toHaveBeenCalledWith(snapshot('tab-2'));
    expect(controllers.get(2)!.selectResult).toHaveBeenCalledWith('Needed help');
    expect(render.mock.calls.some(([next]) => next.message === 'stale-tab-1')).toBe(false);
  });

  it('accepts context only from the active tab and refreshes only matching updates', async () => {
    const controller = new FakeController(2);
    const readSnapshot = vi.fn(async () => snapshot('tab-2-refresh'));
    const coordinator = new SidePanelTabCoordinator({
      getActiveTab: async () => tab(2),
      readSnapshot,
      createController: () => controller,
      render: vi.fn(),
    });
    await coordinator.rebindActiveTab();

    await coordinator.acceptContext(1, snapshot('wrong-tab'));
    await coordinator.acceptContext(2, snapshot('tab-2-message'));
    await coordinator.refreshActiveTab(1);
    await coordinator.refreshActiveTab(2);

    expect(controller.acceptSnapshot.mock.calls).toEqual([
      [snapshot('tab-2-message')],
      [snapshot('tab-2-refresh')],
    ]);
  });

  it('reuses the current controller when focus reports the same active tab', async () => {
    const controller = new FakeController(2);
    const createController = vi.fn(() => controller);
    const coordinator = new SidePanelTabCoordinator({
      getActiveTab: async () => tab(2),
      readSnapshot: async () => snapshot('tab-2'),
      createController,
      render: vi.fn(),
    });

    await coordinator.rebindActiveTab();
    await coordinator.rebindActiveTab();

    expect(createController).toHaveBeenCalledOnce();
    expect(controller.deactivate).not.toHaveBeenCalled();
  });

  it('still initializes startup when a same-tab focus rebind arrives during extraction', async () => {
    let resolveSnapshot!: (value: LeetCodeSnapshot) => void;
    const delayedSnapshot = new Promise<LeetCodeSnapshot>((resolve) => {
      resolveSnapshot = resolve;
    });
    const controller = new FakeController(2);
    const coordinator = new SidePanelTabCoordinator({
      getActiveTab: async () => tab(2),
      readSnapshot: () => delayedSnapshot,
      createController: () => controller,
      render: vi.fn(),
    });

    const startup = coordinator.rebindActiveTab();
    await vi.waitFor(() => expect(coordinator.activeTabId).toBe(2));
    const focusRebind = coordinator.rebindActiveTab();
    resolveSnapshot(snapshot('tab-2'));
    await Promise.all([startup, focusRebind]);

    expect(controller.initialize).toHaveBeenCalledOnce();
    expect(controller.initialize).toHaveBeenCalledWith(snapshot('tab-2'));
  });

  it('queues newer active-tab context until session initialization is ready', async () => {
    let resolveInitial!: (value: LeetCodeSnapshot) => void;
    const delayedInitial = new Promise<LeetCodeSnapshot>((resolve) => {
      resolveInitial = resolve;
    });
    const controller = new FakeController(2);
    const coordinator = new SidePanelTabCoordinator({
      getActiveTab: async () => tab(2),
      readSnapshot: () => delayedInitial,
      createController: () => controller,
      render: vi.fn(),
    });

    const startup = coordinator.rebindActiveTab();
    await vi.waitFor(() => expect(coordinator.activeTabId).toBe(2));
    const newer = snapshot('tab-2-newer');
    await coordinator.acceptContext(2, newer);

    expect(controller.acceptSnapshot).not.toHaveBeenCalled();
    resolveInitial(snapshot('tab-2-initial'));
    await startup;

    expect(controller.initialize).toHaveBeenCalledWith(newer);
    expect(controller.acceptSnapshot).not.toHaveBeenCalled();
  });
});
