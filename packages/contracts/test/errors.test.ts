import { describe, expect, it } from "vitest";
import { ERROR_CODES, ErrorEnvelope } from "../src/index.ts";

const notFound = { error: { code: "not_found", message: "There is nothing here.", requestId: "req-1" } };

describe("error envelope", () => {
  it("accepts the documented shape, with or without field details", () => {
    expect(ErrorEnvelope.parse(notFound)).toEqual(notFound);
    const invalid = {
      error: { ...notFound.error, code: "invalid_request", details: [{ field: "body.headline", message: "Required" }] },
    };
    expect(ErrorEnvelope.parse(invalid)).toEqual(invalid);
  });

  it("refuses unknown codes, extra keys, empty details and a missing request id", () => {
    const bad = [
      { error: { ...notFound.error, code: "teapot" } },
      { error: { ...notFound.error, stack: "at handler (app.ts:1:1)" } },
      { error: { ...notFound.error, details: [] } },
      { error: { code: "not_found", message: "There is nothing here." } },
      { ...notFound, statusCode: 404 },
    ];
    for (const value of bad) expect(ErrorEnvelope.safeParse(value).success, JSON.stringify(value)).toBe(false);
  });

  it("lists each code once, in snake_case", () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const code of ERROR_CODES) expect(code).toMatch(/^[a-z]+(_[a-z]+)*$/);
  });
});
