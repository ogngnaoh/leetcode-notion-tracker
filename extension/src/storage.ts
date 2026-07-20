import { DEFAULT_SETTINGS, type ExtensionSettings } from './types.js';

const SETTINGS_KEY = 'trackerSettings';

export async function getSettings(): Promise<ExtensionSettings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY);
  return {
    ...DEFAULT_SETTINGS,
    ...(result[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined),
  };
}

export async function saveSettings(settings: ExtensionSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}
