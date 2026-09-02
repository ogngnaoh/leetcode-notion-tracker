import type { Client } from '@notionhq/client';
import { isFullPage } from '@notionhq/client';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { NotionManifest } from '../shared/contract.js';
import { parseStoredAttempt } from '../bridge/notion-repository.js';
import {
  blockText,
  listBlocks,
  RECEIPTS_LABEL,
  ReceiptSchema,
  type Receipt,
  compareAttemptPages,
} from '../bridge/latest-attempt.js';

export const GRIND_OPEN_FORMULA =
  'lets(grind, prop("Grind Attempt"), attempts, prop("Attempts").concat(grind).filter(not(empty(current.prop("Attempted At")))), newest, attempts.map(timestamp(current.prop("Attempted At"))).max(), candidates, attempts.filter(timestamp(current.prop("Attempted At")) == newest), created, candidates.map(timestamp(current.prop("Created Time"))).max(), latestId, candidates.filter(timestamp(current.prop("Created Time")) == created).map(current.id()).sort().first(), attempts.filter(current.id() == latestId).unique().slice(0, 1))';

export function planLatestAttempts(
  problems: any[],
  attempts: any[],
  bodies: Record<string, any[]>,
) {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const aliasLinks: Array<{ problemPageId: string; attemptPageId: string }> = [];
  const groups: Array<{
    problemKey: string;
    problemPageId: string;
    title: string;
    keepPageId: string;
    keepAttemptedAt: string;
    trashPageIds: string[];
    receipts: Receipt[];
  }> = [];
  const text = (property: any) =>
    (property?.rich_text ?? property?.title ?? [])
      .map((r: any) => r.plain_text ?? r.text?.content ?? '')
      .join('');
  const problemById = new Map(problems.map((p) => [p.id, p]));
  for (const problem of problems) {
    const key = text(problem.properties['External Key']);
    if (!key) warnings.push(`Problem without key left untouched: ${problem.id}`);
  }
  const attemptsByKey = new Map<
    string,
    Array<{ page: any; record: ReturnType<typeof parseStoredAttempt>; receipt: Receipt }>
  >();
  const eventIds = new Set<string>();
  for (const page of attempts) {
    try {
      const record = parseStoredAttempt(page);
      const clientEventId = z.string().uuid().parse(text(page.properties['Client Event ID']));
      if (eventIds.has(clientEventId)) blockers.push(`Duplicate Client Event ID on ${page.id}`);
      eventIds.add(clientEventId);
      if (page.properties['Extension Managed']?.checkbox !== true)
        blockers.push(`Unmanaged Attempt: ${page.id}`);
      const problem = problemById.get(record.problemPageId);
      if (
        !problem ||
        text(problem.properties['External Key']) !== record.problemKey ||
        page.properties.Problem?.relation?.length !== 1 ||
        page.properties.Problem?.has_more
      ) {
        blockers.push(`Attempt relation/key mismatch: ${page.id}`);
      }
      const body = bodies[page.id];
      if (
        !body ||
        body.filter(
          (b, i) =>
            b.type === 'heading_2' &&
            blockText(b) === 'Captured code' &&
            body[i + 1]?.type === 'code' &&
            blockText(body[i + 1]).trim(),
        ).length !== 1
      ) {
        blockers.push(`Missing or ambiguous captured code body: ${page.id}`);
      }
      const list = attemptsByKey.get(record.problemKey) ?? [];
      list.push({
        page,
        record,
        receipt: {
          version: 1,
          clientEventId,
          attemptedAt: record.attemptedAt,
          result: record.result,
          review: record.review,
        },
      });
      attemptsByKey.set(record.problemKey, list);
    } catch {
      blockers.push(`Invalid Attempt idempotency fields: ${page.id}`);
    }
  }
  for (const [problemKey, rows] of attemptsByKey) {
    rows.sort((a, b) => compareAttemptPages(a.page, b.page));
    const kept = rows[0]!;
    if (rows[1] && Date.parse(rows[1].record.attemptedAt) === Date.parse(kept.record.attemptedAt)) {
      const createdA = Date.parse(kept.page.created_time ?? '');
      const createdB = Date.parse(rows[1].page.created_time ?? '');
      const shape = (page: any) =>
        (bodies[page.id] ?? []).map((b) => ({ type: b.type, text: blockText(b) }));
      if (
        (!Number.isFinite(createdA) || !Number.isFinite(createdB) || createdA === createdB) &&
        !isDeepStrictEqual(shape(kept.page), shape(rows[1].page))
      ) {
        blockers.push(
          `Latest Attempts have the same timestamp and differing bodies: ${problemKey}`,
        );
      } else {
        warnings.push(
          `Latest Attempts have the same timestamp; using creation time then stable page ID: ${problemKey}`,
        );
      }
    }
    const problem = problemById.get(kept.record.problemPageId);
    if (rows.some((row) => row.record.problemPageId !== kept.record.problemPageId)) {
      blockers.push(`Attempts for one key reference different Problems: ${problemKey}`);
    }
    for (const alias of problems.filter(
      (p) =>
        p.id !== kept.record.problemPageId && text(p.properties['External Key']) === problemKey,
    )) {
      if (
        alias.properties['Extension Managed']?.checkbox === false &&
        alias.properties['Grind Day']?.select &&
        alias.properties.Attempts?.relation?.length === 0
      ) {
        aliasLinks.push({ problemPageId: alias.id, attemptPageId: kept.page.id });
      } else warnings.push(`Duplicate Problem row left untouched: ${alias.id}`);
    }
    const earliest = Math.min(...rows.map((r) => Date.parse(r.record.attemptedAt)));
    const first = Date.parse(problem?.properties['First Attempt']?.date?.start ?? '');
    if (!Number.isFinite(first) || first > earliest)
      blockers.push(`First Attempt must be preserved/backfilled before cleanup: ${problemKey}`);
    const receipts = new Map(rows.map((r) => [r.receipt.clientEventId, r.receipt]));
    for (const row of rows) {
      const containers = (bodies[row.page.id] ?? []).filter(
        (b) => b.type === 'toggle' && blockText(b) === RECEIPTS_LABEL,
      );
      if (containers.length > 1) blockers.push(`Multiple receipt containers: ${row.page.id}`);
      for (const container of containers) {
        if (!Array.isArray(container.children)) {
          blockers.push(`Incomplete receipt body backup: ${row.page.id}`);
          continue;
        }
        for (const block of container.children) {
          try {
            const receipt = ReceiptSchema.parse(JSON.parse(blockText(block)));
            if (receipt.pending)
              blockers.push(`Unfinished capture must be recovered before cleanup: ${row.page.id}`);
            const existing = receipts.get(receipt.clientEventId);
            if (existing && !isDeepStrictEqual(existing, receipt))
              blockers.push(`Conflicting receipt: ${row.page.id}`);
            receipts.set(receipt.clientEventId, receipt);
          } catch {
            blockers.push(`Invalid managed receipt: ${row.page.id}`);
          }
        }
      }
    }
    groups.push({
      problemKey,
      problemPageId: kept.record.problemPageId,
      title: text(problem?.properties.Problem) || problemKey,
      keepPageId: kept.page.id,
      keepAttemptedAt: kept.record.attemptedAt,
      trashPageIds: rows.slice(1).map((r) => r.page.id),
      receipts: [...receipts.values()],
    });
  }
  return {
    attemptCount: attempts.length,
    problemCount: groups.length,
    trashCount: groups.reduce((sum, group) => sum + group.trashPageIds.length, 0),
    groups,
    blockers,
    warnings,
    aliasLinks,
  };
}

