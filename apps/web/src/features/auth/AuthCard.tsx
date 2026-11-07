/**
 * The sign-in screens' layout (03 §5.1): one centred card, 400 px wide at most and fluid below, holding the screen's
 * only h1 (the route heading the RouteAnnouncer focuses).
 */
import type { ReactNode } from "react";
import { Container, Stack, Surface } from "../../ui/index.ts";
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import "./auth.css";

export function AuthCard({
  title,
  wide = false,
  children,
}: {
  readonly title: string;
  /** The account's own pages: a wider card (--pg-account-measure). */
  readonly wide?: boolean;
  readonly children?: ReactNode;
}) {
  return (
    <Container>
      <div className="pg-auth">
        <Surface
          as="section"
          className={wide ? "pg-auth__card pg-auth__card--wide" : "pg-auth__card"}
          aria-labelledby={ROUTE_HEADING_ID}
        >
          <Stack gap="5">
            <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>
              {title}
            </h1>
            {children}
          </Stack>
        </Surface>
      </div>
    </Container>
  );
}
