import type { Client } from '@notionhq/client';
import { isDeepStrictEqual as same } from 'node:util';
import {
  blockText,
  listBlocks,
  receiptBlock,
  RECEIPTS_LABEL,
  ReceiptSchema,
  richTextChunks,
  type Receipt,
} from '../bridge/latest-attempt.js';
import {
  planLatestAttempts,
  queryPages,
  type inventoryLatestAttempts,
} from './latest-attempt-maintenance.js';

type Snapshot = Awaited<ReturnType<typeof inventoryLatestAttempts>>;
const managed = (block: any) => block.type === 'toggle' && blockText(block) === RECEIPTS_LABEL;
const shape = (blocks: any[]): any[] =>
  blocks.map((b) => ({
    id: b.id,
    type: b.type,
    value: b[b.type],
    children: shape(b.children ?? []),
  }));
const active = (page: any) => page && !page.in_trash && !page.archived;

async function tree(notion: Client, id: string): Promise<any[]> {
  const blocks = await listBlocks(notion, id);
  for (const block of blocks) if (block.has_children) block.children = await tree(notion, block.id);
  return blocks;
}

function assertPage(page: any, original: any) {
  if (
    !page ||
    !same(page.properties, original.properties) ||
    !same(page.parent, original.parent) ||
    page.created_time !== original.created_time
  )
    throw new Error(`Attempt changed since approved backup: ${original.id}`);
}

function receiptsIn(blocks: any[], expected: Receipt[]) {
  const containers = blocks.filter(managed);
  if (containers.length > 1) throw new Error('Multiple receipt containers; cleanup stopped.');
  const container = containers[0];
  const values = new Map<string, Receipt>();
  for (const block of container?.children ?? []) {
    if (block.type !== 'code') throw new Error('Unexpected block in receipt container.');
    const receipt = ReceiptSchema.parse(JSON.parse(blockText(block)));
    if (
      receipt.pending ||
      values.has(receipt.clientEventId) ||
      !same(
        expected.find((r) => r.clientEventId === receipt.clientEventId),
        receipt,
      )
    )
      throw new Error('Conflicting, pending or duplicate receipt; cleanup stopped.');
    values.set(receipt.clientEventId, receipt);
  }
  return { container, values };
}

