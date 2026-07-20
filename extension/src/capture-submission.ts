import type { CaptureEvent, CaptureResult } from '../../src/shared/contract.js';

export type CaptureRequestDisposition = 'definitive' | 'uncertain';

export class CaptureRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly disposition: CaptureRequestDisposition,
  ) {
    super(message);
    this.name = 'CaptureRequestError';
  }
}

export class CaptureSubmissionCoordinator {
  private pendingEvent: CaptureEvent | null = null;

  get hasPending(): boolean {
    return this.pendingEvent !== null;
  }

  async submit(
    buildEvent: () => CaptureEvent,
    sendEvent: (event: CaptureEvent) => Promise<CaptureResult>,
  ): Promise<CaptureResult> {
    const event = this.pendingEvent ?? buildEvent();
    this.pendingEvent = event;

    try {
      const result = await sendEvent(event);
      this.pendingEvent = null;
      return result;
    } catch (error) {
      if (error instanceof CaptureRequestError && error.disposition === 'definitive') {
        this.pendingEvent = null;
      }
      throw error;
    }
  }
}
