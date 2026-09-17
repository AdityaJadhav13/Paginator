/**
 * EditorShell (UI002 §7.3). Wraps only the editor route (§6 row 33).
 * Deliberately minimal — no persistent sidebar, no publication
 * switcher, no breadcrumb trail: the "Exit editor" link is the only
 * way back, and no page-navigator/canvas chrome is implied since none
 * exists yet (that is UI015–018).
 */
import { Outlet, Link, useParams } from "react-router";
import { Container, Inline, Cluster } from "../../ui/index.ts";
import { SkipLink } from "../SkipLink.tsx";
import { StatusSurface } from "../StatusSurface.tsx";
import { InvalidContextPage } from "../InvalidContextPage.tsx";
import { NotFoundPage } from "../NotFoundPage.tsx";
import { MAIN_LANDMARK_ID, paths } from "../routes.ts";
import {
  resolveWorkspaceContext,
  useWorkspaceFixtures,
  type InvalidContext,
} from "../contracts/route-context.ts";

export interface EditorShellProps {
  notFound?: boolean;
}

export function EditorShell({ notFound = false }: EditorShellProps) {
  const params = useParams<{ orgId?: string; pubId?: string; editionId?: string }>();
  const fixtures = useWorkspaceFixtures();
  const resolution = resolveWorkspaceContext(fixtures, params);

  if (resolution.status === "invalid") {
    return (
      <div
        className="pg-shell pg-shell--editor"
        dir={resolution.publication?.direction ?? "ltr"}
        lang={resolution.publication?.locale ?? "en-IN"}
      >
        <SkipLink />
        <main id={MAIN_LANDMARK_ID} tabIndex={-1}>
          <Container>
            {notFound ? (
              <NotFoundPage />
            ) : (
              <InvalidContextPage invalid={resolution} fixtures={fixtures} />
            )}
          </Container>
        </main>
      </div>
    );
  }

  const { organization, publication, edition } = resolution;
  if (!publication || !edition) {
    // Structurally unreachable: the editor route pattern always
    // includes :pubId/:editionId, so a resolved context always
    // includes them. Defensive fallback rather than a thrown error.
    const invalid: InvalidContext = { status: "invalid", level: "edition", organization };
    return (
      <div className="pg-shell pg-shell--editor">
        <SkipLink />
        <main id={MAIN_LANDMARK_ID} tabIndex={-1}>
          <Container>
            <InvalidContextPage invalid={invalid} fixtures={fixtures} />
          </Container>
        </main>
      </div>
    );
  }

  return (
    <div className="pg-shell pg-shell--editor" dir={publication.direction} lang={publication.locale}>
      <SkipLink />
      <header className="pg-shell__header pg-shell__header--editor">
        <Container>
          <Inline gap="4" wrap="wrap" align="center">
            <span className="pg-type-label">
              Edition <code className="pg-type-code">{edition.id}</code>
            </span>
            <Cluster gap="3" justify="end">
              <StatusSurface subject={edition.label} />
              <Link to={paths.editionContent(organization.id, publication.id, edition.id)}>
                Exit editor
              </Link>
            </Cluster>
          </Inline>
        </Container>
      </header>
      <main id={MAIN_LANDMARK_ID} tabIndex={-1}>
        <Container>
          {notFound ? <NotFoundPage /> : <Outlet />}
        </Container>
      </main>
    </div>
  );
}
