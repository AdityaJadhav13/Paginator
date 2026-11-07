/**
 * The paper sign-up's test double: it keeps the applications and tokens it was given, so a test can see them, and
 * answers with the outcome the test chose ("sent" and "waiting" by default). It sends nothing anywhere.
 */
import type {
  PaperConfirmOutcome,
  PaperDetailsDto,
  PaperSignupOutcome,
  PaperSignupRequestDto,
  PaperSignupService,
} from "../services/index.ts";

export interface MockPaperSignupController {
  readonly sent: readonly PaperSignupRequestDto[];
  readonly confirmed: readonly string[];
  setOutcome(outcome: PaperSignupOutcome): void;
  setConfirm(outcome: PaperConfirmOutcome): void;
  /** What the paper's details answer; null: 404. */
  setPaper(paper: PaperDetailsDto | null): void;
  reset(): void;
}

const PAPER: PaperDetailsDto = { name: "Konkan Coastal Times", languages: ["mr", "en"], primaryLanguage: "mr" };

export function createMockPaperSignup(): { paperSignup: PaperSignupService; paperSignupController: MockPaperSignupController } {
  const sent: PaperSignupRequestDto[] = [];
  const confirmed: string[] = [];
  let outcome: PaperSignupOutcome = { kind: "sent" };
  let confirm: PaperConfirmOutcome = "waiting";
  let paper: PaperDetailsDto | null = PAPER;
  return {
    paperSignup: {
      async apply(request) {
        sent.push(structuredClone(request));
        return outcome;
      },
      async confirm(token) {
        confirmed.push(token);
        return confirm;
      },
      async paper() {
        return paper
          ? { ok: true, value: paper }
          : { ok: false, error: { kind: "answer", status: 404, code: "not_found", message: "" } };
      },
    },
    paperSignupController: {
      sent,
      confirmed,
      setOutcome(next) {
        outcome = next;
      },
      setConfirm(next) {
        confirm = next;
      },
      setPaper(next) {
        paper = next;
      },
      reset() {
        sent.length = 0;
        confirmed.length = 0;
        outcome = { kind: "sent" };
        confirm = "waiting";
        paper = PAPER;
      },
    },
  };
}
