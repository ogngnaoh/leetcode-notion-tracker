import {
  CaptureEventSchema,
  type AttemptResult,
  type ReviewState,
} from '../../src/shared/contract.js';
import { requestNotion, NotionMessageError } from './api.js';
import type { LeetCodeSnapshot } from './leetcode-extraction.js';
import { metadataOnlyContext } from './leetcode-context-runtime.js';
import type { NotionOperation, NotionState, NotionChanged } from './notion-protocol.js';
import {
  PrivateResponseGate,
  PanelStateRevision,
  safeProblemUrl,
  selectReviewRows,
  type ReviewFilter,
} from './panel-private-state.js';
import { difficultyBadgeClass } from './difficulty-badge.js';

type View = 'daily' | 'log' | 'review' | 'settings';
const panels = {
  daily: 'daily-reps-panel',
  log: 'notion-log-panel',
  review: 'review-panel',
  settings: 'settings-panel',
} as const;
const tabs = { daily: 'daily-reps-tab', log: 'notion-log-tab', review: 'review-tab' } as const;
const el = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing panel element ${id}`);
  return node as T;
};
const field = (id: string) => el<HTMLInputElement>(id);
const text = (id: string, value: string) => {
  el(id).textContent = value;
};
const show = (id: string, visible: boolean) => {
  el(id).hidden = !visible;
};
const button = (id: string, action: () => void) => {
  el(id).addEventListener('click', action);
};
const dateLabel = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export interface NotionPanelDependencies {
  readSnapshot(tabId: number, full: boolean): Promise<LeetCodeSnapshot | null>;
  onMetadata(snapshot: LeetCodeSnapshot | null): void;
}

export class NotionPanel {
  private state: NotionState | null = null;
  private view: View = 'daily';
  private previousView: Exclude<View, 'settings'> = 'daily';
  private returnFocus: HTMLElement | null = null;
  private scrollTop = 0;
  private tabId: number | null = null;
  private navigationId = 0;
  private snapshot: LeetCodeSnapshot | null = null;
  private fullSnapshot: LeetCodeSnapshot | null = null;
  private readonly authority = new PrivateResponseGate();
  private readonly stateRevision = new PanelStateRevision();
  private readonly extraction = new PrivateResponseGate();
  private actionBusy = false;
  private logReads = 0;
  private visibleRows = 20;
  private reviewError = '';
  private reviewLoading = false;
  private lastReviewKey = '';
  private statusError = '';
  private savedReview: { slug: string; eventId: string; review: ReviewState } | null = null;
  private confirmation: (() => Promise<void>) | null = null;
  private readQueued = false;
  private connectionReadError = '';

  constructor(private readonly dependencies: NotionPanelDependencies) {
    for (const name of ['daily', 'log', 'review'] as const) {
      button(tabs[name], () => {
        void this.select(name);
      });
      el(tabs[name]).addEventListener('keydown', (event) => {
        const order = ['daily', 'log', 'review'] as const;
        const index = order.indexOf(name);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? 2
              : event.key === 'ArrowRight'
                ? (index + 1) % 3
                : event.key === 'ArrowLeft'
                  ? (index + 2) % 3
                  : null;
        if (next === null) return;
        event.preventDefault();
        const target = order[next]!;
        void this.select(target);
        el(tabs[target]).focus();
      });
    }
    button('open-settings', () => {
      void this.select('settings');
    });
    button('settings-back', () => {
      void this.select(this.previousView);
    });
    for (const id of ['log-connect', 'review-connect'])
      button(id, () => {
        void this.select('settings');
      });
    button('expand-code', () => {
      const expanded = el('expand-code').getAttribute('aria-expanded') !== 'true';
      el('expand-code').setAttribute('aria-expanded', String(expanded));
      el('captured-code').classList.toggle('expanded', expanded);
      text('expand-code', expanded ? 'Collapse preview' : 'Expand preview');
    });
    for (const outcome of document.querySelectorAll<HTMLButtonElement>('[data-result]')) {
      outcome.addEventListener('click', () => {
        void this.capture(outcome.dataset.result as AttemptResult);
      });
    }
    button('refresh-review', () => {
      void this.loadReview(true);
    });
    field('review-search').addEventListener('input', () => {
      this.visibleRows = 20;
      this.renderReview();
    });
    el('review-filter').addEventListener('change', () => {
      this.visibleRows = 20;
      this.renderReview();
    });
    button('review-more', () => {
      this.visibleRows += 20;
      this.renderReview();
    });
    button('edit-review-goal', () => {
      field('review-goal').value = String(this.state?.preferences?.dailyNewProblemGoal ?? 10);
      show('review-goal-form', true);
      field('review-goal').focus();
    });
    const closeGoal = () => {
      show('review-goal-form', false);
      el('edit-review-goal').focus();
    };
    button('cancel-review-goal', closeGoal);
    field('review-goal').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeGoal();
      }
    });
    el('review-goal-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const goal = Number(field('review-goal').value);
      if (!Number.isInteger(goal) || goal < 1 || goal > 100) return;
      void this.run({ op: 'preferences.setGoal', goal }).then((ok) => {
        if (ok) closeGoal();
      });
    });
    button('reset-review', () =>
      this.confirm(
        'Reset the new-problem count?',
        'Only this local session count restarts. Your Problems, Attempts, review schedule, and Daily Reps stay unchanged.',
        async () => {
          await this.run({ op: 'preferences.resetSession' });
          await this.loadReview(true);
        },
      ),
    );
    button('lock-notion', () => {
      void this.lock();
    });
    button('retry-attempt', () => {
      if (!this.state?.connection.unlocked) {
        void this.select('settings');
        return;
      }
      const pending = this.state.pending;
      if (pending)
        void this.run({
          op: pending.disposition === 'check' ? 'capture.check' : 'capture.retry',
          eventId: pending.event.clientEventId,
        });
    });
    const disconnect = () =>
      this.confirm(
        'Remove this saved connection?',
        this.connectionReadError || this.state?.connection.hasPending
          ? 'A pending save may already exist in Notion. Removing local recovery does not undo it. You must inspect and reconcile that result before logging again. Daily Reps is preserved.'
          : 'The saved connection and private Notion data will be removed from this browser. Your Notion pages and Daily Reps stay unchanged. This does not revoke the token in Notion.',
        async () => {
          await this.run({ op: 'connection.disconnect', confirmUncertain: true });
        },
      );
    button('disconnect-notion', disconnect);
    button('forgot-passphrase', disconnect);
    button('acknowledge-reconciliation', () => {
      if (field('reconciled-confirm').checked)
        void this.run({ op: 'connection.acknowledgeReconciliation', confirmed: true });
    });
    button('notion-confirm-cancel', () => this.closeConfirmation());
    el('notion-confirm-dialog').addEventListener('cancel', () => {
      this.confirmation = null;
    });
    button('notion-confirm-accept', () => {
      const action = this.confirmation;
      this.closeConfirmation();
      if (action) void action();
    });
    this.bindForms();
    chrome.runtime.onMessage.addListener((message: unknown, sender) => {
      if (
        sender.id !== chrome.runtime.id ||
        sender.tab ||
        !message ||
        typeof message !== 'object' ||
        !('type' in message) ||
        message.type !== 'lctrack.notion.changed'
      )
        return;
      const changed = message as NotionChanged;
      if (!changed.connection || typeof changed.connection.generation !== 'string') return;
      if (
        !this.stateRevision.observe(
          changed.connection.vaultId,
          changed.connection.generation,
          changed.stateRevision,
        )
      )
        return;
      const current = this.state?.connection;
      if (
        changed.connection.generation !== current?.generation ||
        changed.connection.vaultId !== current?.vaultId ||
        !changed.connection.unlocked
      ) {
        this.authority.invalidate();
        this.clearPrivate();
      }
      if (this.state)
        this.state = {
          ...this.state,
          connection: changed.connection,
          busy: changed.busy,
          stateRevision: changed.stateRevision,
        };
      this.render();
      this.queueStateRead();
    });
    void this.refreshState().then(() => {
      if (new URL(location.href).searchParams.get('view') === 'settings')
        void this.select('settings');
    });
  }

  sourceChanged(tabId: number, snapshot: LeetCodeSnapshot | null): void {
    const changed = this.tabId !== tabId || this.snapshot?.problem.slug !== snapshot?.problem.slug;
    this.tabId = tabId;
    this.snapshot = metadataOnlyContext(snapshot);
    this.dependencies.onMetadata(this.snapshot);
    this.extraction.invalidate();
    if (changed) {
      this.navigationId += 1;
      this.fullSnapshot = null;
      this.statusError = '';
    }
    this.renderLog();
    if (this.view === 'log' && this.state?.connection.unlocked) void this.loadLog(changed);
  }

  private queueStateRead(): void {
    if (this.readQueued) return;
    this.readQueued = true;
    queueMicrotask(() => {
      this.readQueued = false;
      void this.refreshState();
    });
  }

  private async refreshState(): Promise<void> {
    const ticket = this.authority.ticket();
    try {
      const state = await requestNotion({ op: 'connection.state' });
      if (!this.authority.accepts(ticket)) return;
      if (!this.accept(state)) return;
      if (
        this.view === 'review' &&
        state.connection.unlocked &&
        !state.busy &&
        !state.review &&
        !this.reviewLoading &&
        this.reviewKey() !== this.lastReviewKey
      )
        void this.loadReview(false);
    } catch (error) {
      if (!this.authority.accepts(ticket)) return;
      this.connectionReadError = error instanceof NotionMessageError ? error.code : 'UNAVAILABLE';
      this.renderSettings();
      text(
        'connection-state',
        error instanceof NotionMessageError
          ? error.message
          : 'Connection unavailable. Reopen LCTrack to try again.',
      );
    }
  }

  private accept(state: NotionState): boolean {
    if (
      !this.stateRevision.observe(
        state.connection.vaultId,
        state.connection.generation,
        state.stateRevision,
      )
    )
      return false;
    if (!state.connection.unlocked) this.clearPrivate();
    const completed = state.completed;
    if (
      state.connection.unlocked &&
      completed &&
      completed.source.tabId === this.tabId &&
      completed.source.fingerprint === this.fullSnapshot?.fingerprint
    )
      this.savedReview = {
        slug: this.fullSnapshot.problem.slug,
        eventId: completed.eventId,
        review: completed.result.review,
      };
    this.state = state;
    this.connectionReadError = '';
    this.render();
    return true;
  }

  private clearPrivate(): void {
    this.extraction.invalidate();
    this.fullSnapshot = null;
    this.savedReview = null;
    if (this.state) {
      const { problemStatus: _status, ...publicState } = this.state;
      this.state = {
        ...publicState,
        pending: null,
        completed: null,
        preferences: null,
        review: null,
      };
    }
    for (const input of document.querySelectorAll<HTMLInputElement>('input[type="password"]'))
      input.value = '';
    for (const id of [
      'captured-code',
      'pending-code',
      'pending-detail',
      'review-list',
      'success-confirmation',
    ])
      text(id, '');
    field('review-search').value = '';
    this.reviewError = '';
    this.statusError = '';
    this.closeConfirmation();
  }

  private async select(view: View): Promise<void> {
    if (view === 'settings' && this.view !== 'settings') {
      this.previousView = this.view;
      this.returnFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.scrollTop = window.scrollY;
    }
    const leavingSettings = this.view === 'settings' && view !== 'settings';
    if (leavingSettings)
      for (const input of document.querySelectorAll<HTMLInputElement>('input[type="password"]'))
        input.value = '';
    this.view = view;
    this.extraction.invalidate();
    for (const name of Object.keys(panels) as View[]) show(panels[name], name === view);
    el('open-settings').setAttribute('aria-expanded', String(view === 'settings'));
    for (const name of ['daily', 'log', 'review'] as const) {
      const selected = name === view;
      el(tabs[name]).setAttribute('aria-selected', String(selected));
      el(tabs[name]).tabIndex =
        selected || (view === 'settings' && name === this.previousView) ? 0 : -1;
    }
    this.render();
    if (leavingSettings) {
      window.scrollTo(0, this.scrollTop);
      this.returnFocus?.focus();
    } else if (view === 'settings') {
      window.scrollTo(0, 0);
      el('settings-back').focus();
    }
    if (!this.state) await this.refreshState();
    if (view === 'log' && this.state?.connection.unlocked) await this.loadLog(true);
    if (view === 'review' && this.state?.connection.unlocked) await this.loadReview(false);
  }

  private async run(operation: NotionOperation, success = ''): Promise<boolean> {
    if (this.actionBusy && operation.op !== 'connection.lock') return false;
    this.actionBusy = true;
    this.statusError = '';
    text('settings-status', '');
    const ticket = this.authority.ticket();
    this.render();
    try {
      const state = await requestNotion(operation);
      const grantChange =
        operation.op === 'connection.connect' || operation.op === 'connection.unlock';
      const announcedGrant =
        grantChange &&
        state.connection.unlocked &&
        state.connection.generation === this.state?.connection.generation &&
        state.connection.vaultId === this.state?.connection.vaultId;
      if (!this.authority.accepts(ticket) && !announcedGrant) return false;
      if (!this.accept(state)) return false;
      if (success) text('settings-status', success);
      return true;
    } catch (error) {
      if (
        !this.authority.accepts(ticket) &&
        operation.op !== 'connection.connect' &&
        operation.op !== 'connection.unlock'
      )
        return false;
      const message =
        error instanceof NotionMessageError
          ? error.message
          : 'The operation could not be completed. Stored data was preserved.';
      this.statusError = message;
      text('settings-status', message);
      this.reviewError = message;
      await this.refreshState();
      return false;
    } finally {
      this.actionBusy = false;
      this.render();
    }
  }

  private async lock(): Promise<void> {
    this.authority.invalidate();
    this.clearPrivate();
    if (this.state) this.state.connection = { ...this.state.connection, unlocked: false };
    this.render();
    await this.run({ op: 'connection.lock' });
  }

  private async loadLog(status: boolean): Promise<void> {
    if (status) this.logReads += 1;
    this.renderLog();
    try {
      await this.readLog(status);
    } finally {
      if (status) this.logReads -= 1;
      this.renderLog();
    }
  }

  private async readLog(status: boolean): Promise<void> {
    const tabId = this.tabId;
    if (tabId === null || !this.snapshot || !this.state?.connection.unlocked || this.view !== 'log')
      return;
    const ticket = this.extraction.ticket();
    const authority = this.authority.ticket();
    const snapshot = await this.dependencies.readSnapshot(tabId, true).catch(() => null);
    if (
      !this.extraction.accepts(ticket) ||
      !this.authority.accepts(authority) ||
      this.view !== 'log' ||
      !this.state?.connection.unlocked
    )
      return;
    if (snapshot?.problem.slug !== this.snapshot?.problem.slug) return;
    this.fullSnapshot = snapshot;
    this.renderLog();
    if (status && snapshot) {
      const navigationId = this.navigationId;
      try {
        const state = await requestNotion({ op: 'problem.status', slug: snapshot.problem.slug });
        if (navigationId !== this.navigationId || !this.authority.accepts(authority)) return;
        this.accept(state);
      } catch (error) {
        if (navigationId !== this.navigationId || !this.authority.accepts(authority)) return;
        this.statusError =
          error instanceof NotionMessageError ? error.message : 'Review status unavailable.';
        this.renderLog();
      }
    }
  }

  private async capture(result: AttemptResult): Promise<void> {
    if (
      this.actionBusy ||
      this.logReads > 0 ||
      this.state?.busy ||
      !this.state?.connection.unlocked ||
      this.state.connection.hasPending ||
      this.state.connection.reconciliationRequired ||
      this.tabId === null ||
      this.view !== 'log'
    )
      return;
    const tabId = this.tabId;
    const navigationId = this.navigationId;
    const authority = this.authority.ticket();
    const expectedFingerprint = this.fullSnapshot?.fingerprint;
    this.actionBusy = true;
    this.renderLog();
    try {
      const snapshot = await this.dependencies.readSnapshot(tabId, true);
      if (
        !this.authority.accepts(authority) ||
        navigationId !== this.navigationId ||
        tabId !== this.tabId ||
        this.view !== 'log'
      )
        return;
      if (!snapshot?.codeAvailable || snapshot.problem.slug !== this.snapshot?.problem.slug)
        throw new Error('Read the current problem again before saving.');
      if (snapshot.fingerprint !== expectedFingerprint) {
        this.fullSnapshot = snapshot;
        this.statusError =
          'The code changed. Review the updated preview, then confirm the outcome again.';
        return;
      }
      const now = new Date();
      const event = CaptureEventSchema.parse({
        clientEventId: crypto.randomUUID(),
        problem: snapshot.problem,
        attempt: {
          result,
          attemptedAt: now.toISOString(),
          attemptedOn: localDate(now),
          language: snapshot.language,
          code: snapshot.code,
        },
      });
      this.fullSnapshot = snapshot;
      this.actionBusy = false;
      await this.run({
        op: 'capture.submit',
        event,
        source: { tabId, fingerprint: snapshot.fingerprint, navigationId },
      });
      if ((this.view as View) === 'review') await this.loadReview(true);
    } catch {
      this.statusError =
        'Could not prepare this attempt. Confirm the editor is readable and code is at most 20,000 characters.';
    } finally {
      this.actionBusy = false;
      this.renderLog();
    }
  }

  private reviewKey(): string {
    return `${this.state?.connection.generation}:${this.state?.completed?.eventId ?? ''}:${JSON.stringify(this.state?.preferences)}`;
  }

  private async loadReview(force: boolean): Promise<void> {
    if (!this.state?.connection.unlocked || this.reviewLoading) return;
    this.reviewLoading = true;
    this.lastReviewKey = this.reviewKey();
    const ticket = this.authority.ticket();
    this.reviewError = '';
    text('review-message', 'Loading reviews…');
    el<HTMLButtonElement>('refresh-review').disabled = true;
    try {
      const state = await requestNotion({ op: force ? 'review.refresh' : 'review.read' });
      if (!this.authority.accepts(ticket)) return;
      this.accept(state);
    } catch (error) {
      if (!this.authority.accepts(ticket)) return;
      this.reviewError =
        error instanceof NotionMessageError ? error.message : 'Reviews could not be refreshed.';
      this.renderReview();
    } finally {
      this.reviewLoading = false;
      this.renderReview();
    }
  }

  private render(): void {
    this.renderLog();
    this.renderReview();
    this.renderSettings();
    this.renderPending();
  }

  private renderLog(): void {
    const problem = this.snapshot?.problem;
    text('problem-number', problem?.number ? String(problem.number) : '—');
    text('problem-title', problem?.title ?? 'Open a LeetCode problem');
    text('problem-difficulty', problem?.difficulty ?? 'Unknown');
    el('problem-difficulty').className = difficultyBadgeClass(problem?.difficulty ?? 'Unknown');
    const topics = el('problem-topics');
    topics.replaceChildren();
    for (const topic of problem?.topics ?? []) {
      const li = document.createElement('li');
      li.textContent = topic;
      topics.append(li);
    }
    const state = this.state;
    const unlocked = !!state?.connection.unlocked;
    show('log-private', unlocked && !!problem);
    show('log-connect', !unlocked);
    text('log-connect', state?.connection.configured ? 'Unlock Notion' : 'Connect Notion');
    const code = unlocked && this.fullSnapshot?.codeAvailable ? this.fullSnapshot : null;
    text('captured-code', code?.code ?? '');
    text('code-language', code?.language ?? 'Unknown');
    const lines = code ? code.code.split('\n').length : 0;
    text('code-line-count', `${lines} ${lines === 1 ? 'line' : 'lines'}`);
    const status =
      state?.problemStatus && state.problemStatus.slug === problem?.slug
        ? state.problemStatus.status
        : this.savedReview &&
            this.savedReview.slug === problem?.slug &&
            this.savedReview.eventId === state?.completed?.eventId
          ? { found: true, ...this.savedReview.review }
          : null;
    text(
      'review-state',
      !unlocked
        ? 'Unlock to check review status.'
        : this.statusError
          ? 'Review status unavailable'
          : status?.found
            ? `${status.nextReview ? (status.nextReview <= localDate() ? 'Due now' : `Review ${status.nextReview}`) : status.practiceState} · Solved streak ${status.solvedStreak}`
            : status
              ? 'New problem'
              : 'Checking review status…',
    );
    const pending = !!state?.connection.hasPending;
    const busy = this.actionBusy || this.logReads > 0 || !!state?.busy;
    for (const outcome of document.querySelectorAll<HTMLButtonElement>('[data-result]')) {
      outcome.disabled =
        !unlocked ||
        !code ||
        !code.code.trim() ||
        pending ||
        busy ||
        !!state?.connection.reconciliationRequired;
      outcome.setAttribute('aria-pressed', 'false');
    }
    const saved =
      unlocked &&
      !pending &&
      state?.completed?.source.tabId === this.tabId &&
      state.completed.source.fingerprint === code?.fingerprint
        ? state.completed
        : null;
    show('success-confirmation', !!saved);
    text(
      'success-confirmation',
      saved
        ? `Saved to Notion${saved.result.review.nextReview ? `\nNext review: ${saved.result.review.nextReview}` : ''}`
        : '',
    );
    text(
      'status',
      this.statusError ||
        (busy
          ? this.actionBusy || state?.pending?.state === 'saving'
            ? 'Saving to Notion…'
            : 'Checking review status…'
          : pending
            ? 'Finish the pending save before logging another attempt.'
            : state?.connection.reconciliationRequired
              ? 'Inspect and reconcile the uncertain result in Settings before logging again.'
              : !problem
                ? 'Open a LeetCode problem to log an attempt.'
                : !unlocked
                  ? 'Your Notion connection is locked.'
                  : !code
                    ? 'The editor is not readable yet. Open the problem editor and try again.'
                    : ''),
    );
  }

  private renderReview(): void {
    const state = this.state;
    const unlocked = !!state?.connection.unlocked;
    const snapshot = unlocked ? state?.review : null;
    show('review-connect', !unlocked);
    text('review-connect', state?.connection.configured ? 'Unlock Notion' : 'Connect Notion');
    show('review-private', unlocked);
    el<HTMLButtonElement>('refresh-review').disabled =
      !unlocked || this.actionBusy || this.reviewLoading || !!state?.busy;
    text(
      'review-updated',
      snapshot
        ? `${snapshot.stale || this.reviewError ? 'Saved view · ' : ''}Updated ${dateLabel(snapshot.generatedAt)}`
        : 'Waiting for data',
    );
    text(
      'review-message',
      !unlocked
        ? 'Unlock to load reviews.'
        : this.reviewError ||
            (snapshot?.stale
              ? 'Notion refresh failed. Your last saved view is shown.'
              : !snapshot
                ? 'Load reviews to see your current session.'
                : ''),
    );
    text('new-problem-count', snapshot ? String(snapshot.newProblemCount) : '—');
    text('review-goal-value', String(state?.preferences?.dailyNewProblemGoal ?? 10));
    text('reviews-due', snapshot ? String(snapshot.due.length) : '—');
    const preferencesBusy = this.actionBusy || this.reviewLoading || !!state?.busy;
    el<HTMLButtonElement>('edit-review-goal').disabled = !unlocked || preferencesBusy;
    el<HTMLButtonElement>('reset-review').disabled = !unlocked || preferencesBusy;
    for (const control of el('review-goal-form').querySelectorAll<
      HTMLInputElement | HTMLButtonElement
    >('input, button'))
      control.disabled = !unlocked || preferencesBusy;
    const list = el('review-list');
    list.replaceChildren();
    const filter = (el<HTMLSelectElement>('review-filter').value || 'all') as ReviewFilter;
    const rows = snapshot
      ? selectReviewRows(snapshot.due, snapshot.date, filter, field('review-search').value)
      : [];
    const visible = rows.slice(0, this.visibleRows);
    for (const row of visible) {
      const item = document.createElement('li');
      const content = document.createElement('div');
      content.className = 'review-row-content';
      const title = document.createElement('h3');
      title.textContent = row.title;
      const meta = document.createElement('p');
      const difficulty = document.createElement('span');
      difficulty.className = difficultyBadgeClass(row.difficulty);
      difficulty.textContent = row.difficulty;
      const overdue =
        snapshot && row.nextReview < snapshot.date
          ? Math.round(
              (Date.parse(`${snapshot.date}T00:00:00Z`) -
                Date.parse(`${row.nextReview}T00:00:00Z`)) /
                86400000,
            )
          : 0;
      const due = document.createElement('span');
      due.textContent = overdue > 0 ? ` · ${overdue}d overdue` : ' · Today';
      if (overdue > 0) due.className = 'overdue';
      meta.append(difficulty, due);
      if (row.practiceState === 'Needed help') meta.append(' · Needed help');
      content.append(title, meta);
      item.append(content);
      const href = safeProblemUrl(row.url);
      if (href) {
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Review ↗';
        link.setAttribute('aria-label', `Review ${row.title} in a new tab`);
        item.append(link);
      }
      list.append(item);
    }
    show('review-empty', !!snapshot && rows.length === 0);
    text(
      'review-empty',
      snapshot?.due.length === 0
        ? 'All caught up. No reviews are due today.'
        : 'No matching reviews. Try another filter or clear your search.',
    );
    text('review-count', snapshot ? `Showing ${visible.length} of ${rows.length}` : '');
    show('review-more', visible.length < rows.length);
  }

  private renderSettings(): void {
    const state = this.state;
    const configured = !!state?.connection.configured;
    const unlocked = !!state?.connection.unlocked;
    text(
      'connection-state',
      state?.connection.lockFailed
        ? 'Lock failed. Retry Lock or fully exit Chrome before proceeding.'
        : unlocked
          ? 'Unlocked for this browser session'
          : configured
            ? 'Notion is locked'
            : 'Notion is not connected',
    );
    show('connection-form', !!state && !configured);
    show('unlock-form', configured && !unlocked);
    show('connected-settings', unlocked);
    show('disconnect-notion', configured || this.connectionReadError === 'INVALID_VAULT');
    text(
      'disconnect-notion',
      this.connectionReadError === 'INVALID_VAULT' ? 'Reset saved connection' : 'Disconnect Notion',
    );
    show('manual-reconciliation', !!state?.connection.reconciliationRequired);
    for (const form of document.querySelectorAll<HTMLFormElement>('.settings-form')) {
      for (const control of form.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
        'input, button',
      ))
        control.disabled = this.actionBusy || !!state?.busy;
    }
    el<HTMLButtonElement>('lock-notion').disabled = !configured;
  }

  private renderPending(): void {
    const state = this.state;
    const visible =
      !!state?.connection.hasPending && (this.view === 'log' || this.view === 'settings');
    show('pending-recovery', visible);
    const pending = state?.connection.unlocked ? state.pending : null;
    text(
      'pending-heading',
      pending?.state === 'saving' ? 'Saving to Notion' : 'Save needs verification',
    );
    text(
      'pending-detail',
      pending
        ? `${pending.event.problem.title} · ${pending.event.attempt.result} · ${dateLabel(pending.event.attempt.attemptedAt)}`
        : '',
    );
    text(
      'pending-message',
      pending?.message ||
        (pending
          ? pending.disposition === 'check'
            ? 'The response was interrupted. Check Notion for the original result before another write. An empty result does not prove the save failed.'
            : 'Retry the original frozen attempt. Your current editor will not replace it.'
          : 'Unlock to check pending save.'),
    );
    text('pending-code', pending?.event.attempt.code ?? '');
    show('pending-code-disclosure', !!pending);
    text(
      'retry-attempt',
      pending
        ? pending.disposition === 'check'
          ? 'Check saved result'
          : 'Retry same attempt'
        : 'Unlock to check pending save',
    );
    el<HTMLButtonElement>('retry-attempt').disabled = this.actionBusy || !!state?.busy;
  }

  private confirm(title: string, message: string, action: () => Promise<void>): void {
    this.confirmation = action;
    text('notion-confirm-title', title);
    text('notion-confirm-message', message);
    el<HTMLDialogElement>('notion-confirm-dialog').showModal();
    el('notion-confirm-cancel').focus();
  }
  private closeConfirmation(): void {
    this.confirmation = null;
    el<HTMLDialogElement>('notion-confirm-dialog').close();
  }

  private bindForms(): void {
    const bind = (id: string, action: () => Promise<void>) => {
      el(id).addEventListener('submit', (event) => {
        event.preventDefault();
        void action()
          .catch(() =>
            text(
              'settings-status',
              'The settings input could not be read. Check the selected files and try again.',
            ),
          )
          .finally(() => {
            for (const input of el(id).querySelectorAll<HTMLInputElement>('input[type="password"]'))
              input.value = '';
          });
      });
    };
    const matching = (one: string, two: string): string => {
      const value = field(one).value;
      if (value !== field(two).value) throw new Error('Passphrases do not match.');
      return value;
    };
    const readJson = async (id: string, optional = false): Promise<unknown> => {
      const file = field(id).files?.[0];
      if (!file && optional) return undefined;
      if (!file || file.size > 65536 || !/\.json$/i.test(file.name))
        throw new Error('Choose a bounded JSON file.');
      return JSON.parse(await file.text()) as unknown;
    };
    field('preferences-file').addEventListener('change', () => {
      void readJson('preferences-file', true)
        .then((value) => {
          if (value === undefined) {
            text(
              'import-preview',
              'Without a preferences file: goal 10; count first attempts today. Your Daily Reps goal stays separate.',
            );
            return;
          }
          if (!value || typeof value !== 'object' || !('dailyNewProblemGoal' in value))
            throw new Error();
          const settings = value as {
            dailyNewProblemGoal: number;
            newProblemSessionStartedAt?: string;
          };
          if (
            !Number.isInteger(settings.dailyNewProblemGoal) ||
            settings.dailyNewProblemGoal < 1 ||
            settings.dailyNewProblemGoal > 100
          )
            throw new Error();
          text(
            'import-preview',
            `Imported goal: ${settings.dailyNewProblemGoal}. ${settings.newProblemSessionStartedAt ? `Count since ${dateLabel(settings.newProblemSessionStartedAt)}.` : 'Count first attempts today.'} Daily Reps is separate.`,
          );
        })
        .catch(() =>
          text(
            'import-preview',
            'Preferences file is invalid. Choose the existing dashboard-settings.json or remove the file.',
          ),
        );
    });
    bind('connection-form', async () => {
      let passphrase: string;
      try {
        passphrase = matching('new-passphrase', 'confirm-passphrase');
      } catch {
        text('settings-status', 'Passphrases do not match.');
        return;
      }
      const token = field('notion-token').value;
      const manifest = await readJson('manifest-file');
      const preferences = (await readJson('preferences-file', true)) ?? { dailyNewProblemGoal: 10 };
      for (const id of ['notion-token', 'new-passphrase', 'confirm-passphrase'])
        field(id).value = '';
      if (
        await this.run(
          { op: 'connection.connect', manifest, preferences, token, passphrase },
          'Notion connected. No attempt was submitted.',
        )
      )
        await this.select(this.previousView === 'daily' ? 'daily' : this.previousView);
    });
    bind('unlock-form', async () => {
      const passphrase = field('unlock-passphrase').value;
      field('unlock-passphrase').value = '';
      if (await this.run({ op: 'connection.unlock', passphrase }))
        await this.select(this.previousView);
    });
    bind('change-passphrase-form', async () => {
      let newPassphrase: string;
      try {
        newPassphrase = matching('replacement-passphrase', 'replacement-confirm');
      } catch {
        text('settings-status', 'Passphrases do not match.');
        return;
      }
      const oldPassphrase = field('old-passphrase').value;
      for (const id of ['old-passphrase', 'replacement-passphrase', 'replacement-confirm'])
        field(id).value = '';
      await this.run(
        { op: 'connection.changePassphrase', oldPassphrase, newPassphrase },
        'Passphrase changed. Existing recovery remains available.',
      );
    });
    bind('replace-token-form', async () => {
      const token = field('replacement-token').value;
      field('replacement-token').value = '';
      await this.run(
        { op: 'connection.replaceToken', token },
        'Token replaced for the same tracker.',
      );
    });
  }
}
