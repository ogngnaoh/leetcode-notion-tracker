import { describe, expect, it } from 'vitest';
import type { NotionManifest } from '../src/shared/contract.js';
import {
  NotionVault,
  VAULT_STORAGE_KEYS,
  type VaultStorageArea,
} from '../extension/src/notion-vault.js';

const passphrase = 'four independent vault words';
const manifest: NotionManifest = {
  version: 4,
  notionApiVersion: '2026-03-11',
  createdAt: '2026-09-03T00:00:00.000Z',
  parentPageId: '00000000-0000-4000-8000-000000000001',
  problems: {
    databaseId: '00000000-0000-4000-8000-000000000002',
    dataSourceId: '00000000-0000-4000-8000-000000000003',
  },
  attempts: {
    databaseId: '00000000-0000-4000-8000-000000000004',
    dataSourceId: '00000000-0000-4000-8000-000000000005',
  },
};
const initial = () => ({
  token: 'vault-fixture-token',
  manifest: structuredClone(manifest),
  pending: null as null | { clientEventId: string; code: string },
  goal: 10,
});

function memoryArea(): VaultStorageArea & {
  values: Record<string, unknown>;
  failSet: boolean;
  failRemove: boolean;
  accesses: string[];
} {
  return {
    values: {},
    failSet: false,
    failRemove: false,
    accesses: [],
    async get(keys) {
      const names =
        keys === null ? Object.keys(this.values) : typeof keys === 'string' ? [keys] : keys;
      return structuredClone(
        Object.fromEntries(
          names.filter((key) => key in this.values).map((key) => [key, this.values[key]]),
        ),
      );
    },
    async set(values) {
      if (this.failSet)
        throw new Error('storage failure with deliberately unsafe provider details');
      Object.assign(this.values, structuredClone(values));
    },
    async remove(keys) {
      if (this.failRemove) throw new Error('remove failure');
      for (const key of typeof keys === 'string' ? [keys] : keys) delete this.values[key];
    },
    async setAccessLevel({ accessLevel }) {
      this.accesses.push(accessLevel);
    },
  };
}

function fixture() {
  const local = memoryArea();
  const session = memoryArea();
  const vault = new NotionVault<ReturnType<typeof initial>>({ local, session });
  return { local, session, vault };
}

