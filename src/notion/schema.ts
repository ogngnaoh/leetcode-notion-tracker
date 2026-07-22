import { DIFFICULTY_OPTIONS } from './presentation.js';

export const NOTION_API_VERSION = '2026-03-11' as const;

export const DIFFICULTY_OPTION_NAMES = DIFFICULTY_OPTIONS.map(({ name }) => name);

export const STATE_OPTIONS = [
  { name: 'New', color: 'gray' },
  { name: 'Couldn’t solve', color: 'red' },
  { name: 'Needed help', color: 'yellow' },
  { name: 'Solved', color: 'green' },
  { name: 'Mastered', color: 'blue' },
] as const;

export const RESULT_OPTIONS = STATE_OPTIONS.slice(1, 4);

export const PROBLEMS_PROPERTIES = {
  Problem: { title: {} },
  'External Key': { rich_text: {} },
  Slug: { rich_text: {} },
  Number: { number: { format: 'number' as const } },
  URL: { url: {} },
  Difficulty: {
    select: { options: DIFFICULTY_OPTIONS },
  },
  Topics: { multi_select: {} },
  'Practice State': { select: { options: STATE_OPTIONS } },
  'Solved Streak': { number: { format: 'number' as const } },
  'Next Review': { date: {} },
  'Last Attempt': { date: {} },
  'First Solved': { date: {} },
  'Extension Managed': { checkbox: {} },
} as const;

export const ATTEMPTS_PROPERTIES = {
  Attempt: { title: {} },
  'Client Event ID': { rich_text: {} },
  'Problem Key': { rich_text: {} },
  'Attempted At': { date: {} },
  'Source URL': { url: {} },
  Language: { rich_text: {} },
  Result: { select: { options: RESULT_OPTIONS } },
  'Resulting State': { select: { options: STATE_OPTIONS } },
  'Resulting Solved Streak': { number: { format: 'number' as const } },
  'Resulting Next Review': { date: {} },
  'Extension Managed': { checkbox: {} },
  'Created Time': { created_time: {} },
} as const;

export const V1_PROBLEMS_TYPES: Record<string, string> = {
  Problem: 'title',
  'External Key': 'rich_text',
  Slug: 'rich_text',
  Number: 'number',
  URL: 'url',
  Difficulty: 'select',
  'Primary Pattern': 'rich_text',
  Mastery: 'select',
  'Green Count': 'number',
  'Next Review': 'date',
  'Last Attempt': 'date',
  'Extension Managed': 'checkbox',
  Attempts: 'relation',
};

export const V1_ATTEMPTS_TYPES: Record<string, string> = {
  Attempt: 'title',
  'Client Event ID': 'rich_text',
  Problem: 'relation',
  'Problem Key': 'rich_text',
  'Attempted At': 'date',
  'Source URL': 'url',
  Language: 'rich_text',
  'Submission Result': 'select',
  Outcome: 'select',
  'Cold Attempt': 'checkbox',
  'Help Used': 'select',
  'Failure Code': 'select',
  'Total Minutes': 'number',
  'Primary Pattern': 'rich_text',
  Notes: 'rich_text',
  'Resulting Mastery': 'select',
  'Resulting Green Count': 'number',
  'Resulting Next Review': 'date',
  'Extension Managed': 'checkbox',
  'Created Time': 'created_time',
};

export const V2_REQUIRED_PROBLEMS_TYPES: Record<string, string> = {
  Problem: 'title',
  'External Key': 'rich_text',
  Slug: 'rich_text',
  Number: 'number',
  URL: 'url',
  Difficulty: 'select',
  Topics: 'multi_select',
  'Practice State': 'select',
  'Solved Streak': 'number',
  'Next Review': 'date',
  'Last Attempt': 'date',
  'Extension Managed': 'checkbox',
  Attempts: 'relation',
};

export const REQUIRED_PROBLEMS_TYPES: Record<string, string> = {
  ...V2_REQUIRED_PROBLEMS_TYPES,
  'First Solved': 'date',
};

export const V2_REQUIRED_ATTEMPTS_TYPES: Record<string, string> = {
  Attempt: 'title',
  'Client Event ID': 'rich_text',
  Problem: 'relation',
  'Problem Key': 'rich_text',
  'Attempted At': 'date',
  'Source URL': 'url',
  Language: 'rich_text',
  Result: 'select',
  'Resulting State': 'select',
  'Resulting Solved Streak': 'number',
  'Resulting Next Review': 'date',
  'Extension Managed': 'checkbox',
  'Created Time': 'created_time',
};

export const REQUIRED_ATTEMPTS_TYPES = V2_REQUIRED_ATTEMPTS_TYPES;

export const INTERMEDIATE_PROBLEMS_TYPES: Record<string, string> = {
  ...V1_PROBLEMS_TYPES,
  ...V2_REQUIRED_PROBLEMS_TYPES,
};

export const INTERMEDIATE_ATTEMPTS_TYPES: Record<string, string> = {
  ...V1_ATTEMPTS_TYPES,
  ...V2_REQUIRED_ATTEMPTS_TYPES,
};
