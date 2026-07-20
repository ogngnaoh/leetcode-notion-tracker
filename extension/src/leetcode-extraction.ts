import type { Difficulty, ProblemSnapshot } from '../../src/shared/contract.js';

export interface VisibleTextCandidate {
  text: string;
  visible: boolean;
}

export interface TopicCandidate extends VisibleTextCandidate {
  href: string;
}

export interface CodeCandidate {
  visible: boolean;
  readable: boolean;
  value: string;
}

export interface MonacoGutterCandidate {
  lineNumber: number;
  top: number;
}

export interface MonacoRenderedLineCandidate {
  text: string;
  top: number;
}

export interface RenderedCodeCandidate {
  code: string;
  startLine: number;
  endLine: number;
  complete: boolean;
}

export interface ExtractionCandidates {
  locationUrl: string;
  documentTitle: string;
  titleCandidates: VisibleTextCandidate[];
  difficultyCandidates: VisibleTextCandidate[];
  topicCandidates: TopicCandidate[];
  renderedCodeCandidates: RenderedCodeCandidate[];
  codeCandidates: CodeCandidate[];
  nearbyLanguageCandidates: VisibleTextCandidate[];
  languageCandidates: VisibleTextCandidate[];
}

export interface AvailableLeetCodeSnapshot {
  codeAvailable: true;
  problem: ProblemSnapshot;
  language: string;
  code: string;
  codeRange: {
    startLine: number;
    endLine: number;
    complete: boolean;
  };
  fingerprint: string;
}

export interface UnavailableLeetCodeSnapshot {
  codeAvailable: false;
  problem: ProblemSnapshot;
  language: string;
  codeUnavailable: {
    reason: 'NO_VISIBLE_CODE_EDITOR';
  };
  fingerprint: null;
}

export type LeetCodeSnapshot = AvailableLeetCodeSnapshot | UnavailableLeetCodeSnapshot;

export function reconstructMonacoCode(
  gutterCandidates: MonacoGutterCandidate[],
  renderedCandidates: MonacoRenderedLineCandidate[],
  entireFileRendered: boolean,
): RenderedCodeCandidate | null {
  if (gutterCandidates.length === 0 || renderedCandidates.length === 0) return null;

  const gutters = [...gutterCandidates].sort((left, right) => left.top - right.top);
  const rendered = [...renderedCandidates].sort((left, right) => left.top - right.top);
  for (let index = 0; index < gutters.length; index += 1) {
    const gutter = gutters[index]!;
    if (
      !Number.isFinite(gutter.top) ||
      !Number.isInteger(gutter.lineNumber) ||
      gutter.lineNumber < 1
    ) {
      return null;
    }
    if (index > 0) {
      const previous = gutters[index - 1]!;
      if (gutter.top <= previous.top || gutter.lineNumber !== previous.lineNumber + 1) return null;
    }
  }
  for (let index = 0; index < rendered.length; index += 1) {
    const line = rendered[index]!;
    if (!Number.isFinite(line.top) || (index > 0 && line.top <= rendered[index - 1]!.top)) {
      return null;
    }
  }

  const logicalLines = gutters.map(() => [] as string[]);
  let gutterIndex = -1;
  for (const line of rendered) {
    while (gutterIndex + 1 < gutters.length && gutters[gutterIndex + 1]!.top <= line.top) {
      gutterIndex += 1;
    }
    if (gutterIndex < 0) return null;
    const fragments = logicalLines[gutterIndex]!;
    if (fragments.length === 0 && line.top !== gutters[gutterIndex]!.top) return null;
    const normalized = line.text.replaceAll('\u00a0', ' ');
    fragments.push(fragments.length === 0 ? normalized : normalized.replace(/^[ \t]+/, ''));
  }
  if (logicalLines.some((fragments) => fragments.length === 0)) return null;

  const startLine = gutters[0]!.lineNumber;
  return {
    code: logicalLines.map((fragments) => fragments.join('')).join('\n'),
    startLine,
    endLine: gutters.at(-1)!.lineNumber,
    complete: startLine === 1 && entireFileRendered,
  };
}

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

function normalizeLanguage(raw: string): string | null {
  const normalized = raw
    .trim()
    .replace(/^(?:select|choose)\s+language\s*:?\s*/i, '')
    .replace(/^language\s*:\s*/i, '')
    .trim()
    .toLowerCase();
  return LANGUAGES.get(normalized) ?? null;
}

function extractLanguage(candidates: ExtractionCandidates): string {
  for (const group of [candidates.nearbyLanguageCandidates, candidates.languageCandidates]) {
    for (const candidate of group) {
      if (!candidate.visible) continue;
      const language = normalizeLanguage(candidate.text);
      if (language) return language;
    }
  }
  return 'Unknown';
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

  const language = extractLanguage(candidates);
  const renderedCode = candidates.renderedCodeCandidates[0];
  const textareaCode = candidates.codeCandidates.find(
    (candidate) => candidate.visible && candidate.readable,
  )?.value;
  const code = renderedCode?.code ?? textareaCode;

  if (code !== undefined) {
    const lineCount = code.length === 0 ? 1 : code.split('\n').length;
    return {
      codeAvailable: true,
      problem,
      language,
      code,
      codeRange: renderedCode
        ? {
            startLine: renderedCode.startLine,
            endLine: renderedCode.endLine,
            complete: renderedCode.complete,
          }
        : { startLine: 1, endLine: lineCount, complete: true },
      fingerprint: await fingerprintCode(location.slug, language, code),
    };
  }

  return {
    codeAvailable: false,
    problem,
    language,
    codeUnavailable: { reason: 'NO_VISIBLE_CODE_EDITOR' },
    fingerprint: null,
  };
}
