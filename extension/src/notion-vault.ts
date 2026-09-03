import { NotionManifestSchema, type NotionManifest } from '../../src/shared/contract.js';

export const VAULT_STORAGE_KEYS = {
  root: 'lctrack.notion.vault.v1',
  grant: 'lctrack.notion.grant.v1',
  revokedGrant: 'lctrack.notion.revokedGrant.v1',
  reconciliation: 'lctrack.notion.reconciliation.v1',
  privatePrefix: 'lctrack.notion.private.',
} as const;

export interface VaultStorageArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
}

export interface VaultData {
  token: string;
  manifest: NotionManifest;
  pending: unknown | null;
}

export interface VaultPublicState {
  configured: boolean;
  unlocked: boolean;
  hasPending: boolean;
  reconciliationRequired: boolean;
  lockFailed: boolean;
  vaultId: string | null;
  generation: string;
}

export type VaultErrorCode =
  | 'LOCKED'
  | 'LOCK_FAILED'
  | 'INVALID_VAULT'
  | 'INVALID_INPUT'
  | 'UNLOCK_FAILED'
  | 'STORAGE_FAILURE'
  | 'ALREADY_CONNECTED'
  | 'NOT_CONFIGURED'
  | 'TRACKER_MISMATCH'
  | 'CONFIRM_REQUIRED';

export class VaultError extends Error {
  constructor(public readonly code: VaultErrorCode) {
    const messages: Record<VaultErrorCode, string> = {
      LOCKED: 'Unlock Notion before continuing.',
      LOCK_FAILED: 'Lock failed. Retry locking or fully exit Chrome before continuing.',
      INVALID_VAULT: 'The saved connection is damaged or unsupported. It has not been replaced.',
      INVALID_INPUT: 'The connection or saved payload is invalid or too large.',
      UNLOCK_FAILED: 'Passphrase incorrect or saved connection damaged.',
      STORAGE_FAILURE: 'Could not verify local storage. No new Notion write is authorized.',
      ALREADY_CONNECTED: 'Disconnect the existing connection before creating another.',
      NOT_CONFIGURED: 'Connect Notion first.',
      TRACKER_MISMATCH: 'A saved connection cannot be moved to another tracker.',
      CONFIRM_REQUIRED: 'Confirm removal of unresolved recovery before disconnecting.',
    };
    super(messages[code]);
    this.name = 'VaultError';
  }
}

type Cipher = { iv: string; ciphertext: string };
type Envelope = {
  format: 'lctrack-notion-vault';
  version: 1;
  vaultId: string;
  revision: number;
  binding: string;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: 600000; salt: string };
  wrappedKey: Cipher;
  data: Cipher;
  pending: { eventId: string; cipher: Cipher } | null;
};
type Grant = {
  version: 1;
  vaultId: string;
  binding: string;
  grantId: string;
  generation: string;
  key: string;
};
type Options<T> = {
  crypto?: Crypto;
  validateData?: (value: unknown) => T;
  purgePrivate?: () => Promise<void>;
};

const ROOT_LIMIT = 1_048_576;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGEST = /^[0-9a-f]{64}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!record(value) || Object.keys(value).sort().join('|') !== keys.sort().join('|')) {
    throw new VaultError('INVALID_VAULT');
  }
}

function base64(bytes: Uint8Array): string {
  let result = '';
  for (let start = 0; start < bytes.length; start += 8192) {
    result += String.fromCharCode(...bytes.subarray(start, start + 8192));
  }
  return btoa(result);
}

function decode64(value: unknown, length?: number): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== 'string' ||
    value.length > ROOT_LIMIT ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new VaultError('INVALID_VAULT');
  }
  const decoded = Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  if (base64(decoded) !== value || (length !== undefined && decoded.length !== length)) {
    throw new VaultError('INVALID_VAULT');
  }
  return decoded;
}

function serialized(value: unknown, limit = ROOT_LIMIT): string {
  let result: string;
  try {
    result = JSON.stringify(value);
  } catch {
    throw new VaultError('INVALID_INPUT');
  }
  if (result === undefined || encoder.encode(result).length > limit)
    throw new VaultError('INVALID_INPUT');
  return result;
}

