/** The elements a person can Tab to inside a container, in document order. */
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => !element.hidden);
}

/** Whether arrows run right-to-left here: the nearest `dir` decides. */
export function isRtl(element: HTMLElement): boolean {
  return element.closest("[dir]")?.getAttribute("dir") === "rtl";
}
