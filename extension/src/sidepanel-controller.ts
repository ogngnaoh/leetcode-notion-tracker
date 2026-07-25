import type {
  AttemptResult,
  CaptureEvent,
  CaptureResult,
  ProblemStatus,
} from '../../src/shared/contract.js';
import type { CaptureRequestError } from './capture-submission.js';
import type {
  CaptureSessionState,
  CaptureSessionStore,
  LastSuccessCaptureRecord,
  PendingCaptureRecord,
} from './capture-session.js';
import type { LeetCodeSnapshot } from './leetcode-extraction.js';
import type { ExtensionSettings } from './types.js';

export type SidePanelMode = 'loading' | 'ready' | 'blocked' | 'retry';

export interface SidePanelView {
  mode: SidePanelMode;
  snapshot: LeetCodeSnapshot | null;
  reviewLabel: string;
  message: string;
  showSettings: boolean;
  busy: boolean;
  loggedResult: AttemptResult | null;
}

export interface SidePanelControllerDependencies {
  store: CaptureSessionStore;
  getSettings(): Promise<ExtensionSettings>;
  getFreshSnapshot(): Promise<LeetCodeSnapshot | null>;
  getProblemStatus(settings: ExtensionSettings, slug: string): Promise<ProblemStatus>;
  sendCaptureBody(settings: ExtensionSettings, body: string): Promise<CaptureResult>;
  randomUUID(): string;
  now(): Date;
}

type ViewListener = (view: SidePanelView) => void;

function localCalendarDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readable(snapshot: LeetCodeSnapshot | null): snapshot is LeetCodeSnapshot & {
  codeAvailable: true;
} {
  return snapshot?.codeAvailable === true && snapshot.code.trim().length > 0;
}

function reviewLabel(status: ProblemStatus, today: string): string {
  if (!status.found || status.practiceState === 'New') return 'New';
  if (status.practiceState === 'Mastered') return 'Mastered';
  if (status.nextReview !== null && status.nextReview <= today) return 'Due now';
  if (status.nextReview !== null) return `Review on ${status.nextReview}`;
  return status.practiceState;
}

function captureMessage(result: CaptureResult): string {
  const prefix = result.duplicate ? 'Already logged.' : 'Logged.';
  const next = result.review.nextReview ? ` Next review: ${result.review.nextReview}.` : '';
  return `${prefix} ${result.review.practiceState}.${next}`;
}

function isCaptureRequestError(error: unknown): error is CaptureRequestError {
  return (
    error instanceof Error &&
    'disposition' in error &&
    (error.disposition === 'definitive' || error.disposition === 'uncertain') &&
    'status' in error
  );
}

export class SidePanelController {
  private state: CaptureSessionState = { pending: null, lastSuccess: null };
  private listeners = new Set<ViewListener>();
  private statusRevision = 0;
  private submitting = false;
  private active = true;
  private currentView: SidePanelView = {
    mode: 'loading',
    snapshot: null,
    reviewLabel: 'Reading…',
    message: 'Reading the current LeetCode problem…',
    showSettings: false,
    busy: false,
    loggedResult: null,
  };

  constructor(private readonly dependencies: SidePanelControllerDependencies) {}

  get view(): SidePanelView {
    return this.currentView;
  }

  subscribe(listener: ViewListener): () => void {
    if (!this.active) return () => undefined;
    this.listeners.add(listener);
    listener(this.currentView);
    return () => this.listeners.delete(listener);
  }

  deactivate(): void {
    this.active = false;
    this.statusRevision += 1;
    this.listeners.clear();
  }

  async initialize(snapshot: LeetCodeSnapshot | null): Promise<void> {
    this.state = await this.dependencies.store.read();
    if (!this.active) return;
    await this.acceptSnapshot(snapshot);
  }

