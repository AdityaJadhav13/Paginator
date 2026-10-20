// Python's float.hex() and float.fromhex() for IEEE-754 binary64, bit-exact.
// The golden vectors store every float as Python writes it with float.hex() ("0x1.9e56c2e0ea792p+4"), so the
// TypeScript port compares numbers through this exact text form, never through decimal printing.

const view = new DataView(new ArrayBuffer(8));

function bitsOf(x: number): bigint {
  view.setFloat64(0, x);
  return view.getBigUint64(0);
}

function fromBits(bits: bigint): number {
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}

const MANTISSA_MASK = (1n << 52n) - 1n;

/** `float.hex(x)` exactly as CPython 3.11 writes it. */
export function floatToHex(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  const bits = bitsOf(x);
  const sign = bits >> 63n === 1n ? "-" : "";
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const mantissa = bits & MANTISSA_MASK;
  if (exponent === 0 && mantissa === 0n) return `${sign}0x0.0p+0`;
  const digits = mantissa.toString(16).padStart(13, "0");
  if (exponent === 0) return `${sign}0x0.${digits}p-1022`;
  const e = exponent - 1023;
  return `${sign}0x1.${digits}p${e < 0 ? "-" : "+"}${Math.abs(e)}`;
}

const HEX_FLOAT = /^([+-])?(?:0x)?([0-9a-f]*)(?:\.([0-9a-f]*))?(?:p([+-]?\d+))?$/i;

/**
 * `float.fromhex(text)` for values whose hex mantissa has at most 53 significant bits (always true for text written
 * by float.hex()). Longer mantissas would need rounding and are rejected rather than guessed.
 */
export function floatFromHex(text: string): number {
  const t = text.trim().toLowerCase();
  if (t === "nan" || t === "+nan" || t === "-nan") return Number.NaN;
  if (t === "inf" || t === "+inf" || t === "infinity" || t === "+infinity") return Infinity;
  if (t === "-inf" || t === "-infinity") return -Infinity;
  const m = HEX_FLOAT.exec(t);
  if (!m || ((m[2] ?? "") === "" && (m[3] ?? "") === "")) throw new Error(`not a hex float: ${text}`);
  const negative = m[1] === "-";
  const intDigits = m[2] ?? "";
  const fracDigits = m[3] ?? "";
  let mant = BigInt(`0x${intDigits}${fracDigits}`);
  let e2 = Number(m[4] ?? "0") - 4 * fracDigits.length;
  if (mant === 0n) return negative ? -0 : 0;
  while ((mant & 1n) === 0n) {
    // trailing zero bits carry no information: drop them so any exactly representable value parses
    mant >>= 1n;
    e2 += 1;
  }
  const nbits = mant.toString(2).length;
  if (nbits > 53) throw new Error(`hex float mantissa wider than 53 bits: ${text}`);
  const unbiased = e2 + nbits - 1;
  let bits: bigint;
  if (unbiased >= -1022) {
    const biased = unbiased + 1023;
    if (biased > 2046) throw new Error(`hex float out of range: ${text}`);
    const mantissa53 = mant << BigInt(53 - nbits);
    bits = (BigInt(biased) << 52n) | (mantissa53 & MANTISSA_MASK);
  } else {
    const shift = e2 + 1074;
    if (shift < 0) throw new Error(`hex float below the subnormal grid: ${text}`);
    bits = mant << BigInt(shift);
    if (bits > MANTISSA_MASK) throw new Error(`hex float subnormal overflow: ${text}`);
  }
  if (negative) bits |= 1n << 63n;
  return fromBits(bits);
}
