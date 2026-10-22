// The one part of qrcode 1.5.4 (MIT) the app uses: the QR code's module matrix, which QrCode.tsx draws as SVG.
declare module "qrcode" {
  export interface QRCodeModules {
    readonly size: number;
    get(row: number, column: number): number | boolean;
  }
  export function create(text: string, options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" }): {
    readonly modules: QRCodeModules;
  };
}
