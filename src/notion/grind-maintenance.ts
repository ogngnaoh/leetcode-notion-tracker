import type { Client } from '@notionhq/client';
import { z } from 'zod';

const EntrySchema = z
  .object({
    slot: z.string().regex(/^day-[1-6]-\d{2}$/),
    day: z.number().int().min(1).max(6),
    block: z.enum(['A', 'B', 'C']),
    order: z.number().int().min(1).max(20),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: z.string().min(1).max(300),
    number: z.number().int().positive(),
  })
  .strict();
export type GrindEntry = z.infer<typeof EntrySchema>;
export function parseCurriculum(value: unknown) {
  const result = z
    .object({
      version: z.literal(1),
      source: z.string(),
      entries: z.array(EntrySchema).length(120),
    })
    .strict()
    .parse(value);
  const slots = new Set<string>();
  for (const e of result.entries) {
    if (
      e.slot !== `day-${e.day}-${String(e.order).padStart(2, '0')}` ||
      slots.has(e.slot) ||
      e.block !== (e.order <= 7 ? 'A' : e.order <= 14 ? 'B' : 'C')
    ) {
      throw new Error(
        'Curriculum must contain each of the 120 day/order slots exactly once, in 7/7/6 blocks.',
      );
    }
    slots.add(e.slot);
  }
  return result;
}

export const textValue = (items: any): string =>
  Array.isArray(items) ? items.map((x) => x.plain_text ?? x.text?.content ?? '').join('') : '';
export const isTrashed = (page: any): boolean =>
  page.in_trash === true || page.archived === true || page.is_archived === true;
const text = (content: string) => [{ type: 'text' as const, text: { content } }];
export function propertiesFor(e: GrindEntry): Record<string, any> {
  return {
    Problem: { title: text(e.title) },
    Number: { number: e.number },
    URL: { url: `https://leetcode.com/problems/${e.slug}/` },
    Slug: { rich_text: text(e.slug) },
    'External Key': { rich_text: text(`leetcode:${e.slug}`) },
    'Grind Day': { select: { name: `Day ${e.day}` } },
    'Grind Block': { select: { name: e.block } },
    'Grind Order': { number: e.order },
  };
}
const valueOf = (p: any): unknown => {
  if (!p) return undefined;
  if ('title' in p) return textValue(p.title);
  if ('rich_text' in p) return textValue(p.rich_text);
  if ('select' in p) return p.select?.name ?? null;
  if ('number' in p) return p.number;
  return p.url;
};
export function curriculumValues(page: any) {
  return Object.fromEntries(
    [
      'Problem',
      'Number',
      'URL',
      'Slug',
      'External Key',
      'Grind Day',
      'Grind Block',
      'Grind Order',
    ].map((k) => [k, valueOf(page.properties?.[k])]),
  );
}
export interface GrindBindings {
  dataSourceId: string;
  pages: Record<string, string>;
}
export interface GrindAction {
  slot: string;
  pageId: string;
  restore: boolean;
  properties: Record<string, any>;
  before: any;
}
export interface GrindPlan {
  actions: GrindAction[];
  blockers: string[];
  healthy: number;
  expected: number;
}
export function planGrind(
  entries: GrindEntry[],
  bindings: GrindBindings,
  active: any[],
  recovered: any[],
): GrindPlan {
  const plan: GrindPlan = { actions: [], blockers: [], healthy: 0, expected: entries.length };
  const allowed = new Set(Object.values(bindings.pages));
  if (allowed.size !== entries.length || Object.keys(bindings.pages).length !== entries.length) {
    plan.blockers.push('Bindings must contain one distinct original page ID per curriculum slot.');
  }
  for (const p of active)
    if (!allowed.has(p.id) && p.properties?.['Grind Day']?.select)
      plan.blockers.push(`Unexpected scheduled page ${p.id}; inspect it before repairing.`);
  for (const e of entries) {
    const pageId = bindings.pages[e.slot];
    const page = [...active, ...recovered].find((p) => p.id === pageId);
    if (!page) {
      plan.blockers.push(
        `${e.slot}: original page ${pageId ?? '(unbound)'} unavailable; check access or Trash before replacing.`,
      );
      continue;
    }
    if (!page.properties || page.parent?.data_source_id !== bindings.dataSourceId) {
      plan.blockers.push(`${e.slot}: original page moved or returned incomplete data.`);
      continue;
    }
    const desired = propertiesFor(e);
    const changes = Object.fromEntries(
      Object.entries(desired).filter(([k, v]) => valueOf(v) !== valueOf(page.properties[k])),
    );
    if (isTrashed(page) || Object.keys(changes).length)
      plan.actions.push({
        slot: e.slot,
        pageId: page.id,
        restore: isTrashed(page),
        properties: changes,
        before: page,
      });
    else plan.healthy++;
  }
  return plan;
}

export async function repairGrind(
  notion: Client,
  plan: GrindPlan,
  backup: () => Promise<void>,
): Promise<void> {
  if (plan.blockers.length) throw new Error('Resolve Grind blockers before repair.');
  if (!plan.actions.length) return;
  await backup();
  for (const action of plan.actions) {
    const current: any = await notion.pages.retrieve({ page_id: action.pageId });
    if (
      current.parent?.data_source_id !== action.before.parent?.data_source_id ||
      isTrashed(current) !== action.restore ||
      JSON.stringify(curriculumValues(current)) !== JSON.stringify(curriculumValues(action.before))
    )
      throw new Error(`${action.slot}: curriculum changed since check; run check again.`);
    // Absolute assignments to known page IDs are safe to reconcile after an interrupted response.
    // Never resend automatically and never write progress, relations, or page bodies.
    await notion.pages.update({
      page_id: action.pageId,
      ...(action.restore ? { in_trash: false } : {}),
      ...(Object.keys(action.properties).length ? { properties: action.properties } : {}),
    });
    const after: any = await notion.pages.retrieve({ page_id: action.pageId });
    if (
      isTrashed(after) ||
      after.parent?.data_source_id !== action.before.parent?.data_source_id ||
      Object.entries(action.properties).some(
        ([k, v]) => valueOf(after.properties?.[k]) !== valueOf(v),
      )
    )
      throw new Error(`${action.slot}: repair verification failed; run check again.`);
  }
}