function canonicalSerialized(value: unknown): string {
  // Chrome storage may sort object keys. Verify every value without depending on insertion order.
  return JSON.stringify(JSON.parse(serialized(value)), (_key, item: unknown) =>
    record(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

function parseCipher(value: unknown, exactBytes?: number): Cipher {
  exact(value, ['iv', 'ciphertext']);
  decode64(value.iv, 12);
  const bytes = decode64(value.ciphertext, exactBytes);
  if (bytes.length < 16) throw new VaultError('INVALID_VAULT');
  return value as Cipher;
}

function parseEnvelope(value: unknown): Envelope {
  try {
    serialized(value);
    exact(value, [
      'format',
      'version',
      'vaultId',
      'revision',
      'binding',
      'kdf',
      'wrappedKey',
      'data',
      'pending',
    ]);
    if (
      value.format !== 'lctrack-notion-vault' ||
      value.version !== 1 ||
      typeof value.vaultId !== 'string' ||
      !UUID.test(value.vaultId) ||
      typeof value.binding !== 'string' ||
      !DIGEST.test(value.binding) ||
      !Number.isSafeInteger(value.revision) ||
      (value.revision as number) < 1
    )
      throw new VaultError('INVALID_VAULT');
    exact(value.kdf, ['name', 'hash', 'iterations', 'salt']);
    if (
      value.kdf.name !== 'PBKDF2' ||
      value.kdf.hash !== 'SHA-256' ||
      value.kdf.iterations !== 600000
    )
      throw new VaultError('INVALID_VAULT');
    decode64(value.kdf.salt, 16);
    parseCipher(value.wrappedKey, 48);
    parseCipher(value.data);
    if (value.pending !== null) {
      exact(value.pending, ['eventId', 'cipher']);
      if (typeof value.pending.eventId !== 'string' || !UUID.test(value.pending.eventId))
        throw new VaultError('INVALID_VAULT');
      parseCipher(value.pending.cipher);
    }
    return value as Envelope;
  } catch {
    throw new VaultError('INVALID_VAULT');
  }
}

function parseGrant(value: unknown): Grant {
  exact(value, ['version', 'vaultId', 'binding', 'grantId', 'generation', 'key']);
  if (value.version !== 1 || typeof value.binding !== 'string' || !DIGEST.test(value.binding))
    throw new VaultError('INVALID_VAULT');
  for (const key of ['vaultId', 'grantId', 'generation'])
    if (typeof value[key] !== 'string' || !UUID.test(value[key]))
      throw new VaultError('INVALID_VAULT');
  decode64(value.key, 32);
  return value as Grant;
}

function validatePassphrase(value: string): void {
  if (
    typeof value !== 'string' ||
    [...value].length < 16 ||
    encoder.encode(value).length > 1024 ||
    [...value].some(
      (char) => char.length === 1 && char.charCodeAt(0) >= 0xd800 && char.charCodeAt(0) <= 0xdfff,
    )
  ) {
    throw new VaultError('INVALID_INPUT');
  }
}

function pendingId(pending: unknown): string {
  if (!record(pending)) throw new VaultError('INVALID_INPUT');
  const id =
    pending.clientEventId ?? (record(pending.event) ? pending.event.clientEventId : undefined);
  if (typeof id !== 'string' || !UUID.test(id)) throw new VaultError('INVALID_INPUT');
  return id;
}

/** One worker owns this store. Chrome session storage is trusted-extension memory, not a worker enclave. */
export class NotionVault<T extends VaultData> {
  private readonly crypto: Crypto;
  private initialized: Promise<void> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private epoch = 0;
  private generationValue: string;
  private envelope: Envelope | null = null;
  private grant: Grant | null = null;
  private key: CryptoKey | null = null;
  private reconciliationRequired = false;
  private lockFailed = false;

  constructor(
    private readonly storage: { local: VaultStorageArea; session: VaultStorageArea },
    private readonly options: Options<T> = {},
  ) {
    this.crypto = options.crypto ?? globalThis.crypto;
    this.generationValue = this.crypto.randomUUID();
  }

  get generation(): string {
    return this.generationValue;
  }
  get vaultId(): string | null {
    return this.envelope?.vaultId ?? null;
  }

  initialize(): Promise<void> {
    this.initialized ??= this.initializeOnce().catch((error: unknown) => {
      this.initialized = undefined;
      throw error;
    });
    return this.initialized;
  }

  private async initializeOnce(): Promise<void> {
    const epoch = this.epoch;
    await this.store(async () => {
      await Promise.all([
        this.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
        this.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
      ]);
    });
    await this.refreshRoot();
    const [values, revoked] = await Promise.all([
      this.store(() => this.storage.session.get(VAULT_STORAGE_KEYS.grant)),
      this.readRevocation(),
    ]);
    // A Lock received before initialization must not let hydration undo its synchronous fence.
    if (epoch !== this.epoch || this.epoch !== 0) return;
    const raw = values[VAULT_STORAGE_KEYS.grant];
    if (raw === undefined) return;
    let grant: Grant;
    try {
      grant = parseGrant(raw);
    } catch {
      this.lockFailed = true;
      return;
    }
    if (
      !this.envelope ||
      grant.vaultId !== this.envelope.vaultId ||
      grant.binding !== this.envelope.binding ||
      grant.grantId === revoked
    ) {
      this.lockFailed = true;
      return;
    }
    const key = await this.importKey(decode64(grant.key, 32));
    await this.decryptData(this.envelope, key);
    if (epoch !== this.epoch || this.epoch !== 0) return;
    this.grant = grant;
    this.key = key;
    this.generationValue = grant.generation;
  }

  publicState(): Promise<VaultPublicState> {
    return this.serial(async () => {
      await this.initialize();
      await this.refreshRoot();
      const grant = this.grant;
      if (grant && (await this.readRevocation()) === grant.grantId) {
        this.fence();
        this.lockFailed = true;
      }
      return this.state();
    });
  }

  create(data: T, passphrase: string): Promise<VaultPublicState> {
    const epoch = this.epoch;
    return this.serial(async () => {
      await this.initialize();
      this.checkEpoch(epoch);
      await this.refreshRoot();
      if (this.envelope) throw new VaultError('ALREADY_CONNECTED');
      validatePassphrase(passphrase);
      const validated = this.validateData(data);
      const binding = await this.binding(validated.manifest);
      const raw = this.crypto.getRandomValues(new Uint8Array(32));
      const key = await this.importKey(raw);
      const kdf = this.newKdf();
      const shell = {
        format: 'lctrack-notion-vault' as const,
        version: 1 as const,
        vaultId: this.crypto.randomUUID(),
        revision: 1,
        binding,
        kdf,
      };
      const wrappedKey = await this.encrypt(
        raw,
        await this.wrappingKey(passphrase, kdf),
        this.aad(shell, 'key-wrap'),
      );
      const next = await this.encryptData(validated, key, { ...shell, wrappedKey });
      this.checkEpoch(epoch);
      await this.commit(next);
      this.checkEpoch(epoch);
      await this.issueGrant(next, raw, key, epoch);
      return this.state();
    });
  }

  unlock(passphrase: string): Promise<VaultPublicState> {
    const epoch = this.epoch;
    return this.serial(async () => {
      await this.initialize();
      this.checkEpoch(epoch);
      await this.refreshRoot();
      if (!this.envelope) throw new VaultError('NOT_CONFIGURED');
      validatePassphrase(passphrase);
      const current = this.envelope;
      const raw = await this.unwrap(current, passphrase);
      const key = await this.importKey(raw);
      try {
        await this.decryptData(current, key);
      } catch {
        throw new VaultError('UNLOCK_FAILED');
      }
      this.checkEpoch(epoch);
      await this.issueGrant(current, raw, key, epoch);
      return this.state();
    });
  }

  read(): Promise<T> {
    return this.serial(async () => {
      await this.initialize();
      const generation = this.generation;
      await this.assertAccess(generation);
      await this.refreshRoot();
      const result = await this.decryptData(this.requireEnvelope(), this.requireKey());
      await this.assertAccess(generation);
      return result;
    });
  }

  update(transform: (value: T) => T): Promise<T> {
    const epoch = this.epoch;
    return this.serial(async () => {
      await this.initialize();
      this.checkEpoch(epoch);
      const generation = this.generation;
      await this.assertAccess(generation);
      await this.refreshRoot();
      const current = this.requireEnvelope();
      const key = this.requireKey();
      const nextData = this.validateData(transform(await this.decryptData(current, key)));
      if ((await this.binding(nextData.manifest)) !== current.binding)
        throw new VaultError('TRACKER_MISMATCH');
      const next = await this.encryptData(nextData, key, {
        ...current,
        revision: current.revision + 1,
      });
      await this.assertAccess(generation);
      await this.commit(next);
      this.checkEpoch(epoch);
      return nextData;
    });
  }

  async assertAccess(generation: string): Promise<void> {
    await this.initialize();
    this.requireAccess(generation);
    const revoked = await this.readRevocation();
    this.requireAccess(generation);
    if (revoked === this.grant?.grantId) {
      this.fence();
      this.lockFailed = true;
      throw new VaultError('LOCKED');
    }
  }

  lock(): Promise<VaultPublicState> {
    const candidate = this.fence();
    return this.serial(async () => {
      // Lock must remain available even if a malformed vault prevents normal initialization.
      try {
        await this.initialize();
      } catch {
        /* Still purge the independent session grant. */
      }
      await this.purgeAuthority(candidate);
      return this.state();
    });
  }

  changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<VaultPublicState> {
    const epoch = this.epoch;
    return this.serial(async () => {
      await this.initialize();
      this.checkEpoch(epoch);
      const generation = this.generation;
      await this.assertAccess(generation);
      validatePassphrase(oldPassphrase);
      validatePassphrase(newPassphrase);
      await this.refreshRoot();
      const current = this.requireEnvelope();
      const raw = await this.unwrap(current, oldPassphrase);
      const kdf = this.newKdf();
      const next = { ...current, kdf };
      next.wrappedKey = await this.encrypt(
        raw,
        await this.wrappingKey(newPassphrase, kdf),
        this.aad(next, 'key-wrap'),
      );
      await this.assertAccess(generation);
      await this.commit(next);
      this.checkEpoch(epoch);
      return this.state();
    });
  }

  disconnect(confirmUncertain = false): Promise<VaultPublicState> {
    return this.serial(async () => {
      let uncertain = true;
      try {
        await this.initialize();
        await this.refreshRoot();
        uncertain = this.envelope?.pending !== null && this.envelope !== null;
      } catch {
        /* A damaged root cannot prove there is no unresolved recovery. */
      }
      if (uncertain && !confirmUncertain) throw new VaultError('CONFIRM_REQUIRED');
      if (uncertain) {
        await this.store(() =>
          this.storage.local.set({ [VAULT_STORAGE_KEYS.reconciliation]: true }),
        );
        if (
          (await this.store(() => this.storage.local.get(VAULT_STORAGE_KEYS.reconciliation)))[
            VAULT_STORAGE_KEYS.reconciliation
          ] !== true
        )
          throw new VaultError('STORAGE_FAILURE');
        this.reconciliationRequired = true;
      }
      const candidate = this.fence();
      await this.purgeAuthority(candidate);
      await this.store(() => this.storage.local.remove(VAULT_STORAGE_KEYS.root));
      if (
        (await this.store(() => this.storage.local.get(VAULT_STORAGE_KEYS.root)))[
          VAULT_STORAGE_KEYS.root
        ] !== undefined
      )
        throw new VaultError('STORAGE_FAILURE');
      this.envelope = null;
      // A reset can recover from an unsupported/corrupt root without caching its rejected initializer.
      this.initialized = undefined;
      return this.state();
    });
  }

  acknowledgeReconciliation(): Promise<VaultPublicState> {
    return this.serial(async () => {
      await this.initialize();
      await this.assertAccess(this.generation);
      await this.store(() => this.storage.local.remove(VAULT_STORAGE_KEYS.reconciliation));
      const value = (
        await this.store(() => this.storage.local.get(VAULT_STORAGE_KEYS.reconciliation))
      )[VAULT_STORAGE_KEYS.reconciliation];
      if (value !== undefined) throw new VaultError('STORAGE_FAILURE');
      this.reconciliationRequired = false;
      return this.state();
    });
  }

  private state(): VaultPublicState {
    return {
      configured: this.envelope !== null,
      unlocked: this.grant !== null && this.key !== null && !this.lockFailed,
      hasPending: this.envelope?.pending !== undefined && this.envelope.pending !== null,
      reconciliationRequired: this.reconciliationRequired,
      lockFailed: this.lockFailed,
      vaultId: this.vaultId,
      generation: this.generation,
    };
  }

  private fence(): Grant | null {
    const previous = this.grant;
    this.epoch += 1;
    this.generationValue = this.crypto.randomUUID();
    this.grant = null;
    this.key = null;
    return previous;
  }

  private async purgeAuthority(candidate: Grant | null): Promise<void> {
    try {
      const stored = (await this.store(() => this.storage.session.get(VAULT_STORAGE_KEYS.grant)))[
        VAULT_STORAGE_KEYS.grant
      ];
      const grant = stored === undefined ? candidate : parseGrant(stored);
      if (grant) {
        await this.store(() =>
          this.storage.local.set({ [VAULT_STORAGE_KEYS.revokedGrant]: grant.grantId }),
        );
        if ((await this.readRevocation()) !== grant.grantId)
          throw new VaultError('STORAGE_FAILURE');
      }
    } catch {
      /* Verified session removal is still sufficient when revocation storage fails. */
    }
    const removed = await Promise.allSettled([
      this.store(async () => {
        const values = await this.storage.session.get(null);
        const keys = Object.keys(values).filter(
          (key) =>
            key === VAULT_STORAGE_KEYS.grant || key.startsWith(VAULT_STORAGE_KEYS.privatePrefix),
        );
        await this.storage.session.remove(keys);
        const remaining = await this.storage.session.get(keys);
        if (keys.some((key) => remaining[key] !== undefined))
          throw new Error('Session purge was not durable.');
      }),
      this.options.purgePrivate?.() ?? Promise.resolve(),
    ]);
    const purgeFailed = removed.some((result) => result.status === 'rejected');
    this.lockFailed = purgeFailed;
    // Verified removal suffices even if the independent revocation store was unavailable.
    if (purgeFailed) throw new VaultError('LOCK_FAILED');
  }

  private async issueGrant(
    envelope: Envelope,
    raw: Uint8Array<ArrayBuffer>,
    key: CryptoKey,
    epoch: number,
  ): Promise<void> {
    this.checkEpoch(epoch);
    const grant: Grant = {
      version: 1,
      vaultId: envelope.vaultId,
      binding: envelope.binding,
      key: base64(raw),
      grantId: this.crypto.randomUUID(),
      generation: this.crypto.randomUUID(),
    };
    // Register before yielding so a simultaneous Lock knows which not-yet-acknowledged grant to revoke.
    this.grant = grant;
    this.key = key;
    this.generationValue = grant.generation;
    try {
      await this.store(() => this.storage.session.set({ [VAULT_STORAGE_KEYS.grant]: grant }));
      const read = (await this.store(() => this.storage.session.get(VAULT_STORAGE_KEYS.grant)))[
        VAULT_STORAGE_KEYS.grant
      ];
      if (canonicalSerialized(read) !== canonicalSerialized(grant))
        throw new VaultError('STORAGE_FAILURE');
      this.checkEpoch(epoch);
      this.lockFailed = false;
    } catch (error) {
      if (epoch === this.epoch) {
        this.fence();
        try {
          await this.purgeAuthority(grant);
        } catch {
          /* Report failed key purge as Lock failed. */
        }
      }
      if (this.lockFailed) throw new VaultError('LOCK_FAILED');
      throw error;
    } finally {
      raw.fill(0);
    }
  }

  private async refreshRoot(): Promise<void> {
    const values = await this.store(() =>
      this.storage.local.get([VAULT_STORAGE_KEYS.root, VAULT_STORAGE_KEYS.reconciliation]),
    );
    const flag = values[VAULT_STORAGE_KEYS.reconciliation];
    if (flag !== undefined && flag !== true) throw new VaultError('INVALID_VAULT');
    this.reconciliationRequired = flag === true;
    this.envelope =
      values[VAULT_STORAGE_KEYS.root] === undefined
        ? null
        : parseEnvelope(values[VAULT_STORAGE_KEYS.root]);
    if (
      this.grant &&
      (this.grant.vaultId !== this.envelope?.vaultId ||
        this.grant.binding !== this.envelope.binding)
    )
      this.fence();
  }

  private async readRevocation(): Promise<string | undefined> {
    const value = (await this.store(() => this.storage.local.get(VAULT_STORAGE_KEYS.revokedGrant)))[
      VAULT_STORAGE_KEYS.revokedGrant
    ];
    if (value !== undefined && (typeof value !== 'string' || !UUID.test(value)))
      throw new VaultError('INVALID_VAULT');
    return value as string | undefined;
  }

  private async commit(envelope: Envelope): Promise<void> {
    parseEnvelope(envelope);
    const encoded = canonicalSerialized(envelope);
    await this.store(() => this.storage.local.set({ [VAULT_STORAGE_KEYS.root]: envelope }));
    const persisted = (await this.store(() => this.storage.local.get(VAULT_STORAGE_KEYS.root)))[
      VAULT_STORAGE_KEYS.root
    ];
    try {
      if (canonicalSerialized(persisted) !== encoded) throw new VaultError('STORAGE_FAILURE');
    } catch {
      throw new VaultError('STORAGE_FAILURE');
    }
    this.envelope = parseEnvelope(persisted);
  }

  private validateData(value: unknown): T {
    try {
      const plain: unknown = JSON.parse(serialized(value));
      if (
        !record(plain) ||
        typeof plain.token !== 'string' ||
        plain.token.length === 0 ||
        encoder.encode(plain.token).length > 4096 ||
        /[\s\u0000-\u001f\u007f]/u.test(plain.token) ||
        !Object.hasOwn(plain, 'pending')
      )
        throw new VaultError('INVALID_INPUT');
      const manifest = NotionManifestSchema.parse(plain.manifest);
      exact(plain.manifest, [
        'version',
        'notionApiVersion',
        'createdAt',
        'parentPageId',
        'problems',
        'attempts',
      ]);
      exact(plain.manifest.problems, ['databaseId', 'dataSourceId']);
      exact(plain.manifest.attempts, ['databaseId', 'dataSourceId']);
      if (manifest.version !== 4) throw new VaultError('INVALID_INPUT');
      const ids = [
        manifest.parentPageId,
        manifest.problems.databaseId,
        manifest.problems.dataSourceId,
        manifest.attempts.databaseId,
        manifest.attempts.dataSourceId,
      ];
      if (
        !ids.every((id) => UUID.test(id)) ||
        new Set(ids.map((id) => id.toLowerCase())).size !== ids.length
      )
        throw new VaultError('INVALID_INPUT');
      if (plain.pending !== null) pendingId(plain.pending);
      return this.options.validateData ? this.options.validateData(plain) : (plain as T);
    } catch {
      throw new VaultError('INVALID_INPUT');
    }
  }

  private async binding(manifest: NotionManifest): Promise<string> {
    const canonical = [
      manifest.version,
      manifest.notionApiVersion,
      manifest.parentPageId.toLowerCase(),
      manifest.problems.databaseId.toLowerCase(),
      manifest.problems.dataSourceId.toLowerCase(),
      manifest.attempts.databaseId.toLowerCase(),
      manifest.attempts.dataSourceId.toLowerCase(),
    ];
    return Array.from(
      new Uint8Array(
        await this.crypto.subtle.digest('SHA-256', encoder.encode(JSON.stringify(canonical))),
      ),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
  }

  private newKdf(): Envelope['kdf'] {
    return {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: 600000,
      salt: base64(this.crypto.getRandomValues(new Uint8Array(16))),
    };
  }

  private aad(
    envelope: Pick<Envelope, 'vaultId' | 'binding' | 'kdf'>,
    purpose: string,
    eventId?: string,
  ): Uint8Array<ArrayBuffer> {
    return encoder.encode(
      JSON.stringify([
        'lctrack-notion-vault',
        1,
        envelope.vaultId,
        envelope.binding,
        purpose,
        ...(purpose === 'key-wrap'
          ? [envelope.kdf.name, envelope.kdf.hash, envelope.kdf.iterations, envelope.kdf.salt]
          : []),
        ...(eventId === undefined ? [] : [eventId]),
      ]),
    );
  }

  private async importKey(bytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    return this.crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
  }

  private async wrappingKey(passphrase: string, kdf: Envelope['kdf']): Promise<CryptoKey> {
    const password = await this.crypto.subtle.importKey(
      'raw',
      encoder.encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey'],
    );
    return this.crypto.subtle.deriveKey(
      { name: 'PBKDF2', hash: 'SHA-256', salt: decode64(kdf.salt, 16), iterations: kdf.iterations },
      password,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  private async encrypt(
    bytes: Uint8Array<ArrayBuffer>,
    key: CryptoKey,
    aad: Uint8Array<ArrayBuffer>,
  ): Promise<Cipher> {
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    return {
      iv: base64(iv),
      ciphertext: base64(
        new Uint8Array(
          await this.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
            key,
            bytes,
          ),
        ),
      ),
    };
  }

  private async decrypt(
    cipher: Cipher,
    key: CryptoKey,
    aad: Uint8Array<ArrayBuffer>,
  ): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array(
      await this.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: decode64(cipher.iv, 12), additionalData: aad, tagLength: 128 },
        key,
        decode64(cipher.ciphertext),
      ),
    );
  }

  private async unwrap(envelope: Envelope, passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
    try {
      const raw = await this.decrypt(
        envelope.wrappedKey,
        await this.wrappingKey(passphrase, envelope.kdf),
        this.aad(envelope, 'key-wrap'),
      );
      if (raw.length !== 32) throw new Error('Invalid key length.');
      return raw;
    } catch {
      throw new VaultError('UNLOCK_FAILED');
    }
  }

  private async encryptData(
    data: T,
    key: CryptoKey,
    shell: Omit<Envelope, 'data' | 'pending'>,
  ): Promise<Envelope> {
    const { pending, ...credentialData } = data;
    const eventId = pending === null ? undefined : pendingId(pending);
    const pendingRecord =
      eventId === undefined
        ? null
        : {
            eventId,
            cipher: await this.encrypt(
              encoder.encode(serialized(pending)),
              key,
              this.aad(shell, 'pending', eventId),
            ),
          };
    const encrypted = await this.encrypt(
      encoder.encode(serialized(credentialData)),
      key,
      this.dataAad({ ...shell, pending: pendingRecord }),
    );
    const result = { ...shell, data: encrypted, pending: pendingRecord };
    serialized(result);
    return result;
  }

  private async decryptData(envelope: Envelope, key: CryptoKey): Promise<T> {
    try {
      const credentialData: unknown = JSON.parse(
        decoder.decode(await this.decrypt(envelope.data, key, this.dataAad(envelope))),
      );
      if (!record(credentialData) || Object.hasOwn(credentialData, 'pending'))
        throw new Error('Invalid data.');
      const pending: unknown =
        envelope.pending === null
          ? null
          : JSON.parse(
              decoder.decode(
                await this.decrypt(
                  envelope.pending.cipher,
                  key,
                  this.aad(envelope, 'pending', envelope.pending.eventId),
                ),
              ),
            );
      if (envelope.pending !== null && pendingId(pending) !== envelope.pending.eventId)
        throw new Error('Pending identity mismatch.');
      const data = this.validateData({ ...credentialData, pending });
      if ((await this.binding(data.manifest)) !== envelope.binding)
        throw new Error('Tracker identity mismatch.');
      return data;
    } catch {
      throw new VaultError('INVALID_VAULT');
    }
  }

  private dataAad(envelope: Omit<Envelope, 'data'>): Uint8Array<ArrayBuffer> {
    // Bind the pending ciphertext too: deleting/swapping a valid recovery record must not unlock a new save.
    const pending = envelope.pending;
    return this.aad(
      envelope,
      'data',
      serialized([
        envelope.revision,
        pending === null ? null : [pending.eventId, pending.cipher.iv, pending.cipher.ciphertext],
      ]),
    );
  }

  private requireAccess(generation: string): void {
    if (!this.grant || !this.key || this.lockFailed || generation !== this.generation)
      throw new VaultError('LOCKED');
  }
  private requireEnvelope(): Envelope {
    if (!this.envelope) throw new VaultError('NOT_CONFIGURED');
    return this.envelope;
  }
  private requireKey(): CryptoKey {
    if (!this.key) throw new VaultError('LOCKED');
    return this.key;
  }
  private checkEpoch(epoch: number): void {
    if (epoch !== this.epoch) throw new VaultError('LOCKED');
  }
  private serial<R>(operation: () => Promise<R>): Promise<R> {
    const task = this.queue.then(operation);
    this.queue = task.catch(() => undefined);
    return task;
  }
  private async store<R>(operation: () => Promise<R>): Promise<R> {
    try {
      return await operation();
    } catch {
      throw new VaultError('STORAGE_FAILURE');
    }
  }
}
