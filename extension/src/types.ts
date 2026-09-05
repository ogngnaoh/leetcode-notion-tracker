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
