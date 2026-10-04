import 'dotenv/config';
import { Client, LogLevel } from '@notionhq/client';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { z } from 'zod';
import { readManifest } from './io.js';
import {
  parseCurriculum,
  planGrind,
  repairGrind,
  curriculumValues,
  propertiesFor,
  isTrashed,
} from './grind-maintenance.js';
import { dailyViewPatch, guardDrift } from './grind-guards.js';
import { replaceUnavailable, type ReplacementJournal } from './grind-replacement.js';
import { textValue } from './grind-maintenance.js';

const StateSchema = z
  .object({
    version: z.literal(1),
    curriculumHash: z.string().regex(/^[a-f0-9]{64}$/),
    dataSourceId: z.uuid(),
    databaseId: z.uuid(),
    pages: z.record(z.string(), z.uuid()),
    home: z.uuid(),
    days: z
      .array(
        z
          .object({
            pageId: z.uuid(),
            databaseId: z.uuid(),
            viewId: z.uuid(),
            day: z.number().int().min(1).max(6),
          })
          .strict(),
      )
      .length(6),
  })
  .strict();
type State = z.infer<typeof StateSchema>;
const build = resolve('build');
const statePath = resolve(build, 'grind-state.json');
const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Restrict permissions at creation, including the temporary file. Never put credentials in a snapshot.
async function save(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  const file = await open(temp, 'wx', 0o600);
  try {
    await file.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }
  await rename(temp, path);
}
async function all<T>(
  get: (
    cursor?: string,
  ) => Promise<{ results: T[]; next_cursor: string | null; has_more: boolean }>,
) {
  const result: T[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await get(cursor);
    result.push(...page.results);
    if (page.has_more && (!page.next_cursor || seen.has(page.next_cursor)))
      throw new Error('Incomplete Notion pagination.');
    cursor = page.has_more ? page.next_cursor! : undefined;
    if (cursor) seen.add(cursor);
  } while (cursor);
  return result;
}

