import { describe, expect, it, vi } from 'vitest';
import { rollbackDailyDashboard } from '../src/notion/dashboard-rollback.js';

function notion(names: Record<string, string>) {
  return {
    views: {
      list: vi.fn().mockResolvedValue({
        results: Object.keys(names).map((id) => ({ id })),
        next_cursor: null,
      }),
      retrieve: vi.fn(async ({ view_id }: { view_id: string }) => ({
        id: view_id,
        name: names[view_id]!,
        type: 'table',
      })),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
}

describe('Notion dashboard rollback', () => {
  it('dry-runs a token-free inventory without deleting and preserves unrelated views', async () => {
    const client = notion({
      dashboard: 'Daily plan',
      solves: 'New solves today · goal 10',
      due: 'Reviews due',
      review: 'Review now',
      custom: 'My view',
    });
    const writeBackup = vi.fn(async () => '/tmp/backup.json');
    const result = await rollbackDailyDashboard({
      notion: client,
      dataSourceId: 'problems',
      apply: false,
      writeBackup,
    });
    expect(result.targets.map(({ name }) => name)).toEqual([
      'Daily plan',
      'New solves today · goal 10',
      'Reviews due',
      'Review now',
    ]);
    expect(writeBackup).toHaveBeenCalledWith(
      expect.not.objectContaining({ token: expect.anything() }),
    );
    expect(client.views.delete).not.toHaveBeenCalled();
  });

  it('deletes widgets before the dashboard, is idempotent, and rejects ambiguity', async () => {
    const client = notion({
      dashboard: 'Daily plan',
      solves: 'New solves today · goal 10',
      due: 'Reviews due',
      review: 'Review now',
      custom: 'My view',
    });
    await rollbackDailyDashboard({
      notion: client,
      dataSourceId: 'problems',
      apply: true,
      writeBackup: vi.fn(async () => '/tmp/x'),
    });
    expect(client.views.delete.mock.calls.map(([value]: any[]) => value.view_id)).toEqual([
      'solves',
      'due',
      'review',
      'dashboard',
    ]);

    const empty = notion({ custom: 'My view' });
    await expect(
      rollbackDailyDashboard({
        notion: empty,
        dataSourceId: 'problems',
        apply: true,
        writeBackup: vi.fn(async () => '/tmp/x'),
      }),
    ).resolves.toMatchObject({ targets: [] });
    const ambiguous = notion({ one: 'Daily plan', two: 'Daily plan' });
    await expect(
      rollbackDailyDashboard({
        notion: ambiguous,
        dataSourceId: 'problems',
        apply: false,
        writeBackup: vi.fn(async () => '/tmp/x'),
      }),
    ).rejects.toThrow('Ambiguous managed view');
    expect(ambiguous.views.delete).not.toHaveBeenCalled();
  });
});