describe('direct Notion vault', () => {
  it.each(['local', 'session'] as const)(
    'verifies read-back when Chrome sorts %s object keys',
    async (areaName) => {
      const { vault, local, session } = fixture();
      const area = areaName === 'local' ? local : session;
      const set = area.set.bind(area);
      area.set = async (values) => {
        const sorted: Record<string, unknown> = JSON.parse(
          JSON.stringify(values, (_key, value: unknown) => {
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
              const item = value as Record<string, unknown>;
              return Object.fromEntries(
                Object.keys(item)
                  .sort()
                  .map((key) => [key, item[key]]),
              );
            }
            return value;
          }),
        );
        await set(sorted);
      };
      expect(await vault.create(initial(), passphrase)).toMatchObject({ unlocked: true });
      await vault.update((value) => ({ ...value, goal: 22 }));
      await vault.lock();
      await vault.unlock(passphrase);
      expect((await vault.read()).goal).toBe(22);
    },
  );

  it('restricts storage, encrypts token/code locally, and survives retirement but locks after restart', async () => {
    const { vault, local, session } = fixture();
    local.values.dailyReps = { goal: 7 };
    await vault.create(initial(), passphrase);
    await vault.update((value) => ({
      ...value,
      pending: { clientEventId: '00000000-0000-4000-8000-000000000006', code: 'private solution' },
    }));
    expect(local.accesses).toContain('TRUSTED_CONTEXTS');
    expect(session.accesses).toContain('TRUSTED_CONTEXTS');
    for (const serialized of [JSON.stringify(local.values), JSON.stringify(session.values)]) {
      expect(serialized).not.toContain(initial().token);
      expect(serialized).not.toContain('private solution');
      expect(serialized).not.toContain(passphrase);
    }
    const retired = new NotionVault<ReturnType<typeof initial>>({ local, session });
    expect((await retired.read()).pending?.code).toBe('private solution');
    session.values = {};
    const restarted = new NotionVault<ReturnType<typeof initial>>({ local, session });
    expect(await restarted.publicState()).toMatchObject({
      configured: true,
      unlocked: false,
      hasPending: true,
    });
    await expect(restarted.read()).rejects.toMatchObject({ code: 'LOCKED' });
    await restarted.unlock(passphrase);
    expect((await restarted.read()).pending?.code).toBe('private solution');
    expect(local.values.dailyReps).toEqual({ goal: 7 });
  });

  it('wrong passwords and tampered tracker binding preserve stored bytes', async () => {
    const { vault, local } = fixture();
    await vault.create(initial(), passphrase);
    await vault.lock();
    const saved = JSON.stringify(local.values);
    await expect(vault.unlock('a different long passphrase')).rejects.toMatchObject({
      code: 'UNLOCK_FAILED',
    });
    expect(JSON.stringify(local.values)).toBe(saved);
    const root = local.values[VAULT_STORAGE_KEYS.root] as Record<string, unknown>;
    root.binding = 'f'.repeat(64);
    const tampered = JSON.stringify(local.values);
    await expect(vault.unlock(passphrase)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' });
    expect(JSON.stringify(local.values)).toBe(tampered);
  });

  it('changes the passphrase without losing pending work and refuses retargeting', async () => {
    const { vault } = fixture();
    await vault.create(initial(), passphrase);
    await vault.update((value) => ({
      ...value,
      pending: { clientEventId: '00000000-0000-4000-8000-000000000006', code: 'original code' },
    }));
    await vault.changePassphrase(passphrase, 'replacement strong passphrase');
    await vault.lock();
    await expect(vault.unlock(passphrase)).rejects.toMatchObject({ code: 'UNLOCK_FAILED' });
    await vault.unlock('replacement strong passphrase');
    expect((await vault.read()).pending?.code).toBe('original code');
    await expect(
      vault.update((value) => ({
        ...value,
        manifest: { ...value.manifest, parentPageId: '00000000-0000-4000-8000-000000000099' },
      })),
    ).rejects.toMatchObject({ code: 'TRACKER_MISMATCH' });
  });

  it('revokes a grant when session removal fails, including after worker retirement', async () => {
    const { vault, local, session } = fixture();
    await vault.create(initial(), passphrase);
    const generation = vault.generation;
    session.failRemove = true;
    await expect(vault.lock()).rejects.toMatchObject({ code: 'LOCK_FAILED' });
    await expect(vault.assertAccess(generation)).rejects.toMatchObject({ code: 'LOCKED' });
    const retired = new NotionVault<ReturnType<typeof initial>>({ local, session });
    expect(await retired.publicState()).toMatchObject({ unlocked: false, lockFailed: true });
    await expect(retired.read()).rejects.toMatchObject({ code: 'LOCKED' });
    session.failRemove = false;
    await retired.lock();
    expect(await retired.publicState()).toMatchObject({ lockFailed: false });
  });

  it('requires reconciliation before deleting pending recovery and preserves Daily Reps', async () => {
    const { vault, local } = fixture();
    local.values.dailyReps = { goal: 4 };
    await vault.create(initial(), passphrase);
    await vault.update((value) => ({
      ...value,
      pending: {
        clientEventId: '00000000-0000-4000-8000-000000000006',
        code: 'do not discard silently',
      },
    }));
    await expect(vault.disconnect(false)).rejects.toMatchObject({ code: 'CONFIRM_REQUIRED' });
    local.failSet = true;
    await expect(vault.disconnect(true)).rejects.toMatchObject({ code: 'STORAGE_FAILURE' });
    expect(local.values[VAULT_STORAGE_KEYS.root]).toBeDefined();
    local.failSet = false;
    await vault.disconnect(true);
    expect(await vault.publicState()).toMatchObject({
      configured: false,
      reconciliationRequired: true,
    });
    await vault.create(initial(), passphrase);
    expect(await vault.publicState()).toMatchObject({ reconciliationRequired: true });
    await vault.acknowledgeReconciliation();
    expect(await vault.publicState()).toMatchObject({ reconciliationRequired: false });
    expect(local.values.dailyReps).toEqual({ goal: 4 });
  });

  it('serializes aggregate updates and never acknowledges failed persistence', async () => {
    const { vault, local } = fixture();
    await vault.create(initial(), passphrase);
    await Promise.all(
      Array.from({ length: 5 }, () =>
        vault.update((value) => ({ ...value, goal: value.goal + 1 })),
      ),
    );
    expect((await vault.read()).goal).toBe(15);
    local.failSet = true;
    await expect(vault.update((value) => ({ ...value, goal: 99 }))).rejects.toMatchObject({
      code: 'STORAGE_FAILURE',
    });
    local.failSet = false;
    expect((await vault.read()).goal).toBe(15);
  });

  it('authenticates pending presence and content so removing recovery cannot enable another capture', async () => {
    const { vault, local } = fixture();
    await vault.create(initial(), passphrase);
    await vault.update((value) => ({
      ...value,
      pending: {
        clientEventId: '00000000-0000-4000-8000-000000000006',
        code: 'confirmed original',
      },
    }));
    const root = local.values[VAULT_STORAGE_KEYS.root] as Record<string, unknown>;
    root.pending = null;
    await expect(vault.read()).rejects.toMatchObject({ code: 'INVALID_VAULT' });
  });

  it('a grant write finishing after Lock cannot restore unlock or retain a session key', async () => {
    const { vault, session } = fixture();
    await vault.create(initial(), passphrase);
    await vault.lock();
    let notifyStarted!: () => void;
    let releaseWrite!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const set = session.set.bind(session);
    session.set = async (values) => {
      if (VAULT_STORAGE_KEYS.grant in values) {
        notifyStarted();
        await released;
      }
      await set(values);
    };
    const unlocking = vault.unlock(passphrase);
    const rejected = expect(unlocking).rejects.toMatchObject({ code: 'LOCKED' });
    await started;
    const locking = vault.lock();
    releaseWrite();
    await rejected;
    await locking;
    expect(await vault.publicState()).toMatchObject({ unlocked: false, lockFailed: false });
    expect(session.values[VAULT_STORAGE_KEYS.grant]).toBeUndefined();
  });

  it('rewrap preserves encrypted data and pending ciphertext; failed rewrap preserves the old password', async () => {
    const { vault, local } = fixture();
    await vault.create(initial(), passphrase);
    await vault.update((value) => ({
      ...value,
      pending: {
        clientEventId: '00000000-0000-4000-8000-000000000006',
        code: 'unchanged encrypted recovery',
      },
    }));
    const before = structuredClone(local.values[VAULT_STORAGE_KEYS.root]) as Record<
      string,
      unknown
    >;
    local.failSet = true;
    await expect(
      vault.changePassphrase(passphrase, 'not committed new password'),
    ).rejects.toMatchObject({ code: 'STORAGE_FAILURE' });
    local.failSet = false;
    await vault.changePassphrase(passphrase, 'successfully changed password');
    const after = local.values[VAULT_STORAGE_KEYS.root] as Record<string, unknown>;
    expect(after.data).toEqual(before.data);
    expect(after.pending).toEqual(before.pending);
    expect(after.wrappedKey).not.toEqual(before.wrappedKey);
  });

  it('rejects unsupported KDF parameters and oversized writes before changing the root', async () => {
    const { vault, local } = fixture();
    await vault.create(initial(), passphrase);
    const before = structuredClone(local.values[VAULT_STORAGE_KEYS.root]);
    await expect(
      vault.update((value) => ({ ...value, token: 'x'.repeat(4097) })),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect(local.values[VAULT_STORAGE_KEYS.root]).toEqual(before);
    await vault.lock();
    const root = local.values[VAULT_STORAGE_KEYS.root] as Record<string, unknown>;
    (root.kdf as Record<string, unknown>).iterations = 2 ** 40;
    await expect(vault.unlock(passphrase)).rejects.toMatchObject({ code: 'INVALID_VAULT' });
  });

  it('public-state hydration racing Lock returns locked instead of reading a cleared grant', async () => {
    const { vault, local } = fixture();
    await vault.create(initial(), passphrase);
    let notifyStarted!: () => void;
    let releaseRead!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const get = local.get.bind(local);
    let delay = true;
    local.get = async (keys) => {
      if (delay && keys === VAULT_STORAGE_KEYS.revokedGrant) {
        delay = false;
        notifyStarted();
        await released;
      }
      return get(keys);
    };
    const state = vault.publicState();
    await started;
    const lock = vault.lock();
    releaseRead();
    expect(await state).toMatchObject({ unlocked: false });
    await lock;
  });

  it('reports double storage failure honestly, and purges private session records without touching other data', async () => {
    const { vault, local, session } = fixture();
    await vault.create(initial(), passphrase);
    session.values[`${VAULT_STORAGE_KEYS.privatePrefix}review`] = { secretTitle: 'private row' };
    session.values.dailyReps = { goal: 8 };
    local.failSet = true;
    session.failRemove = true;
    await expect(vault.lock()).rejects.toMatchObject({ code: 'LOCK_FAILED' });
    expect(await vault.publicState()).toMatchObject({ unlocked: false, lockFailed: true });
    local.failSet = false;
    session.failRemove = false;
    await vault.lock();
    expect(session.values[`${VAULT_STORAGE_KEYS.privatePrefix}review`]).toBeUndefined();
    expect(session.values.dailyReps).toEqual({ goal: 8 });
    expect(await vault.publicState()).toMatchObject({ lockFailed: false });
  });

  it('Lock as the first event after worker retirement cannot rehydrate authority during initialization', async () => {
    const { vault, local, session } = fixture();
    await vault.create(initial(), passphrase);
    const retired = new NotionVault<ReturnType<typeof initial>>({ local, session });
    expect(await retired.lock()).toMatchObject({ unlocked: false, lockFailed: false });
    await expect(retired.read()).rejects.toMatchObject({ code: 'LOCKED' });
    expect(session.values[VAULT_STORAGE_KEYS.grant]).toBeUndefined();
  });

  it('uses canonical authenticated metadata independent of storage object property order', async () => {
    const { vault, local } = fixture();
    await vault.create(initial(), passphrase);
    await vault.update((value) => ({
      ...value,
      pending: { clientEventId: '00000000-0000-4000-8000-000000000006', code: 'retained body' },
    }));
    const root = local.values[VAULT_STORAGE_KEYS.root] as Record<string, unknown>;
    const pending = root.pending as { eventId: string; cipher: { iv: string; ciphertext: string } };
    root.pending = {
      cipher: { ciphertext: pending.cipher.ciphertext, iv: pending.cipher.iv },
      eventId: pending.eventId,
    };
    expect((await vault.read()).pending?.code).toBe('retained body');
  });
});
