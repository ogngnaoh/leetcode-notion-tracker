import { join } from 'node:path';
import { writeJsonAtomic } from './io.js';

interface RollbackClient {
  views: {
    list(
      request: Record<string, unknown>,
    ): Promise<{ results: { id: string }[]; next_cursor: string | null }>;
    retrieve(request: { view_id: string }): Promise<{ id: string; name?: string; type?: string }>;
    delete(request: { view_id: string }): Promise<unknown>;
  };
}

export interface ManagedDashboardRef {
  id: string;
  name: string;
  type: string | undefined;
}

interface RollbackOptions {
  notion: RollbackClient;
  dataSourceId: string;
  apply: boolean;
  writeBackup?: (backup: unknown) => Promise<string>;
}

const exactNames = ['Daily plan'];
const solvePrefix = 'New solves today · goal ';

export async function rollbackDailyDashboard(options: RollbackOptions) {
  const all: ManagedDashboardRef[] = [];
  let cursor: string | undefined;
  do {
    const response = await options.notion.views.list({
      data_source_id: options.dataSourceId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    const views = await Promise.all(
      response.results.map(({ id }) => options.notion.views.retrieve({ view_id: id })),
    );
    for (const view of views) {
      if (typeof view.name !== 'string')
        throw new Error(`Notion returned partial view ${view.id}.`);
      all.push({ id: view.id, name: view.name, type: view.type });
    }
    cursor = response.next_cursor ?? undefined;
  } while (cursor);

  const groups = [
    ...exactNames.map((name) => all.filter((view) => view.name === name)),
    all.filter((view) => view.name.startsWith(solvePrefix)),
    ...['Reviews due', 'Review now'].map((name) => all.filter((view) => view.name === name)),
  ];
  for (const group of groups) {
    if (group.length > 1)
      throw new Error(
        `Ambiguous managed view ${group.map(({ name, id }) => `${name} (${id})`).join(', ')}.`,
      );
  }
  const targets = groups.flat();
  const backup = {
    version: 1,
    operation: 'retire-notion-daily-dashboard',
    createdAt: new Date().toISOString(),
    dataSourceId: options.dataSourceId,
    targets,
  };
  const backupPath = await (
    options.writeBackup ??
    (async (value) => {
      const path = join(process.cwd(), 'build', `notion-dashboard-rollback-${Date.now()}.json`);
      await writeJsonAtomic(path, value);
      return path;
    })
  )(backup);
  if (options.apply) {
    const dashboard = targets.find(({ name }) => name === 'Daily plan');
    for (const target of targets.filter(({ name }) => name !== 'Daily plan'))
      await options.notion.views.delete({ view_id: target.id });
    if (dashboard) await options.notion.views.delete({ view_id: dashboard.id });
  }
  return { mode: options.apply ? ('applied' as const) : ('dry-run' as const), backupPath, targets };
}
