import { describe, expect, it, vi } from 'vitest';
import { createSnapshotReader } from '../extension/src/sidepanel-snapshot-reader.js';

describe('side-panel startup snapshot reader', () => {
  it('injects the read-only content script once and retries immediately when no receiver exists', async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new Error('Could not establish connection. Receiving end does not exist.'),
      )
      .mockResolvedValueOnce({ context: null });
    const injectContentScript = vi.fn(async () => undefined);
    const readSnapshot = createSnapshotReader({ sendMessage, injectContentScript });

    await expect(readSnapshot(41)).resolves.toBeNull();

    expect(injectContentScript).toHaveBeenCalledOnce();
    expect(injectContentScript).toHaveBeenCalledWith(41, ['content.js']);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('does not inject repeatedly when the one startup retry still has no receiver', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    });
    const injectContentScript = vi.fn(async () => undefined);
    const readSnapshot = createSnapshotReader({ sendMessage, injectContentScript });

    await expect(readSnapshot(41)).rejects.toThrow('Receiving end does not exist');
    await expect(readSnapshot(41)).rejects.toThrow('Receiving end does not exist');

    expect(injectContentScript).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledTimes(3);
  });

  it('does not inject for unrelated content-script failures', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('The tab was closed.');
    });
    const injectContentScript = vi.fn(async () => undefined);
    const readSnapshot = createSnapshotReader({ sendMessage, injectContentScript });

    await expect(readSnapshot(41)).rejects.toThrow('The tab was closed');
    expect(injectContentScript).not.toHaveBeenCalled();
  });
});
