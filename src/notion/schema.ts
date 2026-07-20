export const NOTION_API_VERSION = '2026-03-11' as const;

const option = (name: string) => ({ name });

export const PROBLEMS_PROPERTIES = {
  Problem: { title: {} },
  'External Key': { rich_text: {} },
  Slug: { rich_text: {} },
  Number: { number: { format: 'number' as const } },
  URL: { url: {} },
  Difficulty: {
    select: { options: ['Easy', 'Medium', 'Hard', 'Unknown'].map(option) },
  },
  'Primary Pattern': { rich_text: {} },
  Mastery: {
    select: { options: ['Unseen', 'Red', 'Yellow', 'Green', 'Mastered'].map(option) },
  },
  'Green Count': { number: { format: 'number' as const } },
  'Next Review': { date: {} },
  'Last Attempt': { date: {} },
  'Extension Managed': { checkbox: {} },
} as const;

export const ATTEMPTS_PROPERTIES = {
  Attempt: { title: {} },
  'Client Event ID': { rich_text: {} },
  'Problem Key': { rich_text: {} },
  'Attempted At': { date: {} },
  'Source URL': { url: {} },
  Language: { rich_text: {} },
  'Submission Result': {
    select: {
      options: [
        'Accepted',
        'Wrong Answer',
        'Time Limit Exceeded',
        'Memory Limit Exceeded',
        'Runtime Error',
        'Compile Error',
        'Not Submitted',
      ].map(option),
    },
  },
  Outcome: { select: { options: ['Red', 'Yellow', 'Green'].map(option) } },
  'Cold Attempt': { checkbox: {} },
  'Help Used': {
    select: {
      options: [
        'None',
        'Pattern Hint',
        'Conceptual Hint',
        'Pseudocode',
        'Editorial',
        'Code Viewed',
      ].map(option),
    },
  },
  'Failure Code': {
    select: {
      options: [
        'P — Pattern Recognition',
        'A — Algorithm / Invariant',
        'I — Implementation / Syntax',
        'E — Edge Cases / Testing',
        'T — Time Management',
        'C — Communication',
      ].map(option),
    },
  },
  'Total Minutes': { number: { format: 'number' as const } },
  'Primary Pattern': { rich_text: {} },
  Notes: { rich_text: {} },
  'Resulting Mastery': {
    select: { options: ['Red', 'Yellow', 'Green', 'Mastered'].map(option) },
  },
  'Resulting Green Count': { number: { format: 'number' as const } },
  'Resulting Next Review': { date: {} },
  'Extension Managed': { checkbox: {} },
  'Created Time': { created_time: {} },
} as const;

export const REQUIRED_PROBLEMS_TYPES: Record<string, string> = {
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

export const REQUIRED_ATTEMPTS_TYPES: Record<string, string> = {
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
