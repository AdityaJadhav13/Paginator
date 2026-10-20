/**
 * Moves focus to the new route's heading and announces its text via a
 * polite live region after every client-side navigation (UI002 §7.6,
 * AC-16). The initial page load is not announced, matching UI001
 * §5.1's initial-render rule.
 *
 * Generic and demo-independent: it locates the heading by the shared
 * `ROUTE_HEADING_ID` convention rather than importing anything
 * route-specific.
 */
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { VisuallyHidden } from "../ui/index.ts";
import { ROUTE_HEADING_ID } from "./routes.ts";

export function RouteAnnouncer() {
  const location = useLocation();
  const [announcement, setAnnouncement] = useState("");
  const previousPathname = useRef(location.pathname);

  useEffect(() => {
    // React.StrictMode replays mount effects in development. Comparing
    // pathnames keeps both initial mount passes silent while still
    // detecting a later navigation back to the initial pathname.
    if (previousPathname.current === location.pathname) {
      return;
    }
    previousPathname.current = location.pathname;
    const focusHeading = () => {
      const heading = document.getElementById(ROUTE_HEADING_ID);
      if (!(heading instanceof HTMLElement) || heading.hasAttribute("data-pg-transient-route-heading")) return false;
      if (!heading.hasAttribute("tabindex")) {
        heading.setAttribute("tabindex", "-1");
      }
      heading.focus();
      setAnnouncement(heading.textContent?.trim() ?? "");
      return true;
    };
    if (focusHeading()) return;
    const observer = new MutationObserver(() => {
      if (focusHeading()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
    // Depend on location.pathname specifically: a query-string-only
    // change is not a page navigation for focus/announcement purposes.
  }, [location.pathname]);

  return (
    <VisuallyHidden role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </VisuallyHidden>
  );
}
