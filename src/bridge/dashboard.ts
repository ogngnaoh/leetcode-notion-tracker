import type { Difficulty, PracticeState } from '../shared/contract.js';

export interface DashboardRow {
  title: string;
  url: string;
  difficulty: Difficulty;
  practiceState: PracticeState;
  solvedStreak: number;
  nextReview: string;
}

export interface DashboardSnapshot {
  date: string;
  goal: number;
  newProblemCount: number;
  due: DashboardRow[];
  generatedAt: string;
  stale: boolean;
}

interface DashboardStoreOptions {
  goal: number;
  load(
    date: string,
    newProblemSessionStartedAt?: string,
  ): Promise<{ newProblemCount: number; due: DashboardRow[] }>;
  newProblemSessionStartedAt?: string;
  now?: () => Date;
}

export class DashboardStore {
  private snapshot?: DashboardSnapshot;
  private inFlight: Promise<DashboardSnapshot> | undefined;
  private failedDate: string | undefined;
  private readonly now: () => Date;
  private goal: number;
  private newProblemSessionStartedAt: string | undefined;

  constructor(private readonly options: DashboardStoreOptions) {
    this.now = options.now ?? (() => new Date());
    this.goal = options.goal;
    this.newProblemSessionStartedAt = options.newProblemSessionStartedAt;
  }

  current(): DashboardSnapshot | undefined {
    return this.snapshot;
  }

  currentGoal(): number {
    return this.goal;
  }

  currentSessionStartedAt(): string | undefined {
    return this.newProblemSessionStartedAt;
  }

  failedFor(date: string): boolean {
    return this.failedDate === date;
  }

  updateGoal(goal: number): void {
    this.goal = goal;
    if (this.snapshot) this.snapshot = { ...this.snapshot, goal };
  }

  updateSessionStartedAt(timestamp: string): void {
    this.newProblemSessionStartedAt = timestamp;
    if (this.snapshot) this.snapshot = { ...this.snapshot, newProblemCount: 0 };
  }

  refresh(date = localDate(this.now())): Promise<DashboardSnapshot> {
    if (this.inFlight) return this.inFlight;
    const load = this.newProblemSessionStartedAt
      ? this.options.load(date, this.newProblemSessionStartedAt)
      : this.options.load(date);
    this.inFlight = load
      .then((loaded) => {
        this.failedDate = undefined;
        this.snapshot = {
          date,
          goal: this.goal,
          newProblemCount: loaded.newProblemCount,
          due: loaded.due,
          generatedAt: this.now().toISOString(),
          stale: false,
        };
        return this.snapshot;
      })
      .catch((error: unknown) => {
        this.failedDate = date;
        if (!this.snapshot) throw error;
        this.snapshot = { ...this.snapshot, stale: true };
        return this.snapshot;
      })
      .finally(() => {
        this.inFlight = undefined;
      });
    return this.inFlight;
  }
}

export function localDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeLeetCodeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'leetcode.com' &&
      /^\/problems\/[a-z0-9-]+\/$/.test(url.pathname) &&
      url.search === '' &&
      url.hash === ''
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

type DashboardRenderState = 'ready' | 'loading' | 'unavailable';

function badgeClass(value: string): string {
  return value.toLowerCase().replaceAll('’', '').replaceAll(' ', '-');
}

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    .format(new Date(`${date}T12:00:00`))
    .toUpperCase();
}

function shortDateLabel(date: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
    .format(new Date(`${date}T12:00:00`))
    .toUpperCase();
}

function updatedLabel(timestamp: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(
    new Date(timestamp),
  );
}

function dueLabel(reviewDate: string, snapshotDate: string): string {
  const review = Date.parse(`${reviewDate}T00:00:00Z`);
  const snapshot = Date.parse(`${snapshotDate}T00:00:00Z`);
  const days = Math.round((snapshot - review) / 86_400_000);
  return days === 0 ? 'Today' : `${days}d overdue`;
}

