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
import {
  fallbackPath,
  type InvalidContext,
} from "./contracts/route-context.ts";

const LEVEL_COPY: Record<InvalidContext["level"], string> = {
  organization: "This organization is not available.",
  publication: "This publication is not available in this organization.",
  edition: "This edition is not available in this publication.",
  release: "This archive release is not available in this publication.",
};

export interface InvalidContextPageProps {
  invalid: InvalidContext;
}

export function InvalidContextPage({ invalid }: InvalidContextPageProps) {
  const backHref = fallbackPath(invalid);
  return (
    <Container>
      <Stack gap="4">
        <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>
          Not available
        </h1>
        <p className="pg-type-body">{LEVEL_COPY[invalid.level]}</p>
        <p className="pg-type-body">
          <Link to={backHref}>Return to a valid workspace page</Link>
        </p>
      </Stack>
    </Container>
  );
}
