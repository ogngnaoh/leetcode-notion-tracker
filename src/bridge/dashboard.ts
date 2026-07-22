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
  load(date: string): Promise<{ newProblemCount: number; due: DashboardRow[] }>;
  now?: () => Date;
}

export class DashboardStore {
  private snapshot?: DashboardSnapshot;
  private inFlight: Promise<DashboardSnapshot> | undefined;
  private failedDate: string | undefined;
  private readonly now: () => Date;
  private goal: number;

  constructor(private readonly options: DashboardStoreOptions) {
    this.now = options.now ?? (() => new Date());
    this.goal = options.goal;
  }

  current(): DashboardSnapshot | undefined {
    return this.snapshot;
  }

  currentGoal(): number {
    return this.goal;
  }

  failedFor(date: string): boolean {
    return this.failedDate === date;
  }

  updateGoal(goal: number): void {
    this.goal = goal;
    if (this.snapshot) this.snapshot = { ...this.snapshot, goal };
  }

  refresh(date = localDate(this.now())): Promise<DashboardSnapshot> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.options
      .load(date)
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

export function renderDashboard(
  snapshot?: DashboardSnapshot,
  error?: string,
  state: DashboardRenderState = snapshot ? 'ready' : 'unavailable',
  antiForgeryToken?: string,
  configuredGoal = snapshot?.goal,
): string {
  const unavailable = !snapshot;
  const rows = snapshot?.due ?? [];
  const rowMarkup = rows
    .map((row) => {
      const href = safeLeetCodeUrl(row.url);
      const action = href
        ? `<a class="review" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Review</a>`
        : '<span>Unavailable</span>';
      return `<tr><td class="problem-title">${escapeHtml(row.title)}</td><td><span class="badge badge--${badgeClass(row.difficulty)}">${escapeHtml(row.difficulty)}</span></td><td><span class="badge badge--${badgeClass(row.practiceState)}">${escapeHtml(row.practiceState)}</span></td><td>${row.solvedStreak}</td><td><time datetime="${escapeHtml(row.nextReview)}">${escapeHtml(row.nextReview)}</time></td><td>${action}</td></tr>`;
    })
    .join('');
  const cards = rows
    .map((row) => {
      const href = safeLeetCodeUrl(row.url);
      return `<article class="card"><h2>${escapeHtml(row.title)}</h2><div class="card-badges"><span class="badge badge--${badgeClass(row.difficulty)}">${escapeHtml(row.difficulty)}</span><span class="badge badge--${badgeClass(row.practiceState)}">${escapeHtml(row.practiceState)}</span></div><dl><div><dt>Streak</dt><dd>${row.solvedStreak}</dd></div><div><dt>Due</dt><dd><time datetime="${escapeHtml(row.nextReview)}">${escapeHtml(row.nextReview)}</time></dd></div></dl>${href ? `<a class="review" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Review problem<span aria-hidden="true"> ↗</span></a>` : '<span class="link-unavailable">Link unavailable</span>'}</article>`;
    })
    .join('');
  const status =
    state === 'loading'
      ? '<div class="empty loading" role="status" data-dashboard-loading><div class="loading-mark" aria-hidden="true"></div><h2>Loading today’s plan</h2><p>Fetching fresh solve and review data from Notion.</p></div>'
      : unavailable
        ? `<div class="empty" role="alert"><h2>Dashboard unavailable</h2><p>${escapeHtml(error ?? 'Notion data could not be loaded.')}</p></div>`
        : rows.length === 0
          ? '<div class="empty"><h2>All caught up</h2><p>No reviews are due today.</p></div>'
          : `<table><thead><tr><th>Problem</th><th>Difficulty</th><th>State</th><th>Streak</th><th>Next review</th><th>Action</th></tr></thead><tbody>${rowMarkup}</tbody></table><div class="cards">${cards}</div>`;
  const shownDate = snapshot?.date ?? localDate();
  const updateStatus = snapshot
    ? `<span>Updated <time datetime="${escapeHtml(snapshot.generatedAt)}">${escapeHtml(updatedLabel(snapshot.generatedAt))}</time></span>`
    : '<span>Waiting for data</span>';
  const tokenMeta = antiForgeryToken
    ? `<meta name="dashboard-settings-token" content="${escapeHtml(antiForgeryToken)}">`
    : '';
  const goal = configuredGoal ?? snapshot?.goal;
  const settingsDialog = `<dialog id="dashboard-settings-dialog" aria-labelledby="dashboard-settings-title"><form id="dashboard-settings-form"><div class="eyebrow">DASHBOARD SETTINGS</div><h2 id="dashboard-settings-title">Daily new-problem target</h2><p>Choose how many new Problems you want to practice each day.</p><label for="daily-new-problem-goal">New problems per day</label><input id="daily-new-problem-goal" name="dailyNewProblemGoal" type="number" min="1" max="100" step="1" required value="${goal ?? 10}"><p id="dashboard-settings-error" class="dialog-error" role="status" aria-live="polite"></p><div class="dialog-actions"><button id="cancel-dashboard-settings" class="dialog-button" type="button">Cancel</button><button id="save-dashboard-settings" class="dialog-button dialog-button--primary" type="submit">Save goal</button></div></form></dialog>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${tokenMeta}<title>LC Log Daily</title><link rel="stylesheet" href="/dashboard-assets/tokens.css"><link rel="stylesheet" href="/dashboard-assets/components.css"><link rel="stylesheet" href="/dashboard-assets/dashboard.css?v=3"><script src="/dashboard-assets/dashboard.js?v=3" defer></script></head><body>${snapshot?.stale ? '<div class="stale" role="status"><strong>Saved data</strong><span>Notion refresh failed. Your last successful snapshot is still shown.</span></div>' : ''}<header class="masthead"><a class="brand" href="/dashboard" aria-label="LC Log daily dashboard"><img src="/dashboard-assets/square-terminal.svg" width="20" height="20" alt=""> <span>LC LOG</span></a><time class="date" datetime="${escapeHtml(shownDate)}"><span class="date-long">${escapeHtml(dateLabel(shownDate))}</span><span class="date-short">${escapeHtml(shortDateLabel(shownDate))}</span></time><div class="meta">${updateStatus}</div><div class="header-actions"><button id="open-dashboard-settings" class="refresh" type="button">Settings</button><a class="refresh" href="/dashboard?refresh=1">Refresh<span aria-hidden="true">↻</span></a></div></header>${settingsDialog}<main><section class="summaries" aria-label="Daily summary"><article class="summary summary--solves"><div class="eyebrow">NEW PROBLEMS TODAY</div><div class="number"><strong>${snapshot?.newProblemCount ?? '—'}</strong><span data-dashboard-goal> / ${goal ?? '—'}</span></div><p>First attempts toward today’s goal.</p></article><article class="summary summary--reviews"><div class="eyebrow">REVIEWS DUE</div><div class="number"><strong>${snapshot?.due.length ?? '—'}</strong></div><p>Problems ready for deliberate review.</p></article></section><div class="section-title"><div><div class="eyebrow">DAILY QUEUE</div><h1>REVIEW NOW</h1></div><span class="queue-count">${rows.length} ${rows.length === 1 ? 'problem' : 'problems'}</span></div>${status}</main></body></html>`;
}
