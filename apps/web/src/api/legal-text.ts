/**
 * The owner's legal texts (03 §4.2 `/legal/*`; doc 11 L2-230): plain-text files that Caddy serves at
 * `/legal-text/<doc>.<lang>.txt` from a folder on the host (infra/caddy/Caddyfile; docs/runbooks/deploy.md), so the
 * owner's words are never in this repository or an image. Not the API: no cookie, no X-Pageinator, no ApiClient.
 * Same origin, so the CSP's connect-src 'self' covers it.
 */
export type LegalDoc = "privacy" | "terms" | "grievance";

export type LegalText = { readonly text: string } | "missing" | "failed";

/**
 * The text; "missing" when there is none (a 404, an empty file, or not plain text: the Vite dev server answers its
 * index.html for any unknown path); "failed" when there was no usable answer (no network, a server error).
 */
export async function readLegalText(doc: LegalDoc, language: "en" | "mr"): Promise<LegalText> {
  try {
    const response = await fetch(`/legal-text/${doc}.${language}.txt`);
    const plain = /^text\/plain(;|$)/i.test(response.headers.get("content-type") ?? "");
    if (response.ok && plain) {
      const text = await response.text();
      return text.trim() === "" ? "missing" : { text };
    }
    return response.ok || response.status === 404 ? "missing" : "failed";
  } catch {
    return "failed";
  }
}
