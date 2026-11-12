/**
 * The contact form's service (src/services/contact-service.ts): the API in the app, the test double in tests. The
 * public pages and the public shell's header read it here, never the API directly.
 *
 * `useContactConnection` is the one answer to "does the form send?" for the whole page: asked once per service (one
 * per page load) and kept for the session; only "unknown" (no answer) is asked again by the next component that
 * needs it. Every "Book a demo" depends on it: shown only when connected, never while checking.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { ContactConnection, ContactService } from "../../services/index.ts";

const ContactContext = createContext<ContactService | null>(null);

export function ContactProvider({ contact, children }: { readonly contact: ContactService; readonly children: ReactNode }) {
  return <ContactContext.Provider value={contact}>{children}</ContactContext.Provider>;
}

const NOT_CONNECTED: ContactService = {
  connection: async () => "notConnected",
  send: async () => ({ kind: "unavailable" }),
};

/** The contact service; without a provider, a form that is not connected. */
export function useContact(): ContactService {
  return useContext(ContactContext) ?? NOT_CONNECTED;
}

/** One question to the API per service and page load; "unknown" (no answer) is asked again next time. */
const ASKED = new WeakMap<ContactService, Promise<ContactConnection>>();
/** The answer once it came, so a page opened after it starts with it: no button that appears a moment later. */
const ANSWERED = new WeakMap<ContactService, ContactConnection>();

/** Whether the form is connected: "checking" until the API answers. */
export function useContactConnection(): ContactConnection | "checking" {
  const contact = useContact();
  const [connection, setConnection] = useState<ContactConnection | "checking">(() => ANSWERED.get(contact) ?? "checking");
  useEffect(() => {
    let current = true;
    let asking = ASKED.get(contact);
    if (!asking) {
      asking = contact.connection().catch((): ContactConnection => "unknown");
      ASKED.set(contact, asking);
    }
    void asking.then((answer) => {
      if (answer === "unknown") ASKED.delete(contact);
      else ANSWERED.set(contact, answer);
      if (current) setConnection(answer);
    });
    return () => {
      current = false;
    };
  }, [contact]);
  return connection;
}