async function main() {
  const [command = 'check', ...args] = process.argv.slice(2);
  const flags = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    const value = args[i + 1];
    if (!key?.startsWith('--') || !value || value.startsWith('--') || flags.has(key))
      throw new Error('Use named flags with values; see docs/GRIND_RECOVERY.md.');
    flags.set(key, value);
  }
  if (
    !['check', 'repair', 'init', 'replace'].includes(command) ||
    [...flags.keys()].some(
      (k) =>
        !(
          command === 'init'
            ? ['--backup', '--home', '--days']
            : command === 'replace'
              ? ['--slot', '--confirm-unavailable', '--resume-page']
              : []
        ).includes(k),
    )
  )
    throw new Error(
      'Usage: notion:grind:check | notion:grind:repair | notion:grind:init -- --backup PATH --home ID --days ID,ID,ID,ID,ID,ID',
    );
  const curriculum = parseCurriculum(await readJson('config/grind-curriculum.json'));
  const manifest = await readManifest(
    process.env.NOTION_MANIFEST_PATH ?? 'build/notion-manifest.json',
  );
  if (manifest.version !== 4 || !process.env.NOTION_TOKEN)
    throw new Error('A v4 manifest and local NOTION_TOKEN are required.');
  const notion = new Client({
    auth: process.env.NOTION_TOKEN,
    notionVersion: manifest.notionApiVersion,
    logLevel: LogLevel.ERROR,
    logger: () => {},
    retry: false,
    timeoutMs: 20_000,
  });
  // Pace all REST operations; a failure never causes an automatic mutation retry.
  const paced = new Proxy(notion, {
    get(target, key) {
      const endpoint = Reflect.get(target, key);
      if (!['pages', 'dataSources', 'databases', 'views', 'blocks'].includes(String(key)))
        return endpoint;
      const wrap = (object: any): any =>
        new Proxy(object, {
          get(obj, k) {
            const v = Reflect.get(obj, k);
            return typeof v === 'function'
              ? async (...a: unknown[]) => {
                  await new Promise((r) => setTimeout(r, 350));
                  return v.apply(obj, a);
                }
              : v && typeof v === 'object'
                ? wrap(v)
                : v;
          },
        });
      return wrap(endpoint);
    },
  });
  await mkdir(build, { recursive: true });
  let lock;
  try {
    lock = await open(resolve(build, 'grind-maintenance.lock'), 'wx', 0o600);
  } catch {
    throw new Error(
      'Another Grind command may be running. If interrupted, verify it stopped before removing build/grind-maintenance.lock.',
    );
  }
  try {
    const source: any = await paced.dataSources.retrieve({
      data_source_id: manifest.problems.dataSourceId,
    });
    if (
      source.parent?.database_id !== manifest.problems.databaseId ||
      source.in_trash ||
      source.archived
    )
      throw new Error('Problems data-source binding is not active.');
    const required = {
      Problem: 'title',
      Number: 'number',
      URL: 'url',
      Slug: 'rich_text',
      'External Key': 'rich_text',
      'Grind Day': 'select',
      'Grind Block': 'select',
      'Grind Order': 'number',
      'Grind Done': 'checkbox',
    };
    for (const [name, type] of Object.entries(required))
      if (source.properties?.[name]?.type !== type)
        throw new Error(`Grind schema mismatch: ${name}.`);
    const ids: Record<string, string> = Object.fromEntries(
      Object.entries(source.properties).map(([k, v]: [string, any]) => [k, v.id]),
    );
    const active: any[] = await all((cursor) =>
      paced.dataSources.query({
        data_source_id: manifest.problems.dataSourceId,
        ...(cursor ? { start_cursor: cursor } : {}),
        page_size: 100,
      }),
    );
    if (command === 'init') {
      try {
        await readFile(statePath);
        throw new Error('Grind state already exists; refusing to replace the recovery baseline.');
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (!flags.get('--backup') || !flags.get('--home') || !flags.get('--days'))
        throw new Error('Init requires the verified backup and seven page IDs.');
      const backup = await readJson(flags.get('--backup')!);
      if (
        backup.manifest?.problems?.dataSourceId !== manifest.problems.dataSourceId ||
        backup.manifest?.problems?.databaseId !== manifest.problems.databaseId
      )
        throw new Error('Backup belongs to a different tracker.');
      const pages: Record<string, string> = {};
      for (const e of curriculum.entries) {
        const matches = (backup.problems ?? []).filter(
          (p: any) =>
            JSON.stringify(curriculumValues(p)) ===
            JSON.stringify(curriculumValues({ properties: propertiesFor(e) })),
        );
        if (matches.length !== 1)
          throw new Error(`Backup has no unique exact match for ${e.slot}.`);
        pages[e.slot] = matches[0].id;
      }
      const home = z.uuid().parse(flags.get('--home'));
      const dayIds = z.array(z.uuid()).length(6).parse(flags.get('--days')!.split(','));
      if (new Set([home, ...dayIds]).size !== 7)
        throw new Error('Expected seven different practice pages.');
      const homePage: any = await paced.pages.retrieve({ page_id: home });
      if (isTrashed(homePage)) throw new Error('Grind home is in Trash.');
      const days: State['days'] = [];
      for (let i = 0; i < dayIds.length; i++) {
        const pageId = dayIds[i]!;
        const p: any = await paced.pages.retrieve({ page_id: pageId });
        if (p.parent?.page_id !== home || isTrashed(p))
          throw new Error('Day page is not an active child of Grind home.');
        const children: any[] = await all((cursor) =>
          paced.blocks.children.list({
            block_id: pageId,
            ...(cursor ? { start_cursor: cursor } : {}),
            page_size: 100,
          }),
        );
        const candidates = children.filter((x) => x.type === 'child_database');
        if (candidates.length !== 1)
          throw new Error(`Day ${i + 1}: expected one linked database block.`);
        const databaseId = candidates[0].id;
        const refs = await all((cursor) =>
          paced.views.list({
            database_id: databaseId,
            ...(cursor ? { start_cursor: cursor } : {}),
            page_size: 100,
          }),
        );
        const views = [];
        for (const ref of refs) views.push(await paced.views.retrieve({ view_id: ref.id }));
        const matches = views.filter(
          (v: any) =>
            v.data_source_id === manifest.problems.dataSourceId &&
            v.name === 'Questions' &&
            v.type === 'table',
        );
        if (matches.length !== 1) throw new Error(`Day ${i + 1}: expected one Questions table.`);
        days.push({ pageId, databaseId, viewId: matches[0]!.id, day: i + 1 });
      }
      const state = StateSchema.parse({
        version: 1,
        curriculumHash: hash(curriculum),
        dataSourceId: manifest.problems.dataSourceId,
        databaseId: manifest.problems.databaseId,
        pages,
        home,
        days,
      });
      await save(statePath, state);
      console.log(
        'Saved immutable curriculum bindings to build/grind-state.json. Back up this token-free file. No Notion changes made.',
      );
      return;
    }
    const state = StateSchema.parse(await readJson(statePath));
    if (
      state.curriculumHash !== hash(curriculum) ||
      state.dataSourceId !== manifest.problems.dataSourceId ||
      state.databaseId !== manifest.problems.databaseId ||
      new Set(state.days.map((d) => d.day)).size !== 6 ||
      new Set(Object.values(state.pages)).size !== 120
    )
      throw new Error('Grind state does not match this curriculum/tracker.');
    if (command === 'replace') {
      const entry = curriculum.entries.find((e) => e.slot === flags.get('--slot'));
      if (!entry || flags.get('--confirm-unavailable') !== 'yes')
        throw new Error(
          'Replacement requires --slot day-N-NN --confirm-unavailable yes. Confirm the original is permanently gone, not merely unshared.',
        );
      const journalPath = resolve(build, `grind-replacement-${entry.slot}.json`);
      let journal: ReplacementJournal | null = null;
      try {
        journal = await readJson(journalPath);
      } catch (e: any) {
        if (e.code !== 'ENOENT') throw e;
      }
      const originalId = journal?.originalId ?? state.pages[entry.slot]!;
      if (
        journal &&
        (journal.version !== 1 ||
          journal.slot !== entry.slot ||
          journal.dataSourceId !== state.dataSourceId ||
          !z.uuid().safeParse(journal.intent).success ||
          !['pending', 'created', 'bound'].includes(journal.status) ||
          (state.pages[entry.slot] !== journal.originalId &&
            state.pages[entry.slot] !== journal.pageId))
      )
        throw new Error('Invalid replacement journal/binding.');
      // Existing active checklist candidates require inspection, not automatic deduplication.
      if (
        active.some(
          (p) =>
            p.id !== journal?.pageId &&
            p.properties?.['Grind Day']?.select &&
            (textValue(p.properties.Slug?.rich_text) === entry.slug ||
              textValue(p.properties['External Key']?.rich_text) === `leetcode:${entry.slug}`),
        )
      )
        throw new Error(
          'An active scheduled candidate already exists; inspect it before replacing.',
        );
      const resume = flags.get('--resume-page');
      if (resume) {
        if (!journal || journal.status !== 'pending')
          throw new Error('Resume-page requires an unresolved replacement journal.');
        z.uuid().parse(resume);
        const children: any[] = await all((cursor) =>
          paced.blocks.children.list({
            block_id: resume,
            ...(cursor ? { start_cursor: cursor } : {}),
            page_size: 100,
          }),
        );
        if (
          !children.some(
            (b) =>
              textValue(b.paragraph?.rich_text) === `Grind replacement receipt: ${journal!.intent}`,
          )
        )
          throw new Error('Replacement receipt does not match the unresolved operation.');
        journal = { ...journal, status: 'created', pageId: resume };
        await save(journalPath, journal);
      }
      const attempts: any[] = await all((cursor) =>
        paced.dataSources.query({
          data_source_id: manifest.attempts.dataSourceId,
          filter: { property: 'Problem Key', rich_text: { equals: `leetcode:${entry.slug}` } },
          ...(cursor ? { start_cursor: cursor } : {}),
          page_size: 100,
        }),
      );
      attempts.sort(
        (a, b) =>
          String(b.properties['Attempted At']?.date?.start ?? '').localeCompare(
            String(a.properties['Attempted At']?.date?.start ?? ''),
          ) ||
          String(b.created_time).localeCompare(String(a.created_time)) ||
          a.id.localeCompare(b.id),
      );
      const solutionId = attempts[0]?.id;
      if (
        solutionId &&
        (source.properties['Grind Attempt']?.type !== 'relation' ||
          source.properties['Grind Attempt'].relation?.data_source_id !==
            manifest.attempts.dataSourceId)
      )
        throw new Error(
          'Cannot preserve the solution link: Grind Attempt relation is missing or incompatible.',
        );
      await save(resolve(build, `grind-before-replacement-${Date.now()}-${randomUUID()}.json`), {
        state,
        entry,
        active,
      });
      await replaceUnavailable(
        paced,
        entry,
        originalId,
        state.dataSourceId,
        journal,
        (j) => save(journalPath, j),
        async (id) => {
          state.pages[entry.slot] = id;
          await save(statePath, state);
        },
        solutionId,
      );
      console.log(
        'Replacement verified and bound. It starts unchecked; saved Attempts are unchanged. Run notion:grind:check.',
      );
      return;
    }
    const recovered: any[] = [];
    for (const id of Object.values(state.pages))
      if (!active.some((p) => p.id === id)) {
        try {
          recovered.push(await paced.pages.retrieve({ page_id: id }));
        } catch (e: any) {
          if (e.code !== 'object_not_found') throw e;
        }
      }
    const plan = planGrind(curriculum.entries, state, active, recovered);
    const guards: { kind: 'page' | 'database' | 'view'; id: string; before: any; patch: any }[] =
      [];
    for (const id of [state.home, ...state.days.map((d) => d.pageId)]) {
      const p: any = await paced.pages.retrieve({ page_id: id });
      if (isTrashed(p)) plan.blockers.push(`Practice page ${id} is in Trash; restore it first.`);
      else if (!p.is_locked)
        guards.push({ kind: 'page', id, before: p, patch: { is_locked: true } });
    }
    for (const id of [state.databaseId, ...state.days.map((d) => d.databaseId)]) {
      const db: any = await paced.databases.retrieve({ database_id: id });
      if (isTrashed(db)) plan.blockers.push(`Database view ${id} is in Trash; restore it first.`);
      else if (!db.is_locked)
        guards.push({ kind: 'database', id, before: db, patch: { is_locked: true } });
    }
    for (const d of state.days) {
      const view: any = await paced.views.retrieve({ view_id: d.viewId });
      if (
        view.parent?.database_id !== d.databaseId ||
        view.data_source_id !== state.dataSourceId ||
        view.type !== 'table'
      ) {
        plan.blockers.push(`Day ${d.day} view binding changed.`);
        continue;
      }
      const patch = dailyViewPatch(ids, d.day);
      if (guardDrift(view, patch)) guards.push({ kind: 'view', id: d.viewId, before: view, patch });
    }
    console.log(
      `Grind: ${plan.healthy}/${plan.expected} rows match; ${plan.actions.length} row repairs; ${guards.length} protection/view repairs; ${plan.blockers.length} blockers.`,
    );
    for (const a of plan.actions)
      console.log(
        `${a.slot}: ${a.restore ? 'restore original page; ' : ''}${Object.keys(a.properties).join(', ')}`,
      );
    for (const g of guards)
      console.log(
        `${g.kind} ${g.id}: ${g.kind === 'view' ? 'restore daily checklist view' : 'lock'}`,
      );
    for (const b of plan.blockers) console.log(`BLOCKER: ${b}`);
    if (command === 'check') {
      if (plan.actions.length || guards.length || plan.blockers.length) process.exitCode = 2;
      return;
    }
    if (plan.blockers.length)
      throw new Error('Repair stopped before any writes. Resolve the reported blockers.');
    if (!plan.actions.length && !guards.length) {
      console.log('Already healthy. No Notion writes.');
      return;
    }
    const backupPath = resolve(build, `grind-repair-${Date.now()}-${randomUUID()}.json`);
    await save(backupPath, {
      version: 1,
      capturedAt: new Date().toISOString(),
      state,
      plan,
      guards,
      active,
      recovered,
    });
    console.log(`Before-change backup: ${backupPath}`);
    await repairGrind(paced, plan, async () => {});
    // Apply view changes before locking their containers. No page content or reset buttons are rewritten.
    for (const g of [...guards].sort(
      (a, b) => Number(b.kind === 'view') - Number(a.kind === 'view'),
    )) {
      if (g.kind === 'view') {
        const before: any = await paced.views.retrieve({ view_id: g.id });
        if (before.last_edited_time !== g.before.last_edited_time)
          throw new Error('View changed since check; rerun repair.');
        await paced.views.update({ view_id: g.id, ...g.patch });
        if (guardDrift(await paced.views.retrieve({ view_id: g.id }), g.patch))
          throw new Error('View verification failed.');
      } else if (g.kind === 'page') {
        await paced.pages.update({ page_id: g.id, is_locked: true });
        if (!((await paced.pages.retrieve({ page_id: g.id })) as any).is_locked)
          throw new Error('Page lock verification failed.');
      } else {
        await paced.databases.update({ database_id: g.id, is_locked: true });
        if (!((await paced.databases.retrieve({ database_id: g.id })) as any).is_locked)
          throw new Error('Database lock verification failed.');
      }
    }
    console.log(
      'Repair verified. Checkmarks, notes, solutions, Attempts and reset buttons were preserved. Run notion:grind:check to audit again.',
    );
  } finally {
    await lock.close();
    await unlink(resolve(build, 'grind-maintenance.lock'));
  }
}
main().catch((error: unknown) => {
  // SDK errors can contain request details; print only the service error code.
  const e = error as any;
  console.error(
    e?.code
      ? `Grind maintenance stopped (${String(e.code)}). Rerun check; no automatic write retry.`
      : error instanceof Error
        ? error.message
        : 'Grind maintenance failed.',
  );
  process.exitCode = 1;
});
