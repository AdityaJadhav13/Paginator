# ADR-024: Units: float millimetres for intent, integer millipoints for resolved pages

**Status:** ACCEPTED (2026-10-20). Settles the units question left open in `05_DOCUMENT_MODEL_AND_TYPOGRAPHY.md` §2, which called a thousandth of a point a "micro-point".

## Context
- **The measured house grid is not on any integer grid.** It has an origin of 12.8154 mm and a gutter of 4.19 mm, and column measures come from divisions such as `(span − (m − 1) · gutter) / m`. Rounding these to integer micrometres would change the measures and void the transfer tests against the press-accepted output (ADR-023).
- **The press-accepted writer quantises when it writes.** It places glyphs at `round(x, 3)` points and writes sizes, scales and colours at `round(·, 4)`.
- **Basic float arithmetic is identical across engines.** IEEE-754 binary64 addition, subtraction, multiplication, division and square root are exactly specified, and JavaScript never fuses or extends them. Float-millimetre arithmetic is therefore already deterministic, provided transcendental functions are not used (they are banned by lint in kernel packages).

## Decision

| Layer | Geometry | Type sizes | Ratios (scale, k) | Colour |
|---|---|---|---|---|
| EditableDocument (what people edit) | float64 mm, finite; shortest round-trip JSON | float64 pt | float64 | CMYK integers 0–10000 |
| ResolvedPage (what the engine computes) | **integer millipoints** (1 mpt = 1/1000 pt), PDF space (y up, origin at the MediaBox lower-left) | integer 1e-4 pt | integer 1e-4 | integer 0–10000 |

1. **One y-flip.** It is applied exactly once, in the resolver's quantiser, using the reference writer's own expression `round((page_h − y) · MM, 3)` with Python's rounding (half to even, `@pageinator/pyshim`).
2. **"Micro-point" is renamed** to millipoint in doc 05.
3. **Integer-first glyph arithmetic is not adopted by default.** It is adopted only if the M7 cross-engine test shows a difference, and then with a changelog entry and new goldens.

## Consequences
- **Within the engine,** documents and engine arithmetic keep the precision of the measured grid. Resolved pages are integers, so page hashes are stable and comparable between browser and server.
- **The UI** shows millimetres, points and columns (`docs/product/02-design-system.md`); these units are a display choice only.
