import { useEffect, useRef, useState } from "react";
import { Button, InlineMessage, type ButtonSize, type ButtonVariant } from "../../ui/index.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem } from "../../services/index.ts";
import { describeProblem } from "./ProblemMessage.tsx";
import { useSession } from "./SessionProvider.tsx";

export interface SignOutButtonProps {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Runs just before signing out (a protected screen first moves to the sign-in page). */
  readonly beforeSignOut?: () => void;
}

/** "Sign out", with its pending state, and why it failed if it did (the person is then still signed in). */
export function SignOutButton({ variant = "secondary", size = "md", beforeSignOut }: SignOutButtonProps) {
  const { signOut } = useSession();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={pending}
        onClick={async () => {
          setProblem(null);
          beforeSignOut?.();
          setPending(true);
          const result = await signOut();
          if (!mounted.current) return;
          setPending(false);
          if (!result.ok) setProblem(result.error);
        }}
      >
        {pending ? t("signedIn.signingOut") : t("glossary.signOut")}
      </Button>
      {problem && (
        <InlineMessage variant="error" heading={t("signedIn.signOutFailed")} live iconLabel={t("message.error")}>
          {describeProblem(problem, t).heading}
        </InlineMessage>
      )}
    </>
  );
}
