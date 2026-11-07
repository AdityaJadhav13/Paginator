// The paper sign-up's pieces that need no database (src/modules/signup): the operator's command line
// (scripts/review-paper.ts), the slug made from a paper's name, and the emails.
import { describe, expect, it } from "vitest";
import { approvedEmail, confirmEmail, refusedEmail } from "../../src/modules/signup/emails.ts";
import { USAGE, parseReview, slugOf } from "../../src/modules/signup/review.ts";

const ID = "0193b6a0-0000-7000-8000-000000000001";

describe("review-paper's command line", () => {
  it("reads list, approve and refuse", () => {
    expect(parseReview(["list"], {})).toEqual({ command: "list", all: false });
    expect(parseReview(["list", "--all"], {})).toEqual({ command: "list", all: true });
    expect(parseReview(["approve", ID, "--by", "Operator"], {})).toEqual({
      command: "approve",
      id: ID,
      by: "Operator",
    });
    expect(parseReview(["approve", ID, "--slug", "kalpit-times"], { PGN_OPERATOR: "Env Operator" })).toEqual({
      command: "approve",
      id: ID,
      by: "Env Operator",
      slug: "kalpit-times",
    });
    expect(parseReview(["refuse", ID, "Weekly", "papers", "later", "--by", "Op"], {})).toEqual({
      command: "refuse",
      id: ID,
      by: "Op",
      reason: "Weekly papers later",
    });
    expect(parseReview(["refuse", ID], { PGN_OPERATOR: "Op" })).toEqual({
      command: "refuse",
      id: ID,
      by: "Op",
      reason: null,
    });
  });

  it("refuses a decision without an operator, a missing id, extra words and unknown options", () => {
    expect(parseReview(["approve", ID], {})).toContain("Say who decides");
    expect(parseReview(["approve", ID], { PGN_OPERATOR: "  " })).toContain("Say who decides");
    expect(parseReview(["approve"], { PGN_OPERATOR: "Op" })).toBe(USAGE);
    expect(parseReview(["approve", ID, "extra"], { PGN_OPERATOR: "Op" })).toBe(USAGE);
    expect(parseReview(["delete", ID], { PGN_OPERATOR: "Op" })).toBe(USAGE);
    expect(parseReview([], {})).toBe(USAGE);
    expect(parseReview(["list", "--force"], {})).toContain("Unknown option --force");
    expect(parseReview(["approve", ID, "--by"], {})).toContain("--by needs a value");
    expect(parseReview(["refuse", ID, "x".repeat(2001)], { PGN_OPERATOR: "Op" })).toContain("2000");
  });
});

describe("slugOf", () => {
  it("keeps ASCII letters and digits, joined by hyphens, at most 64 characters", () => {
    expect(slugOf("Kalpitpur Times (fictional)")).toBe("kalpitpur-times-fictional");
    expect(slugOf("  The  Daily -- News 24 ")).toBe("the-daily-news-24");
    expect(slugOf("काल्पनिक वार्ता")).toBe("");
    const long = slugOf(`${"a".repeat(63)} b`);
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });
});

describe("the emails", () => {
  const who = { ownerName: "Asha‮ Kalpit", paperName: "Kalpitpur <Samachar>" };
  it("put the paper's language first, and escape what the applicant typed", () => {
    const mr = confirmEmail({ ...who, language: "mr", url: "https://app.example.test/signup?confirm=x" });
    expect(mr.text.indexOf("नमस्कार")).toBeLessThan(mr.text.indexOf("Hello"));
    expect(mr.text).not.toContain("‮");
    expect(mr.html).toContain("Kalpitpur &lt;Samachar&gt;");
    const en = approvedEmail({ ...who, language: "en", url: "https://app.example.test/login" });
    expect(en.text.indexOf("Hello")).toBeLessThan(en.text.indexOf("नमस्कार"));
    expect(en.text).toContain("https://app.example.test/login");
  });

  it("say why only when a reason is given", () => {
    expect(refusedEmail({ ...who, language: "en", reason: null }).text).not.toContain("Why:");
    expect(refusedEmail({ ...who, language: "en", reason: "Dailies only." }).text).toContain("Why: Dailies only.");
  });
});