function renderReviewQueue(rows: DashboardRow[], snapshotDate: string): string {
  const counts = {
    all: rows.length,
    today: rows.filter((row) => row.nextReview === snapshotDate).length,
    overdue: rows.filter((row) => row.nextReview < snapshotDate).length,
    neededHelp: rows.filter((row) => row.practiceState === 'Needed help').length,
  };
  const filterButton = (
    value: 'all' | 'today' | 'overdue' | 'needed-help',
    label: string,
    count: number,
    pressed = false,
  ): string =>
    `<button type="button" data-review-filter="${value}" aria-pressed="${pressed}" aria-controls="review-results">${label}<span data-filter-count="${value}">${count}</span></button>`;
  const rowMarkup = rows
    .map((row) => {
      const href = safeLeetCodeUrl(row.url);
      const action = href
        ? `<a class="review" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Review<span aria-hidden="true"> ↗</span></a>`
        : '<span class="link-unavailable">Link unavailable</span>';
      return `<li class="review-row" data-review-row data-title="${escapeHtml(row.title.trim().toLowerCase())}" data-review-date="${escapeHtml(row.nextReview)}" data-practice-state="${escapeHtml(row.practiceState)}" data-difficulty="${escapeHtml(row.difficulty)}"><div class="review-row__content"><h2>${escapeHtml(row.title)}</h2><div class="review-row__meta"><span class="badge badge--${badgeClass(row.difficulty)}">${escapeHtml(row.difficulty)}</span><span class="badge badge--${badgeClass(row.practiceState)}">${escapeHtml(row.practiceState)}</span><span>${row.solvedStreak} streak</span><span><strong>${escapeHtml(dueLabel(row.nextReview, snapshotDate))}</strong> · <time datetime="${escapeHtml(row.nextReview)}">${escapeHtml(row.nextReview)}</time></span></div></div>${action}</li>`;
    })
    .join('');
  return `<section class="review-queue" data-review-queue><div class="review-filters" role="group" aria-label="Review filters">${filterButton('all', 'All due', counts.all, true)}${filterButton('today', 'Today', counts.today)}${filterButton('overdue', 'Overdue', counts.overdue)}${filterButton('needed-help', 'Needed help', counts.neededHelp)}</div><div class="review-results"><label for="review-search">Search by title</label><input id="review-search" type="search" autocomplete="off" data-review-search aria-controls="review-results"><p data-review-results role="status" aria-live="polite">Showing ${rows.length} of ${rows.length} matching reviews</p><ol id="review-results" class="review-list">${rowMarkup}</ol><div class="review-filter-empty" data-review-empty hidden><h2>No matching reviews</h2><p>Try another saved view or title search.</p></div><button class="review-more" type="button" data-review-more hidden>Load 50 more</button></div></section>`;
}

