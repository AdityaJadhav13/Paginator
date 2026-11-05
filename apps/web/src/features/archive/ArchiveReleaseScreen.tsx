/**
 * An archived release, /org/:orgId/pub/:pubId/archive/:releaseId (doc 06 §10.1; GET …/archive/releases/:id,
 * archive.view): the edition's releases (late corrections among them, each linked), and this one as the Release tab
 * shows it (ReleaseItem): its files with SHA-256 and bytes, the download of the exact archived version (export.press
 * only), the archive's retention and check, the receipts and the print profile it pinned. A release the API does not
 * give (404: none, or another publication's) is "Not available", the same either way.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Badge, Button, PageHeader, Panel, ProgressIndicator, Stack } from "../../ui/index.ts";
import { ROUTE_HEADING_ID, paths } from "../../app/routes.ts";
import { formatDate, formatDateTime } from "../../i18n/dates.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem } from "../../services/index.ts";
import type { ArchiveReleaseDto } from "../../services/release-service.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { layoutAccess } from "../layout/access.ts";
import { useRelease } from "../release/release-context.tsx";
import { ReleaseItem } from "../release/ReleaseTab.tsx";
import "./archive.css";

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem }
  | { readonly status: "ready"; readonly value: ArchiveReleaseDto };

export function ArchiveReleaseScreen() {
  const { orgId = "", pubId = "", releaseId = "" } = useParams<{ orgId: string; pubId: string; releaseId: string }>();
  const { state } = useSession();
  const { t, language } = useI18n();
  const release = useRelease();
  const org =
    state.status === "ready"
      ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId)
      : undefined;
  const access = layoutAccess(org, pubId);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const ask = useRef(0);

  const fetchRelease = useCallback(
    async (quiet: boolean) => {
      const mine = ++ask.current;
      if (!quiet) setLoad({ status: "loading" });
      const result = await release.archiveRelease({ orgId, pubId, releaseId });
      if (mine !== ask.current) return;
      setLoad(result.ok ? { status: "ready", value: result.value } : { status: "failed", problem: result.error });
    },
    [release, orgId, pubId, releaseId],
  );
  useEffect(() => {
    if (access.archive) void fetchRelease(false);
  }, [fetchRelease, access.archive]);

  const back = (
    <p>
      <Link to={paths.pubArchive(orgId, pubId)}>{t("archive.back")}</Link>
    </p>
  );
  const missing = load.status === "failed" && load.problem.kind === "answer" && load.problem.status === 404;
  if (!access.archive || missing) {
    return (
      <Stack gap="4">
        <PageHeader title={t("archive.notAvailable")} headingId={ROUTE_HEADING_ID} />
        <p>{t("archive.notAvailableBody")}</p>
        {back}
      </Stack>
    );
  }
  if (load.status !== "ready") {
    return (
      <Stack gap="4">
        <PageHeader title={t("glossary.archive")} headingId={ROUTE_HEADING_ID} />
        <OfflineNotice />
        {load.status === "loading" ? (
          <ProgressIndicator role="status" label={t("archive.loading")} />
        ) : (
          <Stack gap="3">
            <ProblemMessage problem={load.problem} />
            <div>
              <Button variant="secondary" onClick={() => void fetchRelease(false)}>
                {t("form.retry")}
              </Button>
            </div>
          </Stack>
        )}
        {back}
      </Stack>
    );
  }

  const { release: item, edition } = load.value;
  const titleOf = (r: { number: number; kind: string }) =>
    r.kind === "correction" ? t("archive.correction", { number: r.number }) : t("archive.release", { number: r.number });
  return (
    <Stack gap="5">
      <PageHeader
        title={t("archive.edition", { date: formatDate(edition.date, language) })}
        headingId={ROUTE_HEADING_ID}
        subtitle={t("archive.kept", { date: formatDate(item.archive.retainUntil, language) })}
      />
      <OfflineNotice />
      {back}
      <Panel title={t("archive.releases")}>
        <Stack gap="4">
          <ul className="pg-layout__list">
            {edition.releases.map((r) => (
              <li key={r.id}>
                {r.id === item.id ? (
                  <strong aria-current="page">{t("archive.thisOne", { title: titleOf(r) })}</strong>
                ) : (
                  <Link to={paths.pubArchiveRelease(orgId, pubId, r.id)}>{titleOf(r)}</Link>
                )}{" "}
                {r.kind === "correction" && <Badge tone="warning">{t("archive.kind.correction")}</Badge>}{" "}
                <span className="pg-layout__note">
                  {t("archive.approved", { time: formatDateTime(r.approvedAt, language) })}
                </span>
              </li>
            ))}
          </ul>
          <ReleaseItem
            where={{ orgId, pubId }}
            item={item}
            access={access}
            onChanged={() => void fetchRelease(true)}
          />
        </Stack>
      </Panel>
    </Stack>
  );
}