export async function queryPages(notion: Client, dataSourceId: string): Promise<any[]> {
  const pages: any[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    if (response.results.some((p) => !isFullPage(p)))
      throw new Error('Partial Notion page in inventory.');
    pages.push(...response.results);
    if (response.has_more && !response.next_cursor)
      throw new Error('Incomplete Notion page pagination.');
    cursor = response.next_cursor ?? undefined;
  } while (cursor);
  for (const page of pages) {
    for (const property of Object.values(page.properties) as any[]) {
      if (!property.has_more) continue;
      if (property.type !== 'relation')
        throw new Error('Unsupported truncated property in backup.');
      const relations: any[] = [];
      let next: string | undefined;
      do {
        const response: any = await notion.pages.properties.retrieve({
          page_id: page.id,
          property_id: property.id,
          ...(next ? { start_cursor: next } : {}),
        });
        if (response.object !== 'list' || !Array.isArray(response.results))
          throw new Error('Incomplete relation backup.');
        relations.push(...response.results.map((item: any) => item.relation));
        if (response.has_more && !response.next_cursor)
          throw new Error('Incomplete relation pagination.');
        next = response.next_cursor ?? undefined;
      } while (next);
      property.relation = relations;
      property.has_more = false;
    }
  }
  return pages;
}

export async function inventoryLatestAttempts(notion: Client, manifest: NotionManifest) {
  if (manifest.version !== 4) throw new Error('Latest-attempt maintenance requires a v4 manifest.');
  const [problemsSource, attemptsSource, problems, attempts] = await Promise.all([
    notion.dataSources.retrieve({ data_source_id: manifest.problems.dataSourceId }),
    notion.dataSources.retrieve({ data_source_id: manifest.attempts.dataSourceId }),
    queryPages(notion, manifest.problems.dataSourceId),
    queryPages(notion, manifest.attempts.dataSourceId),
  ]);
  async function tree(id: string): Promise<any[]> {
    const blocks = await listBlocks(notion, id);
    for (const block of blocks) if (block.has_children) block.children = await tree(block.id);
    return blocks;
  }
  const bodies: Record<string, any[]> = {};
  let next = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (next < attempts.length) {
        const page = attempts[next++];
        bodies[page.id] = await tree(page.id);
      }
    }),
  );
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    manifest,
    problemsSource,
    attemptsSource,
    problems,
    attempts,
    bodies,
    plan: planLatestAttempts(problems, attempts, bodies),
  };
}