/** Only consumes an explicitly approved, hash-verified backup. Never selects new deletion targets. */
export async function applyLatestAttemptCleanup(notion: Client, snapshot: Snapshot) {
  const plan = planLatestAttempts(snapshot.problems, snapshot.attempts, snapshot.bodies);
  if (snapshot.manifest.version !== 4 || !same(plan, snapshot.plan) || plan.blockers.length)
    throw new Error('Invalid or blocked approved cleanup plan.');
  const groups = plan.groups.filter((g) => g.trashPageIds.length);
  const trash = new Set(groups.flatMap((g) => g.trashPageIds));
  const originals = new Map(snapshot.attempts.map((p) => [p.id, p]));
  if (
    originals.size !== snapshot.attempts.length ||
    new Set(snapshot.problems.map((p) => p.id)).size !== snapshot.problems.length
  )
    throw new Error('Duplicate pages in approved backup.');
  for (const group of groups) {
    if (group.receipts.length > 100) throw new Error('Cleanup receipt batch exceeds safe limit.');
    for (const id of group.trashPageIds) {
      const core = snapshot.bodies[id]!.filter((b) => !managed(b));
      if (
        core.length !== 2 ||
        core[0].type !== 'heading_2' ||
        blockText(core[0]) !== 'Captured code' ||
        core[1].type !== 'code' ||
        core.some((b) => b.has_children)
      )
        throw new Error(`Older Attempt contains notes or unsupported content: ${id}`);
    }
  }

  async function checkPopulation(final: boolean) {
    const pages = await queryPages(notion, snapshot.manifest.attempts.dataSourceId);
    const ids = new Set(pages.map((p) => p.id));
    if (
      ids.size !== pages.length ||
      pages.some((p) => !originals.has(p.id) || (final && trash.has(p.id))) ||
      snapshot.attempts.some((p) => !trash.has(p.id) && !ids.has(p.id))
    )
      throw new Error('Attempt population changed since approved backup; cleanup stopped.');
    for (const page of pages) assertPage(page, originals.get(page.id));
    const problems = await queryPages(notion, snapshot.manifest.problems.dataSourceId);
    if (problems.length !== snapshot.problems.length)
      throw new Error('Problem population changed.');
    for (const problem of problems) {
      const original = snapshot.problems.find((p) => p.id === problem.id);
      if (!original) throw new Error('Unexpected Problem during cleanup.');
      const normalize = (props: any, expected: boolean) =>
        Object.fromEntries(
          Object.entries(props)
            .filter(([name]) => name !== 'Grind Open' && name !== 'Solution')
            .map(([name, value]) => {
              const property: any = structuredClone(value);
              if (property.type === 'relation') {
                if (name !== 'Attempts' && property.relation.some((r: any) => trash.has(r.id)))
                  throw new Error(
                    `A noncanonical relation references an older Attempt: ${problem.id}`,
                  );
                property.relation = property.relation
                  .filter((r: any) => !expected || name !== 'Attempts' || ids.has(r.id))
                  .sort((a: any, b: any) => a.id.localeCompare(b.id));
              }
              return [name, property];
            }),
        );
      if (!same(normalize(problem.properties, false), normalize(original.properties, true)))
        throw new Error(`Problem data changed during cleanup: ${problem.id}`);
    }
    return pages.length;
  }

  async function checkKeeper(group: (typeof groups)[number], complete = false) {
    const page = await notion.pages.retrieve({ page_id: group.keepPageId });
    assertPage(page, originals.get(group.keepPageId));
    if (!active(page)) throw new Error('Retained Attempt is in Trash.');
    const blocks = await tree(notion, group.keepPageId);
    if (
      !same(
        shape(blocks.filter((b) => !managed(b))),
        shape(snapshot.bodies[group.keepPageId]!.filter((b) => !managed(b))),
      )
    )
      throw new Error('Retained Attempt body changed; cleanup stopped.');
    const state = receiptsIn(blocks, group.receipts);
    if (complete && state.values.size !== group.receipts.length)
      throw new Error('Receipt read-back incomplete; no further pages will be trashed.');
    return state;
  }

  async function checkOlder(id: string) {
    const page = await notion.pages.retrieve({ page_id: id });
    assertPage(page, originals.get(id));
    if (active(page) && !same(shape(await tree(notion, id)), shape(snapshot.bodies[id]!)))
      throw new Error(`Older Attempt body changed since approved backup: ${id}`);
    return page;
  }

  // Preflight every target before any write. Existing receipt-only progress is safe to resume.
  await checkPopulation(false);
  for (const group of groups) {
    await checkKeeper(group);
    for (const id of group.trashPageIds) await checkOlder(id);
  }
  // Preserve all historical event IDs before starting any removal.
  for (const group of groups) {
    const { container, values } = await checkKeeper(group);
    const missing = group.receipts.filter((r) => !values.has(r.clientEventId));
    if (missing.length) {
      const children = missing.map(receiptBlock);
      await notion.blocks.children.append(
        container
          ? {
              block_id: container.id,
              children,
            }
          : {
              block_id: group.keepPageId,
              children: [
                {
                  object: 'block',
                  type: 'toggle',
                  toggle: {
                    rich_text: richTextChunks(RECEIPTS_LABEL),
                    children,
                  },
                },
              ],
            },
      );
    }
    await checkKeeper(group, true);
  }
  await checkPopulation(false);
  let newlyTrashed = 0;
  for (const group of groups) {
    for (const id of group.trashPageIds) {
      await checkKeeper(group, true);
      const before = await checkOlder(id);
      if (active(before)) {
        await notion.pages.update({ page_id: id, in_trash: true });
        newlyTrashed++;
      }
      const after = await notion.pages.retrieve({ page_id: id });
      assertPage(after, originals.get(id));
      if (active(after)) throw new Error(`Trash read-back failed: ${id}`);
    }
  }
  const retained = await checkPopulation(true);
  for (const group of groups) await checkKeeper(group, true);
  return { newlyTrashed, totalTrashed: trash.size, retained };
}
