import type { Difficulty } from '../../src/shared/contract.js';

export interface LeetCodeContext {
  slug: string;
  title: string;
  number: number | null;
  url: string;
  difficulty: Difficulty;
}

export interface ExtensionSettings {
  bridgeUrl: string;
  bridgeToken: string;
  defaultLanguage: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  bridgeUrl: 'http://127.0.0.1:8787',
  bridgeToken: '',
  defaultLanguage: 'Python',
};
