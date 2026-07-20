export function unicodeSafeTextChunks(value: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  let index = 0;
  while (index < value.length) {
    let end = Math.min(index + chunkSize, value.length);
    if (
      end < value.length &&
      value.charCodeAt(end - 1) >= 0xd800 &&
      value.charCodeAt(end - 1) <= 0xdbff &&
      value.charCodeAt(end) >= 0xdc00 &&
      value.charCodeAt(end) <= 0xdfff
    ) {
      end -= 1;
    }
    chunks.push(value.slice(index, end));
    index = end;
  }
  return chunks;
}
