export function problemExternalKey(slug: string): string {
  const normalized = slug.trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(normalized)) {
    throw new Error(`Invalid LeetCode slug: ${slug}`);
  }
  return `leetcode:${normalized}`;
}

export function attemptTitle(problemTitle: string, attemptedAt: string): string {
  const date = new Date(attemptedAt);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid attempt timestamp: ${attemptedAt}`);
  }
  const stamp = date.toISOString().replace('T', ' ').slice(0, 16);
  return `${problemTitle} — ${stamp}`;
}
