import type { Difficulty, ProblemSnapshot } from '../../src/shared/contract.js';
import type { EditorModelReading } from './leetcode-model-reader.js';

export interface VisibleTextCandidate {
  text: string;
  visible: boolean;
}

export interface TopicCandidate extends VisibleTextCandidate {
  href: string;
}

export interface ExtractionCandidates {
  locationUrl: string;
  documentTitle: string;
  titleCandidates: VisibleTextCandidate[];
  difficultyCandidates: VisibleTextCandidate[];
  topicCandidates: TopicCandidate[];
  model: EditorModelReading | null;
}

export interface AvailableLeetCodeSnapshot {
  codeAvailable: true;
  problem: ProblemSnapshot;
  language: string;
  code: string;
  fingerprint: string;
}

export interface UnavailableLeetCodeSnapshot {
  codeAvailable: false;
  problem: ProblemSnapshot;
  language: string;
  codeUnavailable: {
    reason: 'NO_READABLE_EDITOR_MODEL';
  };
  fingerprint: null;
}

export type LeetCodeSnapshot = AvailableLeetCodeSnapshot | UnavailableLeetCodeSnapshot;

export function normalizeProblemTitle(rawTitle: string): {
  title: string;
  number: number | null;
} {
  const trimmed = rawTitle.trim();
  const match = /^(\d+)\s*\.\s*(.*)$/.exec(trimmed);
  if (!match) return { title: trimmed, number: null };
  return { title: match[2]?.trim() ?? '', number: Number(match[1]) };
}

function problemLocation(locationUrl: string): { slug: string; url: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(locationUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'leetcode.com') return null;
  const match =
    /^\/problems\/([a-z0-9-]+)\/(?:description\/?)?$|^\/problems\/([a-z0-9-]+)\/?$/.exec(
      parsed.pathname,
    );
  const slug = match?.[1] ?? match?.[2];
  if (!slug) return null;
  return {
    slug,
    url: `https://leetcode.com/problems/${slug}/`,
  };
}

function titleFromDocument(documentTitle: string): string {
  const title = documentTitle
    .replace(/^LeetCode\s*[-|]\s*/i, '')
    .replace(/\s*[-|]\s*LeetCode.*$/i, '')
    .trim();
  return /^LeetCode$/i.test(title) ? '' : title;
}

function extractDifficulty(candidates: VisibleTextCandidate[]): Difficulty {
  for (const candidate of candidates) {
    if (!candidate.visible) continue;
    const value = candidate.text.trim();
    if (value === 'Easy' || value === 'Medium' || value === 'Hard') return value;
  }
  return 'Unknown';
}

function isLeetCodeTagHref(href: string): boolean {
  try {
    const url = new URL(href, 'https://leetcode.com');
    return (
      url.protocol === 'https:' &&
      url.hostname === 'leetcode.com' &&
      /^\/tag\/[a-z0-9-]+\/?$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function extractTopics(candidates: TopicCandidate[]): string[] {
  const topics: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const label = candidate.text.trim();
    if (!candidate.visible || !label || !isLeetCodeTagHref(candidate.href) || seen.has(label)) {
      continue;
    }
    seen.add(label);
    topics.push(label);
  }
  return topics;
}

const LANGUAGES = new Map<string, string>([
  ['bash', 'Bash'],
  ['c', 'C'],
  ['c#', 'C#'],
  ['csharp', 'C#'],
  ['c++', 'C++'],
  ['cpp', 'C++'],
  ['dart', 'Dart'],
  ['elixir', 'Elixir'],
  ['erlang', 'Erlang'],
  ['go', 'Go'],
  ['golang', 'Go'],
  ['java', 'Java'],
  ['javascript', 'JavaScript'],
  ['js', 'JavaScript'],
  ['kotlin', 'Kotlin'],
  ['mysql', 'MySQL'],
  ['mssql', 'MS SQL Server'],
  ['ms sql server', 'MS SQL Server'],
  ['oracle', 'Oracle'],
  ['pandas', 'Pandas'],
  ['php', 'PHP'],
  ['python', 'Python'],
  ['python3', 'Python'],
  ['racket', 'Racket'],
  ['ruby', 'Ruby'],
  ['rust', 'Rust'],
  ['scala', 'Scala'],
  ['swift', 'Swift'],
  ['typescript', 'TypeScript'],
  ['ts', 'TypeScript'],
]);

/** Maps Monaco's language id, which on LeetCode is the site's own slug, to a display name. */
function normalizeLanguage(languageId: string): string {
  return LANGUAGES.get(languageId.trim().toLowerCase()) ?? 'Unknown';
}

/** SHA-256 of the UTF-8 JSON array encoding `[slug, language, exactCode]`. */
export async function fingerprintCode(
  slug: string,
  language: string,
  exactCode: string,
): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify([slug, language, exactCode]));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function extractLeetCodeSnapshot(
  candidates: ExtractionCandidates,
): Promise<LeetCodeSnapshot | null> {
  const location = problemLocation(candidates.locationUrl);
  if (!location) return null;

  const visibleTitle = candidates.titleCandidates.find(
    (candidate) => candidate.visible && candidate.text.trim(),
  )?.text;
  const normalized = normalizeProblemTitle(
    visibleTitle ?? titleFromDocument(candidates.documentTitle),
  );
  const title = normalized.title || location.slug;
  const problem: ProblemSnapshot = {
    slug: location.slug,
    title,
    number: normalized.number,
    url: location.url,
    difficulty: extractDifficulty(candidates.difficultyCandidates),
    topics: extractTopics(candidates.topicCandidates),
  };

  const reading = candidates.model;
  const language = reading ? normalizeLanguage(reading.languageId) : 'Unknown';

  if (reading) {
    return {
      codeAvailable: true,
      problem,
      language,
      code: reading.code,
      fingerprint: await fingerprintCode(location.slug, language, reading.code),
    };
  }

  return {
    codeAvailable: false,
    problem,
    language,
    codeUnavailable: { reason: 'NO_READABLE_EDITOR_MODEL' },
    fingerprint: null,
  };
}
