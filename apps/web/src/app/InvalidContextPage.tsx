/**
 * Renders when a route pattern matched but a param did not resolve
 * against the fixture set (UI002 §8.1). Distinct from `NotFoundPage`.
 *
 * The message names only *which* segment failed (organization,
 * publication, edition, or release) — never *why* — so a completely
 * nonexistent id and an id that belongs to a different parent render
 * byte-identically (§8.1 rule 2, AC-07/AC-08). It never lists, names,
 * or counts any other organization's or publication's records
 * (AC-09).
 */
import { Link } from "react-router";
import { Container, Stack } from "../ui/index.ts";
import { ROUTE_HEADING_ID } from "./routes.ts";
import { useI18n } from "../i18n/index.ts";
import {
  fallbackPath,
  type InvalidContext,
} from "./contracts/route-context.ts";

const LEVEL_COPY = {
  organization: "invalid.organization",
  publication: "invalid.publication",
  edition: "invalid.edition",
  release: "invalid.release",
} as const satisfies Record<InvalidContext["level"], string>;

export interface InvalidContextPageProps {
  invalid: InvalidContext;
}

export function InvalidContextPage({ invalid }: InvalidContextPageProps) {
  const { t } = useI18n();
  const backHref = fallbackPath(invalid);
  return (
    <Container>
      <Stack gap="4">
        <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>
          {t("invalid.title")}
        </h1>
        <p className="pg-type-body">{t(LEVEL_COPY[invalid.level])}</p>
        <p className="pg-type-body">
          <Link to={backHref}>{t("invalid.back")}</Link>
        </p>
      </Stack>
    </Container>
  );
}
