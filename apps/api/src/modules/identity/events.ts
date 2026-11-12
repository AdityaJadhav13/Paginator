// Sign-in events (docs/product/10-l2-newsroom-plan.md §3.4): identity.auth_event records each sign-in, wrong password,
// lock, sign-out, verified email, password reset or change, and revoked or expired session, with the address and the
// browser; Account → Security shows them (PR 14). A sign-in from a browser not used for 90 days emails its person,
// except a person's very first sign-in.
import type { AuthEvent, IdentityStore } from "../../db/identity.ts";
import { type Mailer, RecipientError } from "../notifications/mailer.ts";
import { newSignInEmail } from "./emails.ts";

export type SignIn = {
  userId: string;
  sessionId: string;
  ip: string | null;
  userAgent: string | null;
  name: string;
  email: string;
  at: Date;
};

export type AuthEvents = {
  record(event: AuthEvent): Promise<void>;
  /** Records a sign-in, and emails its person when it came from a browser they have not used lately. */
  signedIn(signIn: SignIn): Promise<void>;
};

export function authEvents(store: IdentityStore, mailer: Mailer): AuthEvents {
  return {
    record: (event) => store.recordEvent(event),
    async signedIn(signIn) {
      const history = await store.signInHistory(signIn.userId, signIn.userAgent);
      await store.recordEvent({
        userId: signIn.userId,
        kind: "sign_in",
        sessionId: signIn.sessionId,
        ip: signIn.ip,
        userAgent: signIn.userAgent,
      });
      if (!history.before || history.sameBrowser) return;
      const mail = newSignInEmail({ name: signIn.name, at: signIn.at, device: signIn.userAgent ?? "" });
      try {
        mailer.send({ ...mail, to: signIn.email });
      } catch (error) {
        // an address we cannot send to does not stop the sign-in; sign-up refuses such addresses anyway
        if (!(error instanceof RecipientError)) throw error;
      }
    },
  };
}
