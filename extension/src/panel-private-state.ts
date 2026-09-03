export class PrivateResponseGate {
  private revision = 0;
  ticket(): number {
    return this.revision;
  }
  invalidate(): void {
    this.revision += 1;
  }
  accepts(ticket: number): boolean {
    return ticket === this.revision;
  }
}

export type ReviewFilter = 'all' | 'today' | 'overdue' | 'needed-help';
export function selectReviewRows<
  T extends { title: string; nextReview: string; practiceState: string },
>(rows: readonly T[], date: string, filter: ReviewFilter, search: string): T[] {
  const query = search.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  return rows.filter(
    (row) =>
      row.title.toLocaleLowerCase().replace(/\s+/g, ' ').includes(query) &&
      (filter === 'today'
        ? row.nextReview === date
        : filter === 'overdue'
          ? row.nextReview < date
          : filter === 'needed-help'
            ? row.practiceState === 'Needed help'
            : true),
  );
}

export function safeProblemUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      url.hostname === 'leetcode.com' &&
      /^\/problems\/[a-z0-9-]+\/$/.test(url.pathname) &&
      !url.search &&
      !url.hash
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Accepts monotonic public state within an already-authorized vault session. */
export class PanelStateRevision {
  private identity = '';
  private revision = -1;
  observe(vaultId: string | null, generation: string, revision: number): boolean {
    if (!Number.isSafeInteger(revision) || revision < 0) return false;
    const identity = JSON.stringify([vaultId, generation]);
    if (identity === this.identity && revision < this.revision) return false;
    this.identity = identity;
    this.revision = revision;
    return true;
  }
}
