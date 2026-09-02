import { describe, expect, it, vi } from 'vitest';
import { createSnapshotReader } from '../extension/src/sidepanel-snapshot-reader.js';

describe('side-panel startup snapshot reader', () => {
  it('reinjects once when a stale content script returns no protocol response', async () => {
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ context: null });
    const injectContentScripts = vi.fn(async () => undefined);
    const readSnapshot = createSnapshotReader({ sendMessage, injectContentScripts });

    await expect(readSnapshot(41)).resolves.toBeNull();

    expect(injectContentScripts).toHaveBeenCalledOnce();
    expect(injectContentScripts).toHaveBeenCalledWith(41);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('injects both world scripts once and retries immediately when no receiver exists', async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('Could not establish connection. Receiving end does not exist.'),
      )
      .mockResolvedValueOnce({ context: null });
    const injectContentScripts = vi.fn(async () => undefined);
    const readSnapshot = createSnapshotReader({ sendMessage, injectContentScripts });

    await expect(readSnapshot(41)).resolves.toBeNull();

    expect(injectContentScripts).toHaveBeenCalledOnce();
    expect(injectContentScripts).toHaveBeenCalledWith(41);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('does not inject repeatedly when the one startup retry still has no receiver', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    });
    const injectContentScripts = vi.fn(async () => undefined);
    const readSnapshot = createSnapshotReader({ sendMessage, injectContentScripts });

    await expect(readSnapshot(41)).rejects.toThrow('Receiving end does not exist');
    await expect(readSnapshot(41)).rejects.toThrow('Receiving end does not exist');

    expect(injectContentScripts).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('does not inject for unrelated content-script failures', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('The tab was closed.');
    });
    const injectContentScripts = vi.fn(async () => undefined);
    const readSnapshot = createSnapshotReader({ sendMessage, injectContentScripts });

    await expect(readSnapshot(41)).rejects.toThrow('The tab was closed');
    expect(injectContentScripts).not.toHaveBeenCalled();
  });
});
