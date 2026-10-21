/**
 * An `ApiProblem` in the reader's language: the catalogue's text for the API's code, a plain line for being offline,
 * the server failing or too many tries, and the request's reference when the server failed. A code the catalogue does
 * not know shows the API's own English message, marked as English.
 */
import { InlineMessage } from "../../ui/index.ts";
import { isCatalogueKey, useI18n, type CatalogueKey, type Translate } from "../../i18n/index.ts";
import type { ApiProblem } from "../../services/index.ts";

type ErrorKey = Extract<CatalogueKey, `error.${string}`>;

export interface ProblemText {
  readonly heading: string;
  readonly body?: string;
  /** "Reference: …", when the server failed and gave a request id. */
  readonly reference?: string;
  /** The API's own English message, for a code the catalogue does not know. */
  readonly fallback?: string;
}

export function describeProblem(problem: ApiProblem, t: Translate): ProblemText {
  if (problem.kind === "offline") return { heading: t("problem.offline.heading"), body: t("problem.offline.body") };
  if (problem.kind === "network") return { heading: t("problem.network.heading"), body: t("problem.network.body") };
  const { code, status } = problem;
  if (code === "slow_down" || status === 429) {
    return { heading: t("problem.slowDown.heading"), body: t("problem.slowDown.body") };
  }
  if (code === "cookie_refused") return { heading: t("problem.cookies.heading"), body: t("problem.cookies.body") };
  if (code === "unexpected_answer") {
    return { heading: t("problem.unexpected.heading"), body: t("problem.unexpected.body") };
  }
  if (code === "server_error" || status >= 500) {
    return {
      heading: t("problem.server.heading"),
      body: t("problem.server.body"),
      ...(problem.requestId ? { reference: t("problem.server.reference", { reference: problem.requestId }) } : {}),
    };
  }
  const key = `error.${code}`;
  if (isCatalogueKey(key)) return { heading: t(key as ErrorKey) };
  return { heading: t("problem.other.heading"), ...(problem.message ? { fallback: problem.message } : {}) };
}

export interface ProblemMessageProps {
  readonly problem: ApiProblem;
  /** True when a person's own action caused it (role="alert"); false for a problem already there on arrival. */
  readonly live?: boolean;
}

export function ProblemMessage({ problem, live = true }: ProblemMessageProps) {
  const { t } = useI18n();
  const text = describeProblem(problem, t);
  const hasBody = Boolean(text.body || text.reference || text.fallback);
  return (
    <InlineMessage variant="error" heading={text.heading} live={live} iconLabel={t("message.error")}>
      {hasBody && (
        <>
          {text.body}
          {text.reference && <> {text.reference}</>}
          {text.fallback && <span lang="en">{text.fallback}</span>}
        </>
      )}
    </InlineMessage>
  );
}
