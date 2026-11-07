// @pageinator/pyshim — the Python semantics the kernel must reproduce exactly to match the frozen Python reference
// (rounding, number formatting, JSON, string order, hashing). M0 seeds it with float.hex; M1 completes it.
export { floatFromHex, floatToHex } from "./float.ts";
