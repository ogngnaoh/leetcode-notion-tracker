import { getSettings, saveSettings } from './storage.js';

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Missing element #${id}`);
  return value as T;
}

const form = element<HTMLFormElement>('settings-form');
const bridgeUrl = element<HTMLInputElement>('bridge-url');
const bridgeToken = element<HTMLInputElement>('bridge-token');
const status = element<HTMLParagraphElement>('settings-status');

async function load(): Promise<void> {
  const settings = await getSettings();
  bridgeUrl.value = settings.bridgeUrl;
  bridgeToken.value = settings.bridgeToken;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    await saveSettings({
      bridgeUrl: bridgeUrl.value.trim().replace(/\/$/, ''),
      bridgeToken: bridgeToken.value,
    });
    status.textContent = 'Settings saved.';
    status.className = 'status success';
  })().catch((error: unknown) => {
    status.textContent = error instanceof Error ? error.message : 'Unable to save settings.';
    status.className = 'status error';
  });
});

void load();
