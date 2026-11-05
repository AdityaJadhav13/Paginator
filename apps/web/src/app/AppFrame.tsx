/**
 * The signed-in app's frame (02 §3.4): a 56 px top bar (the wordmark, the organization and publication switchers, then
 * notifications, the language switch and the account menu), a 240 px sidebar that collapses to a 56 px icon rail (the
 * choice remembered on this device), and the content on a grey canvas within a 1,440 px measure. Below 768 px the
 * sidebar is a sheet opened from the top bar's menu button. Its root carries `.pg-app`, which scopes the app's tokens
 * (ui/app-tokens.css) so the public website keeps its own look.
 */
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { Avatar, Icon, IconButton, type IconName } from "../ui/index.ts";
import { SkipLink } from "./SkipLink.tsx";
import { MAIN_LANDMARK_ID, paths } from "./routes.ts";
import { activeRole, useSession } from "../features/auth/SessionProvider.tsx";
import { SignOutButton } from "../features/auth/SignOutButton.tsx";
import type { NavEntry } from "../features/people/navigation.ts";
import { roleName } from "../features/people/roles.ts";
import { LanguageSwitch, useI18n, type PlainKey } from "../i18n/index.ts";
import "./frame.css";

/** Each navigation entry's icon (02 §3.6), by its label. */
const NAV_ICONS: Partial<Record<PlainKey, IconName>> = {
  "nav.home": "house",
  "glossary.overview": "house",
  "nav.editions": "newspaper",
  "glossary.stories": "file-text",
  "nav.media": "images",
  "nav.ads": "megaphone",
  "nav.templates": "layout-template",
  "nav.newsroom": "rss",
  "nav.sources": "radio-tower",
  "glossary.archive": "archive",
  "nav.brand": "palette",
  "nav.printProfiles": "printer",
  "nav.engineProfile": "settings",
  "glossary.team": "users",
  "nav.audit": "scroll-text",
  "nav.orgSettings": "settings",
  "nav.publicationSettings": "settings",
  "nav.billing": "credit-card",
  "nav.storage": "hard-drive",
};

/** Where the sidebar's collapsed state is remembered on this device. */
export const SIDEBAR_STORAGE_KEY = "pageinator.sidebar.collapsed";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean) {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // a browser that refuses storage still collapses, for this visit
  }
}

export interface AppFrameProps {
  dir: "ltr" | "rtl";
  lang: string;
  /** The navigation: its landmark name and its entries (absent while the route resolves, or when denied). */
  nav?: { readonly label: string; readonly entries: readonly NavEntry[]; readonly homeTo: string };
  /** The organization and publication switchers. */
  context?: ReactNode;
  /** The notifications button. */
  notifications?: ReactNode;
  /** Above the content: the breadcrumb trail. */
  breadcrumbs?: ReactNode;
  children: ReactNode;
}

