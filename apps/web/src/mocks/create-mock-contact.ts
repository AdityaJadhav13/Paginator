/**
 * The contact form's test double: it keeps what was sent, so a test can see it, and answers with the outcome the test
 * chose ("sent" by default). It sends nothing anywhere.
 */
import type { ContactConnection, ContactOutcome, ContactRequestDto, ContactService } from "../services/index.ts";

export interface MockContactController {
  /** The messages sent so far, in order. */
  readonly sent: readonly ContactRequestDto[];
  /** The outcome of every later message. */
  setOutcome(outcome: ContactOutcome): void;
  /** What GET /api/v1/contact answers ("connected" by default). */
  setConnection(connection: ContactConnection): void;
  /** Holds every later answer until `release()` (to see the "Sending…" state). */
  hold(): void;
  release(): void;
  reset(): void;
}

export function createMockContact(): { contact: ContactService; contactController: MockContactController } {
  const sent: ContactRequestDto[] = [];
  let outcome: ContactOutcome = { kind: "sent" };
  let connection: ContactConnection = "connected";
  let held: (() => void)[] | null = null;
  return {
    contact: {
      async connection() {
        // answered on a later turn, so a test may choose the answer right after rendering
        await new Promise((resolve) => setTimeout(resolve, 0));
        return connection;
      },
      async send(request) {
        sent.push(structuredClone(request));
        const answer = outcome;
        if (held) await new Promise<void>((resolve) => held?.push(resolve));
        return answer;
      },
    },
    contactController: {
      sent,
      setOutcome(next) {
        outcome = next;
      },
      setConnection(next) {
        connection = next;
      },
      hold() {
        held = [];
      },
      release() {
        const waiting = held ?? [];
        held = null;
        for (const resolve of waiting) resolve();
      },
      reset() {
        sent.length = 0;
        outcome = { kind: "sent" };
        connection = "connected";
        this.release();
      },
    },
  };
}