  async acceptSnapshot(snapshot: LeetCodeSnapshot | null): Promise<void> {
    if (!this.active) return;
    this.setView({
      ...this.currentView,
      snapshot,
      showSettings: false,
      busy: this.submitting,
    });

    if (this.submitting && !this.state.pending) return;

    if (this.state.pending) {
      this.setView({
        ...this.currentView,
        mode: 'retry',
        message: this.submitting
          ? 'Writing this exact attempt to Notion…'
          : 'The previous write is uncertain. Retry the same attempt to resolve it.',
        loggedResult: this.state.pending.result,
        busy: this.submitting,
      });
      return;
    }

    if (this.state.lastSuccess) {
      if (snapshot?.codeAvailable && snapshot.fingerprint === this.state.lastSuccess.fingerprint) {
        this.showLastSuccess(this.state.lastSuccess);
        return;
      }
      if (snapshot?.codeAvailable) {
        this.state = { ...this.state, lastSuccess: null };
        await this.dependencies.store.write(this.state);
        if (!this.active) return;
      }
    }

    if (!snapshot) {
      this.setView({
        ...this.currentView,
        mode: 'blocked',
        reviewLabel: 'Unavailable',
        message: 'Open a LeetCode problem, then reopen this panel.',
        loggedResult: this.state.lastSuccess?.result ?? null,
        busy: false,
      });
      return;
    }

    if (!readable(snapshot)) {
      this.setView({
        ...this.currentView,
        mode: 'blocked',
        reviewLabel: 'Unavailable',
        message:
          'Open the LeetCode code editor with non-blank code, then try again. Reload the page if it stays unavailable.',
        loggedResult: this.state.lastSuccess?.result ?? null,
        busy: false,
      });
      return;
    }

    const settings = await this.dependencies.getSettings();
    if (!this.active) return;
    if (!settings.bridgeToken) {
      this.setView({
        ...this.currentView,
        mode: 'blocked',
        reviewLabel: 'Settings needed',
        message: 'Open Bridge settings and save your bridge token first.',
        showSettings: true,
        loggedResult: null,
        busy: false,
      });
      return;
    }

    this.setView({
      ...this.currentView,
      mode: 'ready',
      reviewLabel: 'Checking…',
      message: 'Choose one outcome to log this exact code.',
      showSettings: false,
      loggedResult: null,
      busy: false,
    });
    await this.refreshProblemStatus(settings, snapshot.problem.slug);
  }

  async selectResult(result: AttemptResult): Promise<void> {
    if (
      !this.active ||
      this.submitting ||
      this.currentView.busy ||
      this.currentView.mode !== 'ready'
    )
      return;
    const displayed = this.currentView.snapshot;
    if (!readable(displayed)) return;

    this.submitting = true;
    this.statusRevision += 1;
    this.setView({ ...this.currentView, busy: true, message: 'Checking the visible code…' });
    let fresh: LeetCodeSnapshot | null;
    try {
      fresh = await this.dependencies.getFreshSnapshot();
    } catch {
      if (!this.active) return;
      this.submitting = false;
      this.setView({
        ...this.currentView,
        busy: false,
        message: 'Could not reread the LeetCode tab. Refresh it, then choose an outcome again.',
      });
      return;
    }

    if (!this.active) return;

    if (!readable(fresh)) {
      this.submitting = false;
      await this.acceptSnapshot(fresh);
      return;
    }
    if (fresh.fingerprint !== displayed.fingerprint) {
      this.submitting = false;
      await this.acceptSnapshot(fresh);
      this.setView({
        ...this.currentView,
        message: 'The problem or code changed. Review it, then choose an outcome again.',
      });
      return;
    }

    const settings = await this.dependencies.getSettings();
    if (!this.active) return;
    if (!settings.bridgeToken) {
      this.submitting = false;
      this.setView({
        ...this.currentView,
        mode: 'blocked',
        busy: false,
        showSettings: true,
        message: 'Open Bridge settings and save your bridge token first.',
      });
      return;
    }

    const now = this.dependencies.now();
    const clientEventId = this.dependencies.randomUUID();
    const event: CaptureEvent = {
      clientEventId,
      problem: fresh.problem,
      attempt: {
        attemptedAt: now.toISOString(),
        attemptedOn: localCalendarDate(now),
        language: fresh.language,
        code: fresh.code,
        result,
      },
    };
    const pending: PendingCaptureRecord = {
      version: 1,
      clientEventId,
      result,
      fingerprint: fresh.fingerprint,
      body: JSON.stringify(event),
    };
    this.state = { ...this.state, pending };
    try {
      await this.dependencies.store.write(this.state);
    } catch {
      this.submitting = false;
      this.state = { ...this.state, pending: null };
      this.setView({
        ...this.currentView,
        mode: 'ready',
        busy: false,
        message: 'Could not save retry state. Reopen the panel, then choose an outcome again.',
      });
      return;
    }
    if (!this.active) {
      this.submitting = false;
      return;
    }
    await this.sendPending(settings);
  }

  async retryPending(): Promise<void> {
    if (!this.active || this.submitting || this.currentView.busy || !this.state.pending) return;
    const settings = await this.dependencies.getSettings();
    if (!this.active) return;
    if (!settings.bridgeToken) {
      this.setView({
        ...this.currentView,
        mode: 'retry',
        showSettings: true,
        message: 'Open Bridge settings and save your bridge token before retrying.',
      });
      return;
    }
    this.submitting = true;
    await this.sendPending(settings);
  }

