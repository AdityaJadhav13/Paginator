import { useEffect, useRef, useState } from "react";
import { Button, Cluster, Dialog, InlineMessage, Stack, type ButtonSize, type ButtonVariant } from "../../ui/index.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem } from "../../services/index.ts";
import { describeProblem } from "./ProblemMessage.tsx";
import { useSession } from "./SessionProvider.tsx";
import { countDrafts } from "../stories/drafts.ts";

export interface SignOutButtonProps {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Runs just before signing out (a protected screen first moves to the sign-in page). */
  readonly beforeSignOut?: () => void;
}

/**
 * "Sign out", with its pending state, and why it failed if it did (the person is then still signed in). When stories
 * have unsaved text on this device, it says that signing out deletes it, and asks first.
 */
export function SignOutButton({ variant = "secondary", size = "md", beforeSignOut }: SignOutButtonProps) {
  const { signOut, state } = useSession();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [unsaved, setUnsaved] = useState(0);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const leave = async () => {
    setProblem(null);
    beforeSignOut?.();
    setPending(true);
    const result = await signOut();
    if (!mounted.current) return;
    setPending(false);
    if (!result.ok) setProblem(result.error);
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={pending}
        onClick={() => {
          const drafts = state.status === "ready" ? countDrafts(state.session.user.id) : 0;
          if (drafts > 0) setUnsaved(drafts);
          else void leave();
        }}
      >
        {pending ? t("signedIn.signingOut") : t("glossary.signOut")}
      </Button>
      {unsaved > 0 && (
      <Dialog
        open
        onClose={() => setUnsaved(0)}
        title={t("signOut.drafts.title")}
        closeLabel={t("shell.closeDialog")}
      >
        <Stack gap="4">
          <p>{t("signOut.drafts.body", { count: unsaved })}</p>
          <Cluster gap="3">
            <Button
              variant="danger"
              onClick={() => {
                setUnsaved(0);
                void leave();
              }}
            >
              {t("signOut.drafts.confirm")}
            </Button>
            <Button variant="secondary" onClick={() => setUnsaved(0)}>
              {t("security.cancel")}
            </Button>
          </Cluster>
        </Stack>
      </Dialog>
      )}
      {problem && (
        <InlineMessage variant="error" heading={t("signedIn.signOutFailed")} live iconLabel={t("message.error")}>
          {describeProblem(problem, t).heading}
        </InlineMessage>
      )}
    </>
  );
}