export async function updateGrindLink(notion: Client, dataSourceId: string, backedUpSource: any) {
  const before: any = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  if (!isDeepStrictEqual(before.properties, backedUpSource.properties))
    throw new Error('Schema changed since backup; run a fresh inventory.');
  const formulaName = before.properties.Solution ? 'Solution' : 'Grind Open';
  const property = before.properties[formulaName];
  if (
    property?.type !== 'formula' ||
    before.properties.Attempts?.type !== 'relation' ||
    before.properties.URL?.type !== 'url'
  ) {
    throw new Error(
      'Expected the existing Solution (or legacy Grind Open) formula, Attempts relation and URL.',
    );
  }
  const target = before.properties.Attempts.relation?.data_source_id;
  if (!target) throw new Error('Attempts relation target is missing.');
  const alias = before.properties['Grind Attempt'];
  if (
    alias &&
    (alias.type !== 'relation' ||
      alias.relation.data_source_id !== target ||
      alias.relation.type !== 'single_property')
  ) {
    throw new Error('Existing Grind Attempt property has an unexpected relation target or type.');
  }
  // Notion resolves formula references against the already-persisted schema.
  if (!alias) {
    await notion.dataSources.update({
      data_source_id: dataSourceId,
      properties: {
        'Grind Attempt': { relation: { data_source_id: target, single_property: {} } },
      },
    });
    const intermediate: any = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
    if (intermediate.properties['Grind Attempt']?.relation?.data_source_id !== target) {
      throw new Error('Grind Attempt relation was not persisted before formula update.');
    }
  }
  if (property.formula.expression !== GRIND_OPEN_FORMULA) {
    try {
      await notion.dataSources.update({
        data_source_id: dataSourceId,
        properties: { [property.id]: { formula: { expression: GRIND_OPEN_FORMULA } } },
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'validation_error') {
        throw new Error(
          'Notion rejected the formula through its API. Paste GRIND_OPEN_FORMULA from ' +
            `src/notion/latest-attempt-maintenance.ts into the existing ${formulaName} formula editor, ` +
            'then rerun with a fresh backup. The added Grind Attempt relation may remain; no pages were removed.',
        );
      }
      throw error;
    }
  }
  const after: any = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const expected = structuredClone(before.properties);
  expected[formulaName].formula.expression = GRIND_OPEN_FORMULA;
  if (!alias) {
    const added = after.properties['Grind Attempt'];
    if (
      added?.type !== 'relation' ||
      added.relation?.data_source_id !== target ||
      added.relation?.type !== 'single_property'
    ) {
      throw new Error('Grind Attempt relation read-back failed.');
    }
    expected['Grind Attempt'] = added;
  }
  if (!isDeepStrictEqual(after.properties, expected))
    throw new Error('Grind formula read-back differs from the expected schema; retain the backup.');
}

export async function updateGrindAliasLinks(
  notion: Client,
  snapshot: Awaited<ReturnType<typeof inventoryLatestAttempts>>,
) {
  const unchanged = (page: any) =>
    Object.fromEntries(
      Object.entries(page.properties).filter(
        ([name]) => name !== 'Grind Open' && name !== 'Solution' && name !== 'Grind Attempt',
      ),
    );
  for (const link of snapshot.plan.aliasLinks) {
    const original = snapshot.problems.find((p) => p.id === link.problemPageId);
    const before: any = await notion.pages.retrieve({ page_id: link.problemPageId });
    if (!isDeepStrictEqual(unchanged(before), unchanged(original)))
      throw new Error('Grind row changed since backup; refusing to overwrite.');
    const relation = before.properties['Grind Attempt']?.relation;
    if (
      !Array.isArray(relation) ||
      (relation.length && (relation.length !== 1 || relation[0].id !== link.attemptPageId))
    ) {
      throw new Error('Grind row already has a different solution link.');
    }
    if (relation.length) continue;
    await notion.pages.update({
      page_id: link.problemPageId,
      properties: { 'Grind Attempt': { relation: [{ id: link.attemptPageId }] } },
    });
    const after: any = await notion.pages.retrieve({ page_id: link.problemPageId });
    if (
      !isDeepStrictEqual(unchanged(after), unchanged(original)) ||
      after.properties['Grind Attempt']?.relation?.length !== 1 ||
      after.properties['Grind Attempt'].relation[0].id !== link.attemptPageId
    )
      throw new Error('Grind alias link verification failed.');
  }
}