  private async sendPending(settings: ExtensionSettings): Promise<void> {
    const pending = this.state.pending;
    if (!pending) return;
    this.setView({
      ...this.currentView,
      mode: 'retry',
      busy: true,
      message: 'Writing this exact attempt to Notion…',
      loggedResult: pending.result,
    });
    try {
      const result = await this.dependencies.sendCaptureBody(settings, pending.body);
      const completed: LastSuccessCaptureRecord = {
        version: 2,
        fingerprint: pending.fingerprint,
        result: pending.result,
        duplicate: result.duplicate,
        review: result.review,
      };
      const fingerprintChanged =
        this.currentView.snapshot?.codeAvailable &&
        this.currentView.snapshot.fingerprint !== pending.fingerprint;
      const completedState: CaptureSessionState = fingerprintChanged
        ? { pending: null, lastSuccess: null }
        : { pending: null, lastSuccess: completed };
      await this.dependencies.store.write(completedState);
      this.state = completedState;
      this.submitting = false;
      if (fingerprintChanged) {
        const currentSnapshot = this.currentView.snapshot;
        await this.acceptSnapshot(currentSnapshot);
        this.setView({
          ...this.currentView,
          message: 'The previous attempt is resolved. Choose an outcome for the current code.',
        });
        return;
      }
      this.showLastSuccess(completed);
    } catch (error) {
      this.submitting = false;
      if (isCaptureRequestError(error) && error.disposition === 'definitive') {
        this.state = { ...this.state, pending: null };
        await this.dependencies.store.write(this.state);
        const authentication = error.status === 401 || error.status === 403;
        this.setView({
          ...this.currentView,
          mode: authentication
            ? 'blocked'
            : readable(this.currentView.snapshot)
              ? 'ready'
              : 'blocked',
          busy: false,
          showSettings: authentication,
          loggedResult: this.state.lastSuccess?.result ?? null,
          message: authentication
            ? 'Bridge authorization failed. Open Settings and save the correct bridge token.'
            : 'The bridge rejected this capture. Refresh the page, then choose an outcome again.',
        });
        return;
      }
      this.setView({
        ...this.currentView,
        mode: 'retry',
        busy: false,
        loggedResult: pending.result,
        message:
          error instanceof Error
            ? error.message
            : 'The write result is uncertain. Retry the same attempt.',
      });
    }
  }

  private showLastSuccess(success: LastSuccessCaptureRecord): void {
    const result: CaptureResult = {
      duplicate: success.duplicate,
      problemPageId: 'session-lock',
      attemptPageId: 'session-lock',
      review: success.review,
    };
    this.setView({
      ...this.currentView,
      mode: 'ready',
      reviewLabel:
        success.review.practiceState === 'Mastered'
          ? 'Mastered'
          : success.review.nextReview
            ? reviewLabel(
                {
                  found: true,
                  ...success.review,
                  lastAttempt: null,
                },
                localCalendarDate(this.dependencies.now()),
              )
            : success.review.practiceState,
      message: captureMessage(result),
      showSettings: false,
      busy: false,
      loggedResult: success.result,
    });
  }

  private async refreshProblemStatus(settings: ExtensionSettings, slug: string): Promise<void> {
    const revision = ++this.statusRevision;
    try {
      const status = await this.dependencies.getProblemStatus(settings, slug);
      if (
        !this.active ||
        revision !== this.statusRevision ||
        this.currentView.snapshot?.problem.slug !== slug
      )
        return;
      this.setView({
        ...this.currentView,
        reviewLabel: reviewLabel(status, localCalendarDate(this.dependencies.now())),
      });
    } catch (error) {
      if (
        !this.active ||
        revision !== this.statusRevision ||
        this.currentView.snapshot?.problem.slug !== slug
      )
        return;
      const authentication =
        isCaptureRequestError(error) && (error.status === 401 || error.status === 403);
      this.setView({
        ...this.currentView,
        mode: authentication ? 'blocked' : this.currentView.mode,
        reviewLabel: authentication ? 'Settings needed' : 'Bridge unavailable',
        showSettings: authentication,
        message: authentication
          ? 'Bridge authorization failed. Open Settings and save the correct bridge token.'
          : 'Could not reach the local bridge. Start it, then reopen this panel.',
      });
    }
  }

  private setView(view: SidePanelView): void {
    if (!this.active) return;
    this.currentView = view;
    for (const listener of this.listeners) listener(view);
  }
}
