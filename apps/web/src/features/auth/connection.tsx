/** Whether the browser says it is online, and the notice the sign-in screens show while it is not. */
import { useSyncExternalStore } from "react";
import { InlineMessage } from "../../ui/index.ts";
import { useI18n } from "../../i18n/index.ts";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine !== false,
    () => true,
  );
}

/** Says, politely, when the connection goes and comes back; on arrival it is shown, not announced. */
export function OfflineNotice() {
  const online = useOnline();
  const { t } = useI18n();
  return (
    <div aria-live="polite">
      {!online && (
        <InlineMessage variant="warning" heading={t("problem.offline.heading")} iconLabel={t("message.warning")}>
          {t("connection.offline.body")}
        </InlineMessage>
      )}
    </div>
  );
}
