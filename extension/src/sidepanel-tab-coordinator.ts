import type { AttemptResult } from '../../src/shared/contract.js';
import type { LeetCodeSnapshot } from './leetcode-extraction.js';
import type { SidePanelView } from './sidepanel-controller.js';

export interface VisibleTab {
  id: number;
  url?: string;
}

export interface CoordinatedSidePanelController {
  subscribe(listener: (view: SidePanelView) => void): () => void;
  initialize(snapshot: LeetCodeSnapshot | null): Promise<void>;
  acceptSnapshot(snapshot: LeetCodeSnapshot | null): Promise<void>;
  selectResult(result: AttemptResult): Promise<void>;
  retryPending(): Promise<void>;
  deactivate(): void;
}

interface ActiveBinding {
  generation: number;
  tabId: number;
  controller: CoordinatedSidePanelController;
  unsubscribe: () => void;
  refreshRevision: number;
  initialized: boolean;
  hasQueuedSnapshot: boolean;
  queuedSnapshot: LeetCodeSnapshot | null;
}

export interface SidePanelTabCoordinatorDependencies {
  getActiveTab(): Promise<VisibleTab>;
  readSnapshot(tabId: number): Promise<LeetCodeSnapshot | null>;
  createController(tabId: number): CoordinatedSidePanelController;
  render(view: SidePanelView): void;
}

const LOADING_VIEW: SidePanelView = {
  mode: 'loading',
  snapshot: null,
  reviewLabel: 'Reading…',
  message: 'Reading the active LeetCode tab…',
  showSettings: false,
  busy: true,
  loggedResult: null,
};

function isLeetCodeProblem(url: string | undefined): boolean {
  return url?.startsWith('https://leetcode.com/problems/') === true;
}

export class SidePanelTabCoordinator {
  private generation = 0;
  private binding: ActiveBinding | null = null;

  constructor(private readonly dependencies: SidePanelTabCoordinatorDependencies) {}

  get activeTabId(): number | null {
    return this.binding?.tabId ?? null;
  }

  async rebindActiveTab(expectedTabId?: number): Promise<void> {
    const generation = ++this.generation;
    if (
      expectedTabId !== undefined &&
      this.binding !== null &&
      this.binding.tabId !== expectedTabId
    ) {
      this.unbind();
      this.dependencies.render(LOADING_VIEW);
    } else if (this.binding === null) {
      this.dependencies.render(LOADING_VIEW);
    }

    const tab = await this.dependencies.getActiveTab();
    if (generation !== this.generation) return;
    if (this.binding?.tabId === tab.id) {
      return;
    }

    this.unbind();
    this.dependencies.render(LOADING_VIEW);

    const controller = this.dependencies.createController(tab.id);
    const unsubscribe = controller.subscribe((view) => {
      if (this.binding?.generation === generation && this.binding.controller === controller) {
        this.dependencies.render(view);
      }
    });
    const binding: ActiveBinding = {
      generation,
      tabId: tab.id,
      controller,
      unsubscribe,
      refreshRevision: 0,
      initialized: false,
      hasQueuedSnapshot: false,
      queuedSnapshot: null,
    };
    this.binding = binding;

    let snapshot: LeetCodeSnapshot | null = null;
    if (isLeetCodeProblem(tab.url)) {
      snapshot = await this.dependencies.readSnapshot(tab.id).catch(() => null);
    }
    if (this.binding !== binding) return;
    const initialSnapshot = binding.hasQueuedSnapshot ? binding.queuedSnapshot : snapshot;
    binding.hasQueuedSnapshot = false;
    binding.queuedSnapshot = null;
    await controller.initialize(initialSnapshot);
    if (this.binding !== binding) return;
    binding.initialized = true;
    if (binding.hasQueuedSnapshot) {
      const queuedSnapshot = binding.queuedSnapshot;
      binding.hasQueuedSnapshot = false;
      binding.queuedSnapshot = null;
      await controller.acceptSnapshot(queuedSnapshot);
    }
  }

  async refreshActiveTab(tabId: number, url?: string): Promise<void> {
    const binding = this.binding;
    if (!binding || binding.tabId !== tabId) return;
    const revision = ++binding.refreshRevision;
    const snapshot =
      url !== undefined && !isLeetCodeProblem(url)
        ? null
        : await this.dependencies.readSnapshot(tabId).catch(() => null);
    if (this.binding !== binding || revision !== binding.refreshRevision) return;
    if (!binding.initialized) {
      binding.hasQueuedSnapshot = true;
      binding.queuedSnapshot = snapshot;
      return;
    }
    await binding.controller.acceptSnapshot(snapshot);
  }

  async acceptContext(tabId: number, snapshot: LeetCodeSnapshot | null): Promise<void> {
    const binding = this.binding;
    if (!binding || binding.tabId !== tabId) return;
    if (!binding.initialized) {
      binding.hasQueuedSnapshot = true;
      binding.queuedSnapshot = snapshot;
      return;
    }
    await binding.controller.acceptSnapshot(snapshot);
  }

  async selectResult(result: AttemptResult): Promise<void> {
    await this.binding?.controller.selectResult(result);
  }

  async retryPending(): Promise<void> {
    await this.binding?.controller.retryPending();
  }

  private unbind(): void {
    const binding = this.binding;
    this.binding = null;
    if (!binding) return;
    binding.unsubscribe();
    binding.controller.deactivate();
  }
}