export function renderDashboard(
  snapshot?: DashboardSnapshot,
  error?: string,
  state: DashboardRenderState = snapshot ? 'ready' : 'unavailable',
  antiForgeryToken?: string,
  configuredGoal = snapshot?.goal,
): string {
  const unavailable = !snapshot;
  const rows = snapshot?.due ?? [];
  const status =
    state === 'loading'
      ? '<div class="empty loading" role="status" data-dashboard-loading><div class="loading-mark" aria-hidden="true"></div><h2>Loading today’s plan</h2><p>Fetching fresh solve and review data from Notion.</p></div>'
      : unavailable
        ? `<div class="empty" role="alert"><h2>Dashboard unavailable</h2><p>${escapeHtml(error ?? 'Notion data could not be loaded.')}</p></div>`
        : rows.length === 0
          ? '<div class="empty"><h2>All caught up</h2><p>No reviews are due today.</p></div>'
          : renderReviewQueue(rows, snapshot.date);
  const shownDate = snapshot?.date ?? localDate();
  const updateStatus = snapshot
    ? `<span>Updated <time datetime="${escapeHtml(snapshot.generatedAt)}">${escapeHtml(updatedLabel(snapshot.generatedAt))}</time></span>`
    : '<span>Waiting for data</span>';
  const tokenMeta = antiForgeryToken
    ? `<meta name="dashboard-settings-token" content="${escapeHtml(antiForgeryToken)}">`
    : '';
  const goal = configuredGoal ?? snapshot?.goal ?? 10;
  const settingsDialog = `<dialog id="dashboard-settings-dialog" aria-labelledby="dashboard-settings-title"><div class="dialog-panel"><div class="eyebrow">DASHBOARD SETTINGS</div><h2 id="dashboard-settings-title">New-problem session</h2><p>Start a fresh counting session without changing your saved attempts.</p><div class="dialog-actions"><button id="cancel-dashboard-settings" class="dialog-button" type="button">Close</button><button id="reset-new-problem-session" class="dialog-button dialog-button--primary" type="button">Reset current count</button></div></div></dialog><dialog id="reset-new-problem-session-dialog" aria-labelledby="reset-new-problem-session-title"><div class="dialog-panel"><div class="eyebrow">CONFIRM RESET</div><h2 id="reset-new-problem-session-title">Reset the new-problems count to zero?</h2><p>Previous Problems and Attempts stay unchanged. Only this local session count restarts.</p><p id="reset-new-problem-session-error" class="dialog-error" role="status" aria-live="polite"></p><div class="dialog-actions"><button id="cancel-new-problem-session-reset" class="dialog-button" type="button">Keep current count</button><button id="confirm-new-problem-session-reset" class="dialog-button dialog-button--primary" type="button">Yes, reset count</button></div></div></dialog>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${tokenMeta}<title>LC Log Daily</title><link rel="stylesheet" href="/dashboard-assets/tokens.css"><link rel="stylesheet" href="/dashboard-assets/components.css"><link rel="stylesheet" href="/dashboard-assets/dashboard.css?v=5"><script src="/dashboard-assets/dashboard.js?v=5" defer></script></head><body>${snapshot?.stale ? '<div class="stale" role="status"><strong>Saved data</strong><span>Notion refresh failed. Your last successful snapshot is still shown.</span></div>' : ''}<header class="masthead"><a class="brand" href="/dashboard" aria-label="LC Log daily dashboard"><img src="/dashboard-assets/square-terminal.svg" width="20" height="20" alt=""> <span>LC LOG</span></a><time class="date" datetime="${escapeHtml(shownDate)}"><span class="date-long">${escapeHtml(dateLabel(shownDate))}</span><span class="date-short">${escapeHtml(shortDateLabel(shownDate))}</span></time><div class="meta">${updateStatus}</div><div class="header-actions"><button id="open-dashboard-settings" class="refresh" type="button">Settings</button><a class="refresh" href="/dashboard?refresh=1">Refresh<span aria-hidden="true">↻</span></a></div></header>${settingsDialog}<main><section class="summaries" aria-label="Daily summary"><article class="summary summary--solves"><div class="eyebrow">NEW PROBLEMS THIS SESSION</div><div class="number new-problem-counter"><strong data-dashboard-new-problem-count>${snapshot?.newProblemCount ?? '—'}</strong><span class="goal-separator" aria-hidden="true"> / </span><button class="goal-button" type="button" data-dashboard-goal aria-label="Maximum new problems: ${goal}. Activate to edit.">${goal}</button><input class="goal-input" id="daily-new-problem-goal" name="dailyNewProblemGoal" type="number" min="1" max="100" step="1" required value="${goal}" aria-label="Maximum new problems" aria-describedby="daily-new-problem-goal-error" hidden></div><p id="daily-new-problem-goal-error" class="goal-error" role="status" aria-live="polite"></p><p class="summary-description">First attempts since your last reset.</p></article><article class="summary summary--reviews"><div class="eyebrow">REVIEWS DUE</div><div class="number"><strong>${snapshot?.due.length ?? '—'}</strong></div><p class="summary-description">Problems ready for deliberate review.</p></article></section><div class="section-title"><div><div class="eyebrow">DAILY QUEUE</div><h1>REVIEW NOW</h1></div><span class="queue-count">${rows.length} ${rows.length === 1 ? 'problem' : 'problems'}</span></div>${status}</main></body></html>`;
}
