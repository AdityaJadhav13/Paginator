import { Link } from "react-router";
import { Container } from "../../ui/index.ts";
import { NotFoundPage } from "../NotFoundPage.tsx";
import { SkipLink } from "../SkipLink.tsx";
import { MAIN_LANDMARK_ID, paths } from "../routes.ts";

export function ScopedNotFoundShell({ editor = false }: { readonly editor?: boolean }) {
  return (
    <div className={`pg-shell ${editor ? "pg-shell--editor" : "pg-shell--workspace"}`}>
      <SkipLink />
      <header className="pg-shell__header"><Container><Link to={paths.home()} className="pg-shell__brand pg-type-section-title">Pageinator</Link></Container></header>
      <main id={MAIN_LANDMARK_ID} tabIndex={-1}><Container><NotFoundPage /></Container></main>
    </div>
  );
}
