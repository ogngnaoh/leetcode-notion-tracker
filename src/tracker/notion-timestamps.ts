// Notion date properties can discard seconds and milliseconds. Accept that exact
// normalization, not an arbitrary timestamp within a tolerance window.
export function matchesNotionTimestamp(stored: string | null, expected: string): boolean {
  if (stored === null) return false;
  const actual = Date.parse(stored);
  const wanted = Date.parse(expected);
  return (
    Number.isFinite(actual) &&
    Number.isFinite(wanted) &&
    (actual === wanted || actual === Math.floor(wanted / 60_000) * 60_000)
  );
}
