/**
 * A QR code drawn as SVG from qrcode's module matrix (no canvas, no HTML string), with a quiet zone of 4 modules.
 * The picture has a name for screen readers; the page always shows the same secret as text beside it.
 */
import { useMemo } from "react";
import { create } from "qrcode";

const QUIET = 4;

export function QrCode({ text, label }: { readonly text: string; readonly label: string }) {
  const { size, path } = useMemo(() => {
    const modules = create(text, { errorCorrectionLevel: "M" }).modules;
    let d = "";
    for (let row = 0; row < modules.size; row += 1) {
      for (let column = 0; column < modules.size; column += 1) {
        if (modules.get(row, column)) d += `M${column + QUIET} ${row + QUIET}h1v1h-1z`;
      }
    }
    return { size: modules.size + QUIET * 2, path: d };
  }, [text]);
  return (
    <svg className="pg-qr" role="img" aria-label={label} viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <rect className="pg-qr__light" width={size} height={size} />
      <path className="pg-qr__dark" d={path} />
    </svg>
  );
}

/** The secret of an otpauth:// link, in groups of four, for typing into an app by hand. */
export function totpKey(uri: string): string {
  const secret = /[?&]secret=([A-Z2-7]+)/i.exec(uri)?.[1] ?? "";
  return secret.toUpperCase().replace(/(.{4})(?=.)/g, "$1 ");
}
