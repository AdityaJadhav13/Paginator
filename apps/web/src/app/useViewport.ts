/**
 * Reports whether the viewport is at or below the phone breakpoint
 * (UI002 §10: < 768px). Used only where a route must render a
 * genuinely different component at phone vs. desktop width — notably
 * the editor route (§10.2) — not for ordinary responsive layout, which
 * belongs in CSS media queries (`shell.css`), not JavaScript.
 */
import { useEffect, useState } from "react";

export const PHONE_MEDIA_QUERY = "(max-width: 767px)";

export function useIsPhoneViewport(): boolean {
  const [isPhone, setIsPhone] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(PHONE_MEDIA_QUERY).matches
      : false
  );

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mediaQueryList = window.matchMedia(PHONE_MEDIA_QUERY);
    const handleChange = () => setIsPhone(mediaQueryList.matches);
    handleChange();
    mediaQueryList.addEventListener("change", handleChange);
    return () => mediaQueryList.removeEventListener("change", handleChange);
  }, []);

  return isPhone;
}
