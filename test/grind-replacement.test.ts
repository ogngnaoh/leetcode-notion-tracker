import { describe, expect, it, vi } from 'vitest';
import { replaceUnavailable } from '../src/notion/grind-replacement.js';
const entry = {
  slot: 'day-1-01',
  day: 1,
  block: 'A' as const,
  order: 1,
  slug: 'two-sum',
  title: 'Two Sum',
  number: 1,
};
describe('explicit replacement of an unavailable Grind row', () => {
  it('refuses to replace an original that is still retrievable', async () => {
    const api: any = {
      pages: { retrieve: async () => ({ id: 'original', in_trash: true }), create: vi.fn() },
    };
    await expect(
      replaceUnavailable(
        api,
        entry,
        'original',
        'source',
        null,
        async () => {},
        async () => {},
      ),
    ).rejects.toThrow('restore');
    expect(api.pages.create).not.toHaveBeenCalled();
  });
  it('journals before creating and refuses another create after a lost response', async () => {
    let journal: any = null;
    const save = vi.fn(async (j) => {
      journal = j;
    });
    const api: any = {
      pages: {
        retrieve: async () => {
          throw { code: 'object_not_found' };
        },
        create: vi.fn(async () => {
          expect(journal.status).toBe('pending');
          throw new Error('lost response');
        }),
      },
    };
    await expect(
      replaceUnavailable(api, entry, 'original', 'source', null, save, async () => {}),
    ).rejects.toThrow('lost response');
    await expect(
      replaceUnavailable(api, entry, 'original', 'source', journal, save, async () => {}),
    ).rejects.toThrow('unresolved');
    expect(api.pages.create).toHaveBeenCalledTimes(1);
  });
  it('does not create when the journal cannot be persisted', async () => {
    const api: any = {
      pages: {
        retrieve: async () => {
          throw { code: 'object_not_found' };
        },
        create: vi.fn(),
      },
    };
    await expect(
      replaceUnavailable(
        api,
        entry,
        'original',
        'source',
        null,
        async () => {
          throw new Error('disk');
        },
        async () => {},
      ),
    ).rejects.toThrow('disk');
    expect(api.pages.create).not.toHaveBeenCalled();
  });
  it('persists the returned ID before rebinding and reuses it if rebinding fails', async () => {
    let journal: any = null;
    let reads = 0;
    const api: any = {
      pages: {
        retrieve: async () => {
          if (reads++ === 0) throw { code: 'object_not_found' };
          return created;
        },
        create: vi.fn(async () => created),
      },
    };
    const created = {
      id: 'new-id',
      parent: { data_source_id: 'source' },
      in_trash: false,
      properties: {},
    };
    // The fixture is filled with the exact creation properties by the mock service.
    api.pages.create.mockImplementation(async (p: any) => {
      created.properties = p.properties;
      return created;
    });
    const save = async (j: any) => {
      journal = structuredClone(j);
    };
    await expect(
      replaceUnavailable(api, entry, 'original', 'source', null, save, async () => {
        throw new Error('rebind failed');
      }),
    ).rejects.toThrow('rebind failed');
    expect(journal.pageId).toBe('new-id');
    const bind = vi.fn(async () => {});
    await replaceUnavailable(api, entry, 'original', 'source', journal, save, bind);
    expect(bind).toHaveBeenCalledWith('new-id');
    expect(api.pages.create).toHaveBeenCalledTimes(1);
  });
});
