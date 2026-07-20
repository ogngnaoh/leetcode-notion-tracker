import type { Difficulty } from '../../src/shared/contract.js';

export type {
  ContentScriptResponse,
  GetLeetCodeContextMessage,
  LeetCodeContextChangedMessage,
} from './leetcode-context-runtime.js';
export type {
  AvailableLeetCodeSnapshot,
  LeetCodeSnapshot,
  UnavailableLeetCodeSnapshot,
} from './leetcode-extraction.js';

export interface LeetCodeContext {
  slug: string;
  title: string;
  number: number | null;
  url: string;
  difficulty: Difficulty;
  topics: string[];
}

export interface ExtensionSettings {
  bridgeUrl: string;
  bridgeToken: string;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  bridgeUrl: 'http://127.0.0.1:8787',
  bridgeToken: '',
};