export function AppFrame({ dir, lang, nav, context, notifications, breadcrumbs, children }: AppFrameProps) {
  const { t } = useI18n();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const sidebarId = useId();

  // a page chosen in the phone's sheet closes it
  useEffect(() => setOpen(false), [location.pathname]);

  // the phone's sheet is modal (the top bar and the page are inert while it is open): focus moves into it; Esc or
  // its close button closes it and returns to the menu button (flushSync: the button is inert until the sheet closes)
  const sidebar = useRef<HTMLElement>(null);
  const closeSheet = () => {
    flushSync(() => setOpen(false));
    toggle.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    sidebar.current?.querySelector<HTMLElement>("a[href]")?.focus();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeSheet();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const publication = nav?.entries.filter((entry) => entry.to.includes("/pub/")) ?? [];
  const organization = nav?.entries.filter((entry) => !entry.to.includes("/pub/")) ?? [];
  const groups = [
    { label: t("shell.publication"), entries: publication },
    { label: t("shell.organization"), entries: organization },
  ].filter((group) => group.entries.length > 0);

  return (
    <div
      className={`pg-shell pg-shell--workspace pg-app${collapsed ? " pg-app--collapsed" : ""}${nav ? "" : " pg-app--no-nav"}`}
      dir={dir}
      lang={lang}
    >
      <SkipLink label={t("shell.skipLink")} />
      <header className="pg-app__topbar" inert={open}>
        {nav && (
          <button
            ref={toggle}
            type="button"
            aria-label={open ? t("shell.hideNav", { section: nav.label }) : t("shell.showNav", { section: nav.label })}
            className="pg-icon-button pg-app__menu-toggle"
            aria-expanded={open}
            aria-controls={sidebarId}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name={open ? "x" : "menu"} size={20} />
          </button>
        )}
        <Link to={paths.home()} className="pg-app__brand" lang="en">
          <span className="pg-app__brand-mark" aria-hidden="true">
            P
          </span>
          Pageinator
        </Link>
        {context && <div className="pg-app__context">{context}</div>}
        <div className="pg-app__actions">
          {notifications}
          <div className="pg-app__language">
            <LanguageSwitch />
          </div>
          <AccountMenu />
        </div>
      </header>
      <div className="pg-app__body">
        {nav && (
          <div className="pg-app__sidebar-column">
            <nav
              id={sidebarId}
              aria-label={nav.label}
              ref={sidebar}
              className={`pg-app__sidebar${open ? " pg-app__sidebar--open" : ""}`}
            >
              {open && (
                <div className="pg-app__sheet-head">
                  <button
                    type="button"
                    className="pg-icon-button"
                    aria-label={t("shell.closeNav")}
                    onClick={closeSheet}
                  >
                    <Icon name="x" size={20} />
                  </button>
                </div>
              )}
              <div className="pg-app__nav-scroll">
                {groups.map((group) => (
                  <div key={group.label} className="pg-app__nav-group">
                    <p className="pg-app__nav-group-label" aria-hidden={groups.length < 2 || undefined}>
                      {group.label}
                    </p>
                    <ul className="pg-app__nav-list">
                      {group.entries.map((entry) => {
                        const label = t(entry.label);
                        return (
                          <li key={entry.to}>
                            <NavLink
                              to={entry.to}
                              end={entry.to === nav.homeTo}
                              className="pg-app__nav-link"
                              title={collapsed ? label : undefined}
                            >
                              <Icon name={NAV_ICONS[entry.label] ?? "file-text"} size={20} />
                              <span className="pg-app__nav-label">{label}</span>
                            </NavLink>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
              <div className="pg-app__nav-footer">
                <IconButton
                  label={collapsed ? t("shell.expandNav") : t("shell.collapseNav")}
                  title={collapsed ? t("shell.expandNav") : t("shell.collapseNav")}
                  className="pg-app__collapse"
                  onClick={() => {
                    setCollapsed(!collapsed);
                    writeCollapsed(!collapsed);
                  }}
                >
                  <Icon name={collapsed ? "panel-left-open" : "panel-left-close"} size={20} />
                </IconButton>
              </div>
            </nav>
            {open && <div className="pg-app__scrim" aria-hidden="true" onClick={() => setOpen(false)} />}
          </div>
        )}
        <main id={MAIN_LANDMARK_ID} tabIndex={-1} className="pg-app__main" inert={open}>
          <div className="pg-app__content">
            {breadcrumbs}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * The account menu: the avatar button opens a panel with the person's name, email and role, Account security, Back to
 * public site, and Sign out. It is a disclosure (links and the sign-out button keep their own roles, and Sign out's
 * own confirmation dialog lives inside it); Esc, a click outside or Tab out of it closes it.
 */
function AccountMenu() {
  const { state } = useSession();
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => setOpen(false), [location.pathname]);
  // Tab out of the panel closes it; focus moving into Sign out's dialog stays inside `root`, so the panel stays open
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (open && next && !root.current?.contains(next)) setOpen(false);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!root.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  if (state.status !== "ready") return null;
  const { user } = state.session;
  const { workspace } = state;
  const inWorkspace = location.pathname.startsWith("/org/");

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Esc inside Sign out's confirmation closes that dialog only
    if (event.key !== "Escape" || !open || (event.target as Element).closest("dialog")) return;
    event.preventDefault();
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div ref={root} className="pg-account" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button
        ref={button}
        type="button"
        className="pg-account__button"
        aria-label={t("shell.account", { name: user.name })}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar name={user.name} size="sm" decorative />
        {/* who is signed in, and as what, stays in sight (a newsroom shares its computers) */}
        <span className="pg-account__summary" aria-hidden="true">
          <bdi>{user.name}</bdi>
          {workspace && <> · {roleName(activeRole(workspace), t)}</>}
        </span>
      </button>
      <div id={panelId} className="pg-account__panel" hidden={!open}>
        {open && (
          <>
            <div className="pg-account__who">
              <Avatar name={user.name} size="lg" decorative />
              <div className="pg-account__names">
                <bdi className="pg-account__name">{user.name}</bdi>
                <span className="pg-account__detail">{user.email}</span>
                {workspace && <span className="pg-account__detail">{roleName(activeRole(workspace), t)}</span>}
              </div>
            </div>
            <ul className="pg-account__links">
              {workspace && !inWorkspace && (
                <li>
                  <Link to={paths.orgHome(workspace.activeOrganizationId)} className="pg-account__link">
                    <Icon name="building-2" size={20} />
                    {t("signedIn.openWorkspace")}
                  </Link>
                </li>
              )}
              <li>
                <Link to={paths.accountSecurity()} className="pg-account__link">
                  <Icon name="shield-check" size={20} />
                  {t("shell.accountSecurity")}
                </Link>
              </li>
              <li>
                <Link to={paths.home()} className="pg-account__link">
                  <Icon name="globe" size={20} />
                  {t("shell.backToPublic")}
                </Link>
              </li>
            </ul>
            <div className="pg-account__sign-out">
              <SignOutButton
                variant="secondary"
                size="sm"
                beforeSignOut={() => {
                  if (inWorkspace) navigate(paths.login(), { replace: true, flushSync: true });
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
