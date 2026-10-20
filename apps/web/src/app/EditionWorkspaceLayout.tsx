/**
 * Tab layout for the edition workspace (§6 rows 27–32): content,
 * generate, preflight, export, plus the reserved, disabled
 * edition-planning nav entry (§9.4, BLV2-02). `WorkspaceShell` has
 * already resolved org/publication/edition validity before this
 * layout is reached — if this component renders at all, the params
 * below are guaranteed present and valid.
 */
import { Outlet, Link, useParams } from "react-router";
import { Stack, Cluster, Button } from "../ui/index.ts";
import { paths, ROUTE_LABELS } from "./routes.ts";

const EDITION_PLAN_REASON_ID = "pg-edition-plan-reason";

export function EditionWorkspaceLayout() {
  const { orgId, pubId, editionId } = useParams<{
    orgId: string;
    pubId: string;
    editionId: string;
  }>();

  if (!orgId || !pubId || !editionId) {
    // Structurally unreachable: WorkspaceShell only renders this
    // layout's <Outlet/> branch once all three params have resolved.
    return null;
  }

  const tabs = [
    { label: ROUTE_LABELS.editionContent, to: paths.editionContent(orgId, pubId, editionId) },
    { label: ROUTE_LABELS.editionGenerate, to: paths.editionGenerate(orgId, pubId, editionId) },
    { label: ROUTE_LABELS.editionPreflight, to: paths.editionPreflight(orgId, pubId, editionId) },
    { label: ROUTE_LABELS.editionExport, to: paths.editionExport(orgId, pubId, editionId) },
  ];

  return (
    <Stack gap="4">
      <nav aria-label="Edition" className="pg-shell__nav">
        <Cluster gap="4">
          {tabs.map((tab) => (
            <Link key={tab.to} to={tab.to}>
              {tab.label}
            </Link>
          ))}
          <Button variant="quiet" size="sm" denied aria-describedby={EDITION_PLAN_REASON_ID}>
            {ROUTE_LABELS.editionPlan}
          </Button>
        </Cluster>
        <p id={EDITION_PLAN_REASON_ID} className="pg-type-caption">
          Edition planning is not yet available — reserved for UI027.
        </p>
      </nav>
      <Outlet />
    </Stack>
  );
}
