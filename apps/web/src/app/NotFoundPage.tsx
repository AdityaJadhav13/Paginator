/**
 * Renders for any path that matches no route pattern at all (UI002
 * §8.2). Distinct from `InvalidContextPage`: this is "the route shape
 * is unrecognized," not "the route shape matched but a param did not
 * resolve."
 */
import { Link } from "react-router";
import { Container, Stack } from "../ui/index.ts";
import { ROUTE_HEADING_ID, paths } from "./routes.ts";

export function NotFoundPage() {
  return (
    <Container>
      <Stack gap="4">
        <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>
          Page not found
        </h1>
        <p className="pg-type-body">There is no page at this address.</p>
        <p className="pg-type-body">
          <Link to={paths.home()}>Return to the home page</Link>
        </p>
      </Stack>
    </Container>
  );
}
