/**
 * WCAG contrast ratio utilities for design token verification.
 * Computes ratios from hex color values; does not depend on rendered CSS.
 */

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

function srgbChannel(value: number): number {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * srgbChannel(r) + 0.7152 * srgbChannel(g) + 0.0722 * srgbChannel(b);
}

/** Returns WCAG contrast ratio (>= 1) for two hex colours. */
export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA minimum for normal text (< 18pt or < 14pt bold): 4.5:1 */
export const WCAG_AA_NORMAL = 4.5;

/** WCAG AA minimum for large text (>= 18pt or >= 14pt bold): 3:1 */
export const WCAG_AA_LARGE = 3.0;

/** WCAG AA minimum for non-text components and focus indicators: 3:1 */
export const WCAG_AA_COMPONENT = 3.0;

/**
 * Token colour pairs to verify (foreground, background, minimum ratio, label).
 * Values are taken directly from the token definitions in §6.3.
 */
export const TOKEN_CONTRAST_PAIRS: Array<{
  fg: string;
  bg: string;
  minimum: number;
  label: string;
}> = [
  // Primary text on page background
  { fg: "#17202A", bg: "#F8FAFC", minimum: WCAG_AA_NORMAL, label: "text on canvas" },
  // Primary text on surface
  { fg: "#17202A", bg: "#FFFFFF", minimum: WCAG_AA_NORMAL, label: "text on surface" },
  // Primary text on surface-subtle
  { fg: "#17202A", bg: "#F1F5F9", minimum: WCAG_AA_NORMAL, label: "text on surface-subtle" },
  // Muted text on surface
  { fg: "#4B5563", bg: "#FFFFFF", minimum: WCAG_AA_NORMAL, label: "text-muted on surface" },
  // Muted text on canvas
  { fg: "#4B5563", bg: "#F8FAFC", minimum: WCAG_AA_NORMAL, label: "text-muted on canvas" },
  // Action text on surface (links / secondary button label)
  { fg: "#1D4ED8", bg: "#FFFFFF", minimum: WCAG_AA_NORMAL, label: "action on surface" },
  // On-action text on action background
  { fg: "#FFFFFF", bg: "#1D4ED8", minimum: WCAG_AA_NORMAL, label: "on-action on action" },
  // On-action text on action-hover background
  { fg: "#FFFFFF", bg: "#1E40AF", minimum: WCAG_AA_NORMAL, label: "on-action on action-hover" },
  // Danger text on surface
  { fg: "#B91C1C", bg: "#FFFFFF", minimum: WCAG_AA_NORMAL, label: "danger on surface" },
  // Success text on surface
  { fg: "#166534", bg: "#FFFFFF", minimum: WCAG_AA_NORMAL, label: "success on surface" },
  // Warning text on surface
  { fg: "#854D0E", bg: "#FFFFFF", minimum: WCAG_AA_NORMAL, label: "warning on surface" },
  // Border against canvas (non-text component boundary)
  { fg: "#64748B", bg: "#F8FAFC", minimum: WCAG_AA_COMPONENT, label: "border on canvas" },
  // Border against surface
  { fg: "#64748B", bg: "#FFFFFF", minimum: WCAG_AA_COMPONENT, label: "border on surface" },
  // Focus indicator against canvas
  { fg: "#7C3AED", bg: "#F8FAFC", minimum: WCAG_AA_COMPONENT, label: "focus on canvas" },
  // Focus indicator against surface
  { fg: "#7C3AED", bg: "#FFFFFF", minimum: WCAG_AA_COMPONENT, label: "focus on surface" },
  // Status: simulated accent on subtle background
  { fg: "#5B21B6", bg: "#F1F5F9", minimum: WCAG_AA_COMPONENT, label: "status-simulated on surface-subtle" },
  // Status: pending accent
  { fg: "#1D4ED8", bg: "#F1F5F9", minimum: WCAG_AA_COMPONENT, label: "status-pending on surface-subtle" },
  // Status: saved-intention accent
  { fg: "#0F766E", bg: "#F1F5F9", minimum: WCAG_AA_COMPONENT, label: "status-saved-intention on surface-subtle" },
  // Status: recomposing accent
  { fg: "#9A3412", bg: "#F1F5F9", minimum: WCAG_AA_COMPONENT, label: "status-recomposing on surface-subtle" },
  // Status: confirmed-proof accent
  { fg: "#166534", bg: "#F1F5F9", minimum: WCAG_AA_COMPONENT, label: "status-confirmed-proof on surface-subtle" },
  // Status: stale accent
  { fg: "#854D0E", bg: "#F1F5F9", minimum: WCAG_AA_COMPONENT, label: "status-stale on surface-subtle" },
  // Status: failed accent
  { fg: "#B91C1C", bg: "#F1F5F9", minimum: WCAG_AA_COMPONENT, label: "status-failed on surface-subtle" },
  // Status: approved-candidate accent
  { fg: "#065F46", bg: "#F1F5F9", minimum: WCAG_AA_COMPONENT, label: "status-approved-candidate on surface-subtle" },
  // Disabled text against disabled background.
  // WCAG 2.1 SC 1.4.3 explicitly exempts inactive UI components from contrast requirements.
  // Spec §6.3: "Disabled controls remain perceivable and are never distinguished by opacity alone."
  // Using the non-text component threshold (3:1) as a reasonable perceivability standard.
  { fg: "#6B7280", bg: "#E5E7EB", minimum: WCAG_AA_COMPONENT, label: "disabled-text on disabled-bg" },
];
