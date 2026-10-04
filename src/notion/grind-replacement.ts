import { randomUUID } from 'node:crypto';
import type { Client } from '@notionhq/client';
import {
  curriculumValues,
  isTrashed,
  propertiesFor,
  type GrindEntry,
} from './grind-maintenance.js';
export interface ReplacementJournal {
  version: 1;
  slot: string;
  originalId: string;
  dataSourceId: string;
  intent: string;
  status: 'pending' | 'created' | 'bound';
  pageId?: string;
}
export async function replaceUnavailable(
  notion: Client,
  entry: GrindEntry,
  originalId: string,
  dataSourceId: string,
  existing: ReplacementJournal | null,
  persist: (journal: ReplacementJournal) => Promise<void>,
  bind: (pageId: string) => Promise<void>,
  solutionId?: string,
) {
  let journal = existing;
  if (
    journal &&
    (journal.version !== 1 ||
      journal.slot !== entry.slot ||
      journal.originalId !== originalId ||
      journal.dataSourceId !== dataSourceId)
  )
    throw new Error('Replacement journal does not match this slot/tracker.');
  if (journal?.status === 'pending')
    throw new Error(
      'Replacement outcome unresolved. Inspect Notion for the receipt before adopting a returned page; never delete the journal to retry.',
    );
  if (!journal) {
    try {
      await notion.pages.retrieve({ page_id: originalId });
      throw new Error('Original page is accessible; restore or repair it instead.');
    } catch (e: any) {
      if (e.code !== 'object_not_found') throw e;
    }
    journal = {
      version: 1,
      slot: entry.slot,
      originalId,
      dataSourceId,
      intent: randomUUID(),
      status: 'pending',
    };
    await persist(journal);
    const created = await notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: dataSourceId },
      properties: {
        ...propertiesFor(entry),
        'Grind Done': { checkbox: false },
        ...(solutionId ? { 'Grind Attempt': { relation: [{ id: solutionId }] } } : {}),
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              { type: 'text', text: { content: `Grind replacement receipt: ${journal.intent}` } },
            ],
          },
        },
      ],
    });
    journal = { ...journal, status: 'created', pageId: created.id };
    await persist(journal);
  }
  if (!journal.pageId) throw new Error('Replacement journal has no returned page ID.');
  const page: any = await notion.pages.retrieve({ page_id: journal.pageId });
  if (
    isTrashed(page) ||
    page.parent?.data_source_id !== dataSourceId ||
    JSON.stringify(curriculumValues(page)) !==
      JSON.stringify(curriculumValues({ properties: propertiesFor(entry) }))
  )
    throw new Error('Replacement page verification failed.');
  await bind(journal.pageId);
  await persist({ ...journal, status: 'bound' });
}
