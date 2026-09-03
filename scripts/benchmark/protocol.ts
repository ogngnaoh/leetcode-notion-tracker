// Benchmark transport only; not installed or imported by the production extension.
const MAX_BYTES = 1_048_576;

export function frame(value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length === 0 || body.length > MAX_BYTES) throw new Error('Invalid frame size');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}

export class FrameReader {
  private pending: Buffer = Buffer.alloc(0);
  constructor(private readonly receive: (value: any) => void) {}
  push(chunk: Buffer): void {
    this.pending = Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= 4) {
      const size = this.pending.readUInt32LE();
      if (size === 0 || size > MAX_BYTES) throw new Error('Invalid frame size');
      if (this.pending.length < size + 4) return;
      const value: unknown = JSON.parse(this.pending.subarray(4, size + 4).toString('utf8'));
      this.pending = this.pending.subarray(size + 4);
      this.receive(value);
    }
  }
}
