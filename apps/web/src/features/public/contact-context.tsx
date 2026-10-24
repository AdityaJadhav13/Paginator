/**
 * The contact form's service (src/services/contact-service.ts): the API in the app, the test double in tests. Only
 * its type comes from the services layer; the public pages never reach the API any other way.
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

/** Whether the form is connected: "checking" until the API answers. */
export function useContactConnection(): ContactConnection | "checking" {
  const contact = useContact();
  const [connection, setConnection] = useState<ContactConnection | "checking">("checking");
  useEffect(() => {
    let current = true;
    let asking = ASKED.get(contact);
    if (!asking) {
      asking = contact.connection().catch((): ContactConnection => "unknown");
      ASKED.set(contact, asking);
    }
    void asking.then((answer) => {
      if (answer === "unknown") ASKED.delete(contact);
      if (current) setConnection(answer);
    });
    return () => {
      current = false;
    };
  }, [contact]);
  return connection;
}
