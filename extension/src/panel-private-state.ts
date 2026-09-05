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
