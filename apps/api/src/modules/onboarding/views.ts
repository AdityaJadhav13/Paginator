// What the onboarding routes answer (packages/contracts/src/onboard.ts Onboarding), from a row of src/db/onboarding.ts.
import type { Onboarding } from "@pageinator/contracts";
import type { OnboardingRow } from "../../db/onboarding.ts";

export function onboardingView(row: OnboardingRow): Onboarding {
  const checks = new Map((row.checks ?? []).map((check) => [check.n, check]));
  return {
    id: row.id,
    state: row.state,
    progress: row.state === "working" ? (row.progress as Onboarding["progress"]) : null,
    files: row.files.map((file) => ({
      n: file.n,
      name: file.name,
      bytes: file.bytes,
      check: checks.get(file.n) ?? null,
    })),
    report: row.report,
    problem:
      row.problem !== null ? { code: row.problem, params: row.params, message: row.message ?? row.problem } : null,
    profileId: row.profile_id,
    createdBy: row.created_by_name !== null ? { id: row.created_by, name: row.created_by_name } : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
