import type { Client } from '@notionhq/client';
import type { ManagedView } from './presentation.js';

export interface ViewReference {
  readonly id: string;
  readonly name: string;
}

export async function listAllViews(notion: Client, dataSourceId: string): Promise<ViewReference[]> {
  const views: ViewReference[] = [];
  let startCursor: string | undefined;
  do {
    const response = await notion.views.list({
      data_source_id: dataSourceId,
      ...(startCursor ? { start_cursor: startCursor } : {}),
      page_size: 100,
    });
    const retrieved = await Promise.all(
      response.results.map(async ({ id }) => notion.views.retrieve({ view_id: id })),
    );
    for (const view of retrieved) {
      if (!('name' in view)) throw new Error(`Notion returned partial view ${view.id}.`);
      views.push({ id: view.id, name: view.name });
    }
    startCursor = response.next_cursor ?? undefined;
  } while (startCursor);
  return views;
}

function request(view: ManagedView): any {
  return {
    name: view.name,
    filter: view.filter,
    sorts: view.sorts,
    configuration: view.configuration,
  };
}

export async function createManagedView(
  notion: Client,
  dataSourceId: string,
  view: ManagedView,
): Promise<string> {
  const response = await notion.views.create({
    data_source_id: dataSourceId,
    type: 'table',
    ...request(view),
  } as never);
  return response.id;
}

export async function updateManagedView(
  notion: Client,
  viewId: string,
  view: ManagedView,
): Promise<void> {
  await notion.views.update({ view_id: viewId, ...request(view) } as never);
}

export async function retrieveManagedView(notion: Client, viewId: string): Promise<unknown> {
  return notion.views.retrieve({ view_id: viewId });
}

export function requireUniqueView(
  views: readonly ViewReference[],
  managedName: string,
  aliases: readonly string[] = [],
): ViewReference | undefined {
  const candidates = views.filter(({ name }) => name === managedName || aliases.includes(name));
  if (candidates.length > 1) {
    throw new Error(
      `Ambiguous managed view ${managedName}: ${candidates.map(({ id, name }) => `${name} (${id})`).join(', ')}.`,
    );
  }
  return candidates[0];
}
